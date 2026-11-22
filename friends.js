// DAILY FIND：グループ・みんなのプレイリスト・管理（メインページの中で動く）
// ・友達は匿名ログイン（メール・パスワード・名前は使わない）
// ・管理者（サイトの持ち主）は Google ログイン。別の Firebase アプリ名で起動して、友達用のログインと混ざらないようにする
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, getAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
         signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, orderBy, limit, where, documentId,
         onSnapshot, serverTimestamp, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

// ===== 共通の部品 =====
const EMOJIS = ["🎧", "🎸", "🎹", "🎤", "🥁", "🎷", "📚", "🎬", "☕", "🌙", "🌈", "🐱", "🐶", "🦊", "🐼", "🍙", "🌸", "⚡"];
const COLORS = ["#8a3a2c", "#2c3a48", "#4a5240", "#463e5c", "#2c4644", "#47292f", "#b07a2a", "#3b3936"];
const pickOne = a => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];
const av = (icon, color) => `<span class="av" style="background:${COLORS.includes(color) ? color : COLORS[7]}">${esc(icon || "🎧")}</span>`;
const pickerHtml = (id, cur) => `<div class="picker" id="${id}">
  <div class="emojis">${EMOJIS.map(e => `<button type="button" data-e="${e}" class="${e === cur.icon ? "on" : ""}" aria-label="アイコン ${e}">${e}</button>`).join("")}</div>
  <div class="colors">${COLORS.map(c => `<button type="button" data-c="${c}" class="${c === cur.color ? "on" : ""}" style="background:${c}" aria-label="色"></button>`).join("")}</div></div>`;
function bindPicker(id, cur) {
  $(id).onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.e) cur.icon = b.dataset.e;
    if (b.dataset.c) cur.color = b.dataset.c;
    $(id).querySelectorAll("[data-e]").forEach(x => x.classList.toggle("on", x.dataset.e === cur.icon));
    $(id).querySelectorAll("[data-c]").forEach(x => x.classList.toggle("on", x.dataset.c === cur.color));
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
const songId = (gid, pid) => `${gid}_${pid}`;
const isPublicSong = p => p && p.category === "音楽" && p.public === true;
const likeCount = p => Object.keys(p.likes || {}).length;
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

// ===== 画面の切り替え =====
let unsubs = [];
const stop = () => { unsubs.forEach(u => u()); unsubs = []; };
let current = null;   // 開いているグループ

window.addEventListener("df:view", e => show(e.detail));
window.addEventListener("df:home", () => fillHome());

async function show(view) {
  stop();
  const h = new URLSearchParams(view);
  if (h.get("g") && h.get("k")) {          // 招待リンク
    rememberGroup(h.get("g"), h.get("k"));
    history.replaceState(null, "", "/#group");   // アドレス欄から合言葉を消す
    window.DF && window.DF.setNav("group");
    return groupView(h.get("g"), h.get("k"));
  }
  if (view === "all") return publicView();
  if (view === "admin") return adminView();
  if (view === "feedback") return feedbackView();
  return groupView();
}

