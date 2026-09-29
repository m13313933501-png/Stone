import { loadMeta, loadIndexShard, loadAllIndex, getJd, daysLeft, sortByDeadline, filterJobs, isHttpUrl } from './data.js';
import { parseResumeFile, saveResume, loadResume, matchJobs } from './resume.js';
import { getWatch, toggleWatch } from './watchlist.js';
import { buildICS } from './ics.js';
import { BACKEND_URL } from './config.js';

let meta = null;
let JOBS = [];
let allLoaded = false;
let loadAllPromise = null;
let watchIds = new Set();
let showAllJobs = false;
const $ = (s) => document.querySelector(s);

// 全量加载（仅筛选/匹配时需要）；首次只加载第 0 片
function ensureAllJobs() {
  if (allLoaded) return Promise.resolve(JOBS);
  if (!loadAllPromise) {
    loadAllPromise = loadAllIndex().then(arr => { JOBS = arr; allLoaded = true; return JOBS; });
  }
  return loadAllPromise;
}

async function init() {
  try {
    meta = await loadMeta();
  } catch (e) {
    $('#jobList').innerHTML = `<div class="empty">元数据加载失败：${e.message}<br>请通过本地或线上 HTTP 服务访问本页（不要直接用 file:// 打开）。</div>`;
    return;
  }
  try { watchIds = new Set(await getWatch()); } catch (e) { watchIds = new Set(); }

  // 首屏：仅加载第 0 片（≈200KB），立刻渲染
  try {
    JOBS = await loadIndexShard(0);
  } catch (e) {
    $('#jobList').innerHTML = `<div class="empty">岗位数据加载失败：${e.message}</div>`;
    return;
  }

  buildFilters();
  renderJobs();
  setupTabs();
  setupUpload();
  setupModal();
  setupWatch();
  setupSubscribe();
  restoreResume();

  // 后台静默加载其余分片，完成后刷新（让“即将截止/关注/匹配”完整）
  loadAllIndex().then(arr => {
    JOBS = arr; allLoaded = true;
    renderJobs(); renderSoon(); renderWatch();
  }).catch(() => { /* 忽略，首屏已可用 */ });
}

function buildFilters() {
  const mk = (sel, list) => {
    $(sel).innerHTML = '<option value="">全部</option>' +
      list.map(o => `<option value="${o.v}">${o.v}（${o.c}）</option>`).join('');
  };
  mk('#industry', meta.industries);
  mk('#city', meta.cities);
  mk('#batch', meta.batches);
  mk('#status', meta.statuses);
  ['#kw', '#industry', '#city', '#batch', '#status', '#hideExpired'].forEach(s => {
    const el = $(s);
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', onFilterChange);
  });
}

async function onFilterChange() {
  if (!allLoaded) {
    $('#jobCount').textContent = '正在加载全部岗位以筛选…';
    try { await ensureAllJobs(); } catch (e) { /* ignore */ }
  }
  renderJobs();
}

function currentFilters() {
  return {
    keyword: $('#kw').value,
    industry: $('#industry').value,
    city: $('#city').value,
    batch: $('#batch').value,
    status: $('#status').value,
    hideExpired: $('#hideExpired').checked
  };
}

function renderJobs() {
  showAllJobs = false;
  const list = sortByDeadline(filterJobs(JOBS, currentFilters()));
  const totalTxt = allLoaded ? `共 ${list.length} 个岗位` : `已加载 ${JOBS.length}/${meta.total}，当前匹配 ${list.length}`;
  $('#jobCount').textContent = totalTxt + '（按截止时间升序）';
  if (!list.length) {
    $('#jobList').innerHTML = '<div class="empty">没有符合条件的岗位</div>';
  } else {
    const capped = list.length > 300;
    const view = capped ? list.slice(0, 300) : list;
    $('#jobList').innerHTML = view.map(jobCard).join('') +
      (capped ? `<button class="more" id="moreBtn">显示全部 ${list.length} 个岗位 ↓</button>` : '');
    if (capped) $('#moreBtn').addEventListener('click', () => { showAllJobs = true; renderJobs(); });
  }
  document.querySelectorAll('.card').forEach(el => el.addEventListener('click', () => openJob(el.dataset.id)));
  document.querySelectorAll('.star').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); onToggleWatch(b.dataset.star); }));
  renderSoon();
}

