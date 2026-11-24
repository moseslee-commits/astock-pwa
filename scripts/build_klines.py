# -*- coding: utf-8 -*-
"""生成同源 K 线快照 data/klines.json

主源：baostock（免费、无 token、含当日、前复权）
回退：同花顺 d.10jqka.com.cn（北交所等 baostock 不覆盖的标的）

用法：
    python scripts/build_klines.py            # 在 github-pages-deploy 目录下
    python build_klines.py                    # 在项目根目录（自动转发）
"""
import os, re, io, json, time, random, urllib.request, datetime

KEEP = 80
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "dashboard.html")
OUT = os.path.join(ROOT, "data", "klines.json")

HDR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Referer": "https://www.10jqka.com.cn/",
}


def parse_block(text, name):
    m = re.search(r"const %s = \[(.*?)\n\];" % name, text, re.S)
    if not m:
        return []
    return re.findall(r"secid:\s*'([0-9]+\.\w+)'", m.group(1))


def to_bs(secid):
    p = secid.split(".")
    if len(p) < 2:
        return None
    if p[0] == "1":
        return "sh." + p[1]
    if p[0] == "0":
        return "sz." + p[1]
    return None  # 116 港股不在此通道


def to_ths(secid):
    p = secid.split(".")
    if len(p) < 2:
        return None
    m, c = p[0], p[1]
    if m == "116":
        return None
    if m == "1" and c == "000001":
        return "hs_1A0001"
    if c == "000300":
        return "hs_399300"
    if re.match(r"\d{6}$", c):
        return "hs_" + c
    return None


def grab_ths(secid):
    ths = to_ths(secid)
    if not ths:
        return None
    url = "https://d.10jqka.com.cn/v6/line/%s/01/last.js" % ths
    for _ in range(2):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=12)
            txt = r.read().decode("utf-8", "ignore")
            l, rr = txt.find("("), txt.rfind(")")
            if l < 0 or rr < 0:
                break
            j = json.loads(txt[l + 1:rr])
            rows = [x for x in (j.get("data") or "").split(";") if x]
            if not rows:
                break
            out = []
            for row in rows[-KEEP:]:
                p = row.split(",")
                out.append([p[0], float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[5])])
            return out
        except Exception:
            time.sleep(0.4)
    return None


def grab_bs(bs, secid):
    code = to_bs(secid)
    if not code:
        return None
    rs = bs.query_history_k_data_plus(
        code, "date,open,high,low,close,volume",
        start_date=START, end_date=END, frequency="d", adjustflag="2")
    if rs.error_code != "0":
        return None
    rows = []
    while rs.next():
        r = rs.get_row_data()
        try:
            vol = float(r[5]) if r[5] else 0.0
            if vol <= 0:
                continue
            rows.append([r[0].replace("-", ""), float(r[1]), float(r[2]), float(r[3]), float(r[4]), vol])
        except Exception:
            continue
    return rows[-KEEP:] if rows else None


START = (datetime.date.today() - datetime.timedelta(days=200)).isoformat()
END = datetime.date.today().isoformat()


def main():
    text = io.open(SRC, encoding="utf-8").read()
    wl = parse_block(text, "watchlist")
    il = parse_block(text, "indexList")
    secids = []
    for s in wl + il:
        if s not in secids:
            secids.append(s)
    print("targets", len(secids), "(watchlist %d + index %d)" % (len(wl), len(il)))

    t0 = time.time()
    items, fails, fb = {}, [], []

    bs = None
    try:
        import baostock
        lg = baostock.login()
        if lg.error_code == "0":
            bs = baostock
            print("baostock login ok")
        else:
            print("baostock login failed:", lg.error_msg)
    except Exception as e:
        print("baostock unavailable:", str(e)[:60])

    for secid in secids:
        rows = grab_bs(bs, secid) if bs else None
        if rows:
            items[secid] = rows
        else:
            fb.append(secid)

    print("primary ok %d, fallback %d" % (len(items), len(fb)))

    for secid in fb:
        rows = grab_ths(secid)
        if rows:
            items[secid] = rows
        else:
            fails.append(secid)
        time.sleep(random.uniform(0.02, 0.05))

    if bs:
        try:
            bs.logout()
        except Exception:
            pass

    dates = [items[k][-1][0] for k in items if items[k]]
    snap_date = max(dates) if dates else time.strftime("%Y%m%d")
    snap_date = "%s-%s-%s" % (snap_date[:4], snap_date[4:6], snap_date[6:8])

    payload = {
        "date": snap_date,
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": "baostock:qfq(d) + 10jqka fallback",
        "count": len(items),
        "items": items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    io.open(OUT, "w", encoding="utf-8").write(raw)

    el = time.time() - t0
    print("ok %d / fail %d | %.1fs | out %.0fKB | date %s"
          % (len(items), len(fails), el, os.path.getsize(OUT) / 1024, snap_date))
    if fails:
        print("fail_list", ",".join(fails[:15]))
    if items:
        k = secids[0]
        r = items.get(k)
        print("sample", k, "rows", len(r) if r else 0, "last", r[-1] if r else None)


if __name__ == "__main__":
    main()
