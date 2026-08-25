'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CANDIDATES = [
  path.join(ROOT, 'vendor', 'imageio_ffmpeg', 'binaries', 'ffmpeg-linux-x86_64-v7.0.2'),
  path.join(ROOT, 'bin', 'ffmpeg'),
];
if (process.env.FFMPEG_BIN) CANDIDATES.unshift(process.env.FFMPEG_BIN);

let _bin;
function findFfmpeg() {
  if (_bin !== undefined) return _bin;
  for (const c of CANDIDATES) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) { fs.chmodSync(c, 0o755); _bin = c; return _bin; }
    } catch (_) { /* ignore */ }
  }
  try { _bin = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim() || null; } catch (_) { _bin = null; }
  return _bin;
}

/** 运行 ffmpeg；失败时抛出包含 stderr 尾部的错误 */
function runFfmpeg(args, { timeoutMs = 600000 } = {}) {
  const bin = findFfmpeg();
  if (!bin) return Promise.reject(new Error('未找到 ffmpeg 可执行文件'));
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); if (err.length > 20000) err = err.slice(-8000); });
    const t = timeoutMs > 0 ? setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} }, timeoutMs) : null;
    p.on('error', e => { if (t) clearTimeout(t); reject(e); });
    p.on('close', code => {
      if (t) clearTimeout(t);
      if (code === 0) resolve({ code });
      else reject(new Error(`ffmpeg 退出码 ${code}: ${err.split('\n').filter(Boolean).slice(-3).join(' | ')}`));
    });
  });
}

/** 构造风格化环境音（lavfi 图）：多正弦叠加 + 颤音 + 滤波 + 淡入淡出 */
function buildAudioGraph(style, duration, seed) {
  const a = style.audio;
  if (!a) return null;
  const freqs = a.freqs.map(f => f * (1 + (((seed % 1000) / 1000) - 0.5) * 0.02));
  const parts = [];
  freqs.forEach((f, i) => {
    let ch = `sine=frequency=${f.toFixed(1)}:duration=${duration}:sample_rate=44100`;
    if (a.tremolo) ch += `,tremolo=f=${a.tremolo.split(':')[0]}:d=${a.tremolo.split(':')[1]}`;
    if (a.lp) ch += `,lowpass=f=${a.lp}`;
    parts.push(`${ch}[s${i}]`);
  });
  if (a.noise) {
    parts.push(`anoisesrc=color=white:amplitude=0.02:seed=${seed}:duration=${duration}:sample_rate=44100,lowpass=f=350[s${parts.length}]`);
  }
  const srcs = parts.map((_, i) => `[s${i}]`).join('');
  const fadeOutAt = Math.max(0.2, duration - 0.8);
  const tail = `amix=inputs=${parts.length}:normalize=0,volume=${a.vol},afade=t=in:d=0.4,afade=t=out:st=${fadeOutAt.toFixed(2)}:d=0.8`;
  return parts.join(';') + ';' + srcs + tail;
}

/** 合成单条分镜片段：海报图 → 运镜动画 + 风格调色 + 环境音 */
async function renderClip({ posterPath, outPath, w, h, duration, style, seed }) {
  const frames = Math.max(24, Math.round(duration * 24));
  const z = style.zoom.z.replaceAll('FR', String(frames));
  const x = style.zoom.x.replaceAll('FR', String(frames));
  const y = style.zoom.y.replaceAll('FR', String(frames));
  const vf = [
    `scale=${w * 2}:${h * 2}:flags=lanczos`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${w}x${h}:fps=24`,
    'format=yuv420p',
    style.grade,
    style.letterbox
      ? `crop=${w}:${Math.round(h * 0.45)}:0:${Math.round(h * 0.275)},pad=${w}:${h}:0:${Math.round(h * 0.275)}:black`
      : null,
  ].filter(Boolean).join(',');

  const audio = buildAudioGraph(style, duration, seed);
  const args = [
    '-loop', '1', '-framerate', '24', '-i', posterPath,
    ...(audio ? ['-f', 'lavfi', '-i', audio] : []),
    '-vf', vf,
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    ...(audio ? ['-c:a', 'aac', '-b:a', '96k', '-shortest'] : []),
    '-movflags', '+faststart',
    outPath,
  ];
  await runFfmpeg(args, { timeoutMs: 600000 });
}

/** 无损拼接多个同参数片段 */
async function concatClips(inputs, outPath) {
  if (inputs.length === 0) throw new Error('没有可拼接的片段');
  if (inputs.length === 1) { fs.copyFileSync(inputs[0], outPath); return; }
  const listFile = outPath + '.concat.txt';
  fs.writeFileSync(listFile, inputs.map(p => `file '${p.replaceAll("'", "'\\''")}'`).join('\n'));
  try {
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath]);
  } finally {
    try { fs.unlinkSync(listFile); } catch (_) { /* ignore */ }
  }
}

/** 从视频中抽一帧作为海报 */
async function extractFrame(videoPath, outJpg, at = '0.5') {
  await runFfmpeg(['-ss', at, '-i', videoPath, '-frames:v', '1', '-q:v', '3', outJpg], { timeoutMs: 120000 });
}

/** 图片格式转换（png → jpg），供缩略图使用 */
async function convertImage(srcPath, outJpg) {
  await runFfmpeg(['-i', srcPath, '-frames:v', '1', '-q:v', '3', outJpg], { timeoutMs: 120000 });
}

module.exports = { findFfmpeg, runFfmpeg, renderClip, concatClips, extractFrame, convertImage, buildAudioGraph };