function jobCard(j) {
  const dl = daysLeft(j.deadline);
  let badge;
  if (j.status === '已截止' || (dl !== null && dl < 0)) badge = '<span class="badge closed">已截止</span>';
  else if (dl === null) badge = '<span class="badge tbd">截止待定</span>';
  else if (dl <= 7) badge = `<span class="badge soon">${dl} 天后截止</span>`;
  else badge = `<span class="badge open">${dl} 天后截止</span>`;
  const star = watchIds.has(j.id) ? '★' : '☆';
  const batch = j.batch ? `<span class="badge batch">${j.batch}</span>` : '';
  const verified = j.verified ? '<span class="badge ok" title="信息已核实">✓ 已核实</span>' : '';
  const dead = j.applyDead ? '<span class="badge warn" title="巡检标记：投递链接可能失效">⚠ 链接失效</span>' : '';
  const skills = (j.skills || []).slice(0, 6).map(s => `<span class="chip">${s}</span>`).join('');
  return `<div class="card" data-id="${j.id}">
    <button class="star" data-star="${j.id}" title="关注/取消">${star}</button>
    <div class="co">${j.company} ${verified}</div>
    <h3>${j.jobTitle}</h3>
    <div class="meta"><span>📍 ${j.location || '—'}</span><span>🏷 ${j.industry || '—'}</span></div>
    <div class="meta">${badge} ${batch} ${dead} <span class="src">${j.source}</span></div>
    <div class="chips">${skills}</div>
  </div>`;
}

