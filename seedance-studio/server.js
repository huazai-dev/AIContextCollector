'use strict';

/**
 * Seedance 短剧工作台 —— 本地服务
 * 纯 Node 实现，零 npm 依赖（Node >= 18）
 * 启动：node server.js（端口 PORT，默认 8787）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const store = require('./lib/store');
const pipeline = require('./lib/pipeline');
const seedance = require('./lib/seedance');
const mockEngine = require('./lib/mockEngine');
const ffmpeg = require('./lib/ffmpeg');
const { STYLES, STYLE_IDS, RESOLUTIONS, RATIOS } = require('./lib/styles');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

store.loadAll();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* ---------------- 工具 ---------------- */
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (_) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath, contentType, req) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: '文件不存在' });
    const total = stat.size;
    const range = req.headers.range;
    if (range && contentType === 'video/mp4') {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : null;
        let end = m[2] ? parseInt(m[2], 10) : null;
        if (start === null && end !== null) { start = Math.max(0, total - end); end = total - 1; }
        if (end === null || end >= total) end = total - 1;
        if (start !== null && start <= end && start < total) {
          res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
          return;
        }
      }
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      // 图片允许短缓存，避免轮询刷新时反复请求海报
      'Cache-Control': contentType.startsWith('image/') ? 'public, max-age=3600' : 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------- 校验 ---------------- */
function validateConfig(body) {
  const config = body && body.config ? body.config : body;
  const errors = [];
  const theme = (config.theme || '').trim();
  if (!theme) errors.push('请填写剧情主题');
  else if (theme.length > 200) errors.push('剧情主题过长（≤200 字）');
  const characters = (config.characters || []).filter(c => c && c.name && c.name.trim());
  if (characters.length === 0) errors.push('请至少填写 1 个角色（姓名）');
  if (characters.length > 6) errors.push('角色最多 6 个');
  for (const c of characters) {
    if (c.name.trim().length > 8) errors.push(`角色名「${c.name}」过长（≤8 字）`);
    for (const k of ['role', 'personality', 'goal']) {
      if ((c[k] || '').trim().length > 30) errors.push(`角色「${c.name}」的字段过长（≤30 字）`);
    }
  }
  const shotCount = Number(config.shotCount);
  if (!(shotCount >= 2 && shotCount <= 10)) errors.push('分镜数量需在 2-10 之间');
  if (!STYLES[config.style]) errors.push('未知的视频风格');
  if (!RESOLUTIONS[config.resolution]) errors.push('未知的分辨率');
  if (!RATIOS[config.ratio]) errors.push('未知的画幅比例');
  return { errors, config: { ...config, theme, characters } };
}

