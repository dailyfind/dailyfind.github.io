// サイトと「記事を書く」画面で共通に使う設定

// カテゴリ（増やしたいときはここに追加）
const CATS = {
  // cta = リンクボタンの文字
  "本":     { en: "BOOKS",  tone: "#2c3a48", cta: "詳しく見てみる" },
  "映画":   { en: "FILM",   tone: "#47292f", cta: "作品を見てみる" },
  "音楽":   { en: "MUSIC",  tone: "#8a3a2c", cta: "聴いてみる" },
  "お店":   { en: "PLACES", tone: "#4a5240", cta: "お店をのぞいてみる" },
  "アニメ": { en: "ANIME",  tone: "#463e5c", cta: "作品を見てみる" },
  "ゲーム": { en: "GAMES",  tone: "#2c4644", cta: "詳しく見てみる" },
  "その他": { en: "OTHERS", tone: "#3b3936", cta: "詳しく見てみる" },
};
const cat = c => CATS[c] || CATS["その他"];

// リンク先に合わせたボタンの文字（例：「Apple Music で聴いてみる」）
function ctaLabel(p) {
  let host = "";
  try { host = new URL(p.link).hostname; } catch {}
  const svc = /music\.apple|itunes\.apple/.test(host) ? "Apple Music"
    : /spotify/.test(host) ? "Spotify"
    : /youtu/.test(host) ? "YouTube" : "";
  return (svc && p.category === "音楽" ? svc + " で" : "") + cat(p.category).cta;
}

// ===== 音楽アプリ（Apple Music / Spotify / LINE MUSIC / YouTube Music） =====
// 曲そのもののリンクがあればそれを使い、ほかのアプリは「曲名＋アーティスト」で検索するリンクにする。
// 最後に選んだアプリを覚えて、次から一番目に出す（この端末だけ）。
const MUSIC_APPS = [
  { id: "apple",   name: "Apple Music",   host: /(^|\.)music\.apple\.com$|(^|\.)itunes\.apple\.com$/, search: q => `https://music.apple.com/jp/search?term=${q}` },
  { id: "spotify", name: "Spotify",       host: /(^|\.)spotify\.com$/,                               search: q => `https://open.spotify.com/search/${q}` },
  { id: "line",    name: "LINE MUSIC",    host: /(^|\.)music\.line\.me$/,                            search: q => `https://music.line.me/webapp/search?query=${q}` },
  { id: "ytm",     name: "YouTube Music", host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/,             search: q => `https://music.youtube.com/search?q=${q}` },
];
const getMusicApp = () => { try { return localStorage.getItem("df_music") || "apple"; } catch { return "apple"; } };
function musicLinks(p) {
  const q = encodeURIComponent(`${p.title || ""} ${p.by || ""}`.trim());
  let host = ""; try { host = new URL(p.link).hostname; } catch {}
  const links = MUSIC_APPS.map(a => ({ id: a.id, name: a.name, url: (safeLink(p.link) && a.host.test(host)) ? safeLink(p.link) : a.search(q) }));
  const pref = getMusicApp();
  return links.sort((a, b) => (b.id === pref) - (a.id === pref));
}
// 曲の「聴く」ボタン。big=true は特集用の大きなボタン、false は一覧用の小さなボタン
function listenHtml(p, big) {
  const [first, ...rest] = musicLinks(p);
  const a = (l, cls, label) => `<a class="${cls}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-music-app="${l.id}">${label}</a>`;
  if (big) return `${a(first, "more", `${esc(first.name)} で聴いてみる ↗`)}
    <div class="other-apps">ほかのアプリで聴く：${rest.map(l => a(l, "", esc(l.name))).join(" · ")}</div>`;
  return `<span class="listenbox">${a(first, "listen", `▶ 聴く`)}<details class="lmenu"><summary aria-label="ほかの音楽アプリで聴く">▾</summary>
    <div class="lmenu-pop"><span class="lm-h">どのアプリで聴く？</span>${[first, ...rest].map(l => a(l, "", esc(l.name))).join("")}<span class="lm-f">選んだアプリが次から「聴く」になります。<br>曲のページが見つからないときは、曲名で検索した画面が開きます。</span></div></details></span>`;
}
// どれかのアプリで開いたら、そのアプリを覚える
document.addEventListener("click", e => {
  const el = e.target.closest && e.target.closest("[data-music-app]");
  if (el) { try { localStorage.setItem("df_music", el.dataset.musicApp); } catch {} }
  // 開いているアプリ選択メニューは、外を押したら閉じる
  document.querySelectorAll("details.lmenu[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; });
});

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = d => { const [y, m, day] = d.split("-"); return `${y}.${m}.${day}`; };
const weekday = d => ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(d + "T00:00").getDay()];
const stars = v => { const n = Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
  return `<span class="stars" aria-label="5段階中${n}">${"★".repeat(n)}<span class="off">${"★".repeat(5 - n)}</span></span>`; };

// 【安全対策】リンクと画像は、ふつうのWebアドレスとサイト内の画像だけを許す（javascript: などは無視）
const safeLink = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const safeImage = u => { const s = String(u || "");
  return /^https:\/\//i.test(s) || /^images\/[\w.-]+$/.test(s) || /^data:image\/(jpeg|png|webp|gif);/.test(s) ? s : ""; };
const paras = b => String(b || "").trim().split(/\n\s*\n/).filter(Boolean)
  .map(t => `<p>${esc(t.trim()).replace(/\n/g, "<br>")}</p>`).join("");

// 画像。なければカテゴリの色と英字で「表紙」をつくる
function cover(p, cls = "", eager = false) {
  const img = safeImage(p.image);
  // 画面の上に出る大きな画像（eager）はすぐ読み込み、一覧の画像は見えるところまで来てから読み込む
  if (img) return `<div class="cover ${p.category === "音楽" ? "sq" : ""} ${cls}"><img src="${esc(img)}" alt="${esc(p.title)}" ${eager ? `fetchpriority="high"` : `loading="lazy"`}></div>`;
  return `<div class="cover cover-type ${cls}" style="--tone:${cat(p.category).tone}">
    <span class="cover-en">${cat(p.category).en}</span>
    <span class="cover-ja">${esc(p.title)}</span>
  </div>`;
}

async function loadPicks() {
  // ?v=… を付けて、公開先のキャッシュではなく最新の記事を読む
  const res = await fetch("picks.json?v=" + Date.now(), { cache: "no-store" });
  const list = await res.json();
  return list.sort((a, b) => b.date.localeCompare(a.date));
}
