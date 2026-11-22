"""
DAILY FIND の公開用ファイルを作るスクリプト（GitHub Actions が自動で実行します）。

記事を保存するたびに、次のものを _site フォルダに作ります。
  - p/<記事ID>.html … 記事ごとのページ。X や LINE で共有するとジャケット付きのカードになる
  - sitemap.xml      … 検索エンジン向けのページ一覧
  - feed.xml         … 新しい記事のお知らせ（RSS）
  - robots.txt       … 検索エンジンへの案内（書く画面は載せない）
標準ライブラリだけで動きます。
"""

import html
import json
import re
import shutil
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

SITE = "https://dailyfind.github.io"
NAME = "DAILY FIND"
TAGLINE = "毎日ひとつ、いいものを見つける。"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
SKIP = {".git", ".github", "tools", "_site", ".cache"}
JST = timezone(timedelta(hours=9))

CATS = {  # common.js と同じ
    "本": ("BOOKS", "#2c3a48", "詳しく見てみる"),
    "映画": ("FILM", "#47292f", "作品を見てみる"),
    "音楽": ("MUSIC", "#8a3a2c", "聴いてみる"),
    "お店": ("PLACES", "#4a5240", "お店をのぞいてみる"),
    "アニメ": ("ANIME", "#463e5c", "作品を見てみる"),
    "ゲーム": ("GAMES", "#2c4644", "詳しく見てみる"),
    "その他": ("OTHERS", "#3b3936", "詳しく見てみる"),
}

