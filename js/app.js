import { loadJobs, loadCompanies, getCompanyMap, daysLeft, sortByDeadline, filterJobs, uniqueValues } from './data.js';
import { parseResumeFile, saveResume, loadResume, matchJobs } from './resume.js';
import { getWatch, toggleWatch } from './watchlist.js';
import { buildICS } from './ics.js';

let COMPANIES = [], JOBS = [], CMAP = [];
let watchIds = new Set();
let showAllJobs = false;
const $ = (s) => document.querySelector(s);

async function init() {
  try {
    [JOBS, COMPANIES] = await Promise.all([loadJobs(), loadCompanies()]);
  } catch (e) {
    $('#jobList').innerHTML = `<div class="empty">数据加载失败：${e.message}<br>请通过本地或线上 HTTP 服务访问本页（不要直接用 file:// 打开）。</div>`;
    return;
  }
  CMAP = getCompanyMap(COMPANIES);
  try { watchIds = new Set(await getWatch()); } catch (e) { watchIds = new Set(); }
  buildFilters();
  renderJobs();
  setupTabs();
  setupUpload();
  setupModal();
  setupWatch();
  restoreResume();
}

function buildFilters() {
  const ind = $('#industry'), city = $('#city'), batch = $('#batch'), status = $('#status');
  ind.innerHTML = '<option value="">全部行业</option>' + uniqueValues(JOBS, 'industry').map(v => `<option>${v}</option>`).join('');
  city.innerHTML = '<option value="">全部城市</option>' + uniqueValues(JOBS, 'location').map(v => `<option>${v}</option>`).join('');
  batch.innerHTML = '<option value="">全部批次</option>' + ['提前批', '正式批', '实习', '补录'].map(v => `<option>${v}</option>`).join('');
  status.innerHTML = '<option value="">全部状态</option>' + ['已开启', '已截止', '待确认'].map(v => `<option>${v}</option>`).join('');
  $('#kw').addEventListener('input', renderJobs);
  ind.addEventListener('change', renderJobs);
  city.addEventListener('change', renderJobs);
  batch.addEventListener('change', renderJobs);
  status.addEventListener('change', renderJobs);
  $('#hideExpired').addEventListener('change', renderJobs);
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
  $('#jobCount').textContent = `共 ${list.length} 个岗位（按截止时间升序）`;
  if (!list.length) { $('#jobList').innerHTML = '<div class="empty">没有符合条件的岗位</div>'; }
  else {
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
  const skills = (j.skills || []).slice(0, 6).map(s => `<span class="chip">${s}</span>`).join('');
  return `<div class="card" data-id="${j.id}">
    <button class="star" data-star="${j.id}" title="关注/取消">${star}</button>
    <div class="co">${j.company} ${verified}</div>
    <h3>${j.jobTitle}</h3>
    <div class="meta"><span>📍 ${j.location || '—'}</span><span>🏷 ${j.industry || '—'}</span></div>
    <div class="meta">${badge} ${batch} <span class="src">${j.source}</span></div>
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

function openJob(id) {
  const j = JOBS.find(x => x.id === id);
  if (!j) return;
  const dl = daysLeft(j.deadline);
  const deadlineText = j.deadline ? j.deadline + (dl < 0 ? '（已截止）' : `（${dl} 天后）`) : '待定';
  const star = watchIds.has(j.id) ? '★' : '☆';
  const positions = (j.positions && j.positions.length) ? j.positions.map(p => `<li>${p}</li>`).join('') : '';
  $('#modal').innerHTML = `
    <button class="close" id="modalClose">×</button>
    <div class="co">${j.company} ${j.verified ? '<span class="badge ok">✓ 已核实</span>' : ''}</div>
    <h2>${j.jobTitle} <button class="star" id="modalStar" data-star="${j.id}" title="关注/取消">${star}</button></h2>
    <div class="meta" style="color:var(--muted);font-size:13px">📍 ${j.location || '—'} · 🏷 ${j.industry || '—'} · 来源 ${j.source}</div>
    <div style="margin-top:8px">批次：<strong>${j.batch || '—'}</strong> &nbsp;·&nbsp; 状态：<strong>${j.status || '—'}</strong> &nbsp;·&nbsp; 截止：<strong>${deadlineText}</strong></div>
    ${positions ? `<div style="margin-top:10px"><div style="font-size:13px;color:var(--muted)">岗位方向</div><ul class="pos">${positions}</ul></div>` : ''}
    <div class="chips">${(j.skills || []).map(s => `<span class="chip">${s}</span>`).join('')}</div>
    <div class="jd">${j.jd || '暂无描述'}</div>
    <div class="actions">
      <a class="btn" href="${j.applyUrl}" target="_blank" rel="noopener">前往投递入口 ↗</a>
      ${j.officialUrl ? `<a class="btn ghost" href="${j.officialUrl}" target="_blank" rel="noopener">企业官网介绍 ↗</a>` : ''}
    </div>`;
  $('#modalMask').classList.add('show');
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalStar').addEventListener('click', () => onToggleWatch(j.id));
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

function renderResume(res) {
  const box = $('#skillsBox');
  if (!res || !res.skills.length) {
    box.innerHTML = '<div class="empty">未从简历中识别到技能标签，可补充项目/技能关键词后再试。</div>';
    $('#recoBox').innerHTML = '';
    return;
  }
  box.innerHTML = `<h3 style="font-size:15px;margin:6px 0 8px">识别到的技能标签（${res.skills.length}）</h3><div class="chips">${res.skills.map(s => `<span class="chip">${s}</span>`).join('')}</div>`;
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
      return `<div class="watch-row">
        <div><div class="name">${j.company} · ${j.jobTitle}</div><div class="sub">📍 ${j.location || '—'} · 截止 ${j.deadline || '待定'}（${when}）</div></div>
        <button class="rm" data-rm="${j.id}">取消关注</button>
      </div>`;
    }).join('');
  box.querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => onToggleWatch(b.dataset.rm)));
}

// ICS 生成见 js/ics.js（buildICS）

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

init();
