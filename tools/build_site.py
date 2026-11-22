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
import shutil
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

SITE = "https://dailyfind.github.io"
NAME = "DAILY FIND"
TAGLINE = "毎日ひとつ、いいものを見つける。"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
SKIP = {".git", ".github", "tools", "_site"}
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
        shutil.rmtree(OUT)
    shutil.copytree(ROOT, OUT, ignore=lambda d, names: [n for n in names if n in SKIP] if Path(d) == ROOT else [])

    # 記事ごとのページ
    (OUT / "p").mkdir()
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
