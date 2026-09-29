#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
投递链接有效性巡检（增强版）：
  1. 从 data/jobs.json 抽取唯一 applyUrl（仅 http(s)，跳过邮箱/文本类）
  2. 并发探测（短超时、跟随重定向）
     - HEAD 请求；连接错误自动重试 1 次（防网络抖动误判）
     - HEAD 得 404/410 → 死链
     - HEAD 得 405（方法不允许）→ 降级 GET 复查
     - HEAD 得其它 4xx/5xx → 降级 GET 复查（很多站点 HEAD 处理不当，GET 才准）
     - GET 跟随重定向后检查最终状态码，404/410 → 死链
  3. 判定死链：404 / 410 / 连接失败（GET 复查仍失败）/ DNS 解析失败 → 剔除
     403 / 超时 / SSL / 其它 → 视为“可能有效”，保留（避免误删）
  4. 写回 data/jobs.json（原文件备份为 data/jobs.json.bak）

用法：
  python crawler/check_links.py                 # 全量巡检（供 Actions 每日跑）
  python crawler/check_links.py --sample 50    # 仅抽前 50 个唯一 URL 验证
"""
import json, os, sys, time, argparse, concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = os.path.join(ROOT, "data", "jobs.json")

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; QiuzhaoBot/1.0)"}


def is_url(s):
    return isinstance(s, str) and s.startswith(("http://", "https://"))


def _request(url, method, timeout):
    import requests
    if method == "head":
        return requests.head(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
    r = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True, stream=True)
    r.close()
    return r


def _get_status(url, method, timeout, retries=1):
    """带重试的请求，返回 (status_code, error)；error 非 None 表示请求失败。"""
    import requests
    last_err = None
    for i in range(retries + 1):
        try:
            return _request(url, method, timeout).status_code, None
        except requests.exceptions.SSLError:
            return None, "ssl"          # SSL 问题不重试，交上层保守处理
        except requests.exceptions.ConnectionError as e:
            last_err = e
            if i < retries:
                time.sleep(0.4)         # 短暂等待后重试，防抖动
        except Exception as e:
            last_err = e
            if i < retries:
                time.sleep(0.4)
    return None, type(last_err).__name__ if last_err else "error"


def check(url, timeout):
    # 第一轮：HEAD（连接错误自动重试 1 次）
    code, err = _get_status(url, "head", timeout)
    if err == "ssl":
        return "suspect"
    if code is not None:
        if code in (404, 410):
            return "dead"
        if code < 400:
            return "alive"
        if code == 405:
            # HEAD 不允许 → GET 复查
            gcode, gerr = _get_status(url, "get", timeout)
            if gerr is None:
                return "dead" if gcode in (404, 410) else ("alive" if gcode < 400 else "suspect")
            return "suspect"
        # 其它 4xx/5xx：HEAD 结果不可靠 → GET 复查再判
        gcode, gerr = _get_status(url, "get", timeout)
        if gerr is None:
            if gcode in (404, 410):
                return "dead"
            if gcode < 400:
                return "alive"
        return "suspect"

    # HEAD 请求失败（超时/连接错误等）：GET 复查一次
    gcode, gerr = _get_status(url, "get", timeout)
    if gerr is None:
        if gcode in (404, 410):
            return "dead"
        return "alive" if gcode < 400 else "suspect"
    # GET 也失败：区分 DNS/连接失败（死链）与超时等（保守保留）
    if gerr in ("ConnectTimeout", "ConnectionError", "ProxyError", "MissingSchema", "InvalidSchema"):
        return "dead"
    return "suspect"


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
    print("完成。")


if __name__ == "__main__":
    main()
