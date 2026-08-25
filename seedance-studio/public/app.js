'use strict';

/* ================= Seedance 短剧工作台 前端 ================= */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const state = {
  meta: null,
  projects: [],
  activeId: null,
  activeProject: null,
  view: 'create',
  renderKey: '',
  polling: null,
};

/* ---------------- 工具 ---------------- */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

function toast(message, type = '') {
  const box = $('#toasts');
  const t = el('div', { class: `toast ${type}` }, message);
  box.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => t.remove(), 3600);
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtSize(n) { return n ? `${(n / 1048576).toFixed(1)} MB` : ''; }
function fmtDuration(s) { return s ? `${s} 秒` : ''; }

const fileUrl = (pid, name) => `/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(name)}`;

const STATUS_TEXT = {
  draft: '待生成', generating: '生成中', done: '已完成', error: '失败', cancelled: '已取消',
};
const SHOT_STATUS = {
  pending: ['待生成', 's-pending'],
  queued: ['排队中', 's-queued'],
  running: ['生成中', 's-running'],
  done: ['完成', 's-done'],
  error: ['失败', 's-error'],
};

/* ================= 初始化 ================= */
async function init() {
  try {
    state.meta = await api('/api/status');
  } catch (e) {
    toast('无法连接服务：' + e.message, 'error');
    return;
  }
  renderModeBadge();
  renderStyles();
  renderCharRow({ name: '', role: '', personality: '', goal: '' });
  bindForm();
  bindTabs();
  $('#fShots').addEventListener('input', e => {
    $('#fShotsVal').textContent = e.target.value;
    $$('.shot-quick .chip').forEach(c => c.classList.toggle('active', Number(c.dataset.shots) === Number(e.target.value)));
  });
  $('#fDuration').addEventListener('input', e => { $('#fDurationVal').textContent = e.target.value; });
  refreshLibrary();
  startPolling();
}

function renderModeBadge() {
  const badge = $('#modeBadge');
  if (state.meta.mode === 'seedance') {
    badge.className = 'mode-badge seedance';
    badge.textContent = `🟢 Seedance 2.0 已接入 · ${state.meta.model}`;
  } else {
    badge.className = 'mode-badge mock';
    badge.textContent = '🟡 演示模式 · 未配置 ARK_API_KEY';
    badge.title = '配置环境变量 ARK_API_KEY 后自动切换为真实 Seedance 2.0 视频生成（doubao-seedance-2-0-260128）';
  }
  $('#footerMode').textContent = state.meta.mode === 'seedance'
    ? `Seedance 2.0 · ${state.meta.model}`
    : `演示模式 · 本地模拟引擎${state.meta.mockReady ? '' : '（资源缺失）'}`;
  $('#formNote').textContent = state.meta.mode === 'seedance'
    ? '将调用火山方舟 Seedance 2.0 真实生成视频，请留意 API 用量。'
    : '演示模式：由本地引擎模拟 Seedance 2.0 生成流程，成片为风格化占位画面；配置 ARK_API_KEY 后即为真实视频。';
}

