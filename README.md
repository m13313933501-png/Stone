# 秋招助手

面向大学生的秋招聚合网站：**聚合企业秋招需求、简历智能匹配、截止时间提醒、企业官网一键跳转**。零成本、无需后端、简历不出本机。

## 功能

1. **岗位聚合与展示**：按截止时间升序排列，支持**行业 / 城市 / 批次（提前批·正式批·实习·补录）/ 状态（已开启·已截止·待确认）/ 关键词**多维筛选；「即将截止（≤7 天）」「已截止」「截止待定」徽标，以及「批次」「✓ 已核实」标签。每日定时**巡检投递链接、剔除死链**，并对失效项打「⚠ 链接失效」标记。
2. **简历智能匹配**：上传 PDF / DOCX，浏览器本地解析并抽取技能标签，与岗位 JD 做**关键词重叠度打分**，按匹配度推荐岗位并高亮命中/缺失技能。
3. **截止时间提醒**：清晰标注各企业秋招截止时间并排序；首页「即将截止（7 天内）」高亮，可**关注岗位并一键导出 .ics 日历提醒**（截止前 3 天 / 1 天弹窗提醒）。
4. **企业官网跳转**：每个岗位提供「投递入口」外链按钮（含官网点位 / 邮箱投递），对非 URL 的投递方式做容错展示。
5. **截止提醒订阅（可选轻量后端）**：关注岗位后填邮箱（与可选 Server 酱 Key），临近截止（≤3 天）时通过**邮件 + 微信**提醒。后端为 Cloudflare Worker（免费），未部署时本功能自动隐藏、不影响其它功能。

> 投递为**跳转企业官方入口**（非站内直投）——各企业投递系统彼此独立，无统一接口，这是当前最可行的方案。

## 数据规模与来源

- **主数据源：秋招雷达聚合接口**（`http://124.221.172.176/api/qiuzhao/search`，公开免登录），一次抓取约 **9800+** 条真实秋招记录，覆盖互联网、银行金融、能源电力、通信、制造、快消等全行业，含公司、城市、岗位方向、批次、状态、截止日、投递链接。
- 种子岗位（`crawler/seed_jobs.json`，约 25 条精选大厂/国企）合并去重后保留。
- 归一化后字段：`company / jobTitle / positions / location / industry / batch / status / deadline / applyUrl / source / verified / skills`。
- 当前 `data/jobs.json` 约 **9900 条**、`data/companies.json` 约 **9900 家企业**。

## 技术架构

- 前端：纯静态（原生 ES Module + CSS），无需构建步骤
- 解析：PDF 用 `pdf.js`、DOCX 用 `mammoth`（均通过 CDN 引入）
- 存储：简历与抽取结果存浏览器 `IndexedDB`，不上传服务器
- 数据：由 `crawler/qiuzhao_radar.py` 每日定时拉取秋招雷达 + 合并种子，生成 `data/jobs.json` / `data/companies.json`
- 托管：`GitHub Pages` + `GitHub Actions` 定时任务（零成本）

## 性能优化：首屏懒加载 / 分片

为降低手机端首屏时间，约 9MB 的 `data/jobs.json` 在部署前被预切分为：

- `data/meta.json`：总数、分片数、字段表、**预计算的筛选项与计数**（下拉框无需加载全量即可显示）
- `data/index/NNN.json`：紧凑数组分片（去掉每个对象的 key 名重复），**首屏仅取第 0 片 ≈ 220KB**
- `data/jd/NNN.json`：岗位描述分片，打开岗位详情时**按需懒加载**

由 `crawler/build_index.py` 生成，前端 `js/data.js` 的 `loadIndexShard / loadJdShard` 负责加载；筛选与简历匹配需要全量时，后台静默拉取其余分片再渲染。

## 本地预览

```bash
cd 秋招
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

> 必须通过 HTTP 访问（`file://` 会因 CORS 无法加载 JSON）。

## 数据管道

- `crawler/qiuzhao_radar.py`：**主数据管道**。拉取秋招雷达公开接口（全量分页）→ 归一化 → 与 `crawler/seed_jobs.json` 种子合并去重 → 写出 `data/jobs.json` / `data/companies.json`。
  - 本地手动跑：`python crawler/qiuzhao_radar.py --cap 500`（先试小批量）；全量去掉 `--cap` 即可。
- `crawler/check_links.py`：**投递链接巡检**。去重 `applyUrl`，并发 HEAD/GET 探测，404 / 连接失败 / DNS 失败判为死链并剔除；403 / 超时保守保留（避免误删）。
  - 本地验证：`python crawler/check_links.py --sample 50`（仅抽 50 个唯一 URL 试跑，不写回全量）。
- `crawler/build_index.py 500`：**分片索引**。把 `jobs.json` 切分为 `meta.json` + `data/index/*` + `data/jd/*`（见上节）。
- `crawler/scraper.py` + `crawler/sources.yaml`：可选模块，抓取牛客等聚合站（需自行补充选择器），当前以秋招雷达为主源。
- `crawler/seed_jobs.json`：精选大厂/国企种子，始终保留并优先展示。

> 每日流水线顺序：`qiuzhao_radar.py` → `check_links.py` → `build_index.py`（见 `.github/workflows/crawl.yml`）。

> 秋招雷达接口为第三方社区聚合数据，**仅供个人参考**；如该接口失效，可回退到 `scraper.py` + 自行配置的聚合站选择器。

## 部署（GitHub Pages）

1. 将本仓库推送到 GitHub（需先完成 GitHub 认证：`gh auth login` 或配置 `GITHUB_TOKEN`）
2. 仓库 Settings → Pages → **Source 选 `GitHub Actions`**
3. 推送后首次 Actions 会自动运行：先爬取最新数据，再部署站点；之后每日 02:00（北京）定时更新

> 工作流 `.github/workflows/crawl.yml` 已同时负责「爬取 + 提交数据 + 部署 Pages」，
> 因此 Pages 来源必须选 **GitHub Actions**（不要选 main 分支 /root）。

## 提醒订阅后端（可选，Cloudflare Worker）

代码见 `backend/subscriber-worker/`，**免费额度即可运行**，与静态站点解耦：

1. 安装并登录：`npm i -g wrangler` → `wrangler login`
2. 建 KV：`cd backend/subscriber-worker && wrangler kv namespace create SUBS`，把返回的 id 填入 `wrangler.toml` 的 `id`
3. 改 `wrangler.toml` 的 `SITE_BASE` 为你的 Pages 地址（如 `https://<user>.github.io/Stone`）
4. （可选）`wrangler secret put RESEND_API_KEY` 开启邮件提醒；微信提醒用订阅者自己填的 **Server 酱 Key**（无需后端密钥）
5. `wrangler deploy`
6. 把 Worker 地址填入前端 `js/config.js` 的 `BACKEND_URL`，「提醒订阅」标签页即启用

Worker 每日 09:00（北京）Cron 自动检查临近截止（≤3 天）的订阅并推送；订阅数据存于 KV，不入仓库。

## 合规说明

数据来自公开秋招信息聚合，仅作参考，请以企业官方渠道为准；爬取已做限速与免责声明，优先官方渠道。
