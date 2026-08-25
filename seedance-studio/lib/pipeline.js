'use strict';

/**
 * 生成流水线编排：剧本 → 分镜 → 视频生成 → 成片合成
 * 引擎选择：配置 ARK_API_KEY → 真实 Seedance 2.0；否则演示模式（本地模拟渲染）
 */
const path = require('path');
const fs = require('fs');
const { generateScript } = require('./scriptEngine');
const mockEngine = require('./mockEngine');
const seedance = require('./seedance');
const ffmpeg = require('./ffmpeg');
const { STYLES, frameSize } = require('./styles');
const store = require('./store');

const ROOT = path.join(__dirname, '..');

/* 全局并发限制器 */
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const run = async fn => {
    active++;
    try { return await fn(); } finally {
      active--;
      if (queue.length) { const next = queue.shift(); next(); }
    }
  };
  return fn => new Promise((resolve, reject) => {
    const job = () => run(fn).then(resolve, reject);
    if (active < max) job(); else queue.push(job);
  });
}
const limiter = makeLimiter(Math.max(1, Number(process.env.RENDER_CONCURRENCY || 2)));

function newId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `sd-${t}-${r}`;
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function log(p, stage, message) {
  p.log = p.log || [];
  p.log.push({ t: Date.now(), stage, message });
  if (p.log.length > 120) p.log = p.log.slice(-120);
  p.logSeq = (p.logSeq || 0) + 1;
}

function setStage(p, stage, progress) {
  p.stage = stage;
  p.progress = progress;
}

function createProject(config) {
  const id = newId();
  const style = STYLES[config.style] || STYLES.cinematic;
  const project = {
    id,
    createdAt: Date.now(),
    status: 'draft',
    stage: 'idle',
    progress: 0,
    cancelled: false,
    mode: seedance.enabled() ? 'seedance' : 'mock',
    model: seedance.enabled() ? seedance.env().model : 'local-mock-engine',
    config: {
      title: (config.title || '').trim(),
      theme: (config.theme || '').trim(),
      characters: (config.characters || []).map(c => ({
        name: (c.name || '').trim(),
        role: (c.role || '').trim(),
        personality: (c.personality || '').trim(),
        goal: (c.goal || '').trim(),
      })),
      shotCount: Math.min(10, Math.max(2, Number(config.shotCount) || 6)),
      style: style.id,
      styleName: style.name,
      resolution: ['480p', '720p', '1080p'].includes(config.resolution) ? config.resolution : '720p',
      ratio: ['16:9', '9:16', '1:1'].includes(config.ratio) ? config.ratio : '16:9',
      duration: Math.min(8, Math.max(4, Number(config.duration) || 5)),
      generateAudio: config.generateAudio !== false,
    },
    script: null,
    shots: [],
    finalVideo: null,
    poster: null,
    finalSeconds: 0,
    log: [],
  };
  project.seed = hashStr(id);
  store.saveNow(project);
  return project;
}

function engineFor(p) {
  return p.mode === 'seedance' ? seedance : mockEngine;
}

