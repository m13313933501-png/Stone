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
let soonExpanded = false;

const SOON_PREVIEW = 5;      // 即将截止区默认展示条数
const SOON_WINDOW = 7;       // 即将截止窗口（天）
const LIST_CAP = 300;        // 列表单次渲染上限
const $ = (s) => document.querySelector(s);

// 全量加载（仅筛选/匹配时需要）；首次只加载第 0 片
function ensureAllJobs() {
  if (allLoaded) return Promise.resolve(JOBS);
  if (!loadAllPromise) {
    loadAllPromise = loadAllIndex().then(arr => { JOBS = arr; allLoaded = true; return JOBS; });
  }
  return loadAllPromise;
}

// ---------- 工具 ----------
// 已截止 = 截止日已过（dl < 0）；今天截止（dl = 0）正常显示并标记「今天截止」
const isExpired = (j, now = Date.now()) => {
  const dl = daysLeft(j.deadline, now);
  return (dl !== null && dl < 0) || (dl === null && j.status === '已截止');
};

function avatarClass(name) {
  let h = 0;
  for (const ch of (name || '?')) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 'av-' + (h % 4);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function daysBadge(dl) {
  if (dl === null) return '<span class="badge tbd">截止待定</span>';
  if (dl < 0) return '<span class="badge closed">已截止</span>';
  if (dl === 0) return '<span class="badge days-urgent">今天截止</span>';
  if (dl <= 3) return `<span class="badge days-urgent num">剩 ${dl} 天</span>`;
  if (dl <= 7) return `<span class="badge days-soon num">剩 ${dl} 天</span>`;
  return `<span class="badge days-open num">剩 ${dl} 天</span>`;
}

// ---------- 初始化 ----------
async function init() {
  renderSkeleton();

  try {
    meta = await loadMeta();
    const st = $('#statTotal');
    if (st) st.textContent = meta.total;
  } catch (e) {
    $('#jobList').innerHTML = `<div class="empty">数据加载失败：${esc(e.message)}<br>请通过 HTTP 服务访问本页（不要直接用 file:// 打开）。</div>`;
    return;
  }
  try { watchIds = new Set(await getWatch()); } catch (e) { watchIds = new Set(); }

  // 首屏：仅加载第 0 片（约 200KB），立刻渲染
  try {
    JOBS = await loadIndexShard(0);
  } catch (e) {
    $('#jobList').innerHTML = `<div class="empty">岗位数据加载失败：${esc(e.message)}</div>`;
    return;
  }

  buildFilters();
  setupViews();
  setupUpload();
  setupDrawer();
  setupWatch();
  setupSubscribe();
  restoreResume();
  renderJobs();

  // 后台静默加载其余分片，完成后刷新（让即将截止/关注/匹配完整）
  loadAllIndex().then(arr => {
    JOBS = arr; allLoaded = true;
    renderJobs(); renderWatch();
  }).catch(() => { /* 忽略，首屏已可用 */ });
}

function renderSkeleton() {
  $('#jobList').innerHTML = Array.from({ length: 6 }, () => `
    <div class="skeleton">
      <div class="sk" style="width:40px;height:40px;border-radius:11px;"></div>
      <div style="flex:1;">
        <div class="sk" style="width:55%;height:15px;"></div>
        <div class="sk" style="width:35%;height:11px;margin-top:9px;"></div>
        <div class="sk" style="width:70%;height:11px;margin-top:11px;"></div>
      </div>
    </div>`).join('');
}

// ---------- 视图切换（桌面顶部导航 / 移动端底部 Tab 共用） ----------
function setupViews() {
  document.querySelectorAll('[data-view]').forEach(b => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });
}

function switchView(name) {
  document.querySelectorAll('[data-view]').forEach(x => {
    x.classList.toggle('active', x.dataset.view === name && (x.classList.contains('navlink') || x.classList.contains('tab') || x.classList.contains('brand')));
  });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  window.scrollTo({ top: 0 });
  if (name === 'watch') renderWatch();
  if (name === 'subscribe') renderSubState();
}