// ===== グループ =====
async function groupView(gid, key) {
  root.innerHTML = `<p class="empty">読み込んでいます…</p>`;
  try { await ensureAuth(); } catch { root.innerHTML = `<p class="empty">つながりませんでした。通信状況を確認して、開き直してください。</p>`; return; }
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

function welcome() {
  current = null;
  const prof = { icon: pickOne(EMOJIS), color: pickOne(COLORS) };
  const has = loadGroups().length;
  root.innerHTML = `
    ${has ? `<div class="bar"><h2>グループ</h2>${groupSelectHtml()}</div>` : ""}
    <div class="panel">
      <h2>友達と「いいもの」をシェアしよう</h2>
      <p>グループは誰でも作れます。招待リンクを送ると、友達はニックネームだけで参加できます。メールアドレスもパスワードも要りません。</p>
      <p>招待リンクをもらった人は、そのリンクを開くだけで参加画面になります。</p>
      <label>グループの名前<input id="gName" maxlength="30" placeholder="例：いつもの4人"></label>
      <label>あなたのニックネーム<input id="gNick" maxlength="20" placeholder="例：こうへい"></label>
      <div class="lbl">あなたのアイコン ${pickerHtml("gPick", prof)}</div>
      <div class="actions"><button class="btn" id="gCreate">グループを作る</button><span class="msg" id="gMsg"></span></div>
      <p class="note">保存されるのは、グループ名・ニックネーム・アイコン・投稿だけです。グループの投稿は、メンバーとサイトの管理者が見られます。</p>
    </div>`;
  bindPicker("gPick", prof); bindGroupSelect();
  $("gCreate").onclick = async () => {
    const name = $("gName").value.trim(), nickname = $("gNick").value.trim();
    if (!name || !nickname) return setMsg("gMsg", "グループの名前とニックネームを入れてください。", false);
    $("gCreate").disabled = true; setMsg("gMsg", "作っています…", true);
    try {
      await ensureAuth();
      const key = randomKey();
      const gref = doc(collection(db, "groups"));
      const b = writeBatch(db);
      b.set(gref, { name, owner: me, createdAt: serverTimestamp() });
      b.set(doc(db, "groups", gref.id, "private", "invite"), { key });
      await b.commit();
      await setDoc(doc(db, "groups", gref.id, "members", me), { nickname, icon: prof.icon, color: prof.color, key, joinedAt: serverTimestamp() });
      rememberGroup(gref.id, key, name);
      await groupView(gref.id, key);
      if ($("invitePanel")) $("invitePanel").hidden = false;
    } catch (e) { console.error(e); setMsg("gMsg", "作れませんでした。少し待ってからもう一度押してください。", false); $("gCreate").disabled = false; }
  };
}

function joinScreen(gid, key) {
  current = null;
  const prof = { icon: pickOne(EMOJIS), color: pickOne(COLORS) };
  root.innerHTML = `
    <div class="panel">
      <h2>グループに招待されています</h2>
      <p>ニックネームとアイコンを選ぶだけで参加できます。メールアドレスもパスワードも要りません。</p>
      <label>あなたのニックネーム<input id="jNick" maxlength="20" placeholder="例：みさき" autocomplete="nickname"></label>
      <div class="lbl">あなたのアイコン ${pickerHtml("jPick", prof)}</div>
      <div class="actions"><button class="btn" id="jGo">参加する</button><span class="msg" id="jMsg"></span></div>
      <p class="note">保存されるのは、ニックネーム・アイコン・あなたの投稿だけです。グループの投稿は、メンバーとサイトの管理者が見られます。</p>
    </div>`;
  bindPicker("jPick", prof);
  $("jGo").onclick = async () => {
    const nickname = $("jNick").value.trim();
    if (!nickname) return setMsg("jMsg", "ニックネームを入れてください。", false);
    $("jGo").disabled = true; setMsg("jMsg", "参加しています…", true);
    try {
      await setDoc(doc(db, "groups", gid, "members", me), { nickname, icon: prof.icon, color: prof.color, key, joinedAt: serverTimestamp() });
      groupView(gid, key);
    } catch (e) { console.error(e); forgetGroup(gid); setMsg("jMsg", "参加できませんでした。招待リンクが古いか、まちがっている可能性があります。", false); $("jGo").disabled = false; }
  };
}

let members = {}, posts = [], tab = "feed";
function groupScreen() {
  const isOwner = current.owner === me;
  const prof = { icon: current.icon, color: current.color };
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
    <div id="gbody"><p class="empty">読み込んでいます…</p></div>
    <button class="fab" id="fab" aria-label="投稿する">＋</button>
    <details class="manage">
      <summary>設定（ニックネーム・アイコン・グループを抜ける${isOwner ? "・メンバー管理" : ""}）</summary>
      <div class="panel">
        <label>ニックネーム<input id="nickEdit" maxlength="20" value="${esc(current.nickname)}"></label>
        <div class="lbl">アイコン ${pickerHtml("ePick", prof)}</div>
        <div class="actions"><button class="btn small" id="nickSave">変更する</button><span class="msg" id="nickMsg"></span></div>
        ${isOwner ? `<h2 style="font-size:16px;margin-top:10px">メンバー</h2><div id="mlist"></div>
          <p>知らない人が入っていたら「外す」を押してから、招待リンクを作り直してください。</p>
          <div class="actions"><button class="btn small ghost" id="rotate">招待リンクを作り直す</button><span class="msg" id="rotMsg"></span></div>` : ""}
        ${isOwner
          ? `<p style="margin-top:10px">あなたはこのグループを作った人なので、抜けることはできません（抜けると、誰もメンバーを管理できなくなるため）。グループが要らなくなったら削除してください。</p>
             <div class="actions"><button class="btn small ghost" id="delGroup">このグループを削除する（全員の投稿も消えます）</button><span class="msg" id="delMsg"></span></div>`
          : `<div class="actions" style="margin-top:10px"><button class="btn small ghost" id="leave">このグループを抜ける</button></div>`}
      </div>
    </details>`;
  bindPicker("ePick", prof); bindGroupSelect();
  root.querySelectorAll(".tabs2 button").forEach(b => { b.classList.toggle("on", b.dataset.t === tab); b.onclick = () => { tab = b.dataset.t; root.querySelectorAll(".tabs2 button").forEach(x => x.classList.toggle("on", x === b)); drawGroupBody(); }; });
  $("inviteBtn").onclick = () => { $("invitePanel").hidden = !$("invitePanel").hidden; };
  $("copyInv").onclick = async () => { try { await navigator.clipboard.writeText($("invUrl").value); toast("招待リンクをコピーしました"); } catch { $("invUrl").select(); setMsg("invMsg", "選択しました。長押しでコピーしてください", true); } };
  $("newBtn").onclick = () => openCompose(null);
  $("fab").onclick = () => openCompose(null);
  $("nickSave").onclick = async () => {
    const n = $("nickEdit").value.trim(); if (!n) return;
    try { await updateDoc(doc(db, "groups", current.gid, "members", me), { nickname: n, icon: prof.icon, color: prof.color }); Object.assign(current, { nickname: n, icon: prof.icon, color: prof.color }); setMsg("nickMsg", "変更しました（これからの投稿に使われます）", true); }
    catch { setMsg("nickMsg", "変更できませんでした", false); }
  };
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

  unsubs.push(onSnapshot(collection(db, "groups", current.gid, "members"), snap => {
    members = {}; snap.forEach(d => { members[d.id] = d.data(); });
    $("members").innerHTML = Object.entries(members).map(([uid, m]) => `<span class="chip">${av(m.icon, m.color)}${esc(m.nickname)}${uid === me ? "（あなた）" : ""}</span>`).join("");
    if (isOwner && $("mlist")) {
      $("mlist").innerHTML = Object.entries(members).map(([uid, m]) => `<div class="mrow"><span>${av(m.icon, m.color)}${esc(m.nickname)}${uid === me ? "（あなた）" : ""}</span>${uid === me ? "" : `<button class="btn small ghost" data-kick="${esc(uid)}">外す</button>`}</div>`).join("");
      $("mlist").querySelectorAll("[data-kick]").forEach(b => b.onclick = () => armed(b, "外す", () => deleteDoc(doc(db, "groups", current.gid, "members", b.dataset.kick))));
    }
    drawGroupBody();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "groups", current.gid, "posts"), orderBy("createdAt", "desc"), limit(200)), snap => {
    posts = []; snap.forEach(d => posts.push({ id: d.id, ...d.data() })); drawGroupBody();
  }, err => { console.error(err); $("gbody").innerHTML = `<p class="empty">読み込めませんでした。グループから外された可能性があります。</p>`; }));
}

const likedByMe = p => !!(p.likes && p.likes[me]);
const likersText = p => Object.keys(p.likes || {}).map(u => (members[u] && members[u].nickname) || "抜けた人").join("、");
const likeBtn = p => `<button class="like ${likedByMe(p) ? "on" : ""}" data-like="${esc(p.id)}" aria-pressed="${likedByMe(p)}"><span class="h">♥</span>${likeCount(p) || ""}</button>`;

function postHtml(p, canDelete) {
  const mine = p.uid === me, link = safeLink(p.link);
  return `
    <article class="post">
      ${cover({ title: p.title, category: p.category, image: p.image })}
      <div>
        <div class="who">${av(p.icon, p.color)}<b>${esc(p.nickname)}</b>${fmtTime(p.createdAt)}</div>
        <div class="kick">${esc(cat(p.category).en)}</div>
        <h3>${esc(p.title)}</h3>
        ${p.by ? `<div class="by">${esc(p.by)}</div>` : ""}
        ${stars(p.rating)}
        ${p.oneline ? `<p>${esc(p.oneline)}</p>` : ""}
        <div class="ops">
          ${likeBtn(p)}
          ${p.category === "音楽" ? listenHtml(p, false) : link ? `<a class="listen" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(ctaLabel(p))} ↗</a>` : ""}
          ${mine ? `<button class="txt" data-edit="${esc(p.id)}">編集</button>` : ""}
          ${mine || canDelete ? `<button class="txt" data-del="${esc(p.id)}">削除</button>` : ""}
          ${likeCount(p) ? `<div class="likers">♥ ${esc(likersText(p))}</div>` : ""}
          ${isPublicSong(p) ? `<div class="pub">🌐 曲名だけ「みんなのプレイリスト」に載っています</div>` : ""}
        </div>
      </div>
    </article>`;
}

function drawGroupBody() {
  const body = $("gbody"); if (!body || !current) return;
  if (tab === "pl") {
    const songs = posts.filter(p => p.category === "音楽").sort((a, b) => likeCount(b) - likeCount(a) || ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    body.innerHTML = `
      <div class="pl-top"><div><h2>${esc(current.name)}</h2><p>グループのプレイリスト · ${songs.length}曲 · いいねが多い順</p></div></div>
      <div class="flist">${songs.length ? songs.map((p, i) => `
        <div class="tr"><span class="no">${String(i + 1).padStart(2, "0")}</span>${cover({ title: p.title, category: "音楽", image: p.image })}
          <div class="ft"><b>${esc(p.title)}</b><small>${esc(p.by || "")} · ${esc(p.nickname)}</small></div>
          <div class="end">${likeBtn(p)}${listenHtml(p, false)}</div></div>`).join("") : `<p class="empty">まだ曲がありません。</p>`}</div>`;
  } else {
    body.innerHTML = posts.length ? posts.map(p => postHtml(p, current.owner === me)).join("") : `<p class="empty">まだ投稿がありません。「＋ 投稿する」から、最初の1つをシェアしましょう。</p>`;
  }
  body.querySelectorAll("[data-like]").forEach(b => b.onclick = () => toggleLike(b.dataset.like, b));
  body.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openCompose(posts.find(p => p.id === b.dataset.edit)));
  body.querySelectorAll("[data-del]").forEach(b => b.onclick = () => armed(b, "削除", () => deletePost(db, current.gid, posts.find(p => p.id === b.dataset.del))));
}

async function deletePost(store, gid, p) {
  if (!p) return;
  const batch = writeBatch(store);
  batch.delete(doc(store, "groups", gid, "posts", p.id));
  if (isPublicSong(p)) batch.delete(doc(store, "songs", songId(gid, p.id)));
  await batch.commit();
}

async function toggleLike(pid, btn) {
  btn.disabled = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pref = doc(db, "groups", current.gid, "posts", pid);
      const fresh = attempt === 0 ? posts.find(p => p.id === pid) : { id: pid, ...(await getDoc(pref)).data() };
      if (!fresh) break;
      const on = !(fresh.likes && fresh.likes[me]);
      const next = { ...(fresh.likes || {}) }; if (on) next[me] = true; else delete next[me];
      const batch = writeBatch(db);
      batch.update(pref, { [`likes.${me}`]: on ? true : deleteField() });
      if (isPublicSong(fresh)) batch.update(doc(db, "songs", songId(current.gid, pid)), { likeCount: Object.keys(next).length });
      await batch.commit();
      break;
    } catch (e) { if (attempt === 1) console.error(e); }
  }
  btn.disabled = false;
}

// ===== 投稿フォーム =====
function openCompose(post) {
  const draft = post ? { ...post } : { category: "音楽", title: "", by: "", oneline: "", link: "", image: "", rating: 4, public: true };
  const c = $("compose"); c.hidden = false;
  c.innerHTML = `
    <div class="actions"><button type="button" class="btn small" id="srcSong">🎵 曲を探す</button><button type="button" class="btn small ghost" id="srcMine">DAILY FIND の記事から選ぶ</button></div>
    <input id="mq" type="search" enterkeyhint="search" placeholder="曲名やアーティスト名を入れる" autocomplete="off">
    <div class="suggest" id="suggest" hidden></div>
    <div class="picked"><div id="pv"></div><div class="note">候補を選ぶと、タイトル・ジャケット・リンクが入ります。曲以外は下に直接書いてください。</div></div>
    <div class="row2">
      <label>カテゴリ<select id="fCat">${Object.keys(CATS).map(k => `<option ${k === draft.category ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <label>タイトル<input id="fTitle" maxlength="100" value="${esc(draft.title)}"></label>
    </div>
    <label>作者・アーティスト・場所など<input id="fBy" maxlength="100" value="${esc(draft.by)}"></label>
    <label>ひとこと（グループの人だけに見えます）<input id="fOne" maxlength="200" value="${esc(draft.oneline)}" placeholder="例：夕日を見ながら聴きたい曲"></label>
    <div class="lbl" role="group" aria-label="評価">評価<div class="rate" id="rate">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="星${n}">★</button>`).join("")}</div></div>
    <label>リンク（なくてもOK）<input id="fLink" type="url" maxlength="500" value="${esc(draft.link)}" placeholder="https://"></label>
    <label class="check" id="pubRow"><input type="checkbox" id="fPub" ${draft.public !== false ? "checked" : ""}><span>曲を「みんなのプレイリスト」にも載せる<br><span class="note">載るのは曲名・アーティスト・ジャケット・リンク・いいね数だけです。ニックネームやひとこと、グループ名は載りません。</span></span></label>
    <div class="actions"><button class="btn" id="post">${post ? "更新する" : "シェアする"}</button><button class="btn ghost" id="cancel" type="button">やめる</button><span class="msg" id="pMsg"></span></div>`;
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
    const data = {
      uid: me, nickname: current.nickname, icon: current.icon, color: current.color,
      category: $("fCat").value, title: $("fTitle").value.trim(), by: $("fBy").value.trim(), oneline: $("fOne").value.trim(), link: $("fLink").value.trim(),
      image: /^https:\/\//.test(draft.image || "") ? draft.image : "", rating: draft.rating | 0, public: $("fCat").value === "音楽" && $("fPub").checked,
    };
    if (!data.title) return setMsg("pMsg", "タイトルを入れてください。", false);
    if (data.link && !/^https:\/\//i.test(data.link)) return setMsg("pMsg", "リンクは https:// から始まるアドレスにしてください。", false);
    $("post").disabled = true; setMsg("pMsg", "シェアしています…", true);
    try {
      const batch = writeBatch(db);
      const pref = post ? doc(db, "groups", current.gid, "posts", post.id) : doc(collection(db, "groups", current.gid, "posts"));
      const sref = doc(db, "songs", songId(current.gid, pref.id));
      const song = { title: data.title, by: data.by, image: data.image, link: data.link };
      if (post) {
        batch.set(pref, { ...data, nickname: post.nickname, icon: post.icon, color: post.color, likes: post.likes || {}, createdAt: post.createdAt, updatedAt: serverTimestamp() });
        const lc = likeCount(post);
        if (isPublicSong(post) && data.public) batch.update(sref, { ...song, likeCount: lc });
        else if (isPublicSong(post) && !data.public) batch.delete(sref);
        else if (!isPublicSong(post) && data.public) batch.set(sref, { ...song, likeCount: lc, createdAt: serverTimestamp() });
      } else {
        batch.set(pref, { ...data, likes: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        if (data.public) batch.set(sref, { ...song, likeCount: 0, createdAt: serverTimestamp() });
      }
      await batch.commit();
      c.hidden = true; c.innerHTML = ""; tab = "feed";
      toast(post ? "更新しました" : "シェアしました！");
      document.querySelector(".tabs2")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { console.error(e); setMsg("pMsg", "シェアできませんでした。少し待ってからもう一度押してください。", false); $("post").disabled = false; }
  };
}

// ===== みんなのプレイリスト =====
let pubSort = "new";
const songRow = (s, i, extra = "") => `
  <div class="tr"><span class="no">${String(i + 1).padStart(2, "0")}</span>${cover({ title: s.title, category: "音楽", image: s.image })}
    <div class="ft"><b>${esc(s.title)}</b><small>${esc(s.by || "")}</small></div>
    <div class="end">${s.likeCount ? `<span class="cnt">♥ ${s.likeCount | 0}</span>` : ""}${listenHtml(s, false)}${extra}</div></div>`;
function publicView() {
  root.innerHTML = `
    <div class="pl-top">
      <div><h2>みんなのプレイリスト</h2><p>DAILY FIND でシェアされた曲。誰が投稿したかは表示されません。</p></div>
      <div class="seg"><button class="btn small ${pubSort === "new" ? "" : "ghost"}" data-s="new">新しい順</button><button class="btn small ${pubSort === "top" ? "" : "ghost"}" data-s="top">いいね順</button></div>
    </div>
    <div class="flist" id="pubList"><p class="empty">読み込んでいます…</p></div>`;
  const listen = () => {
    stop();
    const q = pubSort === "top" ? query(collection(db, "songs"), orderBy("likeCount", "desc"), limit(100)) : query(collection(db, "songs"), orderBy("createdAt", "desc"), limit(100));
    unsubs.push(onSnapshot(q, snap => {
      const list = []; snap.forEach(d => list.push(d.data()));
      $("pubList").innerHTML = list.length ? list.map((s, i) => songRow(s, i)).join("") : `<p class="empty">まだ曲がありません。グループで曲をシェアすると、ここに並びます。</p>`;
    }, e => { console.error(e); $("pubList").innerHTML = `<p class="empty">読み込めませんでした。</p>`; }));
  };
  root.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { pubSort = b.dataset.s; root.querySelectorAll("[data-s]").forEach(x => x.classList.toggle("ghost", x !== b)); listen(); });
  listen();
}

// ===== トップページ：グループの新着＋みんなのプレイリスト =====
let homeUnsubs = [];
const newsHtml = n => `
  <div class="news-item"><div class="nk">お知らせ<span>${esc(fmtTime(n.createdAt))}</span></div>
    <b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ""}${safeLink(n.link) ? `<a href="${esc(safeLink(n.link))}" target="_blank" rel="noopener noreferrer">くわしく見る ↗</a>` : ""}</div>`;

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
    <section class="hx" id="hxGroup"></section>
    <section class="hx">
      <div class="section-head"><h3>Everyone's Playlist<small>みんなのプレイリスト（いいね順）</small></h3></div>
      <div class="flist" id="hxSongs"><p class="empty">読み込んでいます…</p></div>
      <div class="hx-more"><a href="#all">みんなのプレイリストをすべて見る →</a></div>
    </section>`;
  homeUnsubs.push(onSnapshot(query(collection(db, "songs"), orderBy("likeCount", "desc"), limit(5)), snap => {
    const list = []; snap.forEach(d => list.push(d.data()));
    if ($("hxSongs")) $("hxSongs").innerHTML = list.length ? list.map((s, i) => songRow(s, i)).join("") : `<p class="empty">まだ曲がありません。</p>`;
  }, () => { if ($("hxSongs")) $("hxSongs").innerHTML = ""; }));

  const gs = loadGroups(); const g = gs.find(x => x.gid === lastGid()) || gs[0];
  const gbox = $("hxGroup");
  const cta = () => { gbox.innerHTML = `
    <div class="section-head"><h3>Friends<small>グループ</small></h3></div>
    <div class="hx-cta"><p>友達とグループを作って、おすすめをシェアしよう。メールもパスワードも要りません。</p><a class="btn small" href="#group">グループを作る・開く</a></div>`; };
  if (!g) return cta();
  try { await ensureAuth(); } catch { return cta(); }
  let name = g.name;
  try { const m = await getDoc(doc(db, "groups", g.gid, "members", me)); if (!m.exists()) return cta(); } catch { return cta(); }
  gbox.innerHTML = `
    <div class="section-head"><h3>From ${esc(name || "Friends")}<small>グループの新着</small></h3></div>
    <div class="hx-cards" id="hxCards"><p class="empty">読み込んでいます…</p></div>
    <div class="hx-more"><a href="#group">グループを開く →</a></div>`;
  homeUnsubs.push(onSnapshot(query(collection(db, "groups", g.gid, "posts"), orderBy("createdAt", "desc"), limit(6)), snap => {
    const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    if (!$("hxCards")) return;
    $("hxCards").innerHTML = list.length ? list.map(p => `
      <a class="hx-card" href="#group">${cover({ title: p.title, category: p.category, image: p.image })}
        <div><div class="who">${av(p.icon, p.color)}${esc(p.nickname)}${likeCount(p) ? ` · ♥${likeCount(p)}` : ""}</div>
        <b>${esc(p.title)}</b>${p.by ? `<small>${esc(p.by)}</small>` : ""}${p.oneline ? `<p>${esc(p.oneline)}</p>` : ""}</div></a>`).join("")
      : `<p class="empty">まだ投稿がありません。</p>`;
  }, () => {}));
}
window.addEventListener("df:leavehome", () => { homeUnsubs.forEach(u => u()); homeUnsubs = []; });

