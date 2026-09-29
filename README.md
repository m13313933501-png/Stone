# 秋招助手

面向大学生的秋招聚合网站：**聚合企业秋招需求、简历智能匹配、截止时间提醒、企业官网一键跳转**。零成本、无需后端、简历不出本机。

## 功能

1. **岗位聚合与展示**：按截止时间升序排列，支持行业 / 城市 / 关键词筛选，「即将截止（≤7 天）」「已截止」「截止待定」徽标。
2. **简历智能匹配**：上传 PDF / DOCX，浏览器本地解析并抽取技能标签，与岗位 JD 做**关键词重叠度打分**，按匹配度推荐岗位并高亮命中/缺失技能。
3. **截止时间提醒**：清晰标注各企业秋招截止时间并排序；首页「即将截止（7 天内）」高亮，可**关注岗位并一键导出 .ics 日历提醒**（截止前 3 天 / 1 天弹窗提醒）。
4. **企业官网跳转**：每个岗位提供「企业官网介绍」与「投递入口」两个外链按钮。

> 投递为**跳转企业官方入口**（非站内直投）——各企业投递系统彼此独立，无统一接口，这是当前最可行的方案。

## 技术架构

- 前端：纯静态（原生 ES Module + CSS），无需构建步骤
- 解析：PDF 用 `pdf.js`、DOCX 用 `mammoth`（均通过 CDN 引入）
- 存储：简历与抽取结果存浏览器 `IndexedDB`，不上传服务器
- 数据：由 `crawler/scraper.py` 每日定时生成 `data/jobs.json` / `data/companies.json`
- 托管：`GitHub Pages` + `GitHub Actions` 定时任务（零成本）

## 本地预览

```bash
cd 秋招
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

> 必须通过 HTTP 访问（`file://` 会因 CORS 无法加载 JSON）。

## 配置数据源（crawler/sources.yaml）

- `seed_companies`：固定企业清单（始终进入数据）
- `aggregation_sites`：聚合站爬取，填写正确 CSS 选择器并将 `enabled: true` 开启
- `open_api`：可选开放 API（需自定义映射）

聚合站若为 JS 渲染型，取消 `requirements.txt` 中 `playwright` 注释并在 `scraper.py` 启用对应分支。

## 部署（GitHub Pages）

1. 将本仓库推送到 GitHub（需先完成 GitHub 认证：`gh auth login` 或配置 `GITHUB_TOKEN`）
2. 仓库 Settings → Pages → **Source 选 `GitHub Actions`**
3. 推送后首次 Actions 会自动运行：先爬取最新数据，再部署站点；之后每日 02:00（北京）定时更新

> 工作流 `.github/workflows/crawl.yml` 已同时负责「爬取 + 提交数据 + 部署 Pages」，
> 因此 Pages 来源必须选 **GitHub Actions**（不要选 main 分支 /root）。

## 合规说明

数据来自公开秋招信息聚合，仅作参考，请以企业官方渠道为准；爬取已做限速与免责声明，优先官方渠道。