// ---------- 筛选 ----------
function buildFilters() {
  const mk = (sel, list, label) => {
    $(sel).innerHTML = `<option value="">${label}：全部</option>` +
      list.map(o => `<option value="${esc(o.v)}">${esc(o.v)}（${o.c}）</option>`).join('');
  };
  mk('#industry', meta.industries, '行业');
  mk('#city', meta.cities, '城市');
  mk('#batch', meta.batches, '批次');
  mk('#status', meta.statuses, '状态');
  ['#kw', '#industry', '#city', '#batch', '#status'].forEach(s => {
    const el = $(s);
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', onFilterChange);
  });

  // 显示已截止开关（默认关：默认隐藏已截止与剩 0 天）
  const cb = $('#hideExpired');
  try { cb.checked = localStorage.getItem('showExpired') === '1'; } catch (e) { /* ignore */ }
  cb.addEventListener('change', async () => {
    try { localStorage.setItem('showExpired', cb.checked ? '1' : '0'); } catch (e) { /* ignore */ }
    await onFilterChange();
  });

  // 移动端筛选面板折叠
  const tg = $('#filterToggle'), ex = $('#filterExtras');
  if (tg) tg.addEventListener('click', () => {
    const open = ex.classList.toggle('open');
    tg.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

async function onFilterChange() {
  if (!allLoaded) {
    $('#jobCount').textContent = '正在加载全部岗位…';
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
    hideExpired: !$('#hideExpired').checked   // 开关=显示已截止；filter 参数=隐藏已截止
  };
}

// ---------- 岗位列表 ----------
function renderJobs() {
  showAllJobs = false;
  const list = sortByDeadline(filterJobs(JOBS, currentFilters()));
  const expiredOn = $('#hideExpired').checked;
  const txt = allLoaded ? `共 ${list.length} 条 · 按截止升序` : `已加载 ${JOBS.length}/${meta.total} · 匹配 ${list.length}`;
  $('#jobCount').textContent = txt + (expiredOn ? ' · 含已截止' : '');
  if (!list.length) {
    $('#jobList').innerHTML = '<div class="empty">没有符合条件的岗位<br><span style="font-size:12px">试试清空筛选，或在筛选里打开「显示已截止」</span></div>';
  } else {
    const capped = list.length > LIST_CAP;
    const view = capped ? list.slice(0, LIST_CAP) : list;
    $('#jobList').innerHTML = view.map(jobCard).join('') +
      (capped ? `<button class="more" id="moreBtn">显示全部 ${list.length} 条岗位</button>` : '');
    if (capped) $('#moreBtn').addEventListener('click', () => { showAllJobs = true; renderAll(); });
  }
  $('#jobList').querySelectorAll('.card').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.id)));
  $('#jobList').querySelectorAll('.star').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); onToggleWatch(b.dataset.star); }));
  renderSoon();
}

async function renderAll() {
  if (!allLoaded) { try { await ensureAllJobs(); } catch (e) { /* ignore */ } }
  const list = sortByDeadline(filterJobs(JOBS, currentFilters()));
  $('#jobList').innerHTML = list.map(jobCard).join('');
  $('#jobCount').textContent = `共 ${list.length} 条 · 按截止升序${$('#hideExpired').checked ? ' · 含已截止' : ''}`;
  $('#jobList').querySelectorAll('.card').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.id)));
  $('#jobList').querySelectorAll('.star').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); onToggleWatch(b.dataset.star); }));
}

function jobCard(j) {
  const dl = daysLeft(j.deadline);
  const expired = isExpired(j);
  const star = watchIds.has(j.id);
  const verified = j.verified ? '<span class="badge ok">已核实</span>' : '';
  const dead = j.applyDead ? '<span class="badge dead" title="巡检标记：投递链接可能失效">链接失效</span>' : '';
  const sub = [j.location || '', j.batch || ''].filter(Boolean).map(esc).join(' · ');
  const skills = (j.skills || []).slice(0, 3).map(s => esc(s)).join(' · ');
  return `<div class="card${expired ? ' expired' : ''}" data-id="${esc(j.id)}">
    <div class="avatar ${avatarClass(j.company)}">${esc((j.company || '?')[0])}</div>
    <div class="c-body">
      <div class="c-top">
        <div class="c-title"><span class="c-co">${esc(j.company)}</span> · ${esc(j.jobTitle)}</div>
        <button class="star${star ? ' on' : ''}" data-star="${esc(j.id)}" title="关注/取消关注">${star ? '★' : '☆'}</button>
      </div>
      <div class="c-sub">${sub}${j.verified ? ' · 已核实' : ''}</div>
      <div class="c-bottom">
        ${daysBadge(dl)} ${dead} ${verified}
        <span class="c-skills">${skills}</span>
        <span class="c-go">详情 →</span>
      </div>
    </div>
  </div>`;
}