// ===== 意見ボックス（誰でも送れる。読めるのは管理者だけ） =====
function feedbackView() {
  const st = { kind: "要望" };
  const nick = (current && current.nickname) || "";
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
        <div class="stat"><b id="sSongs">–</b><span>みんなのプレイリストの曲</span></div>
        <div class="stat"><b id="sLikes">–</b><span>公開曲のいいね合計</span></div>
      </section>
      <p class="note">すべてのグループのメンバーと投稿を見て、投稿の削除・メンバーを外す・グループを閉じることができます。他の人になりすまして投稿したり、投稿を書き換えたりはできません。</p>

      <h3>💬 意見ボックス</h3>
      <div class="seg" style="margin-bottom:6px"><button class="btn small" data-fb="open">未対応</button><button class="btn small ghost" data-fb="all">すべて</button></div>
      <div id="aFeedback"><p class="empty">読み込んでいます…</p></div>

      <h3>📣 お知らせを書く</h3>
      <div class="panel" style="max-width:none">
        <p>トップページの一番上に、みんなに向けたお知らせを出せます（新しい3件まで表示）。</p>
        <label>タイトル<input id="nTitle" maxlength="60" placeholder="例：グループ機能ができました"></label>
        <label>本文（なくてもOK）<textarea id="nBody" maxlength="1000" placeholder="くわしい説明"></textarea></label>
        <label>リンク（なくてもOK）<input id="nLink" type="url" maxlength="500" placeholder="https://"></label>
        <div class="actions"><button class="btn" id="nPost">お知らせを出す</button><span class="msg" id="nMsg"></span></div>
      </div>
      <div id="aNews"></div>

      <h3>グループ</h3><div id="aGroups"><p class="empty">読み込んでいます…</p></div>
      <h3>みんなのプレイリスト</h3><div class="flist" id="aSongs"><p class="empty">読み込んでいます…</p></div>
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
    $("aNews").innerHTML = snap.size ? `<div class="news">${snap.docs.map(d => newsHtml(d.data()).replace('</div>\n', `</div>`) + `<div class="actions" style="margin:-4px 0 8px"><button class="btn small ghost" data-ndel="${esc(d.id)}">このお知らせを消す</button></div>`).join("")}</div>` : `<p class="empty">まだお知らせはありません。</p>`;
    $("aNews").querySelectorAll("[data-ndel]").forEach(b => b.onclick = () => armed(b, "このお知らせを消す", () => deleteDoc(doc(adb, "announcements", b.dataset.ndel))));
  }, e => console.error(e)));

  adminUnsubs.push(onSnapshot(query(collection(adb, "groups"), orderBy("createdAt", "desc")), snap => {
    $("sGroups").textContent = snap.size;
    const open = new Set([...document.querySelectorAll("#aGroups details[open]")].map(d => d.dataset.gid));
    $("aGroups").innerHTML = snap.size ? snap.docs.map(d => `
      <details data-gid="${esc(d.id)}" ${open.has(d.id) ? "open" : ""}>
        <summary><span><b>${esc(d.data().name)}</b><small>${esc(fmt(d.data().createdAt))}</small></span><span class="note">開く ▾</span></summary>
        <div class="inner" id="ag-${esc(d.id)}"><p class="empty">読み込んでいます…</p></div>
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
    const list = ps.docs.map(d => ({ id: d.id, ...d.data() }));
    box.innerHTML = `
      <div><span class="note">メンバー（${mem.size}人）</span>
        ${mem.docs.map(d => `<div class="mrow"><span>${av(d.data().icon, d.data().color)}${esc(d.data().nickname)}</span><button class="btn small ghost" data-akick="${esc(d.id)}">外す</button></div>`).join("") || `<p class="empty">メンバーはいません。</p>`}</div>
      <div><span class="note">投稿（${list.length}件）</span>
        ${list.map(p => `<div class="arow">${cover({ title: p.title, category: p.category, image: p.image })}
          <div><b>${esc(p.title)}</b><small>${esc(p.nickname)} · ${esc(p.category)} · ♥${likeCount(p)} · ${fmtTime(p.createdAt)}${p.oneline ? " · " + esc(p.oneline) : ""}</small></div>
          <button class="btn small ghost" data-apdel="${esc(p.id)}">消す</button></div>`).join("") || `<p class="empty">投稿はありません。</p>`}</div>
      <div class="actions">
        ${key ? `<button class="btn small ghost" data-acopy="${esc(inviteUrl(gid, key))}">招待リンクをコピー</button>` : ""}
        <button class="btn small ghost" data-aclose>グループを閉じる（全部削除）</button><span class="msg" id="am-${esc(gid)}"></span>
      </div>`;
    box.querySelectorAll("[data-akick]").forEach(b => b.onclick = () => armed(b, "外す", async () => { await deleteDoc(doc(adb, "groups", gid, "members", b.dataset.akick)); loadAdminGroup(gid); }));
    box.querySelectorAll("[data-apdel]").forEach(b => b.onclick = () => armed(b, "消す", async () => { await deletePost(adb, gid, list.find(p => p.id === b.dataset.apdel)); loadAdminGroup(gid); }));
    box.querySelectorAll("[data-acopy]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.acopy); setMsg("am-" + gid, "コピーしました", true); } catch { setMsg("am-" + gid, "コピーできませんでした", false); } });
    box.querySelector("[data-aclose]").onclick = e => armed(e.target, "グループを閉じる（全部削除）", async () => {
      const songs = await getDocs(query(collection(adb, "songs"), where(documentId(), ">=", gid + "_"), where(documentId(), "<", gid + "_")));
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
