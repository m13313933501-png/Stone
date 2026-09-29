#!/usr/bin/env python3
"""秋招数据爬虫：读取 sources.yaml，输出 data/jobs.json 与 data/companies.json。

数据来源（按方案）：
  A. seed_companies  —— 固定企业清单（始终进入数据，保证站点非空）
  B. aggregation_sites —— 聚合站爬取（需自行填写选择器；JS 站点请启用 Playwright）
  D. open_api        —— 可选开放 API（需自定义映射）

运行：pip install -r requirements.txt && python crawler/scraper.py
输出：仓库根 /data/jobs.json, /data/companies.json
"""
import json
import os
import re
import sys
import time
from datetime import date
from pathlib import Path
from urllib.parse import urljoin

try:
    import yaml
    import requests
    from bs4 import BeautifulSoup
except ImportError as e:
    sys.stderr.write(f"[error] 缺少依赖，请先 pip install -r crawler/requirements.txt：{e}\n")
    sys.exit(1)

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
SCFG = BASE / "crawler" / "sources.yaml"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; QiuzhaoBot/1.0; +https://github.com/)",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# 与前端 js/skills.js 保持一致的技能词表（用于从 JD 抽取标签）
SKILLS = [
    "Python","Java","JavaScript","TypeScript","C++","C#","C","Go","Rust","Swift","Kotlin","PHP","Ruby","Scala",
    "React","Vue","Angular","前端","HTML","CSS","工程化","Webpack","Vite","可视化",
    "Spring","Django","Flask","Node","Express","微服务","分布式","RESTful","GraphQL",
    "SQL","MySQL","PostgreSQL","Redis","MongoDB","数据库","数据分析","数据挖掘","报表","数仓",
    "算法","数据结构","机器学习","深度学习","TensorFlow","PyTorch","自然语言处理","计算机视觉","NLP","CV",
    "Linux","Docker","Kubernetes","云计算","AWS","阿里云","网络","操作系统","嵌入式","硬件","电路",
    "图形学","游戏","游戏引擎","Unity","Unreal",
    "产品","产品经理","需求分析","策划","创意","运营","市场营销","用户增长","内容运营",
    "人力资源","财务","会计","金融","软件工程","项目管理","测试","质量保障",
    "沟通能力","团队合作","领导力","学习能力","英语","普通话","数据分析思维","逻辑思维",
    "计算机","软件","电子信息","通信","电力系统","数学","统计",
]


def fetch(url, timeout=15):
    r = requests.get(url, headers=HEADERS, timeout=timeout)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def parse_date(text):
    if not text:
        return None
    t = text.strip()
    if re.search(r"尽快|招满|滚动|长期|不限|待定|不确定|另行通知", t):
        return None
    m = re.search(r"(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})", t)
    if m:
        try:
            return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})[-/月](\d{1,2})", t)
    if m:
        y = date.today().year
        try:
            return f"{y:04d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        except ValueError:
            return None
    return None


def extract_skills(text):
    if not text:
        return []
    hits, seen = [], set()
    for s in SKILLS:
        if s in seen:
            continue
        if re.fullmatch(r"[A-Za-z0-9+#.]+", s):
            if re.search(r"(?<![A-Za-z0-9])" + re.escape(s) + r"(?![A-Za-z0-9])", text, re.I):
                hits.append(s); seen.add(s)
        elif s in text:
            hits.append(s); seen.add(s)
    return hits


def _select(soup, sel):
    """支持 'css' 取文本，或 'css::attr(name)' 取属性。"""
    if not sel:
        return None
    attr = None
    if "::attr(" in sel:
        sel, _, attr = sel.partition("::attr(")
        attr = attr.rstrip(")")
    el = soup.select_one(sel)
    if not el:
        return None
    return el.get(attr).strip() if attr else el.get_text(" ", strip=True)


