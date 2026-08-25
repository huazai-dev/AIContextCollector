'use strict';

/**
 * 演示模式引擎（未配置 ARK_API_KEY 时使用）
 * 用本地「海报渲染 + ffmpeg 运镜合成」模拟 Seedance 2.0 的视频生成，
 * 并模拟生成耗时，用于完整走通「剧本 → 分镜 → 视频 → 成片」全流程。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { STYLES, frameSize } = require('./styles');
const { renderClip, concatClips, extractFrame, convertImage, findFfmpeg } = require('./ffmpeg');

const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'vendor', 'fonts', 'NotoSansSC-Regular.ttf');
const PY = process.env.PYTHON_BIN || 'python3';

const MOCK_SHOT_SECONDS = Math.max(3, Number(process.env.MOCK_SHOT_SECONDS || 7));

function specFor(project, shot) {
  const style = STYLES[project.config.style] || STYLES.cinematic;
  const { w, h } = frameSize(project.config.resolution, project.config.ratio);
  return {
    type: 'shot', w, h, seed: project.seed + shot.index * 97,
    styleId: style.id, styleName: style.name, en: style.en,
    colors: style.colors, accent: style.accent, glow: style.glow,
    deco: style.deco, letterbox: style.letterbox,
    font: FONT,
    index: shot.index, total: project.config.shotCount,
    actLabel: shot.actLabel, scene: shot.scene, camera: shot.camera,
    dialogue: shot.dialogue, speaker: shot.speaker,
  };
}

function titleSpecFor(project) {
  const style = STYLES[project.config.style] || STYLES.cinematic;
  const { w, h } = frameSize(project.config.resolution, project.config.ratio);
  return {
    type: 'title', w, h, seed: project.seed + 13,
    styleId: style.id, styleName: style.name, en: style.en,
    colors: style.colors, accent: style.accent, glow: style.glow,
    deco: style.deco, letterbox: style.letterbox,
    font: FONT,
    title: project.script.title,
    en: 'SHORT DRAMA',
    logline: project.script.logline,
    meta: `${project.config.shotCount} 镜 · ${project.config.resolution.toUpperCase()} · ${style.name} · SEEDANCE 2.0`,
  };
}

function renderPoster(spec, outPng) {
  return new Promise((resolve, reject) => {
    const tmp = outPng + '.spec.json';
    fs.writeFileSync(tmp, JSON.stringify(spec));
    const p = spawn(PY, [path.join(ROOT, 'bin', 'poster.py'), '--spec', tmp, '--out', outPng], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', code => {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      if (code === 0) resolve(outPng);
      else reject(new Error(`海报渲染失败: ${err.slice(-400)}`));
    });
  });
}

async function ensureAssets(project) {
  const dir = path.join(ROOT, 'data', 'projects', project.id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 生成单镜视频（模拟进度 + 真实本地渲染）
 */
async function generateShot(project, shot, onProgress) {
  const style = STYLES[project.config.style] || STYLES.cinematic;
  const dir = await ensureAssets(project);
  const { w, h } = frameSize(project.config.resolution, project.config.ratio);
  const posterPng = path.join(dir, `shot_${String(shot.index).padStart(2, '0')}.png`);
  const posterJpg = path.join(dir, `shot_${String(shot.index).padStart(2, '0')}.jpg`);
  const videoFile = `shot_${String(shot.index).padStart(2, '0')}.mp4`;
  const videoPath = path.join(dir, videoFile);

  // 1) 渲染海报
  await renderPoster(specFor(project, shot), posterPng);
  await convertImage(posterPng, posterJpg).catch(() => {});

  // 2) 渲染视频 + 模拟进度
  const simMs = MOCK_SHOT_SECONDS * 1000 * (0.75 + 0.5 * Math.random());
  const renderPromise = renderClip({
    posterPath: posterPng, outPath: videoPath, w, h,
    duration: shot.duration, style, seed: project.seed + shot.index,
  });
  const start = Date.now();
  let done = false;
  renderPromise.finally(() => { done = true; }).catch(() => {});
  await new Promise(resolve => {
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = done ? 100 : Math.min(93, Math.round((elapsed / simMs) * 93));
      onProgress && onProgress(p, p >= 93 ? '渲染合成中' : 'AI 生成中');
      if (done) return resolve();
      if (elapsed >= simMs && !done) {
        // 等待真实渲染完成
        const wait = setInterval(() => { if (done) { clearInterval(wait); resolve(); } }, 200);
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
  await renderPromise; // 若失败抛出
  onProgress && onProgress(100, '完成');
  return { videoFile, poster: `shot_${String(shot.index).padStart(2, '0')}.jpg` };
}

/** 生成片头（3 秒标题卡） */
async function generateTitleClip(project) {
  const style = STYLES[project.config.style] || STYLES.cinematic;
  const dir = await ensureAssets(project);
  const { w, h } = frameSize(project.config.resolution, project.config.ratio);
  const posterPng = path.join(dir, 'title.png');
  const posterJpg = path.join(dir, 'title.jpg');
  await renderPoster(titleSpecFor(project), posterPng);
  await convertImage(posterPng, posterJpg).catch(() => {});
  await renderClip({
    posterPath: posterPng, outPath: path.join(dir, 'title.mp4'), w, h,
    duration: 3, style, seed: project.seed + 5,
  });
  return 'title.mp4';
}

/** 拼接成片：片头 + 各分镜 */
async function composeFinal(project, shotVideos) {
  const dir = await ensureAssets(project);
  const parts = [path.join(dir, 'title.mp4'), ...shotVideos.map(v => path.join(dir, v))];
  const out = path.join(dir, 'final.mp4');
  await concatClips(parts, out);
  return 'final.mp4';
}

function available() {
  return Boolean(findFfmpeg()) && fs.existsSync(FONT) && fs.existsSync(path.join(ROOT, 'bin', 'poster.py'));
}

module.exports = { generateShot, generateTitleClip, composeFinal, specFor, titleSpecFor, available };