/** 计算整体进度（剧本 8 / 分镜 12 / 视频 72 / 成片 8） */
function overall(p) {
  if (p.status === 'done') return 100;
  if (p.stage === 'idle') return 0;
  if (p.stage === 'script') return Math.min(8, p.progress);
  if (p.stage === 'storyboard') return 12;
  if (p.stage === 'videos') {
    const n = p.shots.length || 1;
    const doneSum = p.shots.reduce((s, sh) => s + (sh.progress || 0), 0);
    return Math.round(12 + (doneSum / n) * 0.78);
  }
  if (p.stage === 'final') return 95;
  return p.progress;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runProject(p) {
  if (p.status === 'generating') return;
  p.status = 'generating';
  p.generating = true;
  p.error = null;
  p.cancelled = false;
  p.startedAt = Date.now();
  store.saveNow(p);
  const engine = engineFor(p);

  try {
    /* ---------- 1. 剧本 ---------- */
    setStage(p, 'script', 2);
    log(p, 'script', '编剧引擎开始创作剧本…');
    store.saveNow(p);
    await sleep(p.mode === 'mock' ? 1200 : 100);
    if (p.cancelled) throw Object.assign(new Error('已取消'), { cancelled: true });
    const script = generateScript({
      theme: p.config.theme,
      characters: p.config.characters,
      shotCount: p.config.shotCount,
      styleId: p.config.style,
    });
    p.script = script;
    setStage(p, 'script', 8);
    log(p, 'script', `剧本完成：《${script.title}》——${script.genreName}，共 ${p.config.shotCount} 个分镜`);
    store.saveNow(p);

    /* ---------- 2. 分镜 ---------- */
    setStage(p, 'storyboard', 12);
    log(p, 'storyboard', '正在拆分分镜脚本（场景/画面/运镜/台词）…');
    await sleep(p.mode === 'mock' ? 1000 : 100);
    if (p.cancelled) throw Object.assign(new Error('已取消'), { cancelled: true });
    const ratio = p.config.ratio;
    const resolution = p.config.resolution;
    p.shots = script.shots.map(s => ({
      index: s.index,
      act: s.act,
      actLabel: s.actLabel,
      scene: s.scene,
      action: s.action,
      camera: s.camera,
      dialogue: s.dialogue,
      speaker: s.speaker,
      duration: p.config.duration ? Math.min(15, Math.max(4, p.config.duration)) : s.duration,
      mood: s.mood,
      status: 'pending',
      progress: 0,
      videoFile: null,
      poster: null,
      taskId: null,
      error: null,
      prompt: null,
    }));
    log(p, 'storyboard', `分镜脚本完成，共 ${p.shots.length} 镜，即将开始视频生成`);
    store.saveNow(p);

    /* ---------- 3. 视频生成 ---------- */
    setStage(p, 'videos', 14);
    log(p, 'videos', p.mode === 'seedance'
      ? `调用 Seedance 2.0（${p.model}）生成视频，分辨率 ${resolution}，画幅 ${ratio}，单镜 ${p.config.duration}s`
      : `演示模式：本地引擎模拟 Seedance 2.0 生成视频（${resolution} / ${ratio}）`);

    // 演示模式：先生成片头海报（作品卡片封面）
    if (p.mode === 'mock') {
      try {
        await limiter(() => renderTitleAssets(p));
      } catch (e) { log(p, 'final', '片头海报生成失败：' + e.message); }
    }

    const concurrency = p.mode === 'seedance' ? seedance.env().concurrency : 2;
    const shotLimiter = makeLimiter(concurrency);
    const jobs = p.shots.map(shot => shotLimiter(async () => {
      if (p.cancelled) { shot.status = 'pending'; shot.progress = 0; return; }
      shot.status = p.cancelled ? 'pending' : 'running';
      shot.progress = 1;
      shot.error = null;
      store.saveNow(p);
      try {
        const result = await engine.generateShot(p, shot, (prog, label) => {
          shot.progress = prog;
          shot.stageLabel = label;
          p.progress = overall(p);
          store.save(p);
        });
        shot.videoFile = result.videoFile;
        shot.poster = result.poster || shot.poster;
        if (result.bytes) shot.bytes = result.bytes;
        shot.status = 'done';
        shot.progress = 100;
        shot.finishedAt = Date.now();
        log(p, 'videos', `第 ${shot.index} 镜完成（${shot.duration}s）`);
      } catch (e) {
        shot.status = e.cancelled ? 'pending' : 'error';
        shot.error = e.cancelled ? null : String(e.message || e);
        shot.progress = 0;
        if (!e.cancelled) log(p, 'videos', `第 ${shot.index} 镜失败：${shot.error}`);
      }
      p.progress = overall(p);
      store.saveNow(p);
    }));
    await Promise.all(jobs);
    if (p.cancelled) throw Object.assign(new Error('已取消'), { cancelled: true });

    const doneCount = p.shots.filter(s => s.status === 'done').length;
    if (doneCount === 0) throw new Error('所有分镜均生成失败，请检查网络或 API Key');

    /* ---------- 4. 成片合成 ---------- */
    setStage(p, 'final', 92);
    log(p, 'final', doneCount === p.shots.length ? '全部分镜完成，开始合成成片…' : `部分分镜完成（${doneCount}/${p.shots.length}），开始合成成片…`);
    store.saveNow(p);

    try {
      const doneShots = p.shots.filter(s => s.status === 'done');
      if (p.mode === 'mock') {
        const titleFile = await generateTitleClipSafe(p);
        const final = await mockEngine.composeFinal(p, doneShots.map(s => s.videoFile));
        p.finalVideo = final;
        p.finalSeconds = 3 + doneShots.reduce((a, s) => a + (s.duration || 0), 0);
        p.poster = 'title.jpg';
      } else if (ffmpeg.findFfmpeg() && doneShots.length > 0) {
        const clips = doneShots.map(s => path.join(store.projectDir(p.id), s.videoFile));
        const out = path.join(store.projectDir(p.id), 'final.mp4');
        try {
          await ffmpeg.concatClips(clips, out);
          p.finalVideo = 'final.mp4';
          p.finalSeconds = doneShots.reduce((a, s) => a + (s.duration || 0), 0);
        } catch (e) { log(p, 'final', '成片拼接失败（保留分镜片段）：' + e.message); }
        p.poster = p.poster || (doneShots.find(s => s.poster) || {}).poster || null;
      }
      log(p, 'final', p.finalVideo ? `成片合成完成：${p.finalVideo}（约 ${p.finalSeconds}s）` : '成片合成完成（以分镜片段形式呈现）');
    } catch (e) {
      log(p, 'final', '成片合成失败：' + e.message);
    }

    p.status = 'done';
    p.stage = 'final';
    p.progress = 100;
    p.finishedAt = Date.now();
    log(p, 'final', `《${p.script.title}》制作完成 ✓`);
  } catch (e) {
    p.status = e.cancelled ? 'cancelled' : 'error';
    p.error = e.cancelled ? null : String(e.message || e);
    if (!e.cancelled) log(p, 'error', '流程中断：' + p.error);
  } finally {
    p.generating = false;
    p.progress = p.status === 'done' ? 100 : overall(p);
    store.saveNow(p);
  }
}

async function renderTitleAssets(p) {
  const dir = store.projectDir(p.id);
  fs.mkdirSync(dir, { recursive: true });
  const spec = mockEngine.titleSpecFor(p);
  const tmp = path.join(dir, 'title.png.spec.json');
  fs.writeFileSync(tmp, JSON.stringify(spec));
  const { spawn } = require('child_process');
  await new Promise((resolve, reject) => {
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [path.join(ROOT, 'bin', 'poster.py'), '--spec', tmp, '--out', path.join(dir, 'title.png')], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      try { fs.unlinkSync(tmp); } catch (_) {}
      if (code === 0) resolve(); else reject(new Error(err.slice(-300)));
    });
  });
  await ffmpeg.convertImage(path.join(dir, 'title.png'), path.join(dir, 'title.jpg')).catch(() => {});
  p.poster = 'title.jpg';
  store.saveNow(p);
}

