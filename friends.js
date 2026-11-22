// DAILY FIND：見つける・グループ・マイページ・管理（メインページの中で動く）
// ・友達は匿名ログイン（メール・パスワード・名前は使わない）
// ・プロフィール（ニックネーム・アイコン・写真・自己紹介）はサイト全体で1人1つ
// ・管理者（サイトの持ち主）は Google ログイン。別の Firebase アプリ名で起動して、友達用のログインと混ざらないようにする
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
         signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
         linkWithPopup, signInWithCredential } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
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

// 友達用（ふだんは匿名。マイページで Google とつなぐと、別の場所でも Google ログインで同じ人に戻れる）
const app = initializeApp(CONFIG);
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
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
const saveGroups = gs => { try { localStorage.setItem(LS_KEY, JSON.stringify(gs)); } catch {} syncGroupsSoon(); };
// 入っているグループの一覧を、本人だけが読める場所（mygroups/{自分}）にも置いておく。
// Google でログインし直したとき（ホーム画面のアイコン・別のスマホ）に、ここからグループを元に戻す
let syncTimer = null;
function syncGroupsSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (!me) return;
    const groups = loadGroups().filter(g => g.name).slice(0, 50).map(g => ({ gid: g.gid, key: g.key, name: g.name }));
    try { await setDoc(doc(db, "mygroups", me), { groups, updatedAt: serverTimestamp() }); } catch (e) { console.warn("グループ一覧を保存できませんでした", e && e.code); }
  }, 800);
}
async function restoreGroups() {
  try {
    const d = await getDoc(doc(db, "mygroups", me)); if (!d.exists()) return 0;
    const cloud = (d.data().groups || []).filter(g => g && g.gid && g.key);
    const local = loadGroups(); const have = new Set(local.map(g => g.gid));
    const merged = [...local, ...cloud.filter(g => !have.has(g.gid))];
    try { localStorage.setItem(LS_KEY, JSON.stringify(merged)); } catch {}
    return cloud.length;
  } catch { return 0; }
}
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

