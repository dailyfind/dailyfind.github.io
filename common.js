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
function cover(p, cls = "") {
  const img = safeImage(p.image);
  if (img) return `<div class="cover ${p.category === "音楽" ? "sq" : ""} ${cls}"><img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy"></div>`;
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
