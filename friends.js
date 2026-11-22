// DAILY FIND：みんな・グループ・マイページ・管理（メインページの中で動く）
// ・友達は匿名ログイン（メール・パスワード・名前は使わない）
// ・プロフィール（ニックネーム・アイコン・写真・自己紹介）はサイト全体で1人1つ
// ・管理者（サイトの持ち主）は Google ログイン。別の Firebase アプリ名で起動して、友達用のログインと混ざらないようにする
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
         signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, orderBy, limit, where, documentId,
         onSnapshot, serverTimestamp, writeBatch, deleteField, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CONFIG = {
  apiKey: "AIzaSyB-FxC1jCePfY8FNsXPHv72lKuQ-0OdO5E",
  authDomain: "dailyfind-friends.firebaseapp.com",
  projectId: "dailyfind-friends",
  storageBucket: "dailyfind-friends.firebasestorage.app",
  messagingSenderId: "765801083878",
  appId: "1:765801083878:web:db4eec9e1531309f4adc27",
};

// 友達用（匿名）
const app = initializeApp(CONFIG);
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const db = getFirestore(app);
// 管理者用（Google）
const adminApp = initializeApp(CONFIG, "admin");
const adminAuth = initializeAuth(adminApp, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
const adb = getFirestore(adminApp);

const $ = id => document.getElementById(id);
const root = $("fapp");
const LOADING = `<p class="empty">読み込んでいます…</p>`;

// ===== 共通の部品 =====
const EMOJIS = ["🎧", "🎸", "🎹", "🎤", "🥁", "🎷", "📚", "🎬", "☕", "🌙", "🌈", "🐱", "🐶", "🦊", "🐼", "🍙", "🌸", "⚡"];
const COLORS = ["#8a3a2c", "#2c3a48", "#4a5240", "#463e5c", "#2c4644", "#47292f", "#b07a2a", "#3b3936"];
const pickOne = a => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];
const okColor = c => (COLORS.includes(c) ? c : COLORS[7]);
const photoOk = p => typeof p === "string" && p.length <= 60000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p);
// 小さい丸アイコン。uid を付けておくと、あとで写真に差し替わる（hydrate）
const av = (icon, color, uid) => `<span class="av"${uid ? ` data-uid="${esc(uid)}"` : ""} style="background:${okColor(color)}">${esc(icon || "🎧")}</span>`;
// 大きい丸アイコン（プロフィール用）
const bigAv = p => `<span class="av big${photoOk(p.photo) ? " ph" : ""}" style="background:${okColor(p.color)}">${photoOk(p.photo) ? `<img src="${esc(p.photo)}" alt="">` : esc(p.icon || "🎧")}</span>`;
const pickerHtml = (id, cur) => `<div class="picker" id="${id}">
  <div class="emojis">${EMOJIS.map(e => `<button type="button" data-e="${e}" class="${e === cur.icon ? "on" : ""}" aria-label="アイコン ${e}">${e}</button>`).join("")}</div>
  <div class="colors">${COLORS.map(c => `<button type="button" data-c="${c}" class="${c === cur.color ? "on" : ""}" style="background:${c}" aria-label="色"></button>`).join("")}</div></div>`;
function bindPicker(id, cur, onChange) {
  $(id).onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.e) cur.icon = b.dataset.e;
    if (b.dataset.c) cur.color = b.dataset.c;
    $(id).querySelectorAll("[data-e]").forEach(x => x.classList.toggle("on", x.dataset.e === cur.icon));
    $(id).querySelectorAll("[data-c]").forEach(x => x.classList.toggle("on", x.dataset.c === cur.color));
    onChange && onChange();
  };
}
// 画面の下に少しだけ出るお知らせ
let toastTimer = null;
function toast(text) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}
const setMsg = (id, t, ok) => { const el = $(id); if (el) { el.textContent = t; el.className = "msg " + (ok ? "ok" : "err"); } };
const fmtTime = ts => { if (!ts || !ts.toDate) return ""; const d = ts.toDate();
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const secs = p => (p.createdAt && p.createdAt.seconds) || Infinity;   // 送信中（時刻がまだない）は一番新しい扱い
const sortNew = list => list.sort((a, b) => secs(b) - secs(a));
const songId = (gid, pid) => `${gid}_${pid}`;
const isPublicSong = p => p && p.category === "音楽" && p.public === true;
const likeCount = p => Object.keys(p.likes || {}).length;
const userHash = uid => "#u=" + encodeURIComponent(uid);
function armed(btn, label, fn) {   // 2回押しで確定
  if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "本当に？"; setTimeout(() => { btn.classList.remove("armed"); btn.textContent = label; }, 4000); return; }
  btn.disabled = true; Promise.resolve(fn()).catch(e => { console.error(e); btn.textContent = "失敗しました"; });
}
function randomKey(n = 28) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint32Array(n))].map(x => abc[x % abc.length]).join("");
}
// openExternalBrowser=1：LINE で開いたとき、LINE の中ではなく Safari / Chrome で開かせる（ホーム画面に追加できるように）
const inviteUrl = (gid, key) => `${location.origin}/?openExternalBrowser=1#g=${encodeURIComponent(gid)}&k=${encodeURIComponent(key)}`;

// ===== この端末に覚えておくグループ =====
const LS_KEY = "dff_groups";
const loadGroups = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; } };
const saveGroups = gs => { try { localStorage.setItem(LS_KEY, JSON.stringify(gs)); } catch {} };
const rememberGroup = (gid, key, name) => { const gs = loadGroups().filter(g => g.gid !== gid); gs.unshift({ gid, key, name: name || "" }); saveGroups(gs); };
const forgetGroup = gid => saveGroups(loadGroups().filter(g => g.gid !== gid));
const joinedGroups = () => loadGroups().filter(g => g.name);
const lastGid = () => { try { return localStorage.getItem("dff_last") || ""; } catch { return ""; } };
const setLast = gid => { try { localStorage.setItem("dff_last", gid); } catch {} };

// ===== 匿名ログイン（必要になったときだけ） =====
let me = null, authReady = null;
function ensureAuth() {
  if (authReady) return authReady;
  authReady = new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, async user => {
      if (user) { off(); me = user.uid; resolve(me); return; }
      try { await signInAnonymously(auth); } catch (e) { off(); authReady = null; reject(e); }
    });
  });
  return authReady;
}

// ===== プロフィール（サイト全体で1つ。写真アイコンもここ） =====
let myProfile = null, myProfileLoaded = false;
const profCache = new Map();
function getProfile(uid) {
  if (!profCache.has(uid)) profCache.set(uid, getDoc(doc(db, "profiles", uid)).then(d => (d.exists() ? d.data() : null)).catch(() => null));
  return profCache.get(uid);
}
async function loadMyProfile(force) {
  await ensureAuth();
  if (force) profCache.delete(me);
  myProfile = await getProfile(me); myProfileLoaded = true;
  if (myProfile) { try { localStorage.setItem("dff_me", "1"); } catch {} }
  return myProfile;
}
// sync：参加しているグループのニックネーム・アイコンもそろえる
async function saveProfile(p, sync) {
  await ensureAuth();
  const data = { nickname: p.nickname, icon: p.icon, color: okColor(p.color), photo: photoOk(p.photo) ? p.photo : "", bio: p.bio || "", updatedAt: serverTimestamp() };
  await setDoc(doc(db, "profiles", me), data);
  myProfile = { ...data }; myProfileLoaded = true; profCache.set(me, Promise.resolve(myProfile));
  try { localStorage.setItem("dff_me", "1"); } catch {}
  if (sync) await Promise.all(joinedGroups().map(g => updateDoc(doc(db, "groups", g.gid, "members", me), { nickname: data.nickname, icon: data.icon, color: data.color }).catch(() => {})));
  if (current) Object.assign(current, { nickname: data.nickname, icon: data.icon, color: data.color });
}
// 画面に出た丸アイコンを、その人の写真に差し替える
async function hydrate() {
  const spans = [...document.querySelectorAll(".av[data-uid]:not([data-h])")];
  if (!spans.length) return;
  spans.forEach(s => { s.dataset.h = "1"; });
  const uids = [...new Set(spans.map(s => s.dataset.uid))];
  await Promise.all(uids.map(async u => {
    const p = await getProfile(u);
    if (!p || !photoOk(p.photo)) return;
    spans.filter(s => s.dataset.uid === u).forEach(s => { const img = new Image(); img.src = p.photo; img.alt = ""; s.textContent = ""; s.append(img); s.classList.add("ph"); });
  }));
}
let hyTimer = null;
new MutationObserver(() => { clearTimeout(hyTimer); hyTimer = setTimeout(hydrate, 60); }).observe(document.body, { childList: true, subtree: true });

// 写真を正方形・小さい JPEG にする（Firestore にそのまま入れるため）
const readAsDataURL = f => new Promise((ok, ng) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ng; r.readAsDataURL(f); });
async function photoFromFile(file) {
  const src = await readAsDataURL(file);
  const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = src; });
  const S = 192, c = document.createElement("canvas"); c.width = c.height = S;
  const m = Math.min(img.naturalWidth, img.naturalHeight); if (!m) throw new Error("size");
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, S, S);
  ctx.drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, S, S);
  for (const q of [0.85, 0.72, 0.6, 0.45, 0.3]) { const d = c.toDataURL("image/jpeg", q); if (photoOk(d)) return d; }
  throw new Error("big");
}

// プロフィールを作る・直す欄
const profDraft = p => ({ nickname: (p && p.nickname) || "", icon: (p && p.icon) || pickOne(EMOJIS), color: p && COLORS.includes(p.color) ? p.color : pickOne(COLORS),
                          photo: p && photoOk(p.photo) ? p.photo : "", bio: (p && p.bio) || "" });
