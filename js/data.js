// 数据加载与岗位筛选/排序工具

export async function loadJobs() {
  const r = await fetch('./data/jobs.json');
  if (!r.ok) throw new Error('岗位数据加载失败 (HTTP ' + r.status + ')');
  return r.json();
}

export async function loadCompanies() {
  const r = await fetch('./data/companies.json');
  if (!r.ok) throw new Error('企业数据加载失败 (HTTP ' + r.status + ')');
  return r.json();
}

export function getCompanyMap(companies) {
  const m = {};
  for (const c of companies) m[c.id] = c;
  return m;
}

const DAY = 86400000;

// 返回距离截止的剩余天数；deadline 为空返回 null
export function daysLeft(deadline, now = Date.now()) {
  if (!deadline) return null;
  const d = new Date(deadline + 'T23:59:59').getTime();
  return Math.ceil((d - now) / DAY);
}

// 按截止时间升序，deadline 缺失排末尾
export function sortByDeadline(jobs) {
  return [...jobs].sort((a, b) => {
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return da - db;
  });
}

export function filterJobs(jobs, { keyword, industry, city, batch, status, hideExpired }, now = Date.now()) {
  keyword = (keyword || '').trim().toLowerCase();
  return jobs.filter(j => {
    if (industry && j.industry !== industry) return false;
    if (city && j.location !== city) return false;
    if (batch && (j.batch || '').indexOf(batch) === -1) return false;
    if (status && j.status !== status) return false;
    if (hideExpired) {
      const dl = daysLeft(j.deadline, now);
      if (dl !== null && dl < 0) return false;
    }
    if (keyword) {
      const hay = (j.jobTitle + ' ' + j.company + ' ' + (j.skills || []).join(' ') + ' ' + (j.location || '') + ' ' + (j.positions || []).join(' ')).toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });
}

export function uniqueValues(jobs, key) {
  return [...new Set(jobs.map(j => j[key]).filter(Boolean))].sort();
}