def scrape_site(site):
    jobs = []
    sel = site.get("selectors", {})
    try:
        html = fetch(site["listUrl"])
        soup = BeautifulSoup(html, "html.parser")
        card_sel = sel.get("card", "body")
        cards = soup.select(card_sel)[:200] if card_sel != "body" else [soup]
        for c in cards:
            title = _select(c, sel.get("title"))
            company = _select(c, sel.get("company"))
            if not (title and company):
                continue
            deadline = parse_date(_select(c, sel.get("deadline")))
            apply = _select(c, sel.get("applyUrl"))
            apply = urljoin(site["listUrl"], apply) if apply else site.get("applyUrl")
            jd = _select(c, sel.get("jd")) or ""
            jobs.append({
                "company": company,
                "jobTitle": title,
                "location": _select(c, sel.get("location")) or "",
                "industry": _select(c, sel.get("industry")) or "",
                "deadline": deadline,
                "applyUrl": apply or "",
                "source": site.get("name", "聚合站"),
                "jd": jd,
                "skills": extract_skills(f"{title} {jd}"),
            })
        print(f"[info] 站点 {site.get('name')} 解析到 {len(jobs)} 条")
    except Exception as e:
        print(f"[warn] 站点 {site.get('name')} 抓取失败：{e}")
    time.sleep(1.5)  # 限速，友好爬取
    return jobs


def build():
    cfg = yaml.safe_load(SCFG.read_text(encoding="utf-8"))
    companies, jobs = [], []
    cid = {}

    def add_company(name, officialUrl, industry, description=""):
        if name in cid:
            return cid[name]
        c_id = "c" + str(len(companies) + 1)
        companies.append({
            "id": c_id, "name": name,
            "officialUrl": officialUrl or None,
            "logo": None, "industry": industry or "", "description": description or None,
        })
        cid[name] = c_id
        return c_id

    # A. 种子企业
    for sc in cfg.get("seed_companies", []):
        add_company(sc["name"], sc.get("officialUrl"), sc.get("industry"), sc.get("description"))

    # B. 聚合站
    for site in cfg.get("aggregation_sites", []):
        if not site.get("enabled", False):
            continue
        for j in scrape_site(site):
            c_id = add_company(j["company"], None, j.get("industry"))
            jobs.append({
                "id": f"x{len(jobs)+1}", "companyId": c_id, "company": j["company"],
                "jobTitle": j["jobTitle"], "location": j.get("location", ""),
                "industry": j.get("industry", ""), "deadline": j.get("deadline"),
                "applyUrl": j.get("applyUrl", ""), "officialUrl": None,
                "source": j.get("source", "聚合站"),
                "jd": j.get("jd", ""), "skills": j.get("skills", []),
            })

    # D. 开放 API（占位，需自定义映射）
    api = cfg.get("open_api", {})
    if api.get("enabled") and api.get("endpoint"):
        print("[info] open_api 已启用但未实现映射，跳过（请在 scraper.py 中扩展 open_api_normalize）")

    # 兜底：种子企业无任何爬取岗位时，补一条占位岗位，保证站点非空
    seeded = {j["company"] for j in jobs}
    for c in companies:
        if c["name"] not in seeded:
            jobs.append({
                "id": f"seed{len(jobs)+1}", "companyId": c["id"], "company": c["name"],
                "jobTitle": "秋招岗位（详见官网）", "location": "",
                "industry": c["industry"], "deadline": None,
                "applyUrl": c["officialUrl"] or "", "officialUrl": c["officialUrl"],
                "source": "种子清单", "jd": "请在官网招聘页查看具体岗位与要求。",
                "skills": [],
            })
    # 补 officialUrl 回填到岗位
    cmap = {c["name"]: c["officialUrl"] for c in companies}
    for j in jobs:
        if not j.get("officialUrl") and cmap.get(j["company"]):
            j["officialUrl"] = cmap[j["company"]]

    # 去重（company+title+applyUrl）
    seen, uniq = set(), []
    for j in jobs:
        k = (j["company"], j["jobTitle"], j.get("applyUrl", ""))
        if k in seen:
            continue
        seen.add(k); uniq.append(j)
    jobs = uniq

    DATA.mkdir(exist_ok=True)
    jobs_path = DATA / "jobs.json"
    comp_path = DATA / "companies.json"
    # 保留已有岗位中可能更丰富的字段：此处直接覆盖为本次生成结果
    jobs_path.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    comp_path.write_text(json.dumps(companies, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] 写出 {len(jobs)} 个岗位、{len(companies)} 家企业 -> {jobs_path}")


if __name__ == "__main__":
    build()
