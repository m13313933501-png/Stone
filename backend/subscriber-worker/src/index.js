/**
 * 秋招助手 · 轻量提醒后端（Cloudflare Worker，免费）
 *
 * 能力：
 *  - POST /api/subscribe   订阅：{ email, serverChanKey?, jobs:[{id,company,jobTitle,deadline,applyUrl,_s}] }
 *  - POST /api/unsubscribe 退订：{ email }
 *  - GET  /api/health      健康检查
 *  - 每日定时（见 wrangler.toml）：对每位订阅者，回查最新岗位截止时间，
 *    对 ≤3 天内截止的岗位，通过 邮件(可选) + 微信(Server 酱) 推送提醒。
 *
 * 依赖：绑定 KV 命名空间 SUBS、环境变量 SITE_BASE；可选 Secret RESEND_API_KEY。
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });
}

function daysLeft(deadline, now = Date.now()) {
  if (!deadline) return null;
  const d = new Date(deadline + 'T23:59:59').getTime();
  return Math.ceil((d - now) / 86400000);
}

async function handleSubscribe(req, env) {
  const body = await req.json().catch(() => ({}));
  const { email, serverChanKey, jobs } = body;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: '邮箱格式不正确' }, 400);
  if (!Array.isArray(jobs) || !jobs.length) return json({ error: '未选择任何岗位' }, 400);
  const sub = {
    email,
    serverChanKey: (serverChanKey || '').trim(),
    jobs: jobs.map(j => ({
      id: j.id, company: j.company, jobTitle: j.jobTitle,
      deadline: j.deadline, applyUrl: j.applyUrl, _s: j._s,
    })),
    updated: Date.now(),
  };
  await env.SUBS.put('sub:' + email.toLowerCase(), JSON.stringify(sub));
  return json({ ok: true, count: sub.jobs.length });
}

async function handleUnsubscribe(req, env) {
  const body = await req.json().catch(() => ({}));
  if (body.email) await env.SUBS.delete('sub:' + String(body.email).toLowerCase());
  return json({ ok: true });
}

// 拉取需要的分片（按 _s 去重），构建 id -> 最新岗位 的映射
async function loadFreshJobs(env, shardsNeeded) {
  const map = {};
  await Promise.all([...shardsNeeded].map(async (s) => {
    try {
      const r = await fetch(`${env.SITE_BASE}/data/index/${String(s).padStart(3, '0')}.json`);
      if (!r.ok) return;
      const data = await r.json();
      // 兼容两种格式：数组化分片 vs 对象分片
      for (const row of data.jobs) {
        const o = Array.isArray(row)
          ? { id: row[0], company: row[1], jobTitle: row[2], deadline: row[8], applyUrl: row[9] }
          : row;
        map[o.id] = o;
      }
    } catch (e) { /* 忽略单个分片失败 */ }
  }));
  return map;
}

async function sendReminders(env) {
  // 列出所有订阅
  let subs = [];
  let cursor;
  do {
    const list = await env.SUBS.list({ cursor });
    cursor = list.list_complete ? undefined : list.cursor;
    for (const k of list.keys) {
      const v = await env.SUBS.get(k.name);
      if (v) try { subs.push(JSON.parse(v)); } catch (e) {}
    }
  } while (cursor);

  // 收集需要回查的分片
  const shardsNeeded = new Set();
  for (const s of subs) for (const j of s.jobs) if (j._s != null) shardsNeeded.add(j._s);
  const fresh = shardsNeeded.size ? await loadFreshJobs(env, shardsNeeded) : {};

  let sent = 0;
  for (const s of subs) {
    const due = [];
    for (const j of s.jobs) {
      const f = fresh[j.id] || j;            // 优先用最新截止时间
      const d = daysLeft(f.deadline);
      if (d !== null && d >= 0 && d <= 3) due.push({ ...j, deadline: f.deadline, d });
    }
    if (!due.length) continue;

    const lines = due.map(j =>
      `· ${j.company} ${j.jobTitle} — 截止 ${j.deadline}（剩 ${j.d} 天）${j.applyUrl ? '\n  投递: ' + j.applyUrl : ''}`
    ).join('\n');
    const title = `秋招截止提醒：${due.length} 个岗位将在 3 天内截止`;
    const desp = lines + '\n\n（来自秋招助手）';

    // 微信：Server 酱（订阅者提供 key）
    if (s.serverChanKey) {
      try {
        await fetch(`https://sctapi.ftqq.com/${s.serverChanKey}.send`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(desp)}`,
        });
      } catch (e) {}
    }
    // 邮件：Resend（可选）
    if (env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: '秋招助手 <onboarding@resend.dev>',
            to: [s.email],
            subject: title,
            text: desp,
          }),
        });
      } catch (e) {}
    }
    sent++;
  }
  return sent;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/api/subscribe') return handleSubscribe(req, env);
    if (req.method === 'POST' && url.pathname === '/api/unsubscribe') return handleUnsubscribe(req, env);
    if (url.pathname === '/api/health') return json({ ok: true });
    return json({ error: 'not found' }, 404);
  },
  async scheduled(_event, env) {
    const sent = await sendReminders(env);
    return new Response('reminders sent to ' + sent + ' subscribers');
  },
};