const profileEditorHtml = cur => `
  <div class="pedit">
    <div class="ph-row"><span id="peAv">${bigAv(cur)}</span>
      <div class="actions"><button type="button" class="btn small" id="pePhoto">📷 写真を選ぶ</button><button type="button" class="btn small ghost" id="peNoPhoto" ${cur.photo ? "" : "hidden"}>写真をやめる</button>
        <input type="file" id="peFile" accept="image/*" hidden></div></div>
    <div class="lbl">写真を使わないときのアイコン ${pickerHtml("pePick", cur)}</div>
    <label>ニックネーム<input id="peNick" maxlength="20" value="${esc(cur.nickname)}" placeholder="例：こうへい" autocomplete="nickname"></label>
    <label>ひとこと自己紹介（なくてもOK）<textarea id="peBio" maxlength="160" style="min-height:80px" placeholder="例：最近はシティポップばかり聴いています">${esc(cur.bio)}</textarea></label>
    <div class="actions"><button class="btn" id="peSave">保存する</button><span class="msg" id="peMsg"></span></div>
    <p class="note">写真・ニックネーム・自己紹介は、サイトを見る人なら誰でも見られます。顔写真や、住所・学校など個人が分かるものには気をつけてください。</p>
  </div>`;
function bindProfileEditor(cur, onSaved) {
  const redraw = () => { $("peAv").innerHTML = bigAv(cur); $("peNoPhoto").hidden = !cur.photo; };
  bindPicker("pePick", cur, redraw);
  $("pePhoto").onclick = () => $("peFile").click();
  $("peFile").onchange = async () => {
    const f = $("peFile").files[0]; if (!f) return;
    setMsg("peMsg", "写真を小さくしています…", true);
    try { cur.photo = await photoFromFile(f); redraw(); setMsg("peMsg", "「保存する」を押すと反映されます", true); }
    catch (e) { console.error(e); setMsg("peMsg", "この写真は使えませんでした。別の写真を選んでください。", false); }
    $("peFile").value = "";
  };
  $("peNoPhoto").onclick = () => { cur.photo = ""; redraw(); };
  $("peSave").onclick = async () => {
    cur.nickname = $("peNick").value.trim(); cur.bio = $("peBio").value.trim();
    if (!cur.nickname) return setMsg("peMsg", "ニックネームを入れてください。", false);
    $("peSave").disabled = true; setMsg("peMsg", "保存しています…", true);
    try { await saveProfile(cur, true); toast("保存しました"); onSaved && onSaved(); }
    catch (e) { console.error(e); setMsg("peMsg", "保存できませんでした。少し待ってからもう一度押してください。", false); $("peSave").disabled = false; }
  };
}

// ===== フォロー =====
const followId = to => `${me}_${to}`;
async function myFollowing() { await ensureAuth(); const s = await getDocs(query(collection(db, "follows"), where("from", "==", me), limit(500))); return s.docs.map(d => d.data().to); }
async function myFollowers() { await ensureAuth(); const s = await getDocs(query(collection(db, "follows"), where("to", "==", me), limit(500))); return s.docs.map(d => d.data().from); }
async function setFollow(to, on) {
  await ensureAuth();
  if (on) await setDoc(doc(db, "follows", followId(to)), { from: me, to, createdAt: serverTimestamp() });
  else await deleteDoc(doc(db, "follows", followId(to)));
}
const followBtn = (uid, on) => `<button class="btn small ${on ? "ghost" : ""}" data-fol="${esc(uid)}" data-on="${on ? "1" : ""}">${on ? "フォロー中" : "フォローする"}</button>`;
const userRow = (uid, p, extra = "") => `<div class="urow"><a href="${esc(userHash(uid))}">${av(p && p.icon, p && p.color, uid)}<span>${esc((p && p.nickname) || "（プロフィールなし）")}</span></a>${extra}</div>`;
// フォローボタンを押したとき（プロフィールがまだなら先に作ってもらう）
function bindFollowBtns(el, after) {
  el.querySelectorAll("[data-fol]").forEach(b => b.onclick = async () => {
    const uid = b.dataset.fol, on = !b.dataset.on;
    if (on && !(await loadMyProfile().catch(() => null))) return askProfile("フォローするには、先にあなたのプロフィールを作ってください。", () => after && after());
    b.disabled = true;
    try { await setFollow(uid, on); b.dataset.on = on ? "1" : ""; b.textContent = on ? "フォロー中" : "フォローする"; b.classList.toggle("ghost", on); toast(on ? "フォローしました" : "フォローをやめました"); after && after(uid, on); }
    catch (e) { console.error(e); toast("うまくいきませんでした"); }
    b.disabled = false;
  });
}
// 画面の上にプロフィール作成欄を出す
function askProfile(text, onSaved) {
  let box = $("profAsk");
  if (!box) { box = document.createElement("section"); box.id = "profAsk"; box.className = "panel"; box.style.margin = "0 0 20px"; root.prepend(box); }
  const cur = profDraft(current ? { nickname: current.nickname, icon: current.icon, color: current.color } : null);
  box.innerHTML = `<h2>プロフィールを作りましょう</h2><p>${esc(text)}</p>${profileEditorHtml(cur)}`;
  bindProfileEditor(cur, () => { box.remove(); onSaved && onSaved(); });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ===== 画面の切り替え =====
let unsubs = [];
const stop = () => { unsubs.forEach(u => u()); unsubs = []; };
let current = null;   // 開いているグループ

window.addEventListener("df:view", e => show(e.detail));
window.addEventListener("df:home", () => fillHome());

async function show(view) {
  stop();
  const mine = me && profCache.get(me); profCache.clear(); if (mine) profCache.set(me, mine);   // ほかの人の写真は開くたびに新しく
  const h = new URLSearchParams(view);
  if (h.get("g") && h.get("k")) {          // 招待リンク
    rememberGroup(h.get("g"), h.get("k"));
    history.replaceState(null, "", "/#group");   // アドレス欄から合言葉を消す
    window.DF && window.DF.setNav("group");
    return groupView(h.get("g"), h.get("k"));
  }
  if (view === "all") return allView();
  if (view === "me") return meView();
  if (view.startsWith("u=")) return userView(decodeURIComponent(view.slice(2)));
  if (view === "admin") return adminView();
  if (view === "feedback") return feedbackView();
  return groupView();
}

// ===== 投稿の表示（グループの投稿・みんなへの投稿で共通） =====
// p._src = { kind: "pub" } または { kind: "group", gid, gname }
const shown = new Map();
const keyOf = p => `${p._src.kind}:${p._src.gid || ""}:${p.id}`;
const tag = (snapDocs, src) => snapDocs.map(d => ({ id: d.id, ...d.data(), _src: src }));
const postRef = (store, p) => (p._src.kind === "pub" ? doc(store, "pubposts", p.id) : doc(store, "groups", p._src.gid, "posts", p.id));
const songRef = (store, p) => doc(store, "songs", p._src.kind === "pub" ? "pub_" + p.id : songId(p._src.gid, p.id));
const likedByMe = p => !!(me && p.likes && p.likes[me]);
let members = {};   // 開いているグループのメンバー（いいねした人の名前用）
const likersText = p => Object.keys(p.likes || {}).map(u => (members[u] && members[u].nickname) || "抜けた人").join("、");
const likeBtn = p => { shown.set(keyOf(p), p); return `<button class="like ${likedByMe(p) ? "on" : ""}" data-like="${esc(keyOf(p))}" aria-pressed="${likedByMe(p)}"><span class="h">♥</span>${likeCount(p) || ""}</button>`; };
const srcLabel = p => (p._src.kind === "pub" ? `<span class="src">🌐 みんな</span>` : `<span class="src">👥 ${esc(p._src.gname || "グループ")}</span>`);

function postHtml(p, { canDelete = false, showSrc = false } = {}) {
  shown.set(keyOf(p), p);
  const k = esc(keyOf(p)), mine = me && p.uid === me, link = safeLink(p.link), inGroup = p._src.kind === "group";
  return `
    <article class="post">
      ${cover({ title: p.title, category: p.category, image: p.image })}
      <div>
        <div class="who"><a class="u" href="${esc(userHash(p.uid))}">${av(p.icon, p.color, p.uid)}<b>${esc(p.nickname)}</b></a>${fmtTime(p.createdAt)}${showSrc ? srcLabel(p) : ""}</div>
        <div class="kick">${esc(cat(p.category).en)}</div>
        <h3>${esc(p.title)}</h3>
        ${p.by ? `<div class="by">${esc(p.by)}</div>` : ""}
        ${stars(p.rating)}
        ${p.oneline ? `<p>${esc(p.oneline)}</p>` : ""}
        <div class="ops">
          ${likeBtn(p)}
          ${p.category === "音楽" ? listenHtml(p, false) : link ? `<a class="listen" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(ctaLabel(p))} ↗</a>` : ""}
          ${mine ? `<button class="txt" data-edit="${k}">編集</button>` : ""}
          ${mine || canDelete ? `<button class="txt" data-del="${k}">削除</button>` : ""}
          ${inGroup && likeCount(p) ? `<div class="likers">♥ ${esc(likersText(p))}</div>` : ""}
          ${isPublicSong(p) ? `<div class="pub">🌐 曲名だけ「みんなのプレイリスト」に載っています</div>` : ""}
        </div>
      </div>
    </article>`;
}
// いいね・編集・削除のボタンを動かす。redraw：いいね後に描き直す（自動で更新されない画面用） reload：削除・編集後に読み直す
function bindPostOps(el, { redraw, reload } = {}) {
  el.querySelectorAll("[data-like]").forEach(b => b.onclick = async () => { await toggleLike(shown.get(b.dataset.like), b); redraw && redraw(); });
  el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openCompose(shown.get(b.dataset.edit), null, reload));
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = () => armed(b, "削除", async () => { await deletePost(db, shown.get(b.dataset.del)); reload && reload(); }));
}

async function deletePost(store, p) {
  if (!p) return;
  const batch = writeBatch(store);
  batch.delete(postRef(store, p));
  if (isPublicSong(p)) batch.delete(songRef(store, p));
  await batch.commit();
}

async function toggleLike(p, btn) {
  if (!p) return;
  btn.disabled = true;
  try { await ensureAuth(); } catch { btn.disabled = false; return; }
  const pref = postRef(db, p);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fresh = attempt === 0 ? p : { ...p, ...(await getDoc(pref)).data() };
      const on = !(fresh.likes && fresh.likes[me]);
      const next = { ...(fresh.likes || {}) }; if (on) next[me] = true; else delete next[me];
      const batch = writeBatch(db);
      batch.update(pref, { [`likes.${me}`]: on ? true : deleteField() });
      if (isPublicSong(fresh)) batch.update(songRef(db, p), { likeCount: Object.keys(next).length });
      await batch.commit();
      p.likes = next;
      break;
    } catch (e) { if (attempt === 1) console.error(e); }
  }
  btn.disabled = false;
}