// ===== Google ログイン（引き継ぎ用） =====
// ふだんは匿名のまま。マイページで「Google とつなぐ」と、今の自分（マイページ・グループ・フォロー）が Google アカウントに結びつく。
// ホーム画面のアイコン・別のスマホでは「Google でログイン」を押すと、その自分に戻れる。
const G_LOGO = `<svg class="glogo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;
const gProvider = () => { const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" }); return p; };
const googleEmail = () => { const u = auth.currentUser, g = u && u.providerData.find(x => x.providerId === "google.com"); return g ? (g.email || "Google アカウント") : ""; };
const authErr = e => ({ "auth/popup-blocked": "ログインの画面が開けませんでした。もう一度押してください。",
  "auth/popup-closed-by-user": "ログインをやめました。", "auth/cancelled-popup-request": "ログインをやめました。",
  "auth/network-request-failed": "通信できませんでした。電波のいいところでもう一度試してください。" }[e && e.code]
  || `うまくいきませんでした（${(e && e.code) || "error"}）。少し待ってからもう一度試してください。`);
async function linkGoogle(msgId) {
  await ensureAuth();
  setMsg(msgId, "Google のログイン画面を開いています…", true);
  try {
    await linkWithPopup(auth.currentUser, gProvider());
    clearTimeout(syncTimer); syncGroupsSoon();
    toast("Google とつなぎました"); return true;
  } catch (e) {
    if (e.code === "auth/credential-already-in-use" || e.code === "auth/email-already-in-use") {
      // その Google アカウントは、もう別のマイページとつながっている → そちらに切り替えるか聞く
      const cred = GoogleAuthProvider.credentialFromError(e);
      if (cred && confirm("この Google アカウントは、前に別の場所で作ったマイページとつながっています。\nそちらに切り替えますか？\n\n（いまこの画面で使っているマイページからは離れます）")) {
        try { await switchAccount(() => signInWithCredential(auth, cred)); return true; } catch (e2) { setMsg(msgId, authErr(e2), false); return false; }
      }
      setMsg(msgId, "切り替えませんでした。", false); return false;
    }
    setMsg(msgId, authErr(e), false); return false;
  }
}
async function loginGoogle(msgId) {
  await ensureAuth().catch(() => {});
  if (myProfile && auth.currentUser && auth.currentUser.isAnonymous &&
      !confirm(`いまこの画面には「${myProfile.nickname}」のマイページがあります。Google でログインすると、そちらに切り替わり、このマイページには戻れなくなります。続けますか？`)) return;
  setMsg(msgId, "Google のログイン画面を開いています…", true);
  try { await switchAccount(() => signInWithPopup(auth, gProvider())); } catch (e) { setMsg(msgId, authErr(e), false); }
}
// 別の自分に切り替えたら、その自分のグループ一覧を取ってきて、画面を読み直す
async function switchAccount(signIn) {
  const res = await signIn();
  me = res.user.uid; authReady = Promise.resolve(me);
  try { localStorage.setItem(LS_KEY, "[]"); localStorage.removeItem("dff_last"); localStorage.setItem("dff_me", "1"); } catch {}
  await restoreGroups();
  toast("ログインしました");
  history.replaceState(null, "", "/#me"); location.reload();
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
  const data = { nickname: p.nickname, icon: p.icon, color: okColor(p.color), photo: photoOk(p.photo) ? p.photo : "", bio: p.bio || "", private: !!p.private, updatedAt: serverTimestamp() };
  const wasPrivate = !!(myProfile && myProfile.private);
  if (wasPrivate === data.private) await setDoc(doc(db, "profiles", me), data);
  else {
    // 非公開／公開を切りかえたら、自分の公開の投稿の印（priv）も一緒に変える
    const mine = await getDocs(query(collection(db, "pubposts"), where("uid", "==", me), limit(400)));
    const b = writeBatch(db);
    b.set(doc(db, "profiles", me), data);
    mine.forEach(d => b.update(d.ref, { priv: data.private, updatedAt: serverTimestamp() }));
    await b.commit();
  }
  myProfile = { ...data }; myProfileLoaded = true; profCache.set(me, Promise.resolve(myProfile));
  try { localStorage.setItem("dff_me", "1"); } catch {}
  if (sync) await Promise.all(joinedGroups().map(g => updateDoc(doc(db, "groups", g.gid, "members", me), { nickname: data.nickname, icon: data.icon, color: data.color }).catch(() => {})));
  if (current) Object.assign(current, { nickname: data.nickname, icon: data.icon, color: data.color });
  if (!actUnsub) watchActivity();
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
// Apple Music の「曲そのもの」のリンク。サイトを作るとき（GitHub）に調べた表 applelinks.json を使い、
// 「聴く」ボタンが Apple Music の検索になっているものを、曲のページに置きかえる（iPhone では検索の仕組みが使えないため）
// 表は musiclinks.json：{ 曲のキー: { apple } }（ほかのアプリを足すときは LINK_OK にも足す）
let linkMap = null;
const songKey = s => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
fetch("musiclinks.json?h=" + Math.floor(Date.now() / 3600000), { cache: "no-store" })
  .then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(m => { linkMap = m && typeof m === "object" ? m : {}; upgradeLinks(); });
const LINK_OK = { apple: /^https:\/\/music\.apple\.com\/[a-z]{2}\/(album|song)\// };
function upgradeLinks() {
  if (!linkMap) return;
  document.querySelectorAll('a[data-music-app="apple"]:not([data-up])').forEach(a => {
    a.dataset.up = "1";
    const app = a.dataset.musicApp;
    let u, term = ""; try { u = new URL(a.href); } catch { return; }
    if (u.hostname === "music.apple.com" && u.pathname.endsWith("/search")) term = u.searchParams.get("term");
    const url = term && linkMap[songKey(term)] && linkMap[songKey(term)][app];
    if (typeof url === "string" && LINK_OK[app].test(url)) a.href = url;
  });
}
let hyTimer = null;
new MutationObserver(() => { clearTimeout(hyTimer); hyTimer = setTimeout(() => { hydrate(); upgradeLinks(); fillLikers(); }, 60); }).observe(document.body, { childList: true, subtree: true });

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
                          photo: p && photoOk(p.photo) ? p.photo : "", bio: (p && p.bio) || "", private: !!(p && p.private) });
const profileEditorHtml = cur => `
  <div class="pedit">
    <div class="ph-row"><span id="peAv">${bigAv(cur)}</span>
      <div class="actions"><button type="button" class="btn small" id="pePhoto">📷 写真を選ぶ</button><button type="button" class="btn small ghost" id="peNoPhoto" ${cur.photo ? "" : "hidden"}>写真をやめる</button>
        <input type="file" id="peFile" accept="image/*" hidden></div></div>
    <div class="lbl">写真を使わないときのアイコン ${pickerHtml("pePick", cur)}</div>
    <label>ニックネーム<input id="peNick" maxlength="20" value="${esc(cur.nickname)}" placeholder="例：みさき" autocomplete="nickname"></label>
    <label>ひとこと自己紹介（なくてもOK）<textarea id="peBio" maxlength="160" style="min-height:80px" placeholder="例：最近はシティポップばかり聴いています">${esc(cur.bio)}</textarea></label>
    <label class="check privrow"><input type="checkbox" id="pePriv" ${cur.private ? "checked" : ""}><span><b>🔒 非公開アカウント</b><br>
      <span class="note">オンにすると、あなたの「公開」の投稿は、<b>あなたが承認したフォロワーだけ</b>が見られます。フォローはリクエスト制になり、「お知らせ」で承認できます（グループの投稿はこれまでどおりメンバーに見えます）。</span></span></label>
    <div class="actions"><button class="btn" id="peSave">保存する</button><span class="msg" id="peMsg"></span></div>
    <p class="note">写真・ニックネーム・自己紹介は、非公開アカウントでも誰でも見られます。顔写真や、住所・学校名など個人が分かるものは載せないようにしましょう。</p>
  </div>`;
function bindProfileEditor(cur, onSaved) {
  const redraw = () => { $("peAv").innerHTML = bigAv(cur); $("peNoPhoto").hidden = !cur.photo; };
  bindPicker("pePick", cur, redraw);
  $("pePhoto").onclick = () => $("peFile").click();
  $("peFile").onchange = async () => {
    const f = $("peFile").files[0]; if (!f) return;
    setMsg("peMsg", "写真を準備しています…", true);
    try { cur.photo = await photoFromFile(f); redraw(); setMsg("peMsg", "「保存する」を押すと反映されます", true); }
    catch (e) { console.error(e); setMsg("peMsg", "この写真は使えませんでした。別の写真を選んでください。", false); }
    $("peFile").value = "";
  };
  $("peNoPhoto").onclick = () => { cur.photo = ""; redraw(); };
  $("peSave").onclick = async () => {
    cur.nickname = $("peNick").value.trim(); cur.bio = $("peBio").value.trim(); cur.private = $("pePriv").checked;
    if (!cur.nickname) return setMsg("peMsg", "ニックネームを入れてください。", false);
    $("peSave").disabled = true; setMsg("peMsg", "保存しています…", true);
    try { await saveProfile(cur, true); toast("保存しました"); onSaved && onSaved(); }
    catch (e) { console.error(e); setMsg("peMsg", "保存できませんでした。少し待ってからもう一度押してください。", false); $("peSave").disabled = false; }
  };
}

// ===== フォロー =====
const followId = to => `${me}_${to}`;
const isApproved = d => d.approved !== false;   // 前からあるフォロー（approved がない）は承認済みとして扱う
// フォロー中（承認済みだけ）／フォロワー（承認済みだけ）
async function myFollowing() { return (await myFollowingAll()).filter(x => x.ok).map(x => x.to); }
async function myFollowingAll() { await ensureAuth(); const s = await getDocs(query(collection(db, "follows"), where("from", "==", me), limit(500))); return s.docs.map(d => ({ to: d.data().to, ok: isApproved(d.data()) })); }
async function myFollowersAll() { await ensureAuth(); const s = await getDocs(query(collection(db, "follows"), where("to", "==", me), limit(500))); return s.docs.map(d => ({ from: d.data().from, ok: isApproved(d.data()) })); }
async function myFollowers() { return (await myFollowersAll()).filter(x => x.ok).map(x => x.from); }
// フォローする／やめる。相手が非公開アカウントなら「リクエスト」になる。戻り値："on"（フォロー中）・"req"（リクエスト済み）・""（していない）
async function setFollow(to, on) {
  await ensureAuth();
  if (on) {
    profCache.delete(to); const p = await getProfile(to);
    const approved = !(p && p.private);
    await setDoc(doc(db, "follows", followId(to)), { from: me, to, approved, createdAt: serverTimestamp() });
    sendNotif(to, `follow_${me}`, true, { type: approved ? "follow" : "request", title: "", image: "", kind: "", gid: "", pid: "" });
    return approved ? "on" : "req";
  }
  await deleteDoc(doc(db, "follows", followId(to)));
  sendNotif(to, `follow_${me}`, false);
  return "";
}
// フォローリクエストを承認する／断る（非公開アカウントの本人）
async function answerRequest(from, ok) {
  await ensureAuth();
  if (ok) {
    await updateDoc(doc(db, "follows", `${from}_${me}`), { approved: true });
    sendNotif(from, `accept_${me}`, true, { type: "accept", title: "", image: "", kind: "", gid: "", pid: "" });
  } else await deleteDoc(doc(db, "follows", `${from}_${me}`));
  try { await deleteDoc(doc(db, "notifs", me, "items", `follow_${from}`)); } catch {}
}

// ===== 通知（いいね・フォローされたら、相手の「お知らせ」に届く） =====
// 届け先：notifs/{相手}/items/{like_投稿ID_自分 / follow_自分}。取り消したら自分で消す
const myCard = () => ({ name: (myProfile && myProfile.nickname) || "ゲスト", icon: (myProfile && myProfile.icon) || "🎧", color: okColor(myProfile && myProfile.color) });
async function sendNotif(to, nid, on, data) {
  if (!to || to === me) return;
  const ref = doc(db, "notifs", to, "items", nid);
  try {
    if (!on) { await deleteDoc(ref); return; }
    if (!myProfileLoaded) await loadMyProfile().catch(() => {});
    await setDoc(ref, { ...data, from: me, ...myCard(), createdAt: serverTimestamp(), read: false });
  } catch (e) { console.warn("通知を送れませんでした", e && e.code); }
}
const sendLikeNotif = (p, on) => p && sendNotif(p.uid, `like_${p.id}_${me}`, on, {
  type: "like", title: String(p.title || "").slice(0, 100), image: /^https:\/\/[^\s"<>]+$/.test(p.image || "") && p.image.length <= 500 ? p.image : "",
  kind: p._src.kind, gid: p._src.gid || "", pid: p.id });

// 未読のお知らせの数を、メニューの「お知らせ」に出す
let actUnsub = null;
async function watchActivity() {
  let hasMe = false; try { hasMe = localStorage.getItem("dff_me") === "1"; } catch {}
  if (!hasMe && !joinedGroups().length) return;   // まだ何もしていない人は、ログインしない
  try { await ensureAuth(); } catch { return; }
  syncGroupsSoon();   // 前から使っている人のグループ一覧も、引き継ぎ用に保存しておく
  if (actUnsub) actUnsub();
  actUnsub = onSnapshot(query(collection(db, "notifs", me, "items"), where("read", "==", false), limit(99)),
    s => window.DF && window.DF.setActBadge && window.DF.setActBadge(s.size), () => {});
}
// state：true または "on"（フォロー中）・"req"（リクエスト済み）・それ以外（フォローしていない）
const FOL_LABEL = { on: "フォロー中", req: "リクエスト済み", "": "フォローする" };
const folState = s => (s === true || s === "on" ? "on" : s === "req" ? "req" : "");
const followBtn = (uid, state) => { const s = folState(state); return `<button class="btn small ${s ? "ghost" : ""}" data-fol="${esc(uid)}" data-on="${s}">${FOL_LABEL[s]}</button>`; };
const userRow = (uid, p, extra = "") => `<div class="urow"><a href="${esc(userHash(uid))}">${av(p && p.icon, p && p.color, uid)}<span>${esc((p && p.nickname) || "（プロフィールなし）")}</span></a>${extra}</div>`;
// フォローボタンを押したとき（プロフィールがまだなら先に作ってもらう）
function bindFollowBtns(el, after) {
  el.querySelectorAll("[data-fol]").forEach(b => b.onclick = async () => {
    const uid = b.dataset.fol, on = !b.dataset.on;
    if (on && !(await loadMyProfile().catch(() => null))) return askProfile("フォローするには、先にあなたのプロフィールを作ってください。", () => after && after());
    b.disabled = true;
    try {
      const s = await setFollow(uid, on);
      b.dataset.on = s; b.textContent = FOL_LABEL[s]; b.classList.toggle("ghost", !!s);
      toast(s === "on" ? "フォローしました" : s === "req" ? "フォローをリクエストしました（相手が承認すると投稿が見られます）" : "フォローをやめました");
      after && after(uid, s === "on", s);
    }
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
  if (view === "activity") return activityView();
  if (view.startsWith("u=")) return userView(decodeURIComponent(view.slice(2)));
  if (view === "admin") return adminView();
  if (view === "feedback") return feedbackView();
  return groupView();
}

// ===== 投稿の表示（グループの投稿・公開の投稿で共通） =====
// p._src = { kind: "pub" } または { kind: "group", gid, gname }
const shown = new Map();
const keyOf = p => `${p._src.kind}:${p._src.gid || ""}:${p.id}`;
const tag = (snapDocs, src) => snapDocs.map(d => ({ id: d.id, ...d.data(), _src: src }));
const postRef = (store, p) => (p._src.kind === "pub" ? doc(store, "pubposts", p.id) : doc(store, "groups", p._src.gid, "posts", p.id));
const songRef = (store, p) => doc(store, "songs", p._src.kind === "pub" ? "pub_" + p.id : songId(p._src.gid, p.id));
const likedByMe = p => !!(me && p.likes && p.likes[me]);
let members = {};   // 開いているグループのメンバー（いいねした人の名前用）
// インスタ風のハート（いいね前は線だけ、いいねすると赤く塗られる）
const HEART = `<svg class="hrt" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.4-4.5-9.4-8.9C1.1 8.4 3 4.6 6.7 4.6c2.2 0 3.9 1.3 5.3 3.1 1.4-1.8 3.1-3.1 5.3-3.1 3.7 0 5.6 3.8 4.1 7-2 4.4-9.4 8.9-9.4 8.9z"/></svg>`;
const likeBtn = p => { shown.set(keyOf(p), p); return `<button class="like ${likedByMe(p) ? "on" : ""}" data-like="${esc(keyOf(p))}" aria-pressed="${likedByMe(p)}" aria-label="いいね">${HEART}<span class="lc">${likeCount(p) || ""}</span></button>`; };
// 「みさきさん、他2人が「いいね！」しました」（名前は後から入れる：fillLikers）
const likersHtml = p => likeCount(p) ? `<div class="likers" data-likers="${esc(Object.keys(p.likes).join(","))}"></div>` : "";
async function fillLikers() {
  const els = [...document.querySelectorAll(".likers[data-likers]:not([data-f])")];
  for (const el of els) {
    el.dataset.f = "1";
    const uids = el.dataset.likers.split(",").filter(Boolean); if (!uids.length) continue;
    // 自分がいいねしていたら自分を先に、そうでなければフォロー中・メンバーを先に
    uids.sort((a, b) => (b === me) - (a === me) || (!!members[b]) - (!!members[a]));
    const nameOf = async u => u === me ? "あなた" : ((members[u] && members[u].nickname) || ((await getProfile(u)) || {}).nickname || "だれか");
    const first = await nameOf(uids[0]);
    el.innerHTML = `${HEART}<span><b>${esc(first)}</b>${first === "あなた" ? "" : "さん"}${uids.length > 1 ? `、<button type="button" class="more-likers">他${uids.length - 1}人</button>` : ""}が「いいね！」しました</span>`;
    const mb = el.querySelector(".more-likers");
    if (mb) mb.onclick = async () => { const names = await Promise.all(uids.map(nameOf)); el.querySelector("span").innerHTML = `<b>${names.map(esc).join("、")}</b> が「いいね！」しました`; };
  }
}
const srcLabel = p => (p._src.kind === "pub" ? `<span class="src">🌐 公開</span>` : `<span class="src">👥 ${esc(p._src.gname || "グループ")}</span>`);