/* ---------------- 路由 ---------------- */
async function handleApi(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const m = seg.slice(1); // api 之后
  const method = req.method;

  try {
    /* GET /api/status */
    if (m.length === 1 && m[0] === 'status' && method === 'GET') {
      const mode = seedance.enabled() ? 'seedance' : 'mock';
      return json(res, 200, {
        mode,
        model: mode === 'seedance' ? seedance.env().model : '本地模拟引擎',
        mockReady: mockEngine.available(),
        ffmpeg: Boolean(ffmpeg.findFfmpeg()),
        version: '1.0.0',
        styles: STYLE_IDS.map(id => ({
          id, name: STYLES[id].name, en: STYLES[id].en, desc: STYLES[id].desc,
          colors: STYLES[id].colors, accent: STYLES[id].accent,
        })),
        resolutions: Object.entries(RESOLUTIONS).map(([k, v]) => ({ id: k, label: v.label })),
        ratios: Object.entries(RATIOS).map(([k, v]) => ({ id: k, label: v.label })),
        limits: { shotCount: [2, 10], duration: [4, 8], characters: 6 },
      });
    }

    /* GET /api/projects */
    if (m.length === 1 && m[0] === 'projects' && method === 'GET') {
      return json(res, 200, { projects: store.list().map(store.summary) });
    }

    /* POST /api/projects */
    if (m.length === 1 && m[0] === 'projects' && method === 'POST') {
      const body = await readBody(req);
      const { errors, config } = validateConfig(body);
      if (errors.length) return json(res, 400, { error: errors.join('；') });
      const project = pipeline.createProject(config);
      return json(res, 201, { project });
    }

    /* /api/projects/:id ... */
    if (m.length >= 2 && m[0] === 'projects') {
      const project = store.get(m[1]);
      if (!project) return json(res, 404, { error: '项目不存在' });

      /* GET detail */
      if (m.length === 2 && method === 'GET') return json(res, 200, { project });

      /* DELETE */
      if (m.length === 2 && method === 'DELETE') {
        if (project.status === 'generating') return json(res, 409, { error: '项目生成中，请先取消再删除' });
        store.remove(project.id);
        return json(res, 200, { ok: true });
      }

      /* POST generate */
      if (m.length === 3 && m[2] === 'generate' && method === 'POST') {
        if (project.status === 'generating') return json(res, 409, { error: '项目正在生成中' });
        if (project.status !== 'draft' || project.script) {
          // 已有成果：重置后重新开始
          project.status = 'draft'; project.stage = 'idle'; project.progress = 0;
          project.shots = []; project.script = null; project.finalVideo = null;
          project.finalSeconds = 0; project.error = null; project.cancelled = false;
          project.log = []; project.poster = null;
          project.seed = Math.floor(Math.random() * 0xffffffff);
          store.saveNow(project);
        }
        pipeline.run(project);
        return json(res, 202, { ok: true, status: project.status });
      }

      /* POST cancel */
      if (m.length === 3 && m[2] === 'cancel' && method === 'POST') {
        project.cancelled = true;
        store.saveNow(project);
        return json(res, 200, { ok: true });
      }

      /* POST shots/:n/regenerate */
      if (m.length === 4 && m[1] && m[2] === 'shots' && m[3] === 'regenerate' && method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const idx = Number(body.index);
        if (!(idx >= 0 && idx < (project.shots || []).length)) return json(res, 404, { error: '分镜不存在' });
        try {
          await pipeline.regenerateShot(project, idx);
          return json(res, 200, { ok: true, shot: project.shots[idx] });
        } catch (e) {
          return json(res, 409, { error: e.message });
        }
      }

      /* GET files/:file */
      if (m.length === 4 && m[2] === 'files' && method === 'GET') {
        const fileName = path.basename(m[3]);
        if (fileName !== m[3] || fileName.includes('..')) return json(res, 400, { error: '非法文件名' });
        const dir = store.projectDir(project.id);
        const full = path.join(dir, fileName);
        if (!full.startsWith(dir)) return json(res, 400, { error: '非法路径' });
        const ext = path.extname(fileName).toLowerCase();
        if (!MIME[ext]) return json(res, 415, { error: '不支持的文件类型' });
        return serveFile(res, full, MIME[ext], req);
      }
    }

    return json(res, 404, { error: '接口不存在' });
  } catch (e) {
    console.error('[api]', req.method, url.pathname, e.message);
    return json(res, 500, { error: String(e.message || e) });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    /* 静态资源 */
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    p = decodeURIComponent(p);
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: '禁止访问' });
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) return json(res, 404, { error: '资源不存在' });
    return serveFile(res, file, MIME[ext], req);
  } catch (e) {
    console.error('[http]', e);
    if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  const mode = seedance.enabled() ? `Seedance 2.0 真实模式（${seedance.env().model}）` : '演示模式（未配置 ARK_API_KEY）';
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│   🎬 Seedance 短剧工作台 v1.0.0             │');
  console.log('└─────────────────────────────────────────────┘');
  console.log(`   ➜ 服务地址: http://localhost:${PORT}`);
  console.log(`   ➜ 运行模式: ${mode}`);
  console.log(`   ➜ 演示引擎: ${mockEngine.available() ? '就绪（ffmpeg + 字体已加载）' : '未就绪！缺少 ffmpeg 或字体'}`);
  console.log('');
  console.log('   配置真实 Seedance 2.0（可选）:');
  console.log('   export ARK_API_KEY=your-ark-api-key');
  console.log('   export SEEDANCE_MODEL=doubao-seedance-2-0-260128');
});