// ===== グループ =====
async function groupView(gid, key) {
  root.innerHTML = LOADING;
  try { await ensureAuth(); } catch { root.innerHTML = `<p class="empty">つながりませんでした。通信状況を確認して、開き直してください。</p>`; return; }
  if (!myProfileLoaded) await loadMyProfile().catch(() => {});
  if (!gid) {
    const gs = loadGroups(); const pick = gs.find(g => g.gid === lastGid()) || gs[0];
    if (!pick) return welcome();
    gid = pick.gid; key = pick.key;
  }
  setLast(gid);
  let member = null;
  try { const m = await getDoc(doc(db, "groups", gid, "members", me)); member = m.exists() ? m.data() : null; } catch {}
  if (!member) return joinScreen(gid, key);
  let g = null, inv = null;
  try { g = (await getDoc(doc(db, "groups", gid))).data(); inv = (await getDoc(doc(db, "groups", gid, "private", "invite"))).data(); } catch {}
  if (!g || !inv) { forgetGroup(gid); root.innerHTML = `<p class="empty">このグループは見つかりませんでした。閉じられたか、外された可能性があります。</p>`; return; }
  current = { gid, key: inv.key, name: g.name, owner: g.owner, nickname: member.nickname, icon: member.icon, color: member.color };
  rememberGroup(gid, inv.key, g.name);
  // 前からグループを使っている人：グループでの名前・アイコンからプロフィールを作っておく
  if (!myProfile) await saveProfile({ nickname: member.nickname, icon: member.icon, color: member.color, photo: "", bio: "" }, false).catch(() => {});
  groupScreen();
}

const groupSelectHtml = () => {
  const gs = loadGroups();
  return `<select id="gSel" aria-label="グループを選ぶ">${gs.map(g => `<option value="${esc(g.gid)}" ${current && g.gid === current.gid ? "selected" : ""}>${esc(g.name || "（参加前）")}</option>`).join("")}<option value="__new">＋ グループを作る</option></select>`;
};
function bindGroupSelect() {
  const s = $("gSel"); if (!s) return;
  s.onchange = () => { stop(); if (s.value === "__new") return welcome(); const g = loadGroups().find(x => x.gid === s.value); if (g) groupView(g.gid, g.key); };
}

// 参加・作成のときの「あなた」欄。プロフィールがあればそれを使う
function whoHtml(prefix) {
  if (myProfile) return `<div class="lbl">あなた<div class="me-mini">${bigAv(myProfile)}<b>${esc(myProfile.nickname)}</b></div><span class="note">名前やアイコンは「マイページ」でいつでも変えられます。</span></div>`;
  return `<label>あなたのニックネーム<input id="${prefix}Nick" maxlength="20" placeholder="例：みさき" autocomplete="nickname"></label>
    <div class="lbl">あなたのアイコン（写真はあとで「マイページ」から選べます） ${pickerHtml(prefix + "Pick", whoDraft)}</div>`;
}
let whoDraft = null;
function readWho(prefix) {
  if (myProfile) return { nickname: myProfile.nickname, icon: myProfile.icon, color: myProfile.color };
  const nickname = $(prefix + "Nick").value.trim();
  return nickname ? { nickname, icon: whoDraft.icon, color: whoDraft.color } : null;
}

function welcome() {
  current = null;
  whoDraft = { icon: pickOne(EMOJIS), color: pickOne(COLORS) };
  const has = loadGroups().length;
  root.innerHTML = `
    ${has ? `<div class="bar"><h2>グループ</h2>${groupSelectHtml()}</div>` : ""}
    <div class="panel">
      <h2>友達と「いいもの」をシェアしよう</h2>
      <p>グループは誰でも作れます。招待リンクを送ると、友達はニックネームだけで参加できます。メールアドレスもパスワードも要りません。</p>
      <p>招待リンクをもらった人は、そのリンクを開くだけで参加画面になります。</p>
      <label>グループの名前<input id="gName" maxlength="30" placeholder="例：いつもの4人"></label>
      ${whoHtml("g")}
      <div class="actions"><button class="btn" id="gCreate">グループを作る</button><span class="msg" id="gMsg"></span></div>
      <p class="note">グループの投稿は、メンバーとサイトの管理者だけが見られます。</p>
    </div>`;
  if (!myProfile) bindPicker("gPick", whoDraft);
  bindGroupSelect();
  $("gCreate").onclick = async () => {
    const name = $("gName").value.trim(), who = readWho("g");
    if (!name || !who) return setMsg("gMsg", "グループの名前とニックネームを入れてください。", false);
    $("gCreate").disabled = true; setMsg("gMsg", "作っています…", true);
    try {
      await ensureAuth();
      const key = randomKey();
      const gref = doc(collection(db, "groups"));
      const b = writeBatch(db);
      b.set(gref, { name, owner: me, createdAt: serverTimestamp() });
      b.set(doc(db, "groups", gref.id, "private", "invite"), { key });
      await b.commit();
      await setDoc(doc(db, "groups", gref.id, "members", me), { ...who, key, joinedAt: serverTimestamp() });
      if (!myProfile) await saveProfile({ ...who, photo: "", bio: "" }, false).catch(() => {});
      rememberGroup(gref.id, key, name);
      await groupView(gref.id, key);
      if ($("invitePanel")) $("invitePanel").hidden = false;
    } catch (e) { console.error(e); setMsg("gMsg", "作れませんでした。少し待ってからもう一度押してください。", false); $("gCreate").disabled = false; }
  };
}

function joinScreen(gid, key) {
  current = null;
  whoDraft = { icon: pickOne(EMOJIS), color: pickOne(COLORS) };
  root.innerHTML = `
    <div class="panel">
      <h2>グループに招待されています</h2>
      <p>${myProfile ? "「参加する」を押すだけで参加できます。" : "ニックネームとアイコンを選ぶだけで参加できます。メールアドレスもパスワードも要りません。"}</p>
      ${whoHtml("j")}
      <div class="actions"><button class="btn" id="jGo">参加する</button><span class="msg" id="jMsg"></span></div>
      <p class="note">グループの投稿は、メンバーとサイトの管理者だけが見られます。</p>
    </div>`;
  if (!myProfile) bindPicker("jPick", whoDraft);
  $("jGo").onclick = async () => {
    const who = readWho("j");
    if (!who) return setMsg("jMsg", "ニックネームを入れてください。", false);
    $("jGo").disabled = true; setMsg("jMsg", "参加しています…", true);
    try {
      await setDoc(doc(db, "groups", gid, "members", me), { ...who, key, joinedAt: serverTimestamp() });
      if (!myProfile) await saveProfile({ ...who, photo: "", bio: "" }, false).catch(() => {});
      groupView(gid, key);
    } catch (e) { console.error(e); forgetGroup(gid); setMsg("jMsg", "参加できませんでした。招待リンクが古いか、まちがっている可能性があります。", false); $("jGo").disabled = false; }
  };
}

