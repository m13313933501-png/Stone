#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
投递链接有效性巡检：
  1. 从 data/jobs.json 抽取唯一 applyUrl（仅 http(s)，跳过邮箱/文本类）
  2. 并发 HEAD/GET 探测（短超时、跟随重定向）
  3. 判定死链：404 / 410 / 连接失败 / DNS 解析失败 → 从数据中剔除
     403 / 超时 / 其它 → 视为“可能有效”，保留（避免误删）
  4. 写回 data/jobs.json（原文件备份为 data/jobs.json.bak）

用法：
  python crawler/check_links.py                 # 全量巡检（供 Actions 每日跑）
  python crawler/check_links.py --sample 50    # 仅抽前 50 个唯一 URL 验证
"""
import json, os, sys, argparse, urllib.parse, concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = os.path.join(ROOT, "data", "jobs.json")

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; QiuzhaoBot/1.0)"}


def is_url(s):
    return isinstance(s, str) and s.startswith(("http://", "https://"))


def check(url, timeout):
    import requests
    try:
        r = requests.head(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        if r.status_code in (404, 410):
            return "dead"
        if r.status_code == 405:  # HEAD 不允许，改 GET
            r = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True, stream=True)
            r.close()
            if r.status_code in (404, 410):
                return "dead"
        if r.status_code >= 400:
            return "suspect"  # 4xx/5xx 但非 404/410，保守保留
        return "alive"
    except requests.exceptions.ConnectionError:
        return "dead"          # 连接失败 / DNS 失败
    except requests.exceptions.SSLError:
        return "suspect"
    except Exception:
        return "suspect"       # 超时等，保守保留


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="仅抽前 N 个唯一 URL（验证用）")
    ap.add_argument("--timeout", type=float, default=6.0)
    ap.add_argument("--workers", type=int, default=32)
    args = ap.parse_args()

    if not os.path.exists(JOBS):
        print("缺少 data/jobs.json", file=sys.stderr); sys.exit(1)

    jobs = json.load(open(JOBS, encoding="utf-8"))
    # 唯一 http(s) URL -> 关联的 job id 列表
    url_to_ids = {}
    for j in jobs:
        u = j.get("applyUrl")
        if is_url(u):
            url_to_ids.setdefault(u, []).append(j.get("id"))

    urls = list(url_to_ids.keys())
    if args.sample:
        urls = urls[:args.sample]
    print(f"待巡检唯一 URL：{len(urls)}（共 {len(url_to_ids)} 个，来自 {len(jobs)} 条岗位）")

    dead_urls = set()
    alive = suspect = 0
    with cf.ThreadPoolExecutor(max_workers=args.sample or args.workers) as ex:
        fut = {ex.submit(check, u, args.timeout): u for u in urls}
        done = 0
        for f in cf.as_completed(fut):
            u = fut[f]
            res = f.result()
            done += 1
            if res == "dead":
                dead_urls.add(u)
            elif res == "alive":
                alive += 1
            else:
                suspect += 1
            if done % 500 == 0 or done == len(urls):
                print(f"  进度 {done}/{len(urls)}  alive={alive} suspect={suspect} dead={len(dead_urls)}")

    dead_ids = set()
    for u in dead_urls:
        dead_ids.update(url_to_ids[u])
    before = len(jobs)
    kept = [j for j in jobs if j.get("id") not in dead_ids]
    removed = before - len(kept)
    print(f"死链命中 {len(dead_urls)} 个 URL，涉及 {removed} 条岗位，已剔除。保留 {len(kept)} 条。")

    if removed:
        os.replace(JOBS, JOBS + ".bak")
        json.dump(kept, open(JOBS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        # 同步清理备份里体积无关的：保留 .bak 仅供回滚
    print("完成。")


if __name__ == "__main__":
    main()