// ---------- 即将截止区（默认 5 条，可展开） ----------
function renderSoon() {
  const soon = JOBS
    .filter(j => { const d = daysLeft(j.deadline); return d !== null && d >= 0 && d <= SOON_WINDOW; })
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const box = $('#soonBox');
  if (!soon.length) { box.innerHTML = ''; return; }
  const view = soonExpanded ? soon : soon.slice(0, SOON_PREVIEW);
  box.innerHTML = `
    <div class="soon">
      <div class="soon-head">
        <h2>即将截止</h2>
        <span class="soon-count num">${SOON_WINDOW} 天内 ${soon.length} 条</span>
      </div>
      <div class="soon-list">${view.map(j => {
        const dl = daysLeft(j.deadline);
        return `<div class="soon-item" data-id="${esc(j.id)}">
          <div class="si-main">
            <div class="si-name">${esc(j.company)} · ${esc(j.jobTitle)}</div>
            <div class="si-sub num">${esc(j.location || '')} · 截止 ${esc(j.deadline)}</div>
          </div>
          <span class="si-days">${daysBadge(dl)}</span>
        </div>`;
      }).join('')}</div>
      ${soon.length > SOON_PREVIEW
        ? `<button class="soon-more" id="soonMore">${soonExpanded ? '收起' : `展开全部 ${soon.length} 条`}</button>`
        : ''}
    </div>`;
  box.querySelectorAll('.soon-item').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.id)));
  const mb = $('#soonMore');
  if (mb) mb.addEventListener('click', e => {
    e.stopPropagation();
    soonExpanded = !soonExpanded;
    renderSoon();
  });
}

// ---------- 详情抽屉 ----------
function setupDrawer() {
  $('#drawerMask').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
}