function postHtml(p, { canDelete = false, showSrc = false } = {}) {
  shown.set(keyOf(p), p);
  const k = esc(keyOf(p)), mine = me && p.uid === me, link = safeLink(p.link);
  return `
    <article class="post" data-k="${k}">
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
          ${likersHtml(p)}
          ${isPublicSong(p) ? `<div class="pub">🌐 曲名だけ「みんなのプレイリスト」に載っています</div>` : ""}
        </div>
      </div>
    </article>`;
}
// いいね・編集・削除のボタンを動かす。redraw：いいね後に描き直す（自動で更新されない画面用） reload：削除・編集後に読み直す
function bindPostOps(el, { redraw, reload } = {}) {
  el.querySelectorAll("[data-like]").forEach(b => b.onclick = async () => { await toggleLike(shown.get(b.dataset.like), b); redraw && redraw(); });
  // インスタのように、ジャケットをダブルタップでいいね（すでにいいね済みなら、ハートが出るだけ）
  el.querySelectorAll("article.post[data-k] > .cover").forEach(c => {
    let last = 0;
    c.addEventListener("pointerup", async () => {
      const now = Date.now(); if (now - last > 320) { last = now; return; } last = 0;
      const art = c.closest("article"), p = shown.get(art.dataset.k), btn = art.querySelector("[data-like]");
      const burst = document.createElement("div"); burst.className = "burst"; burst.innerHTML = HEART; c.append(burst); setTimeout(() => burst.remove(), 900);
      if (p && btn && !likedByMe(p)) { await toggleLike(p, btn); redraw && redraw(); }
    });
  });
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
      // 押した手応え：ハートをその場で赤くして、ぽんっと動かす（すぐに自動で描き直されることもある）
      btn.classList.toggle("on", on); btn.classList.remove("pop"); void btn.offsetWidth; if (on) btn.classList.add("pop");
      const lc = btn.querySelector(".lc"); if (lc) lc.textContent = Object.keys(next).length || "";
      sendLikeNotif(p, on);
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

// グループの切り替え：入っているグループをボタンで並べ、その後ろに「＋ 新しく作る」「🔗 招待で参加」
// mode：今いる画面（"new" = 作る画面、"join" = 参加の画面、それ以外 = グループの中）
const groupSelectHtml = (mode) => {
  const gs = loadGroups();
  return `<div class="gswitch" role="tablist" aria-label="グループを選ぶ">${gs.map(g => `<button type="button" data-g="${esc(g.gid)}" class="${!mode && current && g.gid === current.gid ? "on" : ""}">${esc(g.name || "（参加前）")}</button>`).join("")}<button type="button" data-g="__new" class="add ${mode === "new" ? "on" : ""}">＋ 新しく作る</button><button type="button" data-g="__join" class="add ${mode === "join" ? "on" : ""}">🔗 招待で参加</button></div>`;
};
function bindGroupSelect() {
  root.querySelectorAll(".gswitch [data-g]").forEach(b => b.onclick = () => {
    stop(); const v = b.dataset.g;
    if (v === "__new" || v === "__join") return welcome(v.slice(2));
    const g = loadGroups().find(x => x.gid === v); if (g) groupView(g.gid, g.key);
  });
}

// ===== 招待リンクを貼り付けて参加 =====
// iPhone では、ホーム画面のアイコンと Safari が別々の「自分」を覚えている。
// アイコンで使っている人が LINE の招待リンクを押すと Safari が開いてしまうので、リンクをコピーしてここに貼ってもらう。
const isStandalone = () => window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
function parseInvite(text) {
  const m = String(text || "").match(/[#&?]g=([A-Za-z0-9_-]{1,64})&k=([A-Za-z0-9]{20,64})/);
  return m ? { gid: m[1], key: m[2] } : null;
}
const pasteJoinHtml = () => `
  <div class="panel paste-join" id="pasteJoin">
    <h2>🔗 招待リンクをもらった人</h2>
    <p>LINE などで届いた<b>招待リンクをコピーして、ここに貼り付け</b>、「参加する」を押してください。</p>
    <div class="invite"><input id="pjUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://dailyfind.github.io/…"><button type="button" class="btn small ghost" id="pjPaste">📋 貼り付け</button></div>
    <div class="actions"><button class="btn" id="pjGo">参加する</button><span class="msg" id="pjMsg"></span></div>
    <details class="howto"><summary>リンクのコピーのしかた（iPhone）</summary>
      <ol><li>LINE のトークで、招待リンクを<b>長押し</b>する</li>
        <li>出てきたメニューの「<b>コピー</b>」を押す</li>
        <li>DAILY FIND に戻って「<b>📋 貼り付け</b>」を押す（または上の欄を長押しして「ペースト」）</li></ol></details>
    <p class="note">${isStandalone()
      ? "💡 いまはホーム画面のアイコンから開いています。LINE の招待リンクをそのまま押すと Safari が開いてしまい、<b>このアイコンの方では参加できません</b>。リンクは押さずにコピーして、ここに貼り付けてください。"
      : "💡 ホーム画面のアイコンから DAILY FIND を使っている人は、招待リンクを押さずにコピーして、アイコンから開いたこの画面に貼り付けてください（Safari とアイコンでは、参加しているグループが別々になるため）。"}</p>
  </div>`;
function bindPasteJoin() {
  $("pjPaste").onclick = async () => {
    try { const t = await navigator.clipboard.readText(); $("pjUrl").value = t.trim(); setMsg("pjMsg", parseInvite(t) ? "貼り付けました。「参加する」を押してください。" : "招待リンクではないようです。", !!parseInvite(t)); }
    catch { $("pjUrl").focus(); setMsg("pjMsg", "上の欄を長押しして「ペースト」を選んでください。", false); }
  };
  $("pjGo").onclick = () => {
    const inv = parseInvite($("pjUrl").value);
    if (!inv) return setMsg("pjMsg", "招待リンクが読み取れませんでした。LINE で届いたリンクをそのままコピーして貼り付けてください。", false);
    rememberGroup(inv.gid, inv.key); stop(); groupView(inv.gid, inv.key);
  };
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

// mode："new" = 新しく作る画面（作る欄が上）、"join" = 招待で参加の画面（貼り付け欄が上）
function welcome(mode) {
  current = null;
  whoDraft = { icon: pickOne(EMOJIS), color: pickOne(COLORS) };
  const has = loadGroups().length;
  const createHtml = `
    <div class="panel create-panel">
      <h2>➕ ${has ? "新しいグループを作る" : "自分でグループを作る"}</h2>
      <p>仲のいい友達だけのグループを作れます。${has ? "グループはいくつでも作れます（例：クラスの友達、部活、家族など）。" : ""}作ったあとに出る招待リンクを LINE などで送ると、友達はそのリンクを開くだけで参加できます。メールアドレスもパスワードも要りません。</p>
      <label>グループの名前<input id="gName" maxlength="30" placeholder="例：いつもの4人"></label>
      ${whoHtml("g")}
      <div class="actions"><button class="btn" id="gCreate">グループを作る</button><span class="msg" id="gMsg"></span></div>
      <p class="note">グループの投稿は、メンバーとサイトの管理者にしか見えません。</p>
    </div>`;
  root.innerHTML = `
    ${has ? groupSelectHtml(mode === "join" ? "join" : "new") : ""}
    ${mode === "new" ? createHtml + pasteJoinHtml() : pasteJoinHtml() + createHtml}`;
  if (!myProfile) bindPicker("gPick", whoDraft);
  bindGroupSelect(); bindPasteJoin();
  if (mode === "join") setTimeout(() => $("pjUrl") && $("pjUrl").focus(), 200);
  if (mode === "new") setTimeout(() => $("gName") && $("gName").focus({ preventScroll: true }), 200);
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
      <p>${myProfile ? "「参加する」を押すだけで参加できます。" : "ニックネームとアイコンを決めるだけで参加できます。メールアドレスもパスワードも要りません。"}</p>
      ${whoHtml("j")}
      <div class="actions"><button class="btn" id="jGo">参加する</button><span class="msg" id="jMsg"></span></div>
      <p class="note">グループの投稿は、メンバーとサイトの管理者だけが見られます。</p>
    </div>
    ${isIOS && !isStandalone() ? `
    <div class="panel tip-panel">
      <h2>📱 ホーム画面のアイコンで使っている人へ</h2>
      <p>いまは Safari で開いています。iPhone では Safari とホーム画面のアイコンで「自分」が別々なので、ここで参加すると<b>アイコンの方では参加していないことになります</b>。</p>
      <p>アイコンで使いたい人は、ここでは参加せずに、下のボタンでリンクをコピーしてください。そのあとホーム画面のアイコンから DAILY FIND を開き、「グループ」→「🔗 招待で参加」の欄に貼り付けて参加します。</p>
      <div class="actions"><button class="btn small" id="jCopy">招待リンクをコピー</button><span class="msg" id="jCopyMsg"></span></div>
      <p class="note">まだホーム画面に追加していない人は、先に追加してから、アイコンの方で参加するのがおすすめです。</p>
    </div>` : ""}`;
  if ($("jCopy")) $("jCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(inviteUrl(gid, key)); setMsg("jCopyMsg", "コピーしました。ホーム画面のアイコンから開いて貼り付けてください。", true); }
    catch { prompt("このリンクをコピーしてください", inviteUrl(gid, key)); }
  };
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
    ${groupSelectHtml()}
    <div class="bar">
      <h2>${esc(current.name)}</h2>
      <div class="actions"><button class="btn small ghost" id="inviteBtn">友達を招待</button><button class="btn small" id="newBtn">＋ 投稿する</button></div>
    </div>
    <div class="members" id="members"></div>
    <div class="panel" id="invitePanel" hidden style="margin-bottom:20px">
      <h2>招待リンク</h2>
      <p>このリンクを LINE などで友達に送ってください。開くだけで参加できます。リンクを知っている人は誰でも参加できるので、送る相手に気をつけてください。</p>
      <div class="invite"><input id="invUrl" readonly value="${esc(inviteUrl(current.gid, current.key))}"><button class="btn small" id="copyInv">コピー</button></div>
      <div class="actions"><button class="btn small" id="copyInvMsg">説明つきでコピー</button><a class="btn small ghost" href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(inviteUrl(current.gid, current.key))}" target="_blank" rel="noopener">LINE で送る</a><span class="msg" id="invMsg"></span></div>
      <p class="note">📱 iPhone でホーム画面のアイコンから使っている友達は、リンクを押すと Safari が開いてしまい、アイコンの方では参加できません。「説明つきでコピー」で送ると、その場合のやり方（リンクをコピーして「グループ」の欄に貼る）も一緒に伝わります。</p>
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
  // LINE にそのまま貼れる、説明つきの招待メッセージ
  const inviteMessage = () => `DAILY FIND のグループ「${current.name}」に招待します！\n${$("invUrl").value}\n\n▼ iPhone でホーム画面のアイコンから DAILY FIND を使っている人は\nこのリンクは押さずに長押し→「コピー」して、アイコンから開いた DAILY FIND の「グループ」→「🔗 招待で参加」に貼り付けてね`;
  $("copyInvMsg").onclick = async () => { try { await navigator.clipboard.writeText(inviteMessage()); toast("説明つきでコピーしました。LINE に貼り付けて送ってください"); } catch { prompt("この文をコピーしてください", inviteMessage()); } };
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

// ===== 投稿フォーム（公開・グループ共通） =====
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
  const draft = post ? { ...post } : { category: "", title: "", by: "", oneline: "", link: "", image: "", rating: 4, public: true };
  // ① まずカテゴリを選ぶ（インスタの「何を投稿する？」のように）
  if (!post && !draft.category) {
    c.innerHTML = `
      <h2 class="cmp-h">何をシェアする？</h2>
      <div class="catpick">${Object.keys(CATS).map(k => `<button type="button" data-cat="${k}"><span class="ce">${CAT_EMOJI[k] || "✨"}</span><b>${k}</b></button>`).join("")}</div>
      <div class="actions"><button class="btn ghost small" id="cancel" type="button">やめる</button></div>`;
    c.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { draft.category = b.dataset.cat; drawForm(); });
    $("cancel").onclick = () => { c.hidden = true; c.innerHTML = ""; };
    c.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  drawForm();

  // ② カテゴリに合わせた入力欄
  function drawForm() {
  const H = CAT_HINT[draft.category] || CAT_HINT["その他"], isMusic = draft.category === "音楽";
  const oneLabel = () => (target.kind === "pub" ? "ひとこと（誰でも見られます）" : "ひとこと（グループの人だけに見えます）");
  c.innerHTML = `
    ${post ? `<p class="note">${target.kind === "pub" ? "🌐 公開の投稿" : "👥 " + esc(target.gname || "グループ") + " への投稿"}を編集しています</p>`
      : `<label>投稿先<select id="fTo"><option value="pub">🌐 公開（${myProfile && myProfile.private ? "🔒 非公開アカウントなので、承認したフォロワーだけ" : "誰でも見られる・「見つける」に載る"}）</option>${groups.map(g => `<option value="${esc(g.gid)}" ${target.kind === "group" && target.gid === g.gid ? "selected" : ""}>👥 ${esc(g.name)}（グループの人だけ）</option>`).join("")}</select></label>`}
    <div class="catrow">${Object.keys(CATS).map(k => `<button type="button" data-cat="${k}" class="${k === draft.category ? "on" : ""}">${CAT_EMOJI[k] || ""} ${k}</button>`).join("")}</div>
    ${isMusic ? `<input id="mq" type="search" enterkeyhint="search" placeholder="🎵 曲名やアーティスト名で探す" autocomplete="off">` : ""}
    <div class="suggest" id="suggest" hidden></div>
    <div class="picked"><div id="pv"></div><div class="note">${isMusic ? "曲名を入れて候補から選ぶと、タイトル・ジャケット・リンクが自動で入ります。" : `下に${esc(H.title)}などを書いてください。`}<br><button type="button" class="txt" id="srcMine">DAILY FIND の記事から選ぶ</button></div></div>
    <label>${esc(H.title)}<input id="fTitle" maxlength="100" value="${esc(draft.title)}" placeholder="${esc(H.tph)}"></label>
    <label>${esc(H.by)}<input id="fBy" maxlength="100" value="${esc(draft.by)}" placeholder="${esc(H.bph)}"></label>
    <label><span id="oneLbl">${oneLabel()}</span><input id="fOne" maxlength="200" value="${esc(draft.oneline)}" placeholder="${esc(H.oph)}"></label>
    <div class="lbl" role="group" aria-label="評価">評価<div class="rate" id="rate">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="星${n}">★</button>`).join("")}</div></div>
    <label>リンク（なくてもOK）<input id="fLink" type="text" inputmode="url" autocapitalize="off" autocorrect="off" maxlength="500" value="${esc(draft.link)}" placeholder="${esc(H.lph)}"></label>
    <label class="check" id="pubRow"><input type="checkbox" id="fPub" ${draft.public !== false ? "checked" : ""}><span>曲を「みんなのプレイリスト」にも載せる<br><span class="note">載るのは曲名・アーティスト・ジャケット・リンク・いいね数だけです。誰が投稿したかは載りません。</span></span></label>
    <div class="actions"><button class="btn" id="post">${post ? "更新する" : "シェアする"}</button><button class="btn ghost" id="cancel" type="button">やめる</button><span class="msg" id="pMsg"></span></div>`;
  if ($("fTo")) $("fTo").onchange = () => {
    const v = $("fTo").value, g = groups.find(x => x.gid === v);
    target = g ? { kind: "group", gid: g.gid, gname: g.name } : { kind: "pub" };
    $("oneLbl").textContent = oneLabel();
  };
  // カテゴリを変えたら、入力中の内容を残して欄を作り直す
  c.querySelectorAll(".catrow [data-cat]").forEach(b => b.onclick = () => {
    Object.assign(draft, { title: $("fTitle").value, by: $("fBy").value, oneline: $("fOne").value, link: $("fLink").value, public: $("fPub").checked });
    if ($("fTo")) { const v = $("fTo").value, g = groups.find(x => x.gid === v); target = g ? { kind: "group", gid: g.gid, gname: g.name } : { kind: "pub" }; }
    draft.category = b.dataset.cat; drawForm();
  });
  if ($("fTo")) $("fTo").value = target.kind === "group" ? target.gid : "pub";
  const drawRate = () => c.querySelectorAll("#rate button").forEach(b => b.classList.toggle("on", +b.dataset.n <= draft.rating));
  const drawPv = () => { $("pv").innerHTML = cover({ title: $("fTitle").value || H.title, category: draft.category, image: draft.image }); $("pubRow").hidden = !isMusic; };
  $("rate").onclick = e => { const b = e.target.closest("button[data-n]"); if (b) { draft.rating = +b.dataset.n; drawRate(); } };
  $("fTitle").oninput = drawPv;
  drawRate(); drawPv(); c.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!post) setTimeout(() => ($("mq") || $("fTitle")).focus({ preventScroll: true }), 350);   // すぐ打てるように

  let seq = 0, timer = null, results = [];
  const sug = $("suggest");
  const showResults = (list, footer) => {
    results = list; sug.hidden = false;
    sug.innerHTML = list.length ? list.map((r, i) => `<div class="s-item" data-i="${i}">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : cover(r)}
      <div><div class="s-t">${esc(r.title)}</div><div class="s-a">${esc(r.by || "")}</div></div></div>`).join("") + (footer ? `<div class="s-msg">${esc(footer)}</div>` : "")
      : `<div class="s-msg">見つかりませんでした。</div>`;
    sug.querySelectorAll(".s-item").forEach(el => el.onclick = () => {
      const r = results[+el.dataset.i];
      $("fTitle").value = r.title; $("fBy").value = r.by || "";
      if (r.link) $("fLink").value = r.link;
      if (r.oneline && !$("fOne").value) $("fOne").value = r.oneline;
      if (r.rating) { draft.rating = r.rating; drawRate(); }
      draft.image = r.image || ""; sug.hidden = true; if ($("mq")) $("mq").value = "";
      if (r.category && r.category !== draft.category) {   // 記事のカテゴリに合わせる
        Object.assign(draft, { title: r.title, by: r.by || "", oneline: $("fOne").value, link: $("fLink").value, category: r.category }); return drawForm();
      }
      drawPv();
    });
  };
  const runSearch = async () => {
    const q = $("mq").value.trim(); const my = ++seq;
    if (!q) { sug.hidden = true; return; }
    sug.hidden = false; sug.innerHTML = `<div class="s-msg">探しています…</div>`;
    try { const r = await searchSongs(q); if (my === seq) showResults(r); } catch { if (my === seq) sug.innerHTML = `<div class="s-msg">曲の検索につながりませんでした。</div>`; }
  };
  if ($("mq")) {
    $("mq").addEventListener("input", e => { if (e.isComposing) return; clearTimeout(timer); timer = setTimeout(runSearch, 450); });
    $("mq").addEventListener("compositionend", () => { clearTimeout(timer); timer = setTimeout(runSearch, 300); });
    $("mq").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); runSearch(); } });
  }
  $("srcMine").onclick = async () => {
    try {
      const picks = (await (await fetch("picks.json?v=" + Date.now(), { cache: "no-store" })).json()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const abs = img => /^images\/[\w.-]+$/.test(img || "") ? `https://dailyfind.github.io/${img}` : (/^https:\/\//.test(img || "") ? img : "");
      const mine = picks.filter(p => p.category === draft.category);
      showResults((mine.length ? mine : picks).map(p => ({ title: p.title, by: p.by, category: p.category, oneline: p.oneline, rating: p.rating, link: safeLink(p.link), image: abs(p.image), thumb: abs(p.image) })), "DAILY FIND の記事");
    } catch { showResults([], ""); }
  };
  $("cancel").onclick = () => { c.hidden = true; c.innerHTML = ""; };
  $("post").onclick = async () => {
    const who = post ? { nickname: post.nickname, icon: post.icon, color: post.color } : { nickname: myProfile.nickname, icon: myProfile.icon, color: myProfile.color };
    const link = normLink($("fLink").value);
    const data = {
      uid: me, ...who,
      category: draft.category, title: $("fTitle").value.trim(), by: $("fBy").value.trim(), oneline: $("fOne").value.trim(), link: link || "",
      image: /^https:\/\//.test(draft.image || "") ? draft.image : "", rating: draft.rating | 0, public: isMusic && $("fPub").checked,
    };
    if (!data.title) return setMsg("pMsg", `${H.title}を入れてください。`, false);
    if (link === null) return setMsg("pMsg", "リンクが読み取れませんでした。http:// や https:// から始まるアドレス（または www. から始まるアドレス）を入れてください。", false);
    if (target.kind === "pub") data.priv = !!(myProfile && myProfile.private);   // 非公開アカウントの投稿には印をつける
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
      toast(post ? "更新しました" : (isPub ? "公開しました！" : "グループにシェアしました！"));
      after && after(target);
    } catch (e) { console.error(e); setMsg("pMsg", "シェアできませんでした。少し待ってからもう一度押してください。", false); $("post").disabled = false; }
  };
  }   // drawForm のおわり
}