CSP = ("default-src 'self'; script-src 'none'; img-src 'self' data: https:; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       "object-src 'none'; base-uri 'none'; form-action 'none'")

e = lambda s: html.escape(str(s or ""), quote=True)


def cat(c):
    return CATS.get(c, CATS["その他"])


def safe_link(u):
    u = str(u or "")
    return u if u.startswith(("https://", "http://")) else ""


def image_url(p):
    img = str(p.get("image") or "")
    if img.startswith("images/") and "/" not in img[7:] and ".." not in img:
        return f"{SITE}/{img}"
    return img if img.startswith("https://") else ""


def describe(p):
    parts = [p.get("by"), p.get("oneline")]
    text = " ｜ ".join(str(x) for x in parts if x) or str(p.get("body") or "")[:100]
    return text[:160]


def cta(p):
    link = safe_link(p.get("link"))
    svc = ""
    if p.get("category") == "音楽":
        if "music.apple.com" in link or "itunes.apple.com" in link:
            svc = "Apple Music で"
        elif "spotify" in link:
            svc = "Spotify で"
        elif "youtu" in link:
            svc = "YouTube で"
    return svc + cat(p.get("category"))[2]


def music_links(p):
    """Apple Music / Spotify / LINE MUSIC / YouTube Music のリンク（曲のリンクがあればそれ、なければ検索）"""
    from urllib.parse import quote, urlparse
    q = quote(f"{p.get('title', '')} {p.get('by', '')}".strip())
    link = safe_link(p.get("link"))
    host = urlparse(link).hostname or ""
    apps = [
        ("Apple Music", ("music.apple.com", "itunes.apple.com"), f"https://music.apple.com/jp/search?term={q}"),
        ("Spotify", ("spotify.com",), f"https://open.spotify.com/search/{q}"),
        ("LINE MUSIC", ("music.line.me",), f"https://music.line.me/webapp/search?query={q}"),
        ("YouTube Music", ("youtube.com", "youtu.be"), f"https://music.youtube.com/search?q={q}"),
    ]
    return [(name, link if link and any(host == h or host.endswith("." + h) for h in hosts) else url) for name, hosts, url in apps]


# ===== Apple Music の「曲そのもの」のリンクを調べる =====
# iPhone からは Apple の検索の仕組みが使えない（Apple Music アプリへ飛ばされる）ため、
# ここ（GitHub のサーバー）で「曲名＋アーティスト」から曲のリンクを調べて applelinks.json に書いておく。
# サイトはこの表を見て、「聴く」ボタンを Apple Music の検索ではなく曲そのものに向ける。
CACHE = ROOT / ".cache" / "applelinks.json"   # 前回調べた結果（GitHub Actions のキャッシュで次回に引き継ぐ）
FIRESTORE = "https://firestore.googleapis.com/v1/projects/dailyfind-friends/databases/(default)/documents"
API_KEY = "AIzaSyB-FxC1jCePfY8FNsXPHv72lKuQ-0OdO5E"   # サイトに書いてある公開用の鍵と同じ
APPLE_TRACK = re.compile(r"^https://music\.apple\.com/[a-z]{2}/(album|song)/[^\s\"<>]+$")
MAX_NEW = 15   # 1回に新しく調べる曲の数（Apple の回数制限に引っかからないように）


def song_key(title, by):
    """曲を見分けるための文字（サイトの friends.js と同じ作り方）"""
    s = unicodedata.normalize("NFKC", f"{title or ''} {by or ''}").lower()
    return re.sub(r"\s+", "", s)


def is_apple_search(link):
    return str(link or "").startswith("https://music.apple.com/jp/search?")


def http_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "dailyfind-build/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def public_songs():
    """誰でも見られる曲（公開の投稿・みんなのプレイリスト）の曲名とアーティスト"""
    out = []
    for coll in ("pubposts", "songs"):
        token = ""
        for _ in range(10):
            q = {"pageSize": "300", "key": API_KEY}
            if token:
                q["pageToken"] = token
            try:
                data = http_json(f"{FIRESTORE}/{coll}?" + urllib.parse.urlencode(q))
            except Exception as ex:  # 読めなくてもサイトは作る
                print(f"skip {coll}: {ex}")
                break
            for d in data.get("documents", []):
                f = d.get("fields", {})
                val = lambda k: f.get(k, {}).get("stringValue", "")
                if coll == "pubposts" and val("category") != "音楽":
                    continue
                out.append((val("title"), val("by")))
            token = data.get("nextPageToken", "")
            if not token:
                break
    return out


def find_apple(title, by):
    """iTunes の検索で、いちばん合う曲のリンクを返す（見つからなければ空）"""
    q = urllib.parse.urlencode({"term": f"{title} {by}".strip(), "country": "JP", "media": "music", "entity": "song", "limit": "5"})
    data = http_json("https://itunes.apple.com/search?" + q)
    results = [r for r in data.get("results", []) if APPLE_TRACK.match(str(r.get("trackViewUrl", "")))]
    t = song_key(title, "")
    def score(r):   # 曲名がぴったり ＞ 曲名で始まる ＞ その他。ライブ版などは後回し
        name = song_key(r.get("trackName"), "")
        extra = 1 if re.search(r"live|ライブ|version|ver\.|remix|instrumental|karaoke|カラオケ", name) and not re.search(r"live|ライブ|version|remix", t) else 0
        return (0 if name == t else 1 if name.startswith(t[:12]) else 2) * 2 + extra
    best = min(results, key=score) if results else None
    return best["trackViewUrl"].split("&uo=")[0] if best else ""


def resolve_apple_links(picks):
    try:
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
    except Exception:
        cache = {}
    wanted = {}
    for p in picks:
        if p.get("category") == "音楽" and not APPLE_TRACK.match(safe_link(p.get("link"))):
            wanted[song_key(p.get("title"), p.get("by"))] = (p.get("title"), p.get("by"))
    for title, by in public_songs():
        if title:
            wanted.setdefault(song_key(title, by), (title, by))
    new = 0
    for key, (title, by) in wanted.items():
        if key in cache or new >= MAX_NEW:
            continue
        try:
            cache[key] = find_apple(title, by)
            new += 1
            time.sleep(3.2)
        except Exception as ex:
            print(f"apple lookup failed: {title}: {ex}")
            break
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print(f"apple links: {sum(1 for v in cache.values() if v)} known, {new} looked up now")
    return {k: v for k, v in cache.items() if v}


def stars(n):
    n = max(0, min(5, int(n or 0)))
    return f'<span class="stars" aria-label="5段階中{n}">{"★" * n}<span class="off">{"★" * (5 - n)}</span></span>'


def paras(body):
    blocks = [b.strip() for b in str(body or "").strip().split("\n\n") if b.strip()]
    return "".join(f"<p>{e(b).replace(chr(10), '<br>')}</p>" for b in blocks)


def head(title, desc, url, image, kind):
    card = "summary_large_image" if image else "summary"
    img_tags = (f'<meta property="og:image" content="{e(image)}">\n'
                f'<meta name="twitter:image" content="{e(image)}">\n') if image else ""
    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<link rel="alternate" type="application/rss+xml" title="{NAME}" href="{SITE}/feed.xml">
<link rel="apple-touch-icon" href="{SITE}/icons/site-180.png">
<link rel="icon" type="image/png" href="{SITE}/icons/site-180.png">
<meta property="og:site_name" content="{NAME}">
<meta property="og:type" content="{kind}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
<meta property="og:locale" content="ja_JP">
{img_tags}<meta name="twitter:card" content="{card}">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
"""


def post_page(p, no):
    url = f"{SITE}/p/{p['id']}.html"
    img = image_url(p)
    title = f"{p.get('title', '')}" + (f" / {p['by']}" if p.get("by") else "") + f" — {NAME}"
    desc = describe(p)
    en, tone, _ = cat(p.get("category"))
    if img:
        cover = f'<div class="cover{" sq" if p.get("category") == "音楽" else ""}"><img src="{e(img)}" alt="{e(p.get("title"))}"></div>'
    else:
        cover = (f'<div class="cover cover-type" style="--tone:{tone}"><span class="cover-en">{en}</span>'
                 f'<span class="cover-ja">{e(p.get("title"))}</span></div>')
    link = safe_link(p.get("link"))
    more = f'<a class="more" href="{e(link)}" target="_blank" rel="noopener noreferrer">{e(cta(p))} ↗</a>' if link else ""
    if p.get("category") == "音楽":
        apps = music_links(p)
        first, rest = apps[0], apps[1:]
        more = (f'<a class="more" href="{e(first[1])}" target="_blank" rel="noopener noreferrer">{e(first[0])} で聴いてみる ↗</a>'
                f'<div class="other-apps">ほかのアプリで聴く：' +
                " · ".join(f'<a href="{e(u)}" target="_blank" rel="noopener noreferrer">{e(n)}</a>' for n, u in rest) + "</div>")
    from urllib.parse import quote
    share_text = quote(f"{NAME}：{p.get('title', '')}" + (f"｜{p['oneline']}" if p.get("oneline") else ""))
    share_url = quote(url, safe="")
    date = str(p.get("date", "")).replace("-", ".")
    return head(title, desc, url, img, "article") + f"""<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;700;800&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../style.css">
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div class="meta"><span>No.{no:03d}</span><span>A DAILY SELECTION OF GOOD THINGS</span><span>{e(date)}</span></div>
    <h1><a href="../">{NAME}</a></h1>
    <p class="sub">{TAGLINE}</p>
    <div class="double-rule"></div>
  </header>
  <main>
    <article class="feature">
      {cover}
      <div>
        <div class="kicker">{en} / {e(p.get("category"))}<span class="no">No.{no:03d} · {e(date)}</span></div>
        <h2>{e(p.get("title"))}</h2>
        {f'<div class="by">{e(p.get("by"))}</div>' if p.get("by") else ""}
        {stars(p.get("rating"))}
        {f'<p class="pull">{e(p.get("oneline"))}</p>' if p.get("oneline") else ""}
        <div class="body">{paras(p.get("body"))}</div>
        {more}
        <div class="share">
          <span class="lbl">SHARE</span>
          <a href="https://twitter.com/intent/tweet?text={share_text}&amp;url={share_url}" target="_blank" rel="noopener">X</a>
          <a href="https://social-plugins.line.me/lineit/share?url={share_url}" target="_blank" rel="noopener">LINE</a>
        </div>
      </div>
    </article>
    <a class="back" href="../">← DAILY FIND のトップへ</a>
  </main>
  <footer><span>© {datetime.now(JST).year} {NAME}</span><span>{TAGLINE}</span></footer>
</div>
</body>
</html>
"""


def main():
    picks = json.loads((ROOT / "picks.json").read_text(encoding="utf-8"))
    picks = [p for p in picks if p.get("id") and p.get("title")]
    picks.sort(key=lambda p: p.get("date", ""))  # 古い順に番号を振る
    numbered = [(p, i + 1) for i, p in enumerate(picks)]
    numbered.reverse()                            # 新しい順

    if OUT.exists():
        shutil.rmtree(OUT, ignore_errors=True)   # パソコンで試すとき、使用中のフォルダが残っても続ける
    shutil.copytree(ROOT, OUT, dirs_exist_ok=True,
                    ignore=lambda d, names: [n for n in names if n in SKIP] if Path(d) == ROOT else [])

    # Apple Music の曲のリンク：表を書き出し、記事の「検索リンク」も曲のリンクに置きかえる
    apple = resolve_apple_links(picks)
    (OUT / "applelinks.json").write_text(json.dumps(apple, ensure_ascii=False), encoding="utf-8")
    for p in picks:
        if p.get("category") == "音楽" and is_apple_search(p.get("link")):
            p["link"] = apple.get(song_key(p.get("title"), p.get("by")), p["link"])
    site_picks = json.loads((ROOT / "picks.json").read_text(encoding="utf-8"))
    for sp in site_picks:
        if sp.get("category") == "音楽" and is_apple_search(sp.get("link")):
            sp["link"] = apple.get(song_key(sp.get("title"), sp.get("by")), sp["link"])
    (OUT / "picks.json").write_text(json.dumps(site_picks, ensure_ascii=False, indent=2), encoding="utf-8")

    # 記事ごとのページ
    (OUT / "p").mkdir(exist_ok=True)
    for p, no in numbered:
        safe_id = "".join(ch for ch in str(p["id"]) if ch.isalnum() or ch in "-_")
        p["id"] = safe_id
        (OUT / "p" / f"{safe_id}.html").write_text(post_page(p, no), encoding="utf-8")

    # トップページにも共有カード用の情報を入れる（いちばん新しい記事の画像を使う）
    latest_img = next((image_url(p) for p, _ in numbered if image_url(p)), "")
    idx = OUT / "index.html"
    tags = head(NAME, f"{TAGLINE} 本・映画・音楽・お店など、毎日ひとつおすすめを紹介します。", f"{SITE}/", latest_img, "website")
    tags = tags.split("<title>", 1)[1].split("\n", 1)[1]  # <title> より後ろのメタ情報だけ使う
    tags = "\n".join(l for l in tags.splitlines() if "Content-Security-Policy" not in l)
    idx.write_text(idx.read_text(encoding="utf-8").replace("<!-- OG -->", tags), encoding="utf-8")

    # サイトマップ
    urls = [f"<url><loc>{SITE}/</loc></url>"] + [
        f"<url><loc>{SITE}/p/{p['id']}.html</loc><lastmod>{e(p.get('date', ''))}</lastmod></url>" for p, _ in numbered]
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls) + "\n</urlset>\n", encoding="utf-8")

    # RSS
    items = []
    for p, _ in numbered[:30]:
        try:
            d = datetime.strptime(p.get("date", ""), "%Y-%m-%d").replace(hour=12, tzinfo=JST)
        except ValueError:
            d = datetime.now(JST)
        url = f"{SITE}/p/{p['id']}.html"
        items.append(f"<item><title>{e(p.get('title'))}</title><link>{url}</link><guid>{url}</guid>"
                     f"<pubDate>{format_datetime(d)}</pubDate><description>{e(describe(p))}</description></item>")
    (OUT / "feed.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>{NAME}</title><link>{SITE}/</link>'
        f"<description>{e(TAGLINE)}</description><language>ja</language>\n" + "\n".join(items) + "\n</channel></rss>\n",
        encoding="utf-8")

    # robots.txt（書く画面は検索に出さない）
    (OUT / "robots.txt").write_text(
        f"User-agent: *\nDisallow: /write.html\nDisallow: /friends/\nSitemap: {SITE}/sitemap.xml\n", encoding="utf-8")

    print(f"built {len(numbered)} pages into {OUT}")


if __name__ == "__main__":
    main()