let gposts = [], tab = "feed";
function groupScreen() {
  const isOwner = current.owner === me;
  const afterPost = () => { tab = "feed"; root.querySelectorAll(".tabs2 button").forEach(x => x.classList.toggle("on", x.dataset.t === tab)); drawGroupBody(); document.querySelector(".tabs2")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  root.innerHTML = `
    <div class="bar">
      <h2>${esc(current.name)}</h2>
      <div class="actions">${groupSelectHtml()}<button class="btn small ghost" id="inviteBtn">友達を招待</button><button class="btn small" id="newBtn">＋ 投稿する</button></div>
    </div>
    <div class="members" id="members"></div>
    <div class="panel" id="invitePanel" hidden style="margin-bottom:20px">
      <h2>招待リンク</h2>
      <p>このリンクを LINE などで友達に送ってください。開くとニックネームだけで参加できます。リンクを知っている人は誰でも参加できるので、送る相手に気をつけてください。</p>
      <div class="invite"><input id="invUrl" readonly value="${esc(inviteUrl(current.gid, current.key))}"><button class="btn small" id="copyInv">コピー</button></div>
      <div class="actions"><a class="btn small ghost" href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(inviteUrl(current.gid, current.key))}" target="_blank" rel="noopener">LINE で送る</a><span class="msg" id="invMsg"></span></div>
    </div>
    <section class="compose" id="compose" hidden></section>
    <div class="tabs2"><button data-t="feed">タイムライン</button><button data-t="pl">グループのプレイリスト</button></div>
    <div id="gbody">${LOADING}</div>
    <button class="fab" id="fab" aria-label="投稿する">＋</button>
    <details class="manage">
      <summary>設定（グループを抜ける${isOwner ? "・メンバー管理" : ""}）</summary>
      <div class="panel">
        <p>ニックネーム・アイコン・写真は「<a href="#me">マイページ</a>」で変えられます（参加しているすべてのグループに反映されます）。</p>
        ${isOwner ? `<h2 style="font-size:16px;margin-top:10px">メンバー</h2><div id="mlist"></div>
          <p>知らない人が入っていたら「外す」を押してから、招待リンクを作り直してください。</p>
          <div class="actions"><button class="btn small ghost" id="rotate">招待リンクを作り直す</button><span class="msg" id="rotMsg"></span></div>` : ""}
        ${isOwner
          ? `<p style="margin-top:10px">あなたはこのグループを作った人なので、抜けることはできません（抜けると、誰もメンバーを管理できなくなるため）。グループが要らなくなったら削除してください。</p>
             <div class="actions"><button class="btn small ghost" id="delGroup">このグループを削除する（全員の投稿も消えます）</button><span class="msg" id="delMsg"></span></div>`
          : `<div class="actions" style="margin-top:10px"><button class="btn small ghost" id="leave">このグループを抜ける</button></div>`}
      </div>
    </details>`;
  bindGroupSelect();
  root.querySelectorAll(".tabs2 button").forEach(b => { b.classList.toggle("on", b.dataset.t === tab); b.onclick = () => { tab = b.dataset.t; root.querySelectorAll(".tabs2 button").forEach(x => x.classList.toggle("on", x === b)); drawGroupBody(); }; });
  $("inviteBtn").onclick = () => { $("invitePanel").hidden = !$("invitePanel").hidden; };
  $("copyInv").onclick = async () => { try { await navigator.clipboard.writeText($("invUrl").value); toast("招待リンクをコピーしました"); } catch { $("invUrl").select(); setMsg("invMsg", "選択しました。長押しでコピーしてください", true); } };
  $("newBtn").onclick = $("fab").onclick = () => openCompose(null, { kind: "group", gid: current.gid, gname: current.name }, afterPost);
  if ($("leave")) $("leave").onclick = e => armed(e.target, "このグループを抜ける", async () => {
    try { await deleteDoc(doc(db, "groups", current.gid, "members", me)); } catch {}
    forgetGroup(current.gid); stop(); current = null; groupView();
  });
  // グループを作った人だけ：グループごと削除（投稿・公開曲・メンバー・合言葉・グループ）
  if ($("delGroup")) $("delGroup").onclick = e => armed(e.target, "このグループを削除する（全員の投稿も消えます）", async () => {
    const gid = current.gid; stop();
    const [ps, ms] = await Promise.all([getDocs(collection(db, "groups", gid, "posts")), getDocs(collection(db, "groups", gid, "members"))]);
    const refs = [];
    ps.forEach(d => { refs.push(d.ref); if (isPublicSong(d.data())) refs.push(doc(db, "songs", songId(gid, d.id))); });
    ms.forEach(d => { if (d.id !== me) refs.push(d.ref); });
    refs.push(doc(db, "groups", gid, "private", "invite"));
    for (let i = 0; i < refs.length; i += 400) { const b = writeBatch(db); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
    await deleteDoc(doc(db, "groups", gid));                     // グループを消してから
    await deleteDoc(doc(db, "groups", gid, "members", me));      // 最後に自分を消す
    forgetGroup(gid); current = null; groupView();
  });
  if (isOwner) $("rotate").onclick = async () => {
    const key = randomKey();
    try { await updateDoc(doc(db, "groups", current.gid, "private", "invite"), { key }); current.key = key; rememberGroup(current.gid, key, current.name);
      $("invUrl").value = inviteUrl(current.gid, key); $("invitePanel").hidden = false; setMsg("rotMsg", "作り直しました。新しい招待リンクを送ってください。", true); }
    catch (e) { console.error(e); setMsg("rotMsg", "作り直せませんでした", false); }
  };

  const src = { kind: "group", gid: current.gid, gname: current.name };
  unsubs.push(onSnapshot(collection(db, "groups", current.gid, "members"), snap => {
    members = {}; snap.forEach(d => { members[d.id] = d.data(); });
    $("members").innerHTML = Object.entries(members).map(([uid, m]) => `<a class="chip" href="${esc(userHash(uid))}">${av(m.icon, m.color, uid)}${esc(m.nickname)}${uid === me ? "（あなた）" : ""}</a>`).join("");
    if (isOwner && $("mlist")) {
      $("mlist").innerHTML = Object.entries(members).map(([uid, m]) => `<div class="mrow"><span>${av(m.icon, m.color, uid)}${esc(m.nickname)}${uid === me ? "（あなた）" : ""}</span>${uid === me ? "" : `<button class="btn small ghost" data-kick="${esc(uid)}">外す</button>`}</div>`).join("");
      $("mlist").querySelectorAll("[data-kick]").forEach(b => b.onclick = () => armed(b, "外す", () => deleteDoc(doc(db, "groups", current.gid, "members", b.dataset.kick))));
    }
    drawGroupBody();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "groups", current.gid, "posts"), orderBy("createdAt", "desc"), limit(200)), snap => {
    gposts = tag(snap.docs, src); drawGroupBody();
  }, err => { console.error(err); $("gbody").innerHTML = `<p class="empty">読み込めませんでした。グループから外された可能性があります。</p>`; }));
}

function drawGroupBody() {
  const body = $("gbody"); if (!body || !current) return;
  if (tab === "pl") {
    const songs = gposts.filter(p => p.category === "音楽").sort((a, b) => likeCount(b) - likeCount(a) || (secs(b) - secs(a)));
    body.innerHTML = `
      <div class="pl-top"><div><h2>${esc(current.name)}</h2><p>グループのプレイリスト · ${songs.length}曲 · いいねが多い順</p></div></div>
      <div class="flist">${songs.length ? songs.map((p, i) => `
        <div class="tr"><span class="no">${String(i + 1).padStart(2, "0")}</span>${cover({ title: p.title, category: "音楽", image: p.image })}
          <div class="ft"><b>${esc(p.title)}</b><small>${esc(p.by || "")} · ${esc(p.nickname)}</small></div>
          <div class="end">${likeBtn(p)}${listenHtml(p, false)}</div></div>`).join("") : `<p class="empty">まだ曲がありません。</p>`}</div>`;
  } else {
    body.innerHTML = gposts.length ? gposts.map(p => postHtml(p, { canDelete: current.owner === me })).join("") : `<p class="empty">まだ投稿がありません。「＋ 投稿する」から、最初の1つをシェアしましょう。</p>`;
  }
  bindPostOps(body);
}

// ===== 投稿フォーム（みんな・グループ共通） =====
// target：{ kind: "pub" } か { kind: "group", gid, gname }。編集のときは post._src を使う
async function openCompose(post, target, after) {
  const c = $("compose"); if (!c) return;
  c.hidden = false; c.innerHTML = `<p class="note">準備しています…</p>`;
  try { await ensureAuth(); if (!myProfileLoaded) await loadMyProfile(); } catch { c.innerHTML = `<p class="note">つながりませんでした。通信状況を確認してください。</p>`; return; }
  if (!post && !myProfile) {
    const cur = profDraft(current ? { nickname: current.nickname, icon: current.icon, color: current.color } : null);
    c.innerHTML = `<h2 style="font-size:17px;margin:0">まずはプロフィールを作りましょう</h2><p class="note">投稿に表示される名前とアイコンです。</p>${profileEditorHtml(cur)}`;
    bindProfileEditor(cur, () => openCompose(post, target, after));
    c.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  target = post ? post._src : (target || { kind: "pub" });
  const groups = joinedGroups();
  const draft = post ? { ...post } : { category: "音楽", title: "", by: "", oneline: "", link: "", image: "", rating: 4, public: true };
  const oneLabel = () => (target.kind === "pub" ? "ひとこと（誰でも見られます）" : "ひとこと（グループの人だけに見えます）");
  c.innerHTML = `
    ${post ? `<p class="note">${target.kind === "pub" ? "🌐 みんなへの投稿" : "👥 " + esc(target.gname || "グループ") + " への投稿"}を編集しています</p>`
      : `<label>投稿先<select id="fTo"><option value="pub">🌐 みんな（誰でも見られる）</option>${groups.map(g => `<option value="${esc(g.gid)}" ${target.kind === "group" && target.gid === g.gid ? "selected" : ""}>👥 ${esc(g.name)}（グループの人だけ）</option>`).join("")}</select></label>`}
    <div class="actions"><button type="button" class="btn small" id="srcSong">🎵 曲を探す</button><button type="button" class="btn small ghost" id="srcMine">DAILY FIND の記事から選ぶ</button></div>
    <input id="mq" type="search" enterkeyhint="search" placeholder="曲名やアーティスト名を入れる" autocomplete="off">
    <div class="suggest" id="suggest" hidden></div>
    <div class="picked"><div id="pv"></div><div class="note">候補を選ぶと、タイトル・ジャケット・リンクが入ります。曲以外は下に直接書いてください。</div></div>
    <div class="row2">
      <label>カテゴリ<select id="fCat">${Object.keys(CATS).map(k => `<option ${k === draft.category ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <label>タイトル<input id="fTitle" maxlength="100" value="${esc(draft.title)}"></label>
    </div>
    <label>作者・アーティスト・場所など<input id="fBy" maxlength="100" value="${esc(draft.by)}"></label>
    <label><span id="oneLbl">${oneLabel()}</span><input id="fOne" maxlength="200" value="${esc(draft.oneline)}" placeholder="例：夕日を見ながら聴きたい曲"></label>
    <div class="lbl" role="group" aria-label="評価">評価<div class="rate" id="rate">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="星${n}">★</button>`).join("")}</div></div>
    <label>リンク（なくてもOK）<input id="fLink" type="url" maxlength="500" value="${esc(draft.link)}" placeholder="https://"></label>
    <label class="check" id="pubRow"><input type="checkbox" id="fPub" ${draft.public !== false ? "checked" : ""}><span>曲を「みんなのプレイリスト」にも載せる<br><span class="note">載るのは曲名・アーティスト・ジャケット・リンク・いいね数だけです。誰が投稿したかは載りません。</span></span></label>
    <div class="actions"><button class="btn" id="post">${post ? "更新する" : "シェアする"}</button><button class="btn ghost" id="cancel" type="button">やめる</button><span class="msg" id="pMsg"></span></div>`;
  if ($("fTo")) $("fTo").onchange = () => {
    const v = $("fTo").value, g = groups.find(x => x.gid === v);
    target = g ? { kind: "group", gid: g.gid, gname: g.name } : { kind: "pub" };
    $("oneLbl").textContent = oneLabel();
  };
  const drawRate = () => c.querySelectorAll("#rate button").forEach(b => b.classList.toggle("on", +b.dataset.n <= draft.rating));
  const drawPv = () => { $("pv").innerHTML = cover({ title: $("fTitle").value || "タイトル", category: $("fCat").value, image: draft.image }); $("pubRow").hidden = $("fCat").value !== "音楽"; };
  $("rate").onclick = e => { const b = e.target.closest("button[data-n]"); if (b) { draft.rating = +b.dataset.n; drawRate(); } };
  $("fTitle").oninput = drawPv; $("fCat").onchange = drawPv;
  drawRate(); drawPv(); c.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!post) setTimeout(() => $("mq") && $("mq").focus({ preventScroll: true }), 350);   // すぐ曲名を打てるように

  let seq = 0, timer = null, results = [];
  const sug = $("suggest");
  const showResults = (list, footer) => {
    results = list; sug.hidden = false;
    sug.innerHTML = list.length ? list.map((r, i) => `<div class="s-item" data-i="${i}">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : cover(r)}
      <div><div class="s-t">${esc(r.title)}</div><div class="s-a">${esc(r.by || "")}</div></div></div>`).join("") + (footer ? `<div class="s-msg">${esc(footer)}</div>` : "")
      : `<div class="s-msg">見つかりませんでした。</div>`;
    sug.querySelectorAll(".s-item").forEach(el => el.onclick = () => {
      const r = results[+el.dataset.i];
      $("fTitle").value = r.title; $("fBy").value = r.by || ""; $("fCat").value = r.category || "音楽";
      if (r.link) $("fLink").value = r.link;
      if (r.oneline && !$("fOne").value) $("fOne").value = r.oneline;
      if (r.rating) { draft.rating = r.rating; drawRate(); }
      draft.image = r.image || ""; sug.hidden = true; $("mq").value = ""; drawPv();
    });
  };
  const runSearch = async () => {
    const q = $("mq").value.trim(); const my = ++seq;
    if (!q) { sug.hidden = true; return; }
    sug.hidden = false; sug.innerHTML = `<div class="s-msg">探しています…</div>`;
    try { const r = await searchSongs(q); if (my === seq) showResults(r); } catch { if (my === seq) sug.innerHTML = `<div class="s-msg">曲の検索につながりませんでした。</div>`; }
  };
  $("mq").addEventListener("input", e => { if (e.isComposing) return; clearTimeout(timer); timer = setTimeout(runSearch, 450); });
  $("mq").addEventListener("compositionend", () => { clearTimeout(timer); timer = setTimeout(runSearch, 300); });
  $("mq").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); runSearch(); } });
  $("srcSong").onclick = () => $("mq").focus();
  $("srcMine").onclick = async () => {
    try {
      const picks = (await (await fetch("picks.json?v=" + Date.now(), { cache: "no-store" })).json()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const abs = img => /^images\/[\w.-]+$/.test(img || "") ? `https://dailyfind.github.io/${img}` : (/^https:\/\//.test(img || "") ? img : "");
      showResults(picks.map(p => ({ title: p.title, by: p.by, category: p.category, oneline: p.oneline, rating: p.rating, link: safeLink(p.link), image: abs(p.image), thumb: abs(p.image) })), "DAILY FIND の記事");
    } catch { showResults([], ""); }
  };
  $("cancel").onclick = () => { c.hidden = true; c.innerHTML = ""; };
  $("post").onclick = async () => {
    const who = post ? { nickname: post.nickname, icon: post.icon, color: post.color } : { nickname: myProfile.nickname, icon: myProfile.icon, color: myProfile.color };
    const data = {
      uid: me, ...who,
      category: $("fCat").value, title: $("fTitle").value.trim(), by: $("fBy").value.trim(), oneline: $("fOne").value.trim(), link: $("fLink").value.trim(),
      image: /^https:\/\//.test(draft.image || "") ? draft.image : "", rating: draft.rating | 0, public: $("fCat").value === "音楽" && $("fPub").checked,
    };
    if (!data.title) return setMsg("pMsg", "タイトルを入れてください。", false);
    if (data.link && !/^https:\/\//i.test(data.link)) return setMsg("pMsg", "リンクは https:// から始まるアドレスにしてください。", false);
    $("post").disabled = true; setMsg("pMsg", "シェアしています…", true);
    try {
      const isPub = target.kind === "pub";
      const pref = post ? postRef(db, post) : (isPub ? doc(collection(db, "pubposts")) : doc(collection(db, "groups", target.gid, "posts")));
      const sref = doc(db, "songs", isPub ? "pub_" + pref.id : songId(target.gid, pref.id));
      const song = { title: data.title, by: data.by, image: data.image, link: data.link };
      const batch = writeBatch(db);
      if (post) {
        batch.set(pref, { ...data, likes: post.likes || {}, createdAt: post.createdAt, updatedAt: serverTimestamp() });
        const lc = likeCount(post);
        if (isPublicSong(post) && data.public) batch.update(sref, { ...song, likeCount: lc });
        else if (isPublicSong(post) && !data.public) batch.delete(sref);
        else if (!isPublicSong(post) && data.public) batch.set(sref, { ...song, likeCount: lc, createdAt: serverTimestamp() });
      } else {
        batch.set(pref, { ...data, likes: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        if (data.public) batch.set(sref, { ...song, likeCount: 0, createdAt: serverTimestamp() });
      }
      await batch.commit();
      c.hidden = true; c.innerHTML = "";
      toast(post ? "更新しました" : (isPub ? "みんなにシェアしました！" : "グループにシェアしました！"));
      after && after(target);
    } catch (e) { console.error(e); setMsg("pMsg", "シェアできませんでした。少し待ってからもう一度押してください。", false); $("post").disabled = false; }
  };
}

// ===== みんな（新着・フォロー中・みんなのプレイリスト） =====
let allTab = "new", pubSort = "new";
const songRow = (s, i, extra = "") => `
  <div class="tr"><span class="no">${String(i + 1).padStart(2, "0")}</span>${cover({ title: s.title, category: "音楽", image: s.image })}
    <div class="ft"><b>${esc(s.title)}</b><small>${esc(s.by || "")}</small></div>
    <div class="end">${s.likeCount ? `<span class="cnt">♥ ${s.likeCount | 0}</span>` : ""}${listenHtml(s, false)}${extra}</div></div>`;
async function allView() {
  current = null;
  root.innerHTML = `
    <div class="bar"><h2>みんな</h2><div class="actions"><button class="btn small" id="newBtn">＋ みんなに投稿</button></div></div>
    <section class="compose" id="compose" hidden></section>
    <div class="tabs2"><button data-t="new">新着</button><button data-t="follow">フォロー中</button><button data-t="songs">みんなのプレイリスト</button></div>
    <div id="abody">${LOADING}</div>
    <button class="fab" id="fab" aria-label="投稿する">＋</button>`;
  const tabsOn = () => root.querySelectorAll(".tabs2 button").forEach(x => x.classList.toggle("on", x.dataset.t === allTab));
  root.querySelectorAll(".tabs2 button").forEach(b => b.onclick = () => { allTab = b.dataset.t; tabsOn(); drawAll(); });
  $("newBtn").onclick = $("fab").onclick = () => openCompose(null, { kind: "pub" }, t => { if (t.kind === "pub") { allTab = "new"; tabsOn(); drawAll(); } });
  tabsOn();
  try { await ensureAuth(); } catch {}
  drawAll();
}
function drawAll() {
  stop();
  const body = $("abody"); if (!body) return;
  body.innerHTML = LOADING;
  if (allTab === "new") {
    unsubs.push(onSnapshot(query(collection(db, "pubposts"), orderBy("createdAt", "desc"), limit(60)), snap => {
      const list = tag(snap.docs, { kind: "pub" });
      body.innerHTML = `<p class="note" style="margin:0 0 6px">誰でも見られる投稿です。名前を押すと、その人のページを見たりフォローしたりできます。</p>`
        + (list.length ? list.map(p => postHtml(p)).join("") : `<p class="empty">まだ投稿がありません。「＋ みんなに投稿」から、最初の1つをシェアしましょう。</p>`);
      bindPostOps(body);
    }, e => { console.error(e); body.innerHTML = `<p class="empty">読み込めませんでした。</p>`; }));
  } else if (allTab === "follow") {
    followFeed(body);
  } else {
    body.innerHTML = `
      <div class="pl-top">
        <div><h2>みんなのプレイリスト</h2><p>DAILY FIND でシェアされた曲。誰が投稿したかは表示されません。</p></div>
        <div class="seg"><button class="btn small ${pubSort === "new" ? "" : "ghost"}" data-s="new">新しい順</button><button class="btn small ${pubSort === "top" ? "" : "ghost"}" data-s="top">いいね順</button></div>
      </div>
      <div class="flist" id="pubList">${LOADING}</div>`;
    body.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { pubSort = b.dataset.s; drawAll(); });
    const q = pubSort === "top" ? query(collection(db, "songs"), orderBy("likeCount", "desc"), limit(100)) : query(collection(db, "songs"), orderBy("createdAt", "desc"), limit(100));
    unsubs.push(onSnapshot(q, snap => {
      const list = []; snap.forEach(d => list.push(d.data()));
      if ($("pubList")) $("pubList").innerHTML = list.length ? list.map((s, i) => songRow(s, i)).join("") : `<p class="empty">まだ曲がありません。曲をシェアすると、ここに並びます。</p>`;
    }, e => { console.error(e); if ($("pubList")) $("pubList").innerHTML = `<p class="empty">読み込めませんでした。</p>`; }));
  }
}
// フォローしている人の「みんなへの投稿」をまとめて出す
async function followFeed(body) {
  let tos = [];
  try { tos = await myFollowing(); } catch { body.innerHTML = `<p class="empty">読み込めませんでした。</p>`; return; }
  if (allTab !== "follow") return;
  if (!tos.length) { body.innerHTML = `<p class="empty">まだ誰もフォローしていません。「新着」で気になる人の名前を押すと、その人のページからフォローできます。</p>`; return; }
  const chunks = []; for (let i = 0; i < tos.length; i += 30) chunks.push(tos.slice(i, i + 30));
  const parts = [];
  const draw = () => {
    const list = sortNew(parts.flat()).slice(0, 100);
    body.innerHTML = list.length ? list.map(p => postHtml(p)).join("") : `<p class="empty">フォローしている人の投稿はまだありません。</p>`;
    bindPostOps(body);
  };
  chunks.forEach((ch, i) => unsubs.push(onSnapshot(query(collection(db, "pubposts"), where("uid", "in", ch), limit(100)), snap => { parts[i] = tag(snap.docs, { kind: "pub" }); draw(); },
    e => { console.error(e); parts[i] = []; draw(); })));
}

// ===== ある人の投稿をまとめて読む（みんなへの投稿＋自分も入っているグループでの投稿） =====
async function loadPostsOf(uid) {
  const out = [];
  try { out.push(...tag((await getDocs(query(collection(db, "pubposts"), where("uid", "==", uid), limit(100)))).docs, { kind: "pub" })); } catch (e) { console.error(e); }
  await Promise.all(joinedGroups().map(async g => {
    try { out.push(...tag((await getDocs(query(collection(db, "groups", g.gid, "posts"), where("uid", "==", uid), limit(100)))).docs, { kind: "group", gid: g.gid, gname: g.name })); } catch {}
  }));
  return sortNew(out);
}

// ===== マイページ =====
let meTab = "posts";
async function meView() {
  current = null;
  root.innerHTML = LOADING;
  try { await ensureAuth(); await loadMyProfile(true); } catch { root.innerHTML = `<p class="empty">つながりませんでした。通信状況を確認して、開き直してください。</p>`; return; }
  if (!myProfile) {
    const cur = profDraft(null);
    root.innerHTML = `<div class="panel"><h2>マイページを作りましょう</h2>
      <p>写真やニックネームを決めると、みんなに投稿したり、気になる人をフォローしたりできます。メールアドレスもパスワードも要りません。</p>${profileEditorHtml(cur)}</div>`;
    bindProfileEditor(cur, meView);
    return;
  }
  let following = [], followers = [], myPosts = [];
  [following, followers, myPosts] = await Promise.all([myFollowing().catch(() => []), myFollowers().catch(() => []), loadPostsOf(me)]);
  if (location.hash !== "#me") return;   // 読み込み中に別の画面へ移った
  root.innerHTML = `
    <div class="me-head">${bigAv(myProfile)}<div>
      <h2>${esc(myProfile.nickname)}</h2>${myProfile.bio ? `<p>${esc(myProfile.bio)}</p>` : ""}
      <div class="counts"><button data-t="posts"><b>${myPosts.length}</b>投稿</button><button data-t="following"><b>${following.length}</b>フォロー中</button><button data-t="followers"><b>${followers.length}</b>フォロワー</button></div>
    </div></div>
    <div class="actions"><button class="btn small" id="newBtn">＋ 投稿する</button><button class="btn small ghost" id="editBtn">プロフィールを編集</button><button class="btn small ghost" id="linkBtn">自分のページのリンクをコピー</button></div>
    <section class="panel" id="profEdit" hidden style="margin-top:16px"></section>
    <section class="compose" id="compose" hidden style="margin-top:16px"></section>
    <div class="tabs2" style="margin-top:22px"><button data-t="posts">自分の投稿</button><button data-t="following">フォロー中</button><button data-t="followers">フォロワー</button></div>
    <div id="mbody"></div>
    <p class="note" style="margin-top:36px">🔒 マイページは、この端末のこのブラウザに結びついています（メールやパスワードを使わないため）。ブラウザのデータを消したり、別のスマホで開いたりすると、別の人として扱われます。</p>
    <button class="fab" id="fab" aria-label="投稿する">＋</button>`;
  const tabsOn = () => root.querySelectorAll(".tabs2 button").forEach(x => x.classList.toggle("on", x.dataset.t === meTab));
  root.querySelectorAll(".tabs2 button, .counts button").forEach(b => b.onclick = () => { meTab = b.dataset.t; tabsOn(); drawMe(); });
  $("newBtn").onclick = $("fab").onclick = () => openCompose(null, { kind: "pub" }, meView);
  $("editBtn").onclick = () => {
    const box = $("profEdit"); if (!box.hidden) { box.hidden = true; return; }
    const cur = profDraft(myProfile); box.hidden = false; box.innerHTML = `<h2>プロフィールを編集</h2>${profileEditorHtml(cur)}`;
    bindProfileEditor(cur, meView);
  };
  $("linkBtn").onclick = async () => { const url = location.origin + "/" + userHash(me); try { await navigator.clipboard.writeText(url); toast("リンクをコピーしました"); } catch { prompt("このリンクをコピーしてください", url); } };
  const profs = {};
  async function drawMe() {
    const body = $("mbody"); if (!body) return;
    if (meTab === "posts") {
      body.innerHTML = myPosts.length ? myPosts.map(p => postHtml(p, { showSrc: true })).join("") : `<p class="empty">まだ投稿がありません。「＋ 投稿する」からシェアしましょう。</p>`;
      bindPostOps(body, { redraw: drawMe, reload: meView });
      return;
    }
    const list = meTab === "following" ? following : followers;
    if (!list.length) { body.innerHTML = `<p class="empty">${meTab === "following" ? "まだ誰もフォローしていません。「みんな」で気になる人の名前を押すと、フォローできます。" : "まだフォロワーはいません。"}</p>`; return; }
    body.innerHTML = LOADING;
    await Promise.all(list.map(async u => { if (!(u in profs)) profs[u] = await getProfile(u); }));
    body.innerHTML = list.map(u => userRow(u, profs[u], followBtn(u, following.includes(u)))).join("");
    bindFollowBtns(body, (uid, on) => { if (uid === undefined) return meView(); following = on ? [...new Set([...following, uid])] : following.filter(x => x !== uid);
      root.querySelector('.counts [data-t="following"] b').textContent = following.length; });
  }
  tabsOn(); drawMe();
}

// ===== ほかの人のページ =====
async function userView(uid) {
  current = null;
  root.innerHTML = LOADING;
  try { await ensureAuth(); } catch {}
  if (uid === me) { history.replaceState(null, "", "/#me"); window.DF && window.DF.setNav("me"); return meView(); }
  const p = await getProfile(uid);
  if (!p) { root.innerHTML = `<p class="empty">この人のページは見つかりませんでした。</p>`; return; }
  let following = false, nFollowers = 0, nFollowing = 0, posts = [];
  await Promise.all([
    getDoc(doc(db, "follows", followId(uid))).then(d => { following = d.exists(); }).catch(() => {}),
    getCountFromServer(query(collection(db, "follows"), where("to", "==", uid))).then(r => { nFollowers = r.data().count; }).catch(() => {}),
    getCountFromServer(query(collection(db, "follows"), where("from", "==", uid))).then(r => { nFollowing = r.data().count; }).catch(() => {}),
    loadPostsOf(uid).then(l => { posts = l; }),
  ]);
  if (location.hash.slice(1) !== "u=" + encodeURIComponent(uid) && decodeURIComponent(location.hash.slice(3)) !== uid) return;
  root.innerHTML = `
    <div class="me-head">${bigAv(p)}<div>
      <h2>${esc(p.nickname)}</h2>${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
      <div class="counts"><span><b>${posts.length}</b>投稿</span><span><b>${nFollowing}</b>フォロー中</span><span><b id="nFol">${nFollowers}</b>フォロワー</span></div>
    </div></div>
    <div class="actions" id="uAct">${followBtn(uid, following)}${isAdmin ? `<button class="btn small ghost" id="admDelProf">管理者：このプロフィールを消す</button>` : ""}</div>
    <div class="tabs2" style="margin-top:22px"><button class="on">投稿</button></div>
    <div id="ubody"></div>`;
  const drawPosts = () => {
    const body = $("ubody"); if (!body) return;
    body.innerHTML = posts.length ? posts.map(x => postHtml(x, { showSrc: true })).join("") : `<p class="empty">見られる投稿はまだありません。</p>`;
    bindPostOps(body, { redraw: drawPosts, reload: () => userView(uid) });
  };
  bindFollowBtns($("uAct"), (u, on) => { if (u === undefined) return userView(uid); nFollowers += on ? 1 : -1; $("nFol").textContent = Math.max(0, nFollowers); });
  if ($("admDelProf")) $("admDelProf").onclick = e => armed(e.target, "管理者：このプロフィールを消す", async () => { await deleteDoc(doc(adb, "profiles", uid)); toast("消しました"); userView(uid); });
  drawPosts();
}

// ===== トップページ：お知らせ＋友達のおすすめ =====
let homeUnsubs = [];
const newsHtml = n => `
  <div class="news-item"><div class="nk">お知らせ<span>${esc(fmtTime(n.createdAt))}</span></div>
    <b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ""}${safeLink(n.link) ? `<a href="${esc(safeLink(n.link))}" target="_blank" rel="noopener noreferrer">くわしく見る ↗</a>` : ""}</div>`;
const hxCard = p => `
  <a class="hx-card" href="${p._src.kind === "pub" ? esc(userHash(p.uid)) : "#group"}">${cover({ title: p.title, category: p.category, image: p.image })}
    <div><div class="who">${av(p.icon, p.color, p.uid)}${esc(p.nickname)}${likeCount(p) ? ` · ♥${likeCount(p)}` : ""}</div>
    <b>${esc(p.title)}</b>${p.by ? `<small>${esc(p.by)}</small>` : ""}${p.oneline ? `<p>${esc(p.oneline)}</p>` : ""}</div></a>`;

async function fillHome() {
  homeUnsubs.forEach(u => u()); homeUnsubs = [];
  // 管理者からのお知らせ（新しい3件）
  homeUnsubs.push(onSnapshot(query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(3)), snap => {
    const nb = $("homeNews"); if (!nb) return;
    const list = []; snap.forEach(d => list.push(d.data()));
    nb.innerHTML = list.length ? `<section class="news">${list.map(newsHtml).join("")}</section>` : "";
  }, () => {}));
  const box = $("homeExtras"); if (!box) return;
  box.innerHTML = `
    <section class="hx">
      <div class="section-head"><h3>Friends' Picks<small id="hxSub">友達のおすすめ</small></h3></div>
      <div class="hx-cards" id="hxCards">${LOADING}</div>
      <div class="hx-more" id="hxMore"></div>
    </section>`;
  const parts = {};
  const draw = () => {
    if (!$("hxCards")) return;
    const list = sortNew(Object.values(parts).flat()).slice(0, 6);
    $("hxCards").innerHTML = list.length ? list.map(hxCard).join("") : `<p class="empty">まだ投稿がありません。</p>`;
  };
  const watch = (name, q, src) => homeUnsubs.push(onSnapshot(q, snap => { parts[name] = tag(snap.docs, src); draw(); }, () => { parts[name] = []; draw(); }));
  const started = homeUnsubs.length;
  // グループかプロフィールがある人だけログインして、友達の投稿を集める
  let hasMe = false; try { hasMe = localStorage.getItem("dff_me") === "1"; } catch {}
  const gs = joinedGroups();
  let sources = 0, groupOk = false;
  if (gs.length || hasMe) {
    try {
      await ensureAuth();
      const g = gs.find(x => x.gid === lastGid()) || gs[0];
      if (g) {
        try { groupOk = (await getDoc(doc(db, "groups", g.gid, "members", me))).exists(); } catch {}
        if (groupOk) { watch("group", query(collection(db, "groups", g.gid, "posts"), orderBy("createdAt", "desc"), limit(6)), { kind: "group", gid: g.gid, gname: g.name }); sources++; }
      }
      const tos = await myFollowing().catch(() => []);
      if (tos.length) { watch("follow", query(collection(db, "pubposts"), where("uid", "in", tos.slice(0, 30)), limit(30)), { kind: "pub" }); sources++; }
    } catch {}
  }
  if (homeUnsubs.length < started || !$("hxCards")) return;   // 読み込み中に画面が変わった
  if (!sources) {
    $("hxSub").textContent = "みんなの新着";
    watch("pub", query(collection(db, "pubposts"), orderBy("createdAt", "desc"), limit(6)), { kind: "pub" });
  }
  $("hxMore").innerHTML = sources
    ? `${groupOk ? `<a href="#group">グループを開く →</a>` : ""}<a href="#all">みんなの投稿を見る →</a>`
    : `<div class="hx-cta"><p>友達とグループを作ったり、気になる人をフォローしたりすると、ここに友達のおすすめが並びます。</p><a class="btn small" href="#all">みんなの投稿を見る</a><a class="btn small ghost" href="#group">グループを作る</a></div>`;
}
window.addEventListener("df:leavehome", () => { homeUnsubs.forEach(u => u()); homeUnsubs = []; });

// ===== 意見ボックス（誰でも送れる。読めるのは管理者だけ） =====
function feedbackView() {
  const st = { kind: "要望" };
  const nick = (myProfile && myProfile.nickname) || (current && current.nickname) || "";
  root.innerHTML = `
    <div class="panel">
      <h2>💬 意見ボックス</h2>
      <p>「こうなったらいいな」「ここが使いにくい」「動かない」など、なんでも送ってください。読むのは<b>サイトの管理者だけ</b>です。</p>
      <div class="lbl">どんな内容？<div class="fb-kinds" id="fbKinds">${["要望", "不具合", "感想", "その他"].map(k => `<button type="button" data-k="${k}" class="${k === st.kind ? "on" : ""}">${k}</button>`).join("")}</div></div>
      <label>内容<textarea id="fbText" maxlength="1000" placeholder="例：プレイリストを並べ替えたい"></textarea></label>
      <label>ニックネーム（なくてもOK）<input id="fbNick" maxlength="20" value="${esc(nick)}" placeholder="名前を書かなくても送れます"></label>
      <div class="actions"><button class="btn" id="fbSend">送る</button><span class="msg" id="fbMsg"></span></div>
      <p class="note">メールアドレスなどの個人情報は書かないでください。返事が必要なときは、管理者からのお知らせでお答えすることがあります。</p>
    </div>`;
  $("fbKinds").onclick = e => { const b = e.target.closest("[data-k]"); if (!b) return; st.kind = b.dataset.k; $("fbKinds").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); };
  $("fbSend").onclick = async () => {
    const text = $("fbText").value.trim();
    if (!text) return setMsg("fbMsg", "内容を書いてください。", false);
    $("fbSend").disabled = true; setMsg("fbMsg", "送っています…", true);
    try {
      await ensureAuth();
      await addDoc(collection(db, "feedback"), { uid: me, kind: st.kind, text, nickname: $("fbNick").value.trim(), done: false, createdAt: serverTimestamp() });
      root.innerHTML = `<div class="panel"><h2>ありがとうございます！</h2><p>意見を送りました。管理者が読んで、これからの改良に使います。</p>
        <div class="actions"><a class="btn" href="#">トップへ戻る</a><button class="btn ghost" id="fbMore">もう1つ送る</button></div></div>`;
      $("fbMore").onclick = feedbackView;
      toast("送りました");
    } catch (e) { console.error(e); setMsg("fbMsg", "送れませんでした。少し待ってからもう一度押してください。", false); $("fbSend").disabled = false; }
  };
}

// ===== 管理（サイトの持ち主だけ） =====
let adminUser = null, isAdmin = false, badgeUnsub = null;
onAuthStateChanged(adminAuth, async user => {
  adminUser = user; isAdmin = false;
  if (user) { try { isAdmin = (await getDoc(doc(adb, "admins", user.uid))).exists(); } catch {} }
  window.DF && window.DF.setAdmin(isAdmin);
  // 未対応の意見があればメニューの「管理」に赤い点を出す
  if (badgeUnsub) { badgeUnsub(); badgeUnsub = null; }
  if (isAdmin) badgeUnsub = onSnapshot(query(collection(adb, "feedback"), where("done", "==", false), limit(50)),
    snap => window.DF && window.DF.setBadge(snap.size), () => {});
  else window.DF && window.DF.setBadge(0);
  if (location.hash === "#admin") adminView();
});

let adminUnsubs = [];
function adminView() {
  adminUnsubs.forEach(u => u()); adminUnsubs = [];
  if (!adminUser) {
    root.innerHTML = `<div class="panel"><h2>管理</h2><p>サイトの持ち主だけが使えます。Google アカウントでログインしてください。</p>
      <div class="actions"><button class="btn" id="aIn">Google でログイン</button><span class="msg" id="aMsg"></span></div></div>`;
    $("aIn").onclick = async () => { try { await signInWithPopup(adminAuth, new GoogleAuthProvider()); } catch (e) { setMsg("aMsg", "ログインできませんでした（" + (e.code || "error") + "）", false); } };
    return;
  }
  if (!isAdmin) {
    root.innerHTML = `<div class="panel"><h2>管理</h2><p>このアカウントは管理者として登録されていません。</p><p>管理者番号：<code>${esc(adminUser.uid)}</code></p>
      <div class="actions"><button class="btn small ghost" id="aOut">ログアウト</button></div></div>`;
    $("aOut").onclick = () => signOut(adminAuth);
    return;
  }
  root.innerHTML = `
    <div class="adm">
      <div class="bar"><h2>管理</h2><div class="actions"><a class="btn small" href="write.html">✏️ おすすめを書く</a><button class="btn small ghost" id="aOut">ログアウト</button></div></div>
      <section class="stats">
        <div class="stat"><b id="sGroups">–</b><span>グループ</span></div>
        <div class="stat"><b id="sPub">–</b><span>みんなへの投稿</span></div>
        <div class="stat"><b id="sSongs">–</b><span>みんなのプレイリストの曲</span></div>
        <div class="stat"><b id="sLikes">–</b><span>公開曲のいいね合計</span></div>
      </section>
      <p class="note">すべてのグループのメンバーと投稿を見て、投稿の削除・メンバーを外す・グループを閉じることができます。みんなへの投稿も消せます。問題のある写真やプロフィールは、その人のページの「管理者：このプロフィールを消す」で消せます。他の人になりすまして投稿したり、投稿を書き換えたりはできません。</p>

      <h3>💬 意見ボックス</h3>
      <div class="seg" style="margin-bottom:6px"><button class="btn small" data-fb="open">未対応</button><button class="btn small ghost" data-fb="all">すべて</button></div>
      <div id="aFeedback">${LOADING}</div>

      <h3>📣 お知らせを書く</h3>
      <div class="panel" style="max-width:none">
        <p>トップページの一番上に、みんなに向けたお知らせを出せます（新しい3件まで表示）。</p>
        <label>タイトル<input id="nTitle" maxlength="60" placeholder="例：グループ機能ができました"></label>
        <label>本文（なくてもOK）<textarea id="nBody" maxlength="1000" placeholder="くわしい説明"></textarea></label>
        <label>リンク（なくてもOK）<input id="nLink" type="url" maxlength="500" placeholder="https://"></label>
        <div class="actions"><button class="btn" id="nPost">お知らせを出す</button><span class="msg" id="nMsg"></span></div>
      </div>
      <div id="aNews"></div>

      <h3>🌐 みんなへの投稿</h3><div id="aPub">${LOADING}</div>
      <h3>グループ</h3><div id="aGroups">${LOADING}</div>
      <h3>みんなのプレイリスト</h3><div class="flist" id="aSongs">${LOADING}</div>
    </div>`;
  $("aOut").onclick = () => signOut(adminAuth);
  const fmt = ts => ts && ts.toDate ? ts.toDate().toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "";

  // 意見ボックス
  let fbFilter = "open", fbList = [];
  const drawFb = () => {
    const list = fbFilter === "open" ? fbList.filter(f => !f.done) : fbList;
    $("aFeedback").innerHTML = list.length ? list.map(f => `
      <div class="fb-row ${f.done ? "done" : ""}">
        <div class="fb-meta"><span class="fb-kind">${esc(f.kind)}</span>${esc(f.nickname || "名前なし")} · ${esc(fmt(f.createdAt))}</div>
        <p>${esc(f.text)}</p>
        <div class="actions"><button class="btn small ghost" data-fdone="${esc(f.id)}">${f.done ? "未対応に戻す" : "✓ 対応済みにする"}</button><button class="btn small ghost" data-fdel="${esc(f.id)}">消す</button></div>
      </div>`).join("") : `<p class="empty">${fbFilter === "open" ? "未対応の意見はありません。" : "まだ意見はありません。"}</p>`;
    $("aFeedback").querySelectorAll("[data-fdone]").forEach(b => b.onclick = () => { const f = fbList.find(x => x.id === b.dataset.fdone); updateDoc(doc(adb, "feedback", f.id), { done: !f.done }).catch(console.error); });
    $("aFeedback").querySelectorAll("[data-fdel]").forEach(b => b.onclick = () => armed(b, "消す", () => deleteDoc(doc(adb, "feedback", b.dataset.fdel))));
  };
  root.querySelectorAll("[data-fb]").forEach(b => b.onclick = () => { fbFilter = b.dataset.fb; root.querySelectorAll("[data-fb]").forEach(x => x.classList.toggle("ghost", x !== b)); drawFb(); });
  adminUnsubs.push(onSnapshot(query(collection(adb, "feedback"), orderBy("createdAt", "desc"), limit(200)), snap => {
    fbList = []; snap.forEach(d => fbList.push({ id: d.id, ...d.data() })); drawFb();
  }, e => { console.error(e); $("aFeedback").innerHTML = `<p class="empty">読み込めませんでした。</p>`; }));

  // お知らせ
  $("nPost").onclick = async () => {
    const title = $("nTitle").value.trim(), body = $("nBody").value.trim(), link = $("nLink").value.trim();
    if (!title) return setMsg("nMsg", "タイトルを入れてください。", false);
    if (link && !/^https:\/\//i.test(link)) return setMsg("nMsg", "リンクは https:// から始まるアドレスにしてください。", false);
    $("nPost").disabled = true;
    try { await addDoc(collection(adb, "announcements"), { title, body, link, createdAt: serverTimestamp() }); $("nTitle").value = ""; $("nBody").value = ""; $("nLink").value = ""; toast("お知らせを出しました"); setMsg("nMsg", "", true); }
    catch (e) { console.error(e); setMsg("nMsg", "出せませんでした。", false); }
    $("nPost").disabled = false;
  };
  adminUnsubs.push(onSnapshot(query(collection(adb, "announcements"), orderBy("createdAt", "desc"), limit(50)), snap => {
    $("aNews").innerHTML = snap.size ? `<div class="news">${snap.docs.map(d => newsHtml(d.data()) + `<div class="actions" style="margin:-4px 0 8px"><button class="btn small ghost" data-ndel="${esc(d.id)}">このお知らせを消す</button></div>`).join("")}</div>` : `<p class="empty">まだお知らせはありません。</p>`;
    $("aNews").querySelectorAll("[data-ndel]").forEach(b => b.onclick = () => armed(b, "このお知らせを消す", () => deleteDoc(doc(adb, "announcements", b.dataset.ndel))));
  }, e => console.error(e)));

  // みんなへの投稿
  adminUnsubs.push(onSnapshot(query(collection(adb, "pubposts"), orderBy("createdAt", "desc"), limit(100)), snap => {
    $("sPub").textContent = snap.size >= 100 ? "100+" : snap.size;
    const list = tag(snap.docs, { kind: "pub" });
    $("aPub").innerHTML = list.length ? list.map(p => `<div class="arow">${cover({ title: p.title, category: p.category, image: p.image })}
      <div><b>${esc(p.title)}</b><small><a href="${esc(userHash(p.uid))}">${esc(p.nickname)}</a> · ${esc(p.category)} · ♥${likeCount(p)} · ${fmtTime(p.createdAt)}${p.oneline ? " · " + esc(p.oneline) : ""}</small></div>
      <button class="btn small ghost" data-ppdel="${esc(p.id)}">消す</button></div>`).join("") : `<p class="empty">まだ投稿はありません。</p>`;
    $("aPub").querySelectorAll("[data-ppdel]").forEach(b => b.onclick = () => armed(b, "消す", () => deletePost(adb, list.find(p => p.id === b.dataset.ppdel))));
  }, e => { console.error(e); $("aPub").innerHTML = `<p class="empty">読み込めませんでした。</p>`; }));

  adminUnsubs.push(onSnapshot(query(collection(adb, "groups"), orderBy("createdAt", "desc")), snap => {
    $("sGroups").textContent = snap.size;
    const open = new Set([...document.querySelectorAll("#aGroups details[open]")].map(d => d.dataset.gid));
    $("aGroups").innerHTML = snap.size ? snap.docs.map(d => `
      <details data-gid="${esc(d.id)}" ${open.has(d.id) ? "open" : ""}>
        <summary><span><b>${esc(d.data().name)}</b><small>${esc(fmt(d.data().createdAt))}</small></span><span class="note">開く ▾</span></summary>
        <div class="inner" id="ag-${esc(d.id)}">${LOADING}</div>
      </details>`).join("") : `<p class="empty">まだグループはありません。</p>`;
    $("aGroups").querySelectorAll("details").forEach(dt => {
      const load = () => loadAdminGroup(dt.dataset.gid);
      dt.addEventListener("toggle", () => { if (dt.open) load(); });
      if (dt.open) load();
    });
  }, e => { console.error(e); $("aGroups").innerHTML = `<p class="empty">読み込めませんでした。</p>`; }));

  adminUnsubs.push(onSnapshot(query(collection(adb, "songs"), orderBy("createdAt", "desc")), snap => {
    $("sSongs").textContent = snap.size;
    let likes = 0; snap.forEach(d => { likes += d.data().likeCount | 0; }); $("sLikes").textContent = likes;
    $("aSongs").innerHTML = snap.size ? snap.docs.map((d, i) => songRow(d.data(), i, `<button class="btn small ghost" data-sdel="${esc(d.id)}">消す</button>`)).join("") : `<p class="empty">まだ曲はありません。</p>`;
    $("aSongs").querySelectorAll("[data-sdel]").forEach(b => b.onclick = () => armed(b, "消す", () => deleteDoc(doc(adb, "songs", b.dataset.sdel))));
  }, e => { console.error(e); $("aSongs").innerHTML = `<p class="empty">読み込めませんでした。</p>`; }));
}

async function loadAdminGroup(gid) {
  const box = $("ag-" + gid); if (!box) return;
  try {
    const [mem, ps, inv] = await Promise.all([
      getDocs(collection(adb, "groups", gid, "members")),
      getDocs(query(collection(adb, "groups", gid, "posts"), orderBy("createdAt", "desc"))),
      getDoc(doc(adb, "groups", gid, "private", "invite")),
    ]);
    const key = inv.exists() ? inv.data().key : "";
    const list = tag(ps.docs, { kind: "group", gid });
    box.innerHTML = `
      <div><span class="note">メンバー（${mem.size}人）</span>
        ${mem.docs.map(d => `<div class="mrow"><span>${av(d.data().icon, d.data().color, d.id)}${esc(d.data().nickname)}</span><button class="btn small ghost" data-akick="${esc(d.id)}">外す</button></div>`).join("") || `<p class="empty">メンバーはいません。</p>`}</div>
      <div><span class="note">投稿（${list.length}件）</span>
        ${list.map(p => `<div class="arow">${cover({ title: p.title, category: p.category, image: p.image })}
          <div><b>${esc(p.title)}</b><small>${esc(p.nickname)} · ${esc(p.category)} · ♥${likeCount(p)} · ${fmtTime(p.createdAt)}${p.oneline ? " · " + esc(p.oneline) : ""}</small></div>
          <button class="btn small ghost" data-apdel="${esc(p.id)}">消す</button></div>`).join("") || `<p class="empty">投稿はありません。</p>`}</div>
      <div class="actions">
        ${key ? `<button class="btn small ghost" data-acopy="${esc(inviteUrl(gid, key))}">招待リンクをコピー</button>` : ""}
        <button class="btn small ghost" data-aclose>グループを閉じる（全部削除）</button><span class="msg" id="am-${esc(gid)}"></span>
      </div>`;
    box.querySelectorAll("[data-akick]").forEach(b => b.onclick = () => armed(b, "外す", async () => { await deleteDoc(doc(adb, "groups", gid, "members", b.dataset.akick)); loadAdminGroup(gid); }));
    box.querySelectorAll("[data-apdel]").forEach(b => b.onclick = () => armed(b, "消す", async () => { await deletePost(adb, list.find(p => p.id === b.dataset.apdel)); loadAdminGroup(gid); }));
    box.querySelectorAll("[data-acopy]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.acopy); setMsg("am-" + gid, "コピーしました", true); } catch { setMsg("am-" + gid, "コピーできませんでした", false); } });
    box.querySelector("[data-aclose]").onclick = e => armed(e.target, "グループを閉じる（全部削除）", async () => {
      const songs = await getDocs(query(collection(adb, "songs"), where(documentId(), ">=", gid + "_"), where(documentId(), "<", gid + "_")));
      const refs = [...songs.docs.map(d => d.ref), ...ps.docs.map(d => d.ref), ...mem.docs.map(d => d.ref),
                    doc(adb, "groups", gid, "private", "invite"), doc(adb, "groups", gid)];
      for (let i = 0; i < refs.length; i += 400) { const b = writeBatch(adb); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
    });
  } catch (e) { console.error(e); box.innerHTML = `<p class="empty">読み込めませんでした。</p>`; }
}

// ===== 曲の検索（外部のプログラムは隔離した枠でだけ動かす） =====
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const appleSearchUrl = (t, a) => "https://music.apple.com/jp/search?term=" + encodeURIComponent(`${t} ${a}`.trim());
const s = v => (typeof v === "string" ? v : "");
const https = u => (/^https:\/\//i.test(s(u)) ? s(u) : "");
let frame = null, frameReady = null; const pending = new Map();
function sandbox() {
  if (frameReady) return frameReady;
  frameReady = new Promise(ok => {
    frame = document.createElement("iframe"); frame.setAttribute("sandbox", "allow-scripts"); frame.hidden = true;
    frame.srcdoc = `<script>addEventListener("message", e => { const { id, url } = e.data || {};
      if (typeof url !== "string" || !/^https:\\/\\/api\\.deezer\\.com\\/search\\?/.test(url)) return;
      const cb = "cb" + String(id).replace(/\\W/g, ""); const sc = document.createElement("script");
      window[cb] = d => { parent.postMessage({ id, data: JSON.parse(JSON.stringify(d)) }, "*"); sc.remove(); };
      sc.onerror = () => parent.postMessage({ id, error: true }, "*"); sc.src = url + "&callback=" + cb; document.body.appendChild(sc); });<\/script>`;
    frame.onload = () => ok(frame); document.body.append(frame);
  });
  return frameReady;
}
addEventListener("message", e => {
  if (!frame || e.source !== frame.contentWindow) return;
  const p = pending.get(e.data && e.data.id); if (!p) return; pending.delete(e.data.id);
  e.data.error ? p.reject(new Error("net")) : p.resolve(e.data.data);
});
async function deezer(term) {
  const f = await sandbox(); const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const data = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject }); setTimeout(() => { if (pending.delete(id)) reject(new Error("timeout")); }, 8000);
    f.contentWindow.postMessage({ id, url: "https://api.deezer.com/search?" + new URLSearchParams({ q: term, limit: 12, output: "jsonp" }) }, "*");
  });
  return (Array.isArray(data && data.data) ? data.data : []).map(t => ({ title: s(t.title), by: s(t.artist && t.artist.name), category: "音楽",
    thumb: https(t.album && t.album.cover_medium), image: https(t.album && t.album.cover_xl), link: appleSearchUrl(s(t.title), s(t.artist && t.artist.name)) }));
}
async function apple(term) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  const res = await fetch("https://itunes.apple.com/search?" + new URLSearchParams({ term, country: "JP", media: "music", entity: "song", limit: 12, lang: "ja_jp" }), { signal: ctrl.signal });
  clearTimeout(t); if (!res.ok) throw new Error("apple");
  const d = await res.json();
  return (Array.isArray(d.results) ? d.results : []).map(x => ({ title: s(x.trackName), by: s(x.artistName), category: "音楽",
    thumb: https(x.artworkUrl100), image: https(s(x.artworkUrl100).replace("100x100bb", "600x600bb")), link: https(x.trackViewUrl) }));
}
async function searchSongs(q) { if (!isIOS) { try { return await apple(q); } catch {} } return deezer(q); }

// ===== 読み込み時：今の画面に合わせて動く =====
window.DF_READY = true;
if (window.DF) window.DF.friendsReady();
