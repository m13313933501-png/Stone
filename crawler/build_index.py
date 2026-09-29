#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把同源的 data/jobs.json（全量，含 jd）切分为：
  - data/meta.json       首屏元数据：总数、分片数、字段表、筛选项清单（带计数）
  - data/index/NNN.json  紧凑数组分片（不含 jd），首屏/分页懒加载
  - data/jd/NNN.json      岗位描述分片（按需懒加载）

目的：把 9.3MB 的整包下载拆成「首屏 ~0.4MB + 滚动/筛选按需加载」，
大幅降低手机端首屏时间。数组化（去掉每个对象的 key 名重复）再省 ~1MB。
"""
import json, os, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = os.path.join(ROOT, "data", "jobs.json")
IDX_DIR = os.path.join(ROOT, "data", "index")
JD_DIR = os.path.join(ROOT, "data", "jd")
META = os.path.join(ROOT, "data", "meta.json")

# 紧凑数组的字段顺序（必须与前端 HEADER 完全一致）
HEADER = ["id", "company", "jobTitle", "positions", "location", "industry",
          "batch", "status", "deadline", "applyUrl", "officialUrl",
          "source", "verified", "skills"]

# 固定枚举（前端下拉用，优先用这些再补其它）
KNOWN_BATCH = ["提前批", "正式批", "实习", "补录"]
KNOWN_STATUS = ["已开启", "已截止", "待确认"]


def main():
    per = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    if not os.path.exists(JOBS):
        print("缺少 data/jobs.json，请先运行 qiuzhao_radar.py", file=sys.stderr)
        sys.exit(1)

    jobs = json.load(open(JOBS, encoding="utf-8"))
    total = len(jobs)

    os.makedirs(IDX_DIR, exist_ok=True)
    os.makedirs(JD_DIR, exist_ok=True)

    # 清空旧分片，避免残留
    for d in (IDX_DIR, JD_DIR):
        for f in os.listdir(d):
            if f.endswith(".json"):
                os.remove(os.path.join(d, f))

    shards = (total + per - 1) // per
    industries, cities, batches, statuses = (collections.Counter() for _ in range(4))

    for s in range(shards):
        chunk = jobs[s * per:(s + 1) * per]
        arr = []
        jdmap = {}
        for j in chunk:
            row = [j.get(k, "" if k != "verified" else False) for k in HEADER]
            # verified 保持布尔
            row[HEADER.index("verified")] = bool(j.get("verified", False))
            arr.append(row)
            jd = j.get("jd") or ""
            if jd.strip():
                jdmap[j.get("id")] = jd
            # 计数
            if j.get("industry"): industries[j["industry"]] += 1
            if j.get("location"): cities[j["location"]] += 1
            if j.get("batch"): batches[j["batch"]] += 1
            if j.get("status"): statuses[j["status"]] += 1
        with open(os.path.join(IDX_DIR, f"{s:03d}.json"), "w", encoding="utf-8") as f:
            json.dump({"n": len(arr), "jobs": arr}, f, ensure_ascii=False, separators=(",", ":"))
        with open(os.path.join(JD_DIR, f"{s:03d}.json"), "w", encoding="utf-8") as f:
            json.dump(jdmap, f, ensure_ascii=False, separators=(",", ":"))

    # 筛选项：固定枚举优先，再补出现过的其它值（带计数，按计数降序）
    def opts(known, counter):
        extra = [k for k in counter if k not in known]
        ordered = [v for v in known if v in counter] + sorted(extra, key=lambda x: -counter[x])
        return [{"v": v, "c": counter.get(v, 0)} for v in ordered]

    meta = {
        "total": total,
        "shards": shards,
        "perShard": per,
        "header": HEADER,
        "industries": opts([], industries),
        # 城市唯一值过多（大量「北京/上海」组合串），下拉只放 Top 60，其余靠搜索框覆盖
        "cities": opts([], cities)[:60],
        "batches": opts(KNOWN_BATCH, batches),
        "statuses": opts(KNOWN_STATUS, statuses),
        "generated": __import__("datetime").date.today().isoformat(),
    }
    json.dump(meta, open(META, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    idx_size = sum(os.path.getsize(os.path.join(IDX_DIR, f)) for f in os.listdir(IDX_DIR))
    jd_size = sum(os.path.getsize(os.path.join(JD_DIR, f)) for f in os.listdir(JD_DIR))
    print(f"分片完成：{total} 岗 -> {shards} 片 (每片 {per})")
    print(f"  data/index 总大小: {idx_size/1024/1024:.2f} MB（首屏仅取 1 片 ≈ {per} 条）")
    print(f"  data/jd    总大小: {jd_size/1024/1024:.2f} MB（详情打开时按需加载）")
    print(f"  meta 筛选项: 行业 {len(meta['industries'])} / 城市 {len(meta['cities'])} / 批次 {len(meta['batches'])} / 状态 {len(meta['statuses'])}")


if __name__ == "__main__":
    main()