function renderStyles() {
  const box = $('#styleList');
  box.innerHTML = '';
  state.meta.styles.forEach((s, i) => {
    const card = el('div', { class: 'style-card' + (i === 0 ? ' selected' : ''), 'data-style': s.id }, [
      el('div', {
        class: 'style-preview',
        style: { background: `linear-gradient(135deg, ${s.colors[0]}, ${s.colors[1]} 55%, ${s.colors[2]})` },
      }),
      el('div', { class: 'style-info' }, [
        el('div', { class: 'style-name' }, [s.name, el('small', { text: s.en })]),
        el('div', { class: 'style-desc', text: s.desc }),
      ]),
    ]);
    card.addEventListener('click', () => {
      $$('.style-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
    box.append(card);
  });
}

/* ---------------- 表单 ---------------- */
function renderCharRow(char = {}) {
  const row = el('div', { class: 'char-row' }, [
    el('input', { type: 'text', placeholder: '姓名 *', maxlength: 8, value: char.name || '' }),
    el('input', { type: 'text', placeholder: '身份（如 外卖小哥）', maxlength: 30, value: char.role || '' }),
    el('input', { type: 'text', placeholder: '性格（如 隐忍坚韧）', maxlength: 30, value: char.personality || '' }),
    el('input', { type: 'text', placeholder: '目标/欲望（如 守护家人）', maxlength: 30, value: char.goal || '' }),
    el('button', {
      type: 'button', class: 'char-del', title: '删除角色',
      onclick: () => {
        if ($$('.char-row').length <= 1) { toast('至少保留 1 个角色'); return; }
        row.remove();
      },
    }, '✕'),
  ]);
  $('#charList').append(row);
}

function bindForm() {
  $('#btnAddChar').addEventListener('click', () => {
    if ($$('.char-row').length >= 6) { toast('角色最多 6 个', 'error'); return; }
    renderCharRow();
  });
  $$('.shot-quick .chip').forEach(c => c.addEventListener('click', () => {
    $('#fShots').value = c.dataset.shots;
    $('#fShotsVal').textContent = c.dataset.shots;
    $$('.shot-quick .chip').forEach(x => x.classList.toggle('active', x === c));
  }));

  $('#createForm').addEventListener('submit', async e => {
    e.preventDefault();
    const theme = $('#fTheme').value.trim();
    const characters = $$('.char-row').map(r => {
      const inputs = r.querySelectorAll('input');
      return { name: inputs[0].value.trim(), role: inputs[1].value.trim(), personality: inputs[2].value.trim(), goal: inputs[3].value.trim() };
    }).filter(c => c.name);
    const config = {
      theme,
      characters,
      shotCount: Number($('#fShots').value),
      style: ($('.style-card.selected') || {}).dataset && document.querySelector('.style-card.selected').dataset.style,
      resolution: $('#fResolution').value,
      ratio: $('#fRatio').value,
      duration: Number($('#fDuration').value),
      generateAudio: $('#fAudio').checked,
    };
    if (!theme) { toast('请先填写剧情主题', 'error'); $('#fTheme').focus(); return; }
    if (!characters.length) { toast('请至少填写 1 个角色的姓名', 'error'); return; }
    const btn = $('#btnCreate');
    btn.disabled = true;
    btn.textContent = '⏳ 创建中…';
    try {
      const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify({ config }) });
      state.activeId = project.id;
      state.activeProject = project;
      switchView('workspace');
      await startGeneration(project.id);
      toast('项目已创建，开始生成！', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 开始生成短剧';
    }
  });
}

async function startGeneration(id) {
  try {
    await api(`/api/projects/${encodeURIComponent(id)}/generate`, { method: 'POST' });
  } catch (e) {
    toast(e.message, 'error');
  }
  refreshProject(id, true);
}

/* ---------------- 视图切换 ---------------- */
function bindTabs() {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
  $('#btnNewProject').addEventListener('click', () => switchView('create'));
}
function switchView(view) {
  state.view = view;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  $('#view-create').hidden = view !== 'create';
  $('#view-workspace').hidden = view !== 'workspace';
  $('#view-library').hidden = view !== 'library';
  if (view === 'library') refreshLibrary();
  if (view === 'workspace' && state.activeId) refreshProject(state.activeId, true);
}

/* ================= 工作台 ================= */
async function refreshProject(id, force = false) {
  let p;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(id)}`);
    p = data.project;
  } catch (e) {
    if (String(e.message).includes('项目不存在')) {
      state.activeId = null;
      state.activeProject = null;
      if (state.view === 'workspace') { switchView('library'); refreshLibrary(); }
    }
    return;
  }
  state.activeProject = p;
  const key = renderKey(p);
  if (force || key !== state.renderKey) {
    if (anyVideoPlaying()) {
      // 用户正在看视频：只做局部更新，避免打断播放
      updateWorkspaceDynamic(p);
    } else {
      renderWorkspace(p);
      state.renderKey = key;
    }
  } else {
    updateWorkspaceDynamic(p);
  }
  if (p.status === 'generating' && state.view === 'workspace' && state.activeId === id) {
    setTimeout(() => refreshProject(id), 1200);
  }
}

function renderKey(p) {
  return [
    p.status, p.stage, p.progress, p.error || '',
    (p.shots || []).map(s => `${s.status}:${s.progress}`).join(','),
    p.logSeq || 0,
    p.finalVideo || '',
  ].join('|');
}

function anyVideoPlaying() {
  return $$('#view-workspace video').some(v => !v.paused && !v.ended);
}

function updateWorkspaceDynamic(p) {
  // 视频播放中时不整体重渲染，仅更新进度数字
  const ov = $('#overviewPct');
  if (ov) ov.textContent = p.progress + '%';
  const bar = $('#overviewBarInner');
  if (bar) bar.style.width = p.progress + '%';
  const chip = $('#wsStatusChip');
  if (chip) { chip.className = 'status-chip ' + (p.status === 'generating' ? 'generating' : p.status); chip.textContent = STATUS_TEXT[p.status] || p.status; }
  (p.shots || []).forEach(s => {
    const card = document.querySelector(`.shot-card[data-idx="${s.index}"]`);
    if (!card) return;
    const pctEl = card.querySelector('.pct');
    if (pctEl) pctEl.textContent = s.progress + '%';
    const barEl = card.querySelector('.bar i');
    if (barEl) barEl.style.width = s.progress + '%';
  });
}

function renderWorkspace(p) {
  const box = $('#view-workspace');
  box.innerHTML = '';
  const cfg = p.config;
  const shots = p.shots || [];

  /* 头部 */
  const head = el('div', { class: 'ws-head' }, [
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => switchView('create') }, '← 创作台'),
    el('div', { class: 'ws-title', text: (p.script && p.script.title) || (cfg.title || '未命名短剧') }),
    el('span', { id: 'wsStatusChip', class: 'status-chip ' + (p.status === 'generating' ? 'generating' : p.status), text: STATUS_TEXT[p.status] || p.status }),
    el('div', { class: 'ws-actions' }, [
      p.status === 'generating'
        ? el('button', { class: 'btn btn-danger', onclick: () => cancelProject(p) }, '⏹ 取消生成')
        : el('button', { class: 'btn btn-primary', onclick: () => startGeneration(p.id) }, p.status === 'draft' ? '🚀 开始生成' : '🔁 重新生成'),
      p.finalVideo ? el('a', { class: 'btn btn-ghost', href: fileUrl(p.id, p.finalVideo), download: `${p.script ? p.script.title : 'short-drama'}.mp4` }, '⬇ 下载成片') : null,
      el('button', { class: 'btn btn-ghost', onclick: () => deleteProject(p) }, '🗑 删除'),
    ]),
  ]);
  box.append(head);

  /* 步骤条 */
  const stages = [
    ['script', '1', '剧本生成'], ['storyboard', '2', '分镜脚本'], ['videos', '3', '视频生成'], ['final', '4', '成片合成'],
  ];
  const order = ['idle', 'script', 'storyboard', 'videos', 'final'];
  const curIdx = order.indexOf(p.stage);
  const stepper = el('div', { class: 'stepper' });
  stages.forEach(([key, num, label], i) => {
    const state2 = p.status === 'done' || i < curIdx ? 'done' : i === curIdx ? 'active' : '';
    const step = el('div', { class: 'step ' + state2 }, [
      el('div', { class: 'step-dot', text: state2 === 'done' ? '✓' : num }),
      el('div', { class: 'step-label', text: label }),
    ]);
    stepper.append(step);
    if (i < stages.length - 1) stepper.append(el('div', { class: 'step-line' }, [el('i', { style: { width: (p.status === 'done' || i < curIdx) ? '100%' : '0%' } })]));
  });
  box.append(stepper);

  if (p.status === 'error' && p.error) {
    box.append(el('div', { class: 'panel overview', style: { marginBottom: '18px', borderColor: 'rgba(248,113,113,.4)' } }, [
      el('div', { class: 'overview-row' }, [el('b', { text: '⚠️ 生成失败：' }), el('span', { text: p.error })]),
      el('div', { class: 'field-hint', text: '可点击「重新生成」重试，或删除项目。' }),
    ]));
  }

  const grid = el('div', { class: 'ws-grid' });

  /* 左栏：剧本 */
  const scriptPanel = el('div', { class: 'panel script-panel' });
  if (p.script) {
    scriptPanel.append(
      el('h3', { text: '📜 剧本' }),
      el('div', { class: 'script-title', text: p.script.title }),
      el('div', { class: 'script-genre', text: `${p.script.genreName} · ${cfg.styleName} · ${cfg.shotCount} 镜 · ${cfg.resolution} · ${cfg.ratio}` }),
      el('div', { class: 'script-logline', text: p.script.logline }),
      el('h3', { text: '🎭 角色' }),
      el('div', { class: 'char-cards' }, (p.script.characters || []).map(c =>
        el('div', { class: 'char-card' }, [
          el('span', { class: 'tag', text: c.tag }),
          el('span', { class: 'cname', text: c.name }),
          el('span', { class: 'cinfo', text: [c.role, c.personality, c.goal].filter(Boolean).join(' · ') || '神秘角色' }),
        ])
      )),
      el('h3', { text: '🎬 分镜脚本' }),
      ...(p.script.acts || []).map(act => el('div', { class: 'act-block' }, [
        el('div', { class: 'act-title', text: `${act.label} — ${act.summary}` }),
        ...shots.filter(s => s.act === act.act).map(s => el('div', { class: 'shot-script-item' }, [
          el('b', { text: `第${s.index}镜 · ${s.scene} ` }),
          el('span', { text: s.action }),
          s.dialogue ? el('div', { class: 'dlg', text: `${s.speaker}：${s.dialogue}` }) : null,
          el('div', { class: 'shot-cam', text: `📷 ${s.camera} · ${s.duration}s` }),
        ])),
      ]))
    );
  } else {
    scriptPanel.append(el('h3', { text: '📜 剧本' }), el('div', { class: 'field-hint', text: '剧本生成后将在此展示…' }));
  }
  grid.append(scriptPanel);

  /* 右栏 */
  const right = el('div', { class: 'ws-right' });

  /* 总进度 */
  const overview = el('div', { class: 'panel overview' }, [
    el('div', { class: 'overview-row' }, [
      el('span', { id: 'overviewPct', class: 'overview-pct', text: p.progress + '%' }),
      el('span', { class: 'overview-stage', text: stageText(p) }),
      el('span', { class: 'overview-meta', text: `${p.mode === 'seedance' ? 'Seedance 2.0' : '演示引擎'} · ${(shots.filter(s => s.status === 'done')).length}/${shots.length} 镜完成` }),
    ]),
    el('div', { class: 'bar ' + (p.status === 'error' ? 'red' : '') }, [el('i', { id: 'overviewBarInner', style: { width: p.progress + '%' } })]),
  ]);
  right.append(overview);

  /* 分镜卡片 */
  if (shots.length) {
    const shotsGrid = el('div', { class: 'shots-grid' });
    shots.forEach(s => shotsGrid.append(shotCard(p, s)));
    right.append(shotsGrid);
  }

  /* 成片 */
  if (p.finalVideo || (p.status === 'done' && shots.some(s => s.status === 'done'))) {
    right.append(finalPanel(p));
  }

  /* 日志 */
  if (p.log && p.log.length) {
    const logDetails = el('details', { class: 'panel log-panel' }, [
      el('summary', { text: `📋 生成日志（${p.log.length}）` }),
      el('div', { class: 'log-feed' }, p.log.slice(-60).map(l =>
        el('div', { class: 'log-line ' + l.stage }, [
          el('b', { text: `[${fmtTime(l.t)}]` }),
          el('span', { text: l.message }),
        ])
      )),
    ]);
    right.append(logDetails);
  }

  grid.append(right);
  box.append(grid);
}

function stageText(p) {
  if (p.status === 'done') return '全部完成，成片已就绪 🎉';
  if (p.status === 'error') return '流程中断';
  if (p.status === 'cancelled') return '已取消';
  const map = { script: '编剧引擎创作剧本中…', storyboard: '拆分分镜脚本中…', videos: 'Seedance 逐镜生成视频中…', final: '合成成片中…' };
  return map[p.stage] || '准备中…';
}

function shotCard(p, s) {
  const aspect = { '16:9': '16/9', '9:16': '9/16', '1:1': '1/1' }[p.config.ratio] || '16/9';
  const [stText, stCls] = SHOT_STATUS[s.status] || [s.status, ''];
  const card = el('div', { class: 'shot-card', 'data-idx': s.index });

  const poster = el('div', { class: 'shot-poster', style: { aspectRatio: aspect } });
  if (s.poster) poster.append(el('img', { src: fileUrl(p.id, s.poster), alt: `第${s.index}镜` }));
  else poster.append(el('div', { class: 'ph', text: `第${s.index}镜` }));
  poster.append(el('span', { class: 'status-chip small ' + stCls, text: stText }));
  poster.append(el('span', { class: 'dur', text: `${s.duration}s` }));
  card.append(poster);

  const body = el('div', { class: 'shot-body' }, [
    el('div', { class: 'shot-scene', text: `第 ${s.index} 镜 · ${s.scene}` }),
    s.dialogue ? el('div', { class: 'shot-dlg', text: `${s.speaker}：${s.dialogue}` }) : null,
    el('div', { class: 'shot-cam', text: `📷 ${s.camera}` }),
    s.error ? el('div', { class: 'shot-err', text: '⚠️ ' + s.error }) : null,
    (s.status === 'running' || s.status === 'queued') ? el('div', { class: 'shot-status-row' }, [
      el('span', { text: s.stageLabel || (s.status === 'queued' ? '排队中…' : '生成中…') }),
      el('span', { class: 'pct', text: s.progress + '%' }),
      el('div', { class: 'bar slim', style: { flex: 1 } }, [el('i', { style: { width: s.progress + '%' } })]),
    ]) : null,
    el('div', { class: 'shot-actions' }, [
      s.status === 'done' && s.videoFile
        ? el('a', { class: 'btn btn-ghost btn-sm', href: fileUrl(p.id, s.videoFile), download: `shot_${s.index}.mp4` }, '⬇ 下载')
        : null,
      (s.status === 'done' || s.status === 'error') && p.status !== 'generating'
        ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => regenerateShot(p, s) }, '🔁 重生成')
        : null,
    ]),
  ]);
  card.append(body);
  return card;
}

function finalPanel(p) {
  const panel = el('div', { class: 'panel final-panel' }, [
    el('h3', { text: '🎉 成片' }),
  ]);
  if (p.finalVideo) {
    panel.append(
      el('video', { class: 'final-player', controls: true, poster: p.poster ? fileUrl(p.id, p.poster) : '', src: fileUrl(p.id, p.finalVideo) }),
      el('div', { class: 'final-meta' }, [
        el('span', { text: `⏱ ${p.finalSeconds || ''}秒` }),
        el('span', { text: `${p.config.resolution} · ${p.config.ratio}` }),
        el('span', { text: `${p.config.styleName} · ${p.config.shotCount} 镜` }),
        el('a', { href: fileUrl(p.id, p.finalVideo), download: `${p.script ? p.script.title : 'short-drama'}.mp4`, style: { color: '#c4b5fd' } }, '下载 MP4'),
      ])
    );
  }
  const doneShots = (p.shots || []).filter(s => s.status === 'done' && s.videoFile);
  if (doneShots.length) {
    panel.append(el('div', { style: { margin: '14px 0 8px', fontSize: '13px', color: 'var(--text-2)' } }, `分镜片段（${doneShots.length}）`));
    panel.append(el('div', { class: 'clip-strip' }, doneShots.map(s =>
      el('div', { class: 'clip-item' }, [
        el('video', { controls: true, preload: 'metadata', poster: s.poster ? fileUrl(p.id, s.poster) : '', src: fileUrl(p.id, s.videoFile) }),
        el('div', { class: 'clip-label', text: `第 ${s.index} 镜 · ${s.duration}s` }),
      ])
    )));
  }
  return panel;
}

/* ---------------- 操作 ---------------- */
async function cancelProject(p) {
  try {
    await api(`/api/projects/${encodeURIComponent(p.id)}/cancel`, { method: 'POST' });
    toast('已发送取消指令');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteProject(p) {
  if (!confirm(`确定删除《${(p.script && p.script.title) || p.config.title || '未命名短剧'}》？所有成片将被删除。`)) return;
  try {
    await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    toast('项目已删除');
    if (state.activeId === p.id) { state.activeId = null; state.activeProject = null; }
    switchView('library');
  } catch (e) { toast(e.message, 'error'); }
}

async function regenerateShot(p, shot) {
  try {
    await api(`/api/projects/${encodeURIComponent(p.id)}/shots/regenerate`, {
      method: 'POST', body: JSON.stringify({ index: shot.index - 1 }),
    });
    toast(`第 ${shot.index} 镜已重新提交生成`);
    refreshProject(p.id, true);
  } catch (e) { toast(e.message, 'error'); }
}

/* ================= 成片库 ================= */
async function refreshLibrary() {
  try {
    const data = await api('/api/projects');
    state.projects = data.projects;
  } catch (_) { return; }
  const grid = $('#libraryGrid');
  grid.innerHTML = '';
  $('#libCount').textContent = state.projects.length ? `· ${state.projects.length}` : '';
  if (!state.projects.length) {
    grid.append(el('div', { class: 'empty-tip' }, [
      el('div', { class: 'big', text: '🎬' }),
      el('div', { text: '还没有作品，去创作台生成你的第一部 AI 短剧吧！' }),
    ]));
    return;
  }
  state.projects.forEach(p => grid.append(libCard(p)));
}

function libCard(p) {
  const card = el('div', { class: 'lib-card' });
  const thumb = el('div', { class: 'lib-thumb' });
  if (p.poster) thumb.append(el('img', { src: fileUrl(p.id, p.poster), alt: p.title }));
  else thumb.append(el('div', { class: 'ph', text: p.title || '短剧' }));
  thumb.append(el('span', {
    class: 'status-chip ' + (p.status === 'generating' ? 'generating' : p.status),
    text: STATUS_TEXT[p.status] || p.status,
  }));
  if (p.status === 'done' && p.finalVideo) thumb.append(el('div', { class: 'play-btn', text: '▶' }));
  card.append(thumb);

  const body = el('div', { class: 'lib-body' }, [
    el('div', { class: 'lib-title', text: p.title || '未命名短剧' }),
    p.theme ? el('div', { class: 'lib-theme', text: p.theme }) : null,
    el('div', { class: 'lib-meta' }, [
      el('span', { text: `${p.styleName || ''}` }),
      el('span', { text: `${p.shotCount} 镜` }),
      el('span', { text: `${p.resolution}` }),
      el('span', { text: p.ratio }),
      p.mode === 'seedance' ? el('span', { text: 'Seedance 2.0', style: { color: '#6ee7b7' } }) : el('span', { text: '演示' }),
    ]),
    p.status === 'generating' ? el('div', { class: 'bar slim', style: { marginTop: '6px' } }, [el('i', { style: { width: p.progress + '%' } })]) : null,
    p.error ? el('div', { class: 'shot-err', text: p.error }) : null,
    el('div', { class: 'lib-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: e => { e.stopPropagation(); state.activeId = p.id; switchView('workspace'); refreshProject(p.id, true); },
      }, p.status === 'generating' ? '查看进度' : p.status === 'done' ? '▶ 查看成片' : '打开项目'),
      el('button', {
        class: 'btn btn-danger btn-sm',
        onclick: async e => {
          e.stopPropagation();
          if (!confirm(`确定删除《${p.title}》？`)) return;
          try { await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); refreshLibrary(); toast('已删除'); }
          catch (err) { toast(err.message, 'error'); }
        },
      }, '删除'),
    ]),
  ]);
  card.append(body);
  card.addEventListener('click', () => { state.activeId = p.id; switchView('workspace'); refreshProject(p.id, true); });
  return card;
}

/* ---------------- 轮询 ---------------- */
function startPolling() {
  setInterval(() => {
    if (state.view === 'workspace' && state.activeId) {
      refreshProject(state.activeId, false);
    } else if (state.view === 'library') {
      // 库页面静默刷新（生成中的项目会更新状态）
      refreshLibrary();
    }
  }, 3000);
}

init();