// カテゴリごとの絵文字と、入力欄の言葉
const CAT_EMOJI = { "音楽": "🎵", "本": "📚", "映画": "🎬", "お店": "🍽️", "アニメ": "📺", "ゲーム": "🎮", "その他": "✨" };
const CAT_HINT = {
  "音楽": { title: "曲名", tph: "例：BLOW", by: "アーティスト", bph: "例：Ed Sheeran", oph: "例：夕日を見ながら聴きたい曲", lph: "Apple Music や YouTube のリンク（なくてもOK）" },
  "本": { title: "本のタイトル", tph: "例：君たちはどう生きるか", by: "作者", bph: "例：吉野源三郎", oph: "例：迷ったときに読み返したい本", lph: "本の紹介ページのリンク（なくてもOK）" },
  "映画": { title: "映画のタイトル", tph: "例：千と千尋の神隠し", by: "監督・出演", bph: "例：宮崎駿", oph: "例：何回見ても泣ける", lph: "予告編や作品ページのリンク（なくてもOK）" },
  "お店": { title: "お店の名前", tph: "例：〇〇カフェ", by: "場所・エリア", bph: "例：渋谷", oph: "例：プリンが絶品", lph: "お店のページや地図のリンク（なくてもOK）" },
  "アニメ": { title: "アニメのタイトル", tph: "例：葬送のフリーレン", by: "制作・原作", bph: "例：マッドハウス", oph: "例：静かに泣ける", lph: "作品ページや配信のリンク（なくてもOK）" },
  "ゲーム": { title: "ゲームのタイトル", tph: "例：スプラトゥーン3", by: "メーカー・機種", bph: "例：Nintendo Switch", oph: "例：友達とやると最高", lph: "ゲームのページのリンク（なくてもOK）" },
  "その他": { title: "タイトル", tph: "例：おすすめのもの", by: "作者・場所など", bph: "", oph: "例：ここが好き", lph: "リンク（なくてもOK）" },
};
// リンクを読み取る：http:// と https:// はそのまま、「www.〜」や「example.com/〜」は https:// をつける。読めなければ null
function normLink(v) {
  v = String(v || "").trim();
  if (!v) return "";
  if (/^https?:\/\/[^\s"<>]+$/i.test(v)) return v;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#][^\s"<>]*)?$/i.test(v)) return "https://" + v;
  return null;
}

