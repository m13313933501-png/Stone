#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
秋招雷达数据抓取 -> 归一化为本站 data/jobs.json / data/companies.json

数据源: http://124.221.172.176/api/qiuzhao/search  (公开接口, 免登录)
模型: 秋招雷达为「公司维度 + 多岗位 + 批次 + 状态」，本站为「岗位维度」。
本脚本把每条记录归一化为一个岗位，并补全 batch / status / verified / positions 字段。
"""
import json
import re
import sys
import time
import hashlib
import argparse
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "crawler" / "seed_jobs.json"
OUT_JOBS = ROOT / "data" / "jobs.json"
OUT_COMPS = ROOT / "data" / "companies.json"

BASE = "http://124.221.172.176"
SEARCH = f"{BASE}/api/qiuzhao/search"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": f"{BASE}/qiuzhao",
    "Accept": "application/json",
}

# 技能关键词（中英文），用于从岗位文本抽取技能标签做简历匹配
SKILLS = [
    # 语言
    "Python", "Java", "C++", "C语言", "C#", "Go", "Golang", "JavaScript", "TypeScript",
    "Rust", "Swift", "Kotlin", "PHP", "Ruby", "Scala", "Shell", "Matlab",
    # 前端
    "HTML", "CSS", "React", "Vue", "Angular", "Node.js", "小程序", "jQuery", "前端",
    # 后端/架构
    "Spring", "Django", "Flask", "FastAPI", "Express", "Gin", "微服务", "RESTful", "API",
    # 数据/AI
    "SQL", "MySQL", "PostgreSQL", "Oracle", "MongoDB", "Redis", "Hadoop", "Spark", "Kafka",
    "Flink", "机器学习", "深度学习", "神经网络", "NLP", "自然语言处理", "计算机视觉", "CV",
    "大模型", "LLM", "AIGC", "数据分析", "数据挖掘", "爬虫", "TensorFlow", "PyTorch",
    "Pandas", "Numpy", "人工智能", "算法", "数据可视化",
    # 云/运维
    "Linux", "Docker", "Kubernetes", "K8s", "云计算", "AWS", "阿里云", "腾讯云", "华为云",
    "CI/CD", "Git", "运维", "网络安全", "安全",
    # 产品/运营/设计
    "Excel", "PPT", "Word", "产品设计", "产品经理", "PRD", "需求分析", "用户研究", "运营",
    "策划", "文案", "UI", "UX", "Photoshop", "Figma", "剪辑", "视频", "新媒体", "市场营销",
    "沟通能力", "团队合作", "项目管理",
    # 职能领域
    "财务", "会计", "金融", "投资", "风控", "审计", "税务", "人力资源", "HR", "供应链",
    "物流", "采购", "法务", "咨询", "销售", "商务", "嵌入式", "硬件", "芯片", "半导体",
    "通信", "网络", "测试", "自动化", "机械", "电气", "土木", "建筑", "医药", "生物",
    "化学", "材料", "能源", "电力",
]

BATCH_TAGS = ["提前批", "正式批", "实习", "补录"]


def slug(name: str) -> str:
    h = hashlib.md5(name.encode("utf-8")).hexdigest()[:8]
    return "co_" + h


def extract_skills(text: str):
    if not text:
        return []
    t = text.lower()
    found = []
    for kw in SKILLS:
        if kw.lower() in t:
            found.append(kw)
    # 去重保序
    seen = set()
    out = []
    for s in found:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def fetch_all(cap=None, delay=0.15):
    items = []
    page = 1
    size = 100
    while True:
        try:
            r = requests.get(SEARCH, params={"page": page, "size": size},
                             headers=HEADERS, timeout=20)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print("  [warn] 第", page, "页抓取失败:", e, file=sys.stderr)
            break
        its = data.get("items", [])
        if not its:
            break
        items.extend(its)
        total = data.get("total", 0)
        print(f"  第 {page} 页: +{len(its)} (累计 {len(items)}/{total})")
        if cap and len(items) >= cap:
            items = items[:cap]
            break
        if len(items) >= total:
            break
        page += 1
        time.sleep(delay)
    return items


def norm_batch(b):
    b = (b or "").strip()
    has = [tag for tag in BATCH_TAGS if tag in b]
    return "、".join(has)


def split_positions(s):
    # 秋招雷达 positions 可能用 逗号 / 顿号 / 分号 / 空格 分隔，统一拆开
    return [p.strip() for p in re.split(r"[，,、；;\s\u3000]+", (s or "")) if p.strip()]


def ensure_fields(j):
    # 为旧种子岗位补齐新增字段，保证前端访问安全
    j.setdefault("positions", [j.get("jobTitle", "")])
    j.setdefault("batch", "")
    j.setdefault("status", "已开启" if not j.get("deadline") else "")
    j.setdefault("verified", False)
    j.setdefault("sourceUrl", None)
    j.setdefault("companyId", slug(j.get("company", "")))
    return j


def to_job(it):
    name = (it.get("name") or "").strip()
    positions = split_positions(it.get("positions"))
    if not positions:
        positions = [name] if name else ["校招岗位"]
    city = (it.get("city") or "").strip()
    industry = (it.get("category") or it.get("industry") or "").strip()
    batch = norm_batch(it.get("batch"))
    status = (it.get("status") or "").strip()
    deadline = (it.get("deadline") or "").strip() or None
    official = (it.get("official_url") or "").strip()
    apply = official if official else None
    text = " ".join([name] + positions + [(it.get("notes") or ""), industry,
                     (it.get("industry") or "")])
    skills = extract_skills(text)
    return {
        "id": "qz_" + str(it.get("id")),
        "companyId": slug(name),
        "company": name,
        "jobTitle": positions[0],
        "positions": positions,
        "location": city,
        "industry": industry,
        "batch": batch,
        "status": status,
        "deadline": deadline,
        "applyUrl": apply,
        "officialUrl": None,
        "source": "秋招雷达",
        "sourceUrl": (it.get("source_url") or "").strip() or None,
        "verified": bool(it.get("verified")),
        "jd": (it.get("notes") or "").strip(),
        "skills": skills,
    }


def dedupe_key(j):
    return (j["company"].strip().lower(), j["jobTitle"].strip().lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=0, help="最多抓取条数，0=全部")
    ap.add_argument("--delay", type=float, default=0.15, help="请求间隔(秒)")
    args = ap.parse_args()

    print("[1] 读取种子岗位")
    seed = json.loads(SEED.read_text(encoding="utf-8")) if SEED.exists() else []
    seed = [ensure_fields(j) for j in seed]
    print(f"    种子 {len(seed)} 条")

    print("[2] 抓取秋招雷达 API")
    items = fetch_all(cap=args.cap or None, delay=args.delay)
    print(f"    抓到 {len(items)} 条")

    if not items:
        print("[中止] 未抓到任何数据，保留现有 data/jobs.json 不被覆盖。", file=sys.stderr)
        sys.exit(1)

    print("[3] 归一化 + 合并 + 去重")
    jobs = list(seed)
    seen = set(dedupe_key(j) for j in jobs)
    added = 0
    for it in items:
        j = to_job(it)
        k = dedupe_key(j)
        if k in seen:
            continue
        seen.add(k)
        jobs.append(j)
        added += 1
    print(f"    新增 {added} 条，合计 {len(jobs)} 条")

    print("[4] 写出 companies.json")
    comps = {}
    for j in jobs:
        c = comps.setdefault(j["companyId"], {
            "id": j["companyId"],
            "name": j["company"],
            "officialUrl": None,
            "industry": j["industry"],
            "jobCount": 0,
        })
        c["jobCount"] += 1
        if not c["officialUrl"] and j["applyUrl"] and j["applyUrl"].startswith("http"):
            c["officialUrl"] = j["applyUrl"]
    comp_list = sorted(comps.values(), key=lambda x: -x["jobCount"])
    OUT_COMPS.write_text(json.dumps(comp_list, ensure_ascii=False, separators=(",", ":")),
                         encoding="utf-8")

    print("[5] 写出 jobs.json")
    OUT_JOBS.write_text(json.dumps(jobs, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
    print("完成。岗位", len(jobs), "企业", len(comp_list))


if __name__ == "__main__":
    main()