async function openDrawer(id) {
  const j = JOBS.find(x => x.id === id);
  if (!j) return;
  const dl = daysLeft(j.deadline);
  const dlTxt = dl === null ? '待定'
    : dl < 0 ? '已截止'
    : dl === 0 ? `${j.deadline}（今天截止）`
    : `${j.deadline}（剩 ${dl} 天）`;
  const star = watchIds.has(j.id);

  // 投递入口：死链兜底（巡检标记 / 非 URL / 邮箱）
  const au = j.applyUrl || '';
  let applyHtml;
  if (j.applyDead) {
    applyHtml = '<div class="empty" style="padding:14px">巡检发现该投递链接可能已失效，建议从下方企业官网查找最新入口。</div>';
  } else if (isHttpUrl(au)) {
    applyHtml = `<a class="btn primary" href="${esc(au)}" target="_blank" rel="noopener">前往投递入口 →</a>`;
  } else if (/@/.test(au)) {
    const m = au.match(/[\w.]+@[\w.]+/);
    applyHtml = `<a class="btn primary" href="mailto:${esc(m ? m[0] : au)}">邮箱投递 →</a>`;
  } else {
    applyHtml = `<div class="empty" style="padding:14px">投递入口：${esc(au || '待补充')}，可从企业官网查找。</div>`;
  }
  const officialHtml = j.officialUrl
    ? `<a class="btn" href="${esc(j.officialUrl)}" target="_blank" rel="noopener">企业官网 →</a>` : '';

  const positions = (j.positions && j.positions.length)
    ? `<div class="d-section"><div class="d-label">岗位方向</div><ul class="d-pos">${j.positions.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '';
  const skills = (j.skills || []).length
    ? `<div class="d-section"><div class="d-label">技能关键词</div><div class="chips">${j.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>` : '';

  const d = $('#drawer');
  d.innerHTML = `
    <button class="drawer-close" id="drawerClose" aria-label="关闭">×</button>
    <div class="d-co">
      <div class="avatar ${avatarClass(j.company)}">${esc((j.company || '?')[0])}</div>
      <div class="d-co-name">${esc(j.company)} ${j.verified ? '<span class="badge ok">已核实</span>' : ''}</div>
    </div>
    <div class="d-title">${esc(j.jobTitle)}<button class="star${star ? ' on' : ''}" id="drawerStar" title="关注/取消关注">${star ? '★' : '☆'}</button></div>
    <div class="d-meta">
      ${j.location ? `<span class="badge plain">${esc(j.location)}</span>` : ''}
      ${j.batch ? `<span class="badge plain">${esc(j.batch)}</span>` : ''}
      ${j.status ? `<span class="badge plain">${esc(j.status)}</span>` : ''}
      ${j.industry ? `<span class="badge plain">${esc(j.industry)}</span>` : ''}
      ${daysBadge(dl)}
    </div>
    <div class="d-line">截止时间：<strong class="d-deadline num">${esc(dlTxt)}</strong></div>
    <div class="d-line">信息来源：${esc(j.source || '—')}</div>
    ${positions}
    ${skills}
    <div class="d-section"><div class="d-label">岗位描述</div><div class="jd" id="jdBox">加载中…</div></div>
    <div class="d-actions">${applyHtml}${officialHtml}</div>`;

  $('#drawerMask').hidden = false;
  d.hidden = false;
  requestAnimationFrame(() => {
    $('#drawerMask').classList.add('show');
    d.classList.add('show');
  });
  document.body.style.overflow = 'hidden';

  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerStar').addEventListener('click', () => onToggleWatch(j.id));

  // 懒加载 jd
  const jd = await getJd(j);
  const box = document.querySelector('#jdBox');
  if (box) box.textContent = jd || '暂无岗位描述';
}

function closeDrawer() {
  $('#drawerMask').classList.remove('show');
  $('#drawer').classList.remove('show');
  document.body.style.overflow = '';
  setTimeout(() => {
    if (!$('#drawer').classList.contains('show')) {
      $('#drawerMask').hidden = true;
      $('#drawer').hidden = true;
    }
  }, 280);
}

async function onToggleWatch(id) {
  try {
    const ids = await toggleWatch(id);
    watchIds = new Set(ids);
    renderJobs();
    renderWatch();
    // 同步抽屉里的星标
    const ds = $('#drawerStar');
    if (ds && ds.dataset && true) {
      const on = watchIds.has(id);
      ds.classList.toggle('on', on);
      ds.textContent = on ? '★' : '☆';
    }
  } catch (e) { /* 忽略 */ }
}

// ---------- 简历 ----------
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
  box.innerHTML = `<div class="reco"><h3>识别到的技能标签（${res.skills.length}）</h3><div class="chips">${res.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>`;
  $('#recoBox').innerHTML = '<div class="empty">正在加载全部岗位以匹配…</div>';
  try { await ensureAllJobs(); } catch (e) { /* ignore */ }
  renderReco(res.skills);
}

function renderReco(skills) {
  const recos = matchJobs(skills, JOBS);
  const box = $('#recoBox');
  if (!recos.length) { box.innerHTML = '<div class="empty">暂无匹配岗位，可尝试补充更多技能关键词。</div>'; return; }
  box.innerHTML = `<div class="reco"><h3>为你推荐的岗位（按匹配度排序）</h3>` + recos.slice(0, 15).map(r => {
    const pct = Math.round(r.score * 100);
    const hit = r.hit.map(s => `<span class="chip hit">${esc(s)}</span>`).join('');
    const miss = r.miss.slice(0, 5).map(s => `<span class="chip miss">${esc(s)}</span>`).join('');
    const au = r.job.applyUrl || '';
    const applyBtn = r.job.applyDead
      ? '<span class="badge dead">链接失效</span>'
      : isHttpUrl(au)
        ? `<a class="btn" href="${esc(au)}" target="_blank" rel="noopener">投递入口 →</a>`
        : /@/.test(au)
          ? `<a class="btn" href="mailto:${esc((au.match(/[\w.]+@[\w.]+/) || [au])[0])}">邮箱投递 →</a>`
          : '';
    return `<div class="row" data-id="${esc(r.job.id)}" style="cursor:pointer">
      <div class="top"><span class="name">${esc(r.job.company)} · ${esc(r.job.jobTitle)}</span><span class="score num">匹配 ${pct}%</span></div>
      <div class="sub">${esc(r.job.location || '')} · 截止 ${esc(r.job.deadline || '待定')} · 命中 ${r.hit.length}/${skills.length}</div>
      <div class="chips">${hit}${miss}</div>
      <div class="actions">${applyBtn}</div>
    </div>`;
  }).join('') + '</div>';
  box.querySelectorAll('.row').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.id)));
  box.querySelectorAll('.actions a').forEach(a => a.addEventListener('click', e => e.stopPropagation()));
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
  if (!box) return;
  const list = JOBS.filter(j => watchIds.has(j.id));
  if (!list.length) { box.innerHTML = '<div class="empty">还没有关注的岗位。在岗位卡片或详情里点 ☆ 即可关注。</div>'; return; }
  box.innerHTML = list
    .sort((a, b) => { const da = a.deadline ? new Date(a.deadline) : Infinity; const db = b.deadline ? new Date(b.deadline) : Infinity; return da - db; })
    .map(j => {
      const dl = daysLeft(j.deadline);
      const when = dl === null ? '待定' : (dl < 0 ? '已截止' : dl === 0 ? '今天截止' : `剩 ${dl} 天`);
      const dead = j.applyDead ? ' <span class="badge dead">链接失效</span>' : '';
      return `<div class="watch-row">
        <div style="min-width:0">
          <div class="name">${esc(j.company)} · ${esc(j.jobTitle)}</div>
          <div class="sub num">${esc(j.location || '')} · 截止 ${esc(j.deadline || '待定')}（${when}）${dead}</div>
        </div>
        <button class="rm" data-rm="${esc(j.id)}">取消关注</button>
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

// ---------- 提醒订阅 ----------
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
  if (!watchIds.size) { note.textContent = '你还没有关注任何岗位，请先在岗位卡片点 ☆ 关注。'; return; }
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