// ===== 見つける（新着・フォロー中・みんなのプレイリスト） =====
let allTab = "new", pubSort = "new";
const songRow = (s, i, extra = "") => `
  <div class="tr"><span class="no">${String(i + 1).padStart(2, "0")}</span>${cover({ title: s.title, category: "音楽", image: s.image })}
    <div class="ft"><b>${esc(s.title)}</b><small>${esc(s.by || "")}</small></div>
    <div class="end">${s.likeCount ? `<span class="cnt">♥ ${s.likeCount | 0}</span>` : ""}${listenHtml(s, false)}${extra}</div></div>`;
async function allView() {
  current = null;
  root.innerHTML = `
    <div class="bar"><h2>見つける</h2><div class="actions"><button class="btn small" id="newBtn">＋ 投稿する</button></div></div>
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
    unsubs.push(onSnapshot(query(collection(db, "pubposts"), where("priv", "==", false), orderBy("createdAt", "desc"), limit(60)), snap => {
      const list = tag(snap.docs, { kind: "pub" });
      body.innerHTML = `<p class="note" style="margin:0 0 6px">公開された投稿が新しい順に並びます。名前を押すと、その人のページを見たりフォローしたりできます。</p>`
        + (list.length ? list.map(p => postHtml(p)).join("") : `<p class="empty">まだ投稿がありません。「＋ 投稿する」から、最初の1つをシェアしましょう。</p>`);
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
// フォローしている人の「公開の投稿」をまとめて出す
async function followFeed(body) {
  let tos = [];
  try { tos = await myFollowing(); } catch { body.innerHTML = `<p class="empty">読み込めませんでした。</p>`; return; }
  if (allTab !== "follow") return;
  if (!tos.length) { body.innerHTML = `<p class="empty">まだ誰もフォローしていません。「新着」で気になる人の名前を押して、その人のページでフォローしてみましょう。</p>`; return; }
  await watchFollowPosts(tos, list => {
    if (allTab !== "follow") return;
    list = list.slice(0, 100);
    body.innerHTML = list.length ? list.map(p => postHtml(p)).join("") : `<p class="empty">フォローしている人の投稿はまだありません。</p>`;
    bindPostOps(body);
  }, unsubs);
}
// フォローしている人（承認済み）の公開の投稿を見張る。公開アカウントの人はまとめて、非公開アカウントの人は1人ずつ読む
async function watchFollowPosts(tos, onData, unsubList, max = 100) {
  const parts = {};
  const emit = () => onData(sortNew(Object.values(parts).flat()));
  const profs = await Promise.all(tos.map(u => getProfile(u)));
  const pub = tos.filter((u, i) => !(profs[i] && profs[i].private)), priv = tos.filter((u, i) => profs[i] && profs[i].private);
  for (let i = 0; i < pub.length; i += 30) {
    const k = "p" + i;
    unsubList.push(onSnapshot(query(collection(db, "pubposts"), where("uid", "in", pub.slice(i, i + 30)), where("priv", "==", false), limit(max)),
      s => { parts[k] = tag(s.docs, { kind: "pub" }); emit(); }, e => { console.warn(e); parts[k] = []; emit(); }));
  }
  priv.forEach(u => unsubList.push(onSnapshot(query(collection(db, "pubposts"), where("uid", "==", u), limit(50)),
    s => { parts["v" + u] = tag(s.docs, { kind: "pub" }); emit(); }, e => { console.warn(e); parts["v" + u] = []; emit(); })));
  if (!tos.length) emit();
}

// ===== ある人の投稿をまとめて読む（公開の投稿＋自分も入っているグループでの投稿） =====
// 非公開アカウントで、まだ承認されていないときは out.locked = true（投稿は見られない）
async function loadPostsOf(uid) {
  const out = [];
  let q = query(collection(db, "pubposts"), where("uid", "==", uid), limit(100));
  if (uid !== me) {
    const p = await getProfile(uid);
    if (!(p && p.private)) q = query(collection(db, "pubposts"), where("uid", "==", uid), where("priv", "==", false), limit(100));
  }
  try { out.push(...tag((await getDocs(q)).docs, { kind: "pub" })); } catch (e) { if (e && e.code === "permission-denied") out.locked = true; else console.error(e); }
  await Promise.all(joinedGroups().map(async g => {
    try { out.push(...tag((await getDocs(query(collection(db, "groups", g.gid, "posts"), where("uid", "==", uid), limit(100)))).docs, { kind: "group", gid: g.gid, gname: g.name })); } catch {}
  }));
  const locked = out.locked; const sorted = sortNew(out); sorted.locked = locked;
  return sorted;
}

// ===== マイページ =====
let meTab = "posts";
async function meView() {
  current = null;
  root.innerHTML = LOADING;
  try { await ensureAuth(); await loadMyProfile(true); } catch { root.innerHTML = `<p class="empty">つながりませんでした。通信状況を確認して、開き直してください。</p>`; return; }
  if (!myProfile) {
    const cur = profDraft(null);
    root.innerHTML = `
      <div class="panel acct" style="margin-bottom:20px">
        <h2>🔑 前に DAILY FIND を使っていた人</h2>
        <p>マイページを Google とつないでいた人は、Google でログインすると、そのマイページ・グループ・フォローに戻れます（Safari で作ったマイページを、ホーム画面のアイコンで使いたいときも）。</p>
        <div class="actions"><button class="btn gbtn" id="gLogin">${G_LOGO}Google でログイン</button><span class="msg" id="gLoginMsg"></span></div>
      </div>
      <div class="panel"><h2>はじめての人：マイページを作りましょう</h2>
      <p>ニックネームと写真（なくてもOK）を決めると、投稿したり、気になる人をフォローしたりできます。メールアドレスもパスワードも要りません。</p>${profileEditorHtml(cur)}</div>`;
    bindProfileEditor(cur, meView);
    $("gLogin").onclick = () => loginGoogle("gLoginMsg");
    return;
  }
  let followAll = [], followerAll = [], myPosts = [];
  [followAll, followerAll, myPosts] = await Promise.all([myFollowingAll().catch(() => []), myFollowersAll().catch(() => []), loadPostsOf(me)]);
  const stMap = new Map(followAll.map(x => [x.to, x.ok ? "on" : "req"]));   // 自分のフォロー（承認済み／リクエスト中）
  let following = followAll.filter(x => x.ok).map(x => x.to), followers = followerAll.filter(x => x.ok).map(x => x.from);
  let requests = followerAll.filter(x => !x.ok).map(x => x.from);   // 自分へのフォローリクエスト（非公開アカウントのとき）
  if (location.hash !== "#me") return;   // 読み込み中に別の画面へ移った
  root.innerHTML = `
    <div class="me-head">${bigAv(myProfile)}<div>
      <h2>${esc(myProfile.nickname)}</h2>${myProfile.bio ? `<p>${esc(myProfile.bio)}</p>` : ""}
      <div class="counts"><button data-t="posts"><b>${myPosts.length}</b>投稿</button><button data-t="following"><b>${following.length}</b>フォロー中</button><button data-t="followers"><b>${followers.length}</b>フォロワー${requests.length ? `<span class="reqdot">${requests.length}</span>` : ""}</button></div>
      ${myProfile.private ? `<p class="note" style="margin:6px 0 0">🔒 非公開アカウント：公開の投稿は、承認したフォロワーだけが見られます。</p>` : ""}
    </div></div>
    <div class="actions"><button class="btn small" id="newBtn">＋ 投稿する</button><button class="btn small ghost" id="editBtn">プロフィールを編集</button><button class="btn small ghost" id="linkBtn">自分のページのリンクをコピー</button></div>
    <section class="panel" id="profEdit" hidden style="margin-top:16px"></section>
    <section class="compose" id="compose" hidden style="margin-top:16px"></section>
    <div class="tabs2" style="margin-top:22px"><button data-t="posts">自分の投稿</button><button data-t="following">フォロー中</button><button data-t="followers">フォロワー</button></div>
    <div id="mbody"></div>
    <section class="panel acct" style="margin-top:36px">${googleEmail()
      ? `<h2>✅ Google とつながっています</h2>
         <p><b>${esc(googleEmail())}</b> とつながっています。ホーム画面のアイコンや別のスマホでも、マイページの「Google でログイン」を押せば、このマイページ・グループ・フォローに戻れます。</p>`
      : `<h2>🔐 引き継げるようにしておく（おすすめ）</h2>
         <p>いまのマイページは、<b>このスマホのこのブラウザだけ</b>に結びついています。iPhone では Safari とホーム画面のアイコンでも別の人になり、スマホを変えたりブラウザのデータを消したりすると元に戻れません。</p>
         <p>Google とつないでおくと、どこでも「Google でログイン」するだけで、このマイページ・グループ・フォローに戻れます。</p>
         <div class="actions"><button class="btn gbtn" id="gLink">${G_LOGO}Google とつなぐ</button><span class="msg" id="gLinkMsg"></span></div>
         <p class="note">つなぐと、Google のメールアドレス・名前・写真がサイトの管理者に伝わります（ほかの人には見えません。サイトにも表示されません）。つながなくても、今までどおり使えます。</p>`}
    </section>
    <button class="fab" id="fab" aria-label="投稿する">＋</button>`;
  if ($("gLink")) $("gLink").onclick = async () => { if (await linkGoogle("gLinkMsg")) meView(); };
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
    // フォロー中のタブには、リクエスト中の人も「リクエスト済み」で出す
    const list = meTab === "following" ? followAll.map(x => x.to) : followers;
    const reqs = meTab === "followers" ? requests : [];
    if (!list.length && !reqs.length) { body.innerHTML = `<p class="empty">${meTab === "following" ? "まだ誰もフォローしていません。「見つける」で気になる人の名前を押すと、フォローできます。" : "まだフォロワーはいません。"}</p>`; return; }
    body.innerHTML = LOADING;
    await Promise.all([...list, ...reqs].map(async u => { if (!(u in profs)) profs[u] = await getProfile(u); }));
    body.innerHTML = (reqs.length ? `<h3 class="act-sec">フォローリクエスト（${reqs.length}）</h3>` + reqs.map(u => userRow(u, profs[u],
        `<span class="reqbtns"><button class="btn small" data-ok="${esc(u)}">承認</button><button class="btn small ghost" data-ng="${esc(u)}">削除</button></span>`)).join("")
        + (list.length ? `<h3 class="act-sec">フォロワー</h3>` : "") : "")
      + list.map(u => userRow(u, profs[u], followBtn(u, stMap.get(u) || ""))).join("");
    bindFollowBtns(body, (uid, on, s) => { if (uid === undefined) return meView(); if (s) stMap.set(uid, s); else stMap.delete(uid);
      following = [...stMap].filter(([, v]) => v === "on").map(([k]) => k);
      root.querySelector('.counts [data-t="following"] b').textContent = following.length; });
    body.querySelectorAll("[data-ok], [data-ng]").forEach(b => b.onclick = async () => {
      const u = b.dataset.ok || b.dataset.ng, ok = !!b.dataset.ok; b.disabled = true;
      try { await answerRequest(u, ok); toast(ok ? "承認しました" : "リクエストを削除しました"); requests = requests.filter(x => x !== u); if (ok) followers = [...followers, u]; drawMe(); }
      catch (e) { console.error(e); toast("うまくいきませんでした"); b.disabled = false; }
    });
  }
  tabsOn(); drawMe();
}

// ===== お知らせ（インスタの「アクティビティ」のように、いいね・フォローが届く） =====
const ago = ts => {
  if (!ts || !ts.toDate) return "今";
  const d = ts.toDate(), s = (Date.now() - d) / 1000;
  if (s < 60) return "今"; if (s < 3600) return `${Math.floor(s / 60)}分前`; if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  if (s < 604800) return `${Math.floor(s / 86400)}日前`; return `${d.getMonth() + 1}月${d.getDate()}日`;
};
const actSection = ts => {
  if (!ts || !ts.toDate) return "今日";
  const d = ts.toDate(), now = new Date(), days = (now - d) / 86400000;
  if (d.toDateString() === now.toDateString()) return "今日";
  return days < 7 ? "今週" : days < 30 ? "今月" : "それ以前";
};
async function activityView() {
  current = null;
  root.innerHTML = `<div class="bar"><h2>お知らせ</h2></div><div id="actList">${LOADING}</div>`;
  try { await ensureAuth(); } catch { root.innerHTML = `<p class="empty">つながりませんでした。通信状況を確認して、開き直してください。</p>`; return; }
  let following = new Map((await myFollowingAll().catch(() => [])).map(x => [x.to, x.ok ? "on" : "req"]));
  let unreadAtOpen = null;   // 開いたときに未読だったもの（その間は色をつけて目立たせる）
  unsubs.push(onSnapshot(query(collection(db, "notifs", me, "items"), orderBy("createdAt", "desc"), limit(100)), snap => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!unreadAtOpen) {
      unreadAtOpen = new Set(items.filter(x => !x.read).map(x => x.id));
      const unread = snap.docs.filter(d => !d.data().read);   // 開いたら「読んだ」にする
      if (unread.length) { const b = writeBatch(db); unread.forEach(d => b.update(d.ref, { read: true })); b.commit().catch(() => {}); }
    }
    drawActivity(items, following, unreadAtOpen);
  }, e => { console.error(e); $("actList").innerHTML = `<p class="empty">読み込めませんでした。</p>`; }));
}
function drawActivity(items, following, unreadAtOpen) {
  const box = $("actList"); if (!box) return;
  if (!items.length) {
    box.innerHTML = `<div class="act-empty">${HEART}<h3>あなたへのお知らせ</h3><p>誰かがあなたの投稿に「いいね！」したり、あなたをフォローしたりすると、ここに届きます。</p></div>`;
    return;
  }
  // 同じ日のくくりの中で、同じ投稿へのいいねは1行にまとめる（インスタと同じ）
  const rows = [], byPost = new Map();
  for (const n of items) {
    const sec = actSection(n.createdAt);
    if (n.type === "like") {
      const k = sec + "|" + n.kind + "|" + n.gid + "|" + n.pid;
      if (byPost.has(k)) { byPost.get(k).people.push(n); if (unreadAtOpen.has(n.id)) byPost.get(k).isNew = true; continue; }
      const row = { sec, type: "like", n, people: [n], isNew: unreadAtOpen.has(n.id) }; byPost.set(k, row); rows.push(row);
    } else rows.push({ sec, type: n.type, n, people: [n], isNew: unreadAtOpen.has(n.id) });
  }
  const who = n => `<a href="${esc(userHash(n.from))}"><b>${esc(n.name)}</b></a>さん`;
  const faces = people => `<a class="act-av ${people.length > 1 ? "two" : ""}" href="${esc(userHash(people[0].from))}">${people.slice(0, 2).map(x => av(x.icon, x.color, x.from)).join("")}</a>`;
  let html = "", lastSec = "";
  for (const r of rows) {
    if (r.sec !== lastSec) { html += `<h3 class="act-sec">${r.sec}</h3>`; lastSec = r.sec; }
    const n = r.n, others = r.people.length - 1;
    const text = r.type === "follow" ? `${who(n)}があなたをフォローしました。`
      : r.type === "request" ? `${who(n)}がフォローをリクエストしました。`
      : r.type === "accept" ? `${who(n)}があなたのフォローリクエストを承認しました。`
      : `${who(n)}${others ? `、他${others}人` : ""}があなたの投稿「${esc(n.title)}」に「いいね！」しました。`;
    const right = r.type === "request"
      ? `<span class="reqbtns"><button class="btn small act-btn" data-ok="${esc(n.from)}">承認</button><button class="btn small ghost act-btn" data-ng="${esc(n.from)}">削除</button></span>`
      : r.type === "follow" || r.type === "accept"
      ? followBtn(n.from, following.get(n.from) || "").replace('class="btn small', 'class="btn small act-btn')
      : `<a class="act-thumb" href="${n.kind === "group" ? "#group" : "#me"}" data-gid="${esc(n.gid || "")}">${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy">` : `<span class="act-ph">${esc(String(n.title || "").slice(0, 2))}</span>`}</a>`;
    html += `<div class="act-row ${r.isNew ? "new" : ""}">${faces(r.people)}<div class="act-text">${text}<span class="act-time">${ago(n.createdAt)}</span></div>${right}</div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll(".act-thumb[data-gid]").forEach(a => a.onclick = () => { if (a.dataset.gid) setLast(a.dataset.gid); });
  bindFollowBtns(box, (uid, on, s) => { if (uid === undefined) return; if (s) following.set(uid, s); else following.delete(uid); });
  box.querySelectorAll("[data-ok], [data-ng]").forEach(b => b.onclick = async () => {
    const u = b.dataset.ok || b.dataset.ng, ok = !!b.dataset.ok;
    b.closest(".reqbtns").querySelectorAll("button").forEach(x => x.disabled = true);
    try { await answerRequest(u, ok); toast(ok ? "承認しました" : "リクエストを削除しました"); }   // 通知は消えるので、自動で一覧から消える
    catch (e) { console.error(e); toast("うまくいきませんでした"); b.closest(".reqbtns").querySelectorAll("button").forEach(x => x.disabled = false); }
  });
}

// ===== ほかの人のページ =====
async function userView(uid) {
  current = null;
  root.innerHTML = LOADING;
  try { await ensureAuth(); } catch {}
  if (uid === me) { history.replaceState(null, "", "/#me"); window.DF && window.DF.setNav("me"); return meView(); }
  profCache.delete(uid);
  const p = await getProfile(uid);
  if (!p) { root.innerHTML = `<p class="empty">この人のページは見つかりませんでした。</p>`; return; }
  let following = "", nFollowers = 0, nFollowing = 0, posts = [];
  // フォロワー数・フォロー中の数は、承認済みだけ数える（全部の数 − リクエスト中の数）
  const count = async (field, extra) => (await getCountFromServer(query(collection(db, "follows"), where(field, "==", uid), ...extra))).data().count;
  await Promise.all([
    getDoc(doc(db, "follows", followId(uid))).then(d => { following = d.exists() ? (isApproved(d.data()) ? "on" : "req") : ""; }).catch(() => {}),
    Promise.all([count("to", []), count("to", [where("approved", "==", false)])]).then(([a, b]) => { nFollowers = a - b; }).catch(() => {}),
    Promise.all([count("from", []), count("from", [where("approved", "==", false)])]).then(([a, b]) => { nFollowing = a - b; }).catch(() => {}),
  ]);
  posts = await loadPostsOf(uid);
  const locked = !!posts.locked && following !== "on";
  if (location.hash.slice(1) !== "u=" + encodeURIComponent(uid) && decodeURIComponent(location.hash.slice(3)) !== uid) return;
  root.innerHTML = `
    <div class="me-head">${bigAv(p)}<div>
      <h2>${p.private ? `<span class="lock" title="非公開アカウント">🔒</span>` : ""}${esc(p.nickname)}</h2>${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
      <div class="counts"><span><b>${locked ? "–" : posts.length}</b>投稿</span><span><b>${nFollowing}</b>フォロー中</span><span><b id="nFol">${nFollowers}</b>フォロワー</span></div>
    </div></div>
    <div class="actions" id="uAct">${followBtn(uid, following)}${isAdmin ? `<button class="btn small ghost" id="admDelProf">管理者：このプロフィールを消す</button>` : ""}</div>
    <div class="tabs2" style="margin-top:22px"><button class="on">投稿</button></div>
    <div id="ubody"></div>`;
  const drawPosts = () => {
    const body = $("ubody"); if (!body) return;
    if (locked) {
      body.innerHTML = `<div class="locked"><div class="lk">🔒</div><h3>このアカウントは非公開です</h3><p>${following === "req" ? "フォローをリクエストしました。相手が承認すると、投稿が見られるようになります。" : "フォローして、相手に承認されると投稿が見られます。"}</p>${posts.length ? `<p class="note">（同じグループでの投稿は下に出ています）</p>` : ""}</div>`
        + posts.map(x => postHtml(x, { showSrc: true })).join("");
    } else body.innerHTML = posts.length ? posts.map(x => postHtml(x, { showSrc: true })).join("") : `<p class="empty">見られる投稿はまだありません。</p>`;
    bindPostOps(body, { redraw: drawPosts, reload: () => userView(uid) });
  };
  bindFollowBtns($("uAct"), (u, on, s) => { if (u === undefined) return userView(uid); if (s === "on" || (!s && following === "on")) userView(uid); else { following = s; drawPosts(); } });
  if ($("admDelProf")) $("admDelProf").onclick = e => armed(e.target, "管理者：このプロフィールを消す", async () => { await deleteDoc(doc(adb, "profiles", uid)); toast("消しました"); userView(uid); });
  drawPosts();
}

// ===== トップページ：お知らせ＋友達のおすすめ =====
let homeUnsubs = [], homeGen = 0;   // homeGen：トップを描き直したら、前の読み込みは使わない
const newsHtml = n => `
  <div class="news-item"><div class="nk">お知らせ<span>${esc(fmtTime(n.createdAt))}</span></div>
    <b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ""}${safeLink(n.link) ? `<a href="${esc(safeLink(n.link))}" target="_blank" rel="noopener noreferrer">くわしく見る ↗</a>` : ""}</div>`;
const hxCard = p => `
  <a class="hx-card" href="${p._src.kind === "pub" ? esc(userHash(p.uid)) : "#group"}">${cover({ title: p.title, category: p.category, image: p.image })}
    <div><div class="who">${av(p.icon, p.color, p.uid)}${esc(p.nickname)}${likeCount(p) ? ` · ♥${likeCount(p)}` : ""}</div>
    <b>${esc(p.title)}</b>${p.by ? `<small>${esc(p.by)}</small>` : ""}${p.oneline ? `<p>${esc(p.oneline)}</p>` : ""}</div></a>`;

async function fillHome() {
  homeUnsubs.forEach(u => u()); homeUnsubs = [];
  const gen = ++homeGen;
  // 管理者からのお知らせ（新しい3件）
  homeUnsubs.push(onSnapshot(query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(3)), snap => {
    const nb = $("homeNews"); if (!nb) return;
    const list = []; snap.forEach(d => list.push(d.data()));
    nb.innerHTML = list.length ? `<section class="news">${list.map(newsHtml).join("")}</section>` : "";
  }, () => {}));
  const box = $("homeExtras"); if (!box) return;
  box.innerHTML = `
    <section class="hx">
      <div class="section-head"><h3><span id="hxTitle">Friends' Picks</span><small id="hxSub">友達のおすすめ</small></h3></div>
      <div class="hx-cards" id="hxCards">${LOADING}</div>
      <div class="hx-more" id="hxMore"></div>
    </section>`;
  const parts = {};
  const draw = () => {
    if (!$("hxCards")) return;
    const list = sortNew(Object.values(parts).flat()).slice(0, 6);
    $("hxCards").innerHTML = list.length ? list.map(hxCard).join("") : `<p class="empty">まだ投稿がありません。</p>`;
  };
  const watch = (name, q, src) => { if (gen === homeGen) homeUnsubs.push(onSnapshot(q, snap => { parts[name] = tag(snap.docs, src); draw(); }, () => { parts[name] = []; draw(); })); };
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
      if (tos.length && gen === homeGen) { await watchFollowPosts(tos.slice(0, 60), list => { parts.follow = list; draw(); }, homeUnsubs, 30); sources++; }
    } catch {}
  }
  if (gen !== homeGen || !$("hxCards")) return;   // 読み込み中に画面が変わった
  if (!sources) {
    $("hxTitle").textContent = "New Picks"; $("hxSub").textContent = "みんなの新着のおすすめ";
    watch("pub", query(collection(db, "pubposts"), where("priv", "==", false), orderBy("createdAt", "desc"), limit(6)), { kind: "pub" });
  }
  $("hxMore").innerHTML = sources
    ? `${groupOk ? `<a href="#group">グループを開く →</a>` : ""}<a href="#all">「見つける」を開く →</a>`
    : `<div class="hx-cta"><p>気になる人をフォローしたり、友達とグループを作ったりすると、ここに友達のおすすめが並びます。</p><a class="btn small" href="#all">「見つける」を開く</a><a class="btn small ghost" href="#group">グループを作る</a></div>`;
}
window.addEventListener("df:leavehome", () => { homeUnsubs.forEach(u => u()); homeUnsubs = []; homeGen++; });

// ===== 意見ボックス（誰でも送れる。読めるのは管理者だけ） =====
function feedbackView() {
  const st = { kind: "要望" };
  const nick = (myProfile && myProfile.nickname) || (current && current.nickname) || "";
  root.innerHTML = `
    <div class="panel">
      <h2>💬 意見ボックス</h2>
      <p>「こうなったらいいな」「ここが使いにくい」「動かない」など、なんでも気軽に送ってください。読むのは<b>サイトの管理者だけ</b>です。</p>
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
        <div class="stat"><b id="sPub">–</b><span>公開の投稿</span></div>
        <div class="stat"><b id="sSongs">–</b><span>みんなのプレイリストの曲</span></div>
        <div class="stat"><b id="sLikes">–</b><span>公開曲のいいね合計</span></div>
      </section>
      <p class="note">すべてのグループのメンバーと投稿を見て、投稿の削除・メンバーを外す・グループを閉じることができます。公開の投稿も消せます。問題のある写真やプロフィールは、その人のページの「管理者：このプロフィールを消す」で消せます。他の人になりすまして投稿したり、投稿を書き換えたりはできません。</p>

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

      <h3>🌐 公開の投稿</h3><div id="aPub">${LOADING}</div>
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
    if (normLink(link) === null) return setMsg("nMsg", "リンクが読み取れませんでした。http:// や https:// から始まるアドレスを入れてください。", false);
    $("nPost").disabled = true;
    try { await addDoc(collection(adb, "announcements"), { title, body, link: normLink(link) || "", createdAt: serverTimestamp() }); $("nTitle").value = ""; $("nBody").value = ""; $("nLink").value = ""; toast("お知らせを出しました"); setMsg("nMsg", "", true); }
    catch (e) { console.error(e); setMsg("nMsg", "出せませんでした。", false); }
    $("nPost").disabled = false;
  };
  adminUnsubs.push(onSnapshot(query(collection(adb, "announcements"), orderBy("createdAt", "desc"), limit(50)), snap => {
    $("aNews").innerHTML = snap.size ? `<div class="news">${snap.docs.map(d => newsHtml(d.data()) + `<div class="actions" style="margin:-4px 0 8px"><button class="btn small ghost" data-ndel="${esc(d.id)}">このお知らせを消す</button></div>`).join("")}</div>` : `<p class="empty">まだお知らせはありません。</p>`;
    $("aNews").querySelectorAll("[data-ndel]").forEach(b => b.onclick = () => armed(b, "このお知らせを消す", () => deleteDoc(doc(adb, "announcements", b.dataset.ndel))));
  }, e => console.error(e)));

  // 公開の投稿
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
watchActivity();
if (window.DF) window.DF.friendsReady();