async function generateTitleClipSafe(p) {
  const dir = store.projectDir(p.id);
  const hasTitle = fs.existsSync(path.join(dir, 'title.png'));
  return mockEngine.generateTitleClip(p);
}

async function run(p) {
  runProject(p).catch(e => console.error('[pipeline]', p.id, e));
}

/** 重新生成单个分镜 */
async function regenerateShot(p, shotIndex) {
  if (p.status === 'generating') throw new Error('项目正在生成中，请稍后再试');
  const shot = p.shots[shotIndex];
  if (!shot) throw new Error('分镜不存在');
  if (shot.status === 'running') throw new Error('该分镜正在生成中');
  p.status = 'generating';
  p.generating = true;
  p.cancelled = false;
  p.stage = 'videos';
  p.error = null;
  store.saveNow(p);
  try {
    shot.status = 'running';
    shot.progress = 1;
    shot.error = null;
    shot.videoFile = null;
    shot.poster = null;
    shot.taskId = null;
    store.saveNow(p);
    const result = await engineFor(p).generateShot(p, shot, (prog, label) => {
      shot.progress = prog;
      shot.stageLabel = label;
      store.save(p);
    });
    shot.videoFile = result.videoFile;
    shot.poster = result.poster || shot.poster;
    shot.status = 'done';
    shot.progress = 100;
    shot.finishedAt = Date.now();
    log(p, 'videos', `第 ${shot.index} 镜重新生成完成`);
    // 重新合成成片
    setStage(p, 'final', 92);
    const doneShots = p.shots.filter(s => s.status === 'done');
    if (p.mode === 'mock') {
      await mockEngine.composeFinal(p, doneShots.map(s => s.videoFile));
      p.finalVideo = 'final.mp4';
      p.finalSeconds = 3 + doneShots.reduce((a, s) => a + (s.duration || 0), 0);
    } else if (ffmpeg.findFfmpeg()) {
      try {
        await ffmpeg.concatClips(doneShots.map(s => path.join(store.projectDir(p.id), s.videoFile)), path.join(store.projectDir(p.id), 'final.mp4'));
        p.finalVideo = 'final.mp4';
      } catch (e) { log(p, 'final', '成片重拼失败：' + e.message); }
    }
    p.status = 'done';
    p.stage = 'final';
    p.progress = 100;
    log(p, 'final', '成片已更新');
  } catch (e) {
    shot.status = 'error';
    shot.error = String(e.message || e);
    shot.progress = 0;
    p.status = 'done';
    p.progress = overall(p);
    if (p.finalVideo) p.status = 'done';
  } finally {
    p.generating = false;
    store.saveNow(p);
  }
  return shot;
}

module.exports = { createProject, run, regenerateShot, engineFor, overall };
