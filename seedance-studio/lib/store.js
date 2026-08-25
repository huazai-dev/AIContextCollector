'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

let cache = new Map();
let saveTimers = new Map();

function projectDir(id) {
  return path.join(PROJECTS_DIR, String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
}

function filePath(id) {
  return path.join(projectDir(id), 'project.json');
}

function loadAll() {
  cache = new Map();
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      const f = path.join(PROJECTS_DIR, d, 'project.json');
      try {
        const p = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (p && p.id) cache.set(p.id, p);
      } catch (_) { /* 忽略损坏的项目文件 */ }
    }
  } catch (_) { /* ignore */ }
  return cache;
}

function save(project) {
  const id = project.id;
  cache.set(id, project);
  if (saveTimers.has(id)) return;
  saveTimers.set(id, setTimeout(() => {
    saveTimers.delete(id);
    try {
      const dir = projectDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = filePath(id) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(project));
      fs.renameSync(tmp, filePath(id));
    } catch (e) {
      console.error('[store] 保存项目失败', e.message);
    }
  }, 400));
}

function saveNow(project) {
  const id = project.id;
  cache.set(id, project);
  if (saveTimers.has(id)) { clearTimeout(saveTimers.get(id)); saveTimers.delete(id); }
  try {
    const dir = projectDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath(id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(project));
    fs.renameSync(tmp, filePath(id));
  } catch (e) {
    console.error('[store] 保存项目失败', e.message);
  }
}

function get(id) {
  return cache.get(id) || null;
}

function list() {
  return [...cache.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function remove(id) {
  const p = cache.get(id);
  if (!p) return false;
  if (p.status === 'generating') return false; // 生成中的项目先取消再删除
  if (saveTimers.has(id)) { clearTimeout(saveTimers.get(id)); saveTimers.delete(id); }
  cache.delete(id);
  try { fs.rmSync(projectDir(id), { recursive: true, force: true }); } catch (_) { /* ignore */ }
  return true;
}

function summary(p) {
  return {
    id: p.id,
    title: p.script && p.script.title ? p.script.title : (p.config.title || '未命名短剧'),
    theme: p.config.theme,
    status: p.status,
    stage: p.stage,
    progress: p.progress,
    error: p.error,
    shotCount: p.config.shotCount,
    style: p.config.style,
    styleName: p.config.styleName,
    resolution: p.config.resolution,
    ratio: p.config.ratio,
    mode: p.mode,
    model: p.model,
    createdAt: p.createdAt,
    finishedAt: p.finishedAt,
    poster: p.poster,
    finalVideo: p.finalVideo,
    finalSeconds: p.finalSeconds,
    doneShots: p.shots ? p.shots.filter(s => s.status === 'done').length : 0,
    totalShots: p.shots ? p.shots.length : p.config.shotCount,
    cancelled: p.cancelled,
  };
}

module.exports = { loadAll, get, list, save, saveNow, remove, summary, projectDir, PROJECTS_DIR };
