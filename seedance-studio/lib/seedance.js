'use strict';

/**
 * 火山方舟 Seedance 2.0 视频生成客户端（真实 API）
 *
 * 接口（官方文档）：
 *   创建任务  POST {base}/contents/generations/tasks
 *   查询任务  GET  {base}/contents/generations/tasks/{id}
 *   成功后从 content.video_url 下载 mp4（直链 24 小时有效）
 *
 * 环境变量：
 *   ARK_API_KEY         必填，火山方舟 API Key（配置后自动切换为真实模式）
 *   SEEDANCE_BASE_URL   默认 https://ark.cn-beijing.volces.com/api/v3
 *   SEEDANCE_MODEL      默认 doubao-seedance-2-0-260128（极速版 doubao-seedance-2-0-fast-260128）
 */
const fs = require('fs');
const path = require('path');
const { extractFrame, findFfmpeg } = require('./ffmpeg');

const ROOT = path.join(__dirname, '..');

function env() {
  return {
    apiKey: process.env.ARK_API_KEY || '',
    baseUrl: process.env.SEEDANCE_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    model: process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-260128',
    pollIntervalMs: Math.max(4000, Number(process.env.SEEDANCE_POLL_MS || 8000)),
    concurrency: Math.max(1, Number(process.env.SEEDANCE_CONCURRENCY || 2)),
    timeoutMs: Math.max(5, Number(process.env.SEEDANCE_TIMEOUT_MIN || 20)) * 60000,
  };
}

function enabled() {
  return Boolean(process.env.ARK_API_KEY);
}

async function arkFetch(cfg, urlPath, options = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + urlPath, {
        ...options,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (!res.ok) {
        const msg = (data && (data.error && (data.error.message || data.error.code))) || `HTTP ${res.status}`;
        if (res.status === 429 || res.status >= 500) { lastErr = new Error(msg); await sleep(2000 * (i + 1)); continue; }
        throw new Error(`Seedance 接口错误: ${msg}`);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr || new Error('Seedance 接口请求失败');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 构建单镜提示词 */
function buildPrompt(project, shot) {
  const cfg = project.config;
  const seen = new Set();
  const chars = (project.script.characters || [])
    .filter(c => (seen.has(c.name) ? false : (seen.add(c.name), true)))
    .map(c => `${c.name}（${[c.role, c.personality].filter(Boolean).join('，')}）`)
    .join('、');
  const style = require('./styles').STYLES[cfg.style] || require('./styles').STYLES.cinematic;
  const parts = [
    style.promptTag,
    `角色设定：${chars}。`,
    `场景：${shot.scene}。`,
    `画面内容：${shot.action}。`,
    `运镜：${shot.camera}。`,
    shot.dialogue ? `台词："${shot.dialogue}"，角色口型与对白自然同步。` : '',
    `${style.qualityTag}，${cfg.ratio} 画幅，${shot.duration} 秒，24fps。`,
  ];
  return parts.filter(Boolean).join('');
}

/** 创建视频生成任务 */
async function createTask(cfg, prompt, shot) {
  const body = {
    model: cfg.model,
    content: [{ type: 'text', text: prompt }],
    generate_audio: shot.generateAudio,
    ratio: shot.ratio,
    duration: Math.min(15, Math.max(4, Math.round(shot.duration))),
    watermark: false,
    resolution: shot.resolution,
  };
  const data = await arkFetch(cfg, '/contents/generations/tasks', { method: 'POST', body: JSON.stringify(body) });
  if (!data || !data.id) throw new Error('Seedance 未返回任务 ID: ' + JSON.stringify(data).slice(0, 300));
  return data.id;
}

/** 查询任务状态 */
async function getTask(cfg, taskId) {
  const data = await arkFetch(cfg, `/contents/generations/tasks/${taskId}`);
  if (!data) throw new Error('Seedance 查询任务无响应');
  return {
    id: taskId,
    status: data.status || 'unknown',
    videoUrl: data.content && data.content.video_url,
    error: data.error ? (data.error.message || data.error.code || '未知错误') : null,
    usage: data.usage || null,
  };
}

/** 下载视频到本地 */
async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载视频失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10000) throw new Error('下载的视频文件异常（过小）');
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

/**
 * 生成单镜视频（真实模式）：提交任务 → 轮询 → 下载 → 抽帧海报
 */
async function generateShot(project, shot, onProgress) {
  const cfg = env();
  const dir = path.join(ROOT, 'data', 'projects', project.id);
  fs.mkdirSync(dir, { recursive: true });
  const prompt = buildPrompt(project, shot);
  shot.prompt = prompt;

  onProgress && onProgress(2, '提交生成任务');
  const taskId = await createTask(cfg, prompt, {
    generateAudio: project.config.generateAudio,
    ratio: project.config.ratio,
    duration: shot.duration,
    resolution: project.config.resolution,
  });
  shot.taskId = taskId;

  const start = Date.now();
  // 预估耗时（官方实测 720p 5s 约 2-5 分钟）
  const expected = 50000 + Math.round(shot.duration) * 30000;
  let lastStatus = 'queued';
  while (true) {
    if (project.cancelled) throw Object.assign(new Error('已取消'), { cancelled: true });
    const info = await getTask(cfg, taskId);
    lastStatus = info.status;
    if (info.status === 'succeeded') {
      if (!info.videoUrl) throw new Error('任务成功但未返回视频地址');
      onProgress && onProgress(96, '下载成片');
      const videoFile = `shot_${String(shot.index).padStart(2, '0')}.mp4`;
      const bytes = await download(info.videoUrl, path.join(dir, videoFile));
      onProgress && onProgress(99, '生成海报');
      let poster = null;
      if (findFfmpeg()) {
        const posterFile = `shot_${String(shot.index).padStart(2, '0')}.jpg`;
        await extractFrame(path.join(dir, videoFile), path.join(dir, posterFile), '0.5').catch(() => {});
        if (fs.existsSync(path.join(dir, posterFile))) poster = posterFile;
      }
      onProgress && onProgress(100, '完成');
      return { videoFile, poster, bytes };
    }
    if (info.status === 'failed' || info.status === 'cancelled') {
      throw new Error(`视频生成失败: ${info.error || info.status}`);
    }
    const elapsed = Date.now() - start;
    if (elapsed > cfg.timeoutMs) throw new Error(`视频生成超时（>${cfg.timeoutMs / 60000} 分钟）`);
    const p = Math.min(95, Math.round(8 + (elapsed / expected) * 86));
    const label = info.status === 'queued' ? '排队中' : 'AI 生成中';
    onProgress && onProgress(p, label);
    await sleep(cfg.pollIntervalMs);
  }
}

module.exports = { enabled, env, generateShot, buildPrompt, createTask, getTask };