function renderSoon() {
  const soon = JOBS
    .filter(j => { const d = daysLeft(j.deadline); return d !== null && d >= 0 && d <= 7; })
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const box = $('#soonBox');
  if (!soon.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="soon-banner"><h3>⏰ 即将截止（7 天内，共 ${soon.length} 个）</h3>${
    soon.map(j => `<div class="item" data-id="${j.id}">${j.company}·${j.jobTitle} — ${j.deadline}（${daysLeft(j.deadline)} 天）</div>`).join('')
  }</div>`;
  box.querySelectorAll('.item').forEach(el => el.addEventListener('click', () => openJob(el.dataset.id)));
}

async function openJob(id) {
  const j = JOBS.find(x => x.id === id);
  if (!j) return;
  const dl = daysLeft(j.deadline);
  const deadlineText = j.deadline ? j.deadline + (dl < 0 ? '（已截止）' : `（${dl} 天后）`) : '待定';
  const star = watchIds.has(j.id) ? '★' : '☆';
  const positions = (j.positions && j.positions.length) ? j.positions.map(p => `<li>${p}</li>`).join('') : '';

  // 投递入口按钮：容错非 URL / 失效标记
  let applyHtml;
  const au = j.applyUrl || '';
  if (j.applyDead) {
    applyHtml = '<span class="badge warn">⚠ 巡检标记：投递链接可能失效</span>';
  } else if (isHttpUrl(au)) {
    applyHtml = `<a class="btn" href="${au}" target="_blank" rel="noopener">前往投递入口 ↗</a>`;
  } else if (/@/.test(au)) {
    const m = au.match(/[\w.]+@[\w.]+/);
    applyHtml = `<a class="btn" href="mailto:${m ? m[0] : au}">邮箱投递 ↗</a>`;
  } else {
    applyHtml = `<span class="badge tbd">投递入口：${au || '待补充'}</span>`;
  }
  const officialHtml = j.officialUrl
    ? `<a class="btn ghost" href="${j.officialUrl}" target="_blank" rel="noopener">企业官网介绍 ↗</a>` : '';

  $('#modal').innerHTML = `
    <button class="close" id="modalClose">×</button>
    <div class="co">${j.company} ${j.verified ? '<span class="badge ok">✓ 已核实</span>' : ''}</div>
    <h2>${j.jobTitle} <button class="star" id="modalStar" data-star="${j.id}" title="关注/取消">${star}</button></h2>
    <div class="meta" style="color:var(--muted);font-size:13px">📍 ${j.location || '—'} · 🏷 ${j.industry || '—'} · 来源 ${j.source}</div>
    <div style="margin-top:8px">批次：<strong>${j.batch || '—'}</strong> &nbsp;·&nbsp; 状态：<strong>${j.status || '—'}</strong> &nbsp;·&nbsp; 截止：<strong>${deadlineText}</strong></div>
    ${positions ? `<div style="margin-top:10px"><div style="font-size:13px;color:var(--muted)">岗位方向</div><ul class="pos">${positions}</ul></div>` : ''}
    <div class="chips">${(j.skills || []).map(s => `<span class="chip">${s}</span>`).join('')}</div>
    <div class="jd" id="jdBox">描述加载中…</div>
    <div class="actions">${applyHtml} ${officialHtml}</div>`;
  $('#modalMask').classList.add('show');
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalStar').addEventListener('click', () => onToggleWatch(j.id));

  // 懒加载 jd
  const jd = await getJd(j);
  const box = document.querySelector('#jdBox');
  if (box) box.innerHTML = jd || '暂无描述';
}

function closeModal() { $('#modalMask').classList.remove('show'); }
function setupModal() {
  $('#modalMask').addEventListener('click', e => { if (e.target.id === 'modalMask') closeModal(); });
}

async function onToggleWatch(id) {
  try {
    const ids = await toggleWatch(id);
    watchIds = new Set(ids);
    renderJobs();
    renderWatch();
  } catch (e) { /* 忽略 */ }
}

function setupTabs() {
  document.querySelectorAll('nav.tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav.tabs button').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      $('#' + b.dataset.tab).classList.add('active');
      if (b.dataset.tab === 'watch') renderWatch();
      if (b.dataset.tab === 'subscribe') renderSubState();
    });
  });
}

function setupUpload() {
  const up = $('#uploader'), file = $('#file'), pick = $('#pickBtn');
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) handleFile(file.files[0]); });
  ['dragover', 'dragenter'].forEach(ev => up.addEventListener(ev, e => { e.preventDefault(); up.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => up.addEventListener(ev, e => { e.preventDefault(); up.classList.remove('drag'); }));
  up.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
}

async function handleFile(f) {
  const st = $('#status');
  st.innerHTML = '<span class="spinner"></span>正在本地解析简历…';
  try {
    const res = await parseResumeFile(f);
    await saveResume(res);
    st.textContent = `已解析：${res.fileName}（${res.text.length} 字，命中 ${res.skills.length} 个技能标签）`;
    renderResume(res);
  } catch (e) {
    st.textContent = '解析失败：' + e.message;
  }
}

async function renderResume(res) {
  const box = $('#skillsBox');
  if (!res || !res.skills.length) {
    box.innerHTML = '<div class="empty">未从简历中识别到技能标签，可补充项目/技能关键词后再试。</div>';
    $('#recoBox').innerHTML = '';
    return;
  }
  box.innerHTML = `<h3 style="font-size:15px;margin:6px 0 8px">识别到的技能标签（${res.skills.length}）</h3><div class="chips">${res.skills.map(s => `<span class="chip">${s}</span>`).join('')}</div>`;
  $('#recoBox').innerHTML = '<div class="empty">正在加载全部岗位以匹配…</div>';
  try { await ensureAllJobs(); } catch (e) { /* ignore */ }
  renderReco(res.skills);
}

function renderReco(skills) {
  const recos = matchJobs(skills, JOBS);
  const box = $('#recoBox');
  if (!recos.length) { box.innerHTML = '<div class="empty">暂无匹配岗位，可尝试补充更多技能关键词。</div>'; return; }
  box.innerHTML = `<h3>为你推荐的岗位（按匹配度排序）</h3>` + recos.slice(0, 15).map(r => {
    const pct = Math.round(r.score * 100);
    const hit = r.hit.map(s => `<span class="chip hit">${s}</span>`).join('');
    const miss = r.miss.slice(0, 5).map(s => `<span class="chip miss">${s}</span>`).join('');
    return `<div class="row">
      <div class="top"><span class="name">${r.job.company} · ${r.job.jobTitle}</span><span class="score">匹配 ${pct}%</span></div>
      <div class="sub">📍 ${r.job.location} · 截止 ${r.job.deadline || '待定'} · 命中 ${r.hit.length}/${skills.length}</div>
      <div class="chips">${hit}${miss}</div>
      <div class="actions" style="margin-top:8px"><a class="btn" href="${r.job.applyUrl}" target="_blank" rel="noopener">投递入口 ↗</a></div>
    </div>`;
  }).join('');
}

async function restoreResume() {
  try {
    const r = await loadResume();
    if (r) { $('#status').textContent = `已恢复上次简历：${r.fileName}`; renderResume(r); }
  } catch (e) { /* 忽略 */ }
}

// ---------- 关注 / 日历 ----------
function setupWatch() {
  $('#exportIcs').addEventListener('click', exportICS);
  renderWatch();
}

function renderWatch() {
  const box = $('#watchList');
  const list = JOBS.filter(j => watchIds.has(j.id));
  if (!list.length) { box.innerHTML = '<div class="empty">还没有关注的岗位。在岗位卡片或详情里点击 ☆ 即可关注。</div>'; return; }
  box.innerHTML = list
    .sort((a, b) => { const da = a.deadline ? new Date(a.deadline) : Infinity; const db = b.deadline ? new Date(b.deadline) : Infinity; return da - db; })
    .map(j => {
      const dl = daysLeft(j.deadline);
      const when = dl === null ? '待定' : (dl < 0 ? '已截止' : dl + ' 天后');
      const dead = j.applyDead ? ' <span class="badge warn">链接失效</span>' : '';
      return `<div class="watch-row">
        <div><div class="name">${j.company} · ${j.jobTitle}</div><div class="sub">📍 ${j.location || '—'} · 截止 ${j.deadline || '待定'}（${when}）${dead}</div></div>
        <button class="rm" data-rm="${j.id}">取消关注</button>
      </div>`;
    }).join('');
  box.querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => onToggleWatch(b.dataset.rm)));
}

function exportICS() {
  const list = JOBS.filter(j => watchIds.has(j.id) && j.deadline);
  if (!list.length) { alert('请先关注至少一个有截止时间的岗位，再导出日历。'); return; }
  const ics = buildICS(list);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '秋招截止提醒.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- 提醒订阅（轻量后端） ----------
function setupSubscribe() {
  const btn = $('#subBtn');
  if (!btn) return;
  const note = $('#subNote');
  if (!BACKEND_URL) {
    note.textContent = '未配置提醒后端：请在 js/config.js 填入你的 Cloudflare Worker 地址（详见 README 的「提醒订阅」一节）。';
    btn.disabled = true;
    return;
  }
  btn.addEventListener('click', doSubscribe);
}

async function doSubscribe() {
  const email = $('#subEmail').value.trim();
  const key = $('#subKey').value.trim();
  const note = $('#subNote');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { note.textContent = '请填写有效邮箱。'; return; }
  if (!watchIds.size) { note.textContent = '你还没有关注任何岗位，请先在岗位卡片点击 ☆ 关注。'; return; }
  note.textContent = '提交中…';
  try {
    await ensureAllJobs();
    const watched = [...watchIds]
      .map(id => JOBS.find(j => j.id === id))
      .filter(Boolean)
      .map(j => ({ id: j.id, company: j.company, jobTitle: j.jobTitle, deadline: j.deadline, applyUrl: j.applyUrl, _s: j._s }));
    const r = await fetch(BACKEND_URL.replace(/\/$/, '') + '/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, serverChanKey: key, jobs: watched })
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      note.textContent = '订阅成功！临近截止时将通过' + (key ? '邮件 + 微信' : '邮件') + '提醒你。';
    } else {
      note.textContent = '订阅失败：' + (data.error || r.status);
    }
  } catch (e) {
    note.textContent = '请求失败：' + e.message;
  }
}

function renderSubState() {
  const note = $('#subNote');
  if (note && !BACKEND_URL) note.textContent = '未配置提醒后端：请在 js/config.js 填入 Cloudflare Worker 地址。';
}

init();
