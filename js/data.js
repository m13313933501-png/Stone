// 数据加载与岗位筛选/排序工具（支持分片懒加载）

// 与 crawler/build_index.py 的 HEADER 保持一致（无 meta 时的兜底）
export const HEADER_FALLBACK = ["id", "company", "jobTitle", "positions", "location", "industry",
  "batch", "status", "deadline", "applyUrl", "officialUrl", "source", "verified", "skills"];

let META = null;
const indexCache = new Map();   // shardIndex -> Promise<jobObject[]>
const jdCache = new Map();      // shardIndex -> Promise<{id: jd}>

export async function loadMeta() {
  if (META) return META;
  const r = await fetch('./data/meta.json');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  META = await r.json();
  return META;
}
export function getMeta() { return META; }

export async function loadIndexShard(i) {
  if (indexCache.has(i)) return indexCache.get(i);
  const p = (async () => {
    const r = await fetch(`./data/index/${String(i).padStart(3, '0')}.json`);
    if (!r.ok) throw new Error('分片 ' + i + ' HTTP ' + r.status);
    const data = await r.json();
    const header = (META && META.header) || HEADER_FALLBACK;
    return data.jobs.map(arr => {
      const o = {};
      header.forEach((k, idx) => { o[k] = arr[idx]; });
      o._s = i;            // 记录所属分片，供 jd 懒加载定位
      return o;
    });
  })();
  indexCache.set(i, p);
  return p;
}

export async function loadJdShard(i) {
  if (jdCache.has(i)) return jdCache.get(i);
  const p = (async () => {
    const r = await fetch(`./data/jd/${String(i).padStart(3, '0')}.json`);
    if (!r.ok) return {};
    return await r.json();
  })();
  jdCache.set(i, p);
  return p;
}

// 取单个岗位的 jd（懒加载对应分片，结果缓存在 job._jd）
export async function getJd(job) {
  if (!job) return '';
  if (job._jd !== undefined) return job._jd;
  const map = await loadJdShard(job._s);
  job._jd = (map && map[job.id]) || '';
  return job._jd;
}

// 全量加载所有分片（首屏之后后台执行；筛选/匹配时需要）
export async function loadAllIndex() {
  const m = await loadMeta();
  const arrs = await Promise.all(
    Array.from({ length: m.shards }, (_, i) => loadIndexShard(i))
  );
  return arrs.flat();
}

// ---------- 以下为纯函数工具，与加载方式无关 ----------

const DAY = 86400000;

export function daysLeft(deadline, now = Date.now()) {
  if (!deadline) return null;
  const d = new Date(deadline + 'T23:59:59').getTime();
  // floor：当天剩余不足一天记 0 → 「今天截止 = 剩 0 天」，明天截止 = 剩 1 天
  return Math.floor((d - now) / DAY);
}

export function sortByDeadline(jobs) {
  return [...jobs].sort((a, b) => {
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return da - db;
  });
}

// hideExpired：仅隐藏「截止日已过」的岗位（剩 0 天 = 今天截止，正常显示并标记「今天截止」）。
// 用户在状态下拉里显式选「已截止」时不隐藏（明确想看）。
export function filterJobs(jobs, { keyword, industry, city, batch, status, hideExpired }, now = Date.now()) {
  keyword = (keyword || '').trim().toLowerCase();
  return jobs.filter(j => {
    if (industry && j.industry !== industry) return false;
    if (city && j.location !== city) return false;
    if (batch && (j.batch || '').indexOf(batch) === -1) return false;
    if (status && j.status !== status) return false;
    if (hideExpired && status !== '已截止') {
      const dl = daysLeft(j.deadline, now);
      if (dl !== null && dl < 0) return false;
      if (dl === null && j.status === '已截止') return false;
    }
    if (keyword) {
      const hay = (j.jobTitle + ' ' + j.company + ' ' + (j.skills || []).join(' ') + ' ' +
        (j.location || '') + ' ' + (j.positions || []).join(' ')).toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });
}

export function uniqueValues(jobs, key) {
  return [...new Set(jobs.map(j => j[key]).filter(Boolean))].sort();
}

// 判断 applyUrl 是否为可点击的 http(s) 链接（用于容错展示）
export function isHttpUrl(s) {
  return /^https?:\/\//i.test(s || '');
}
