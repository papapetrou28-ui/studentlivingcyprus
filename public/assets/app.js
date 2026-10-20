import {
  getUser, login, signup, logout, requestPasswordRecovery, updateUser,
  handleAuthCallback, refreshSession, acceptInvite, onAuthChange, AuthError, MissingIdentityError,
} from "/assets/identity.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const state = { user: null, isAdmin: false, threads: [], activeThread: null, listings: new Map() };

// ---------- Helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (v) => "€" + Number(v).toLocaleString("en-IE", { maximumFractionDigits: 2 });
const when = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.style.display = "none"), 3800);
}

async function api(path, { method = "GET", body, raw, type } = {}) {
  if (state.user) await refreshSession().catch(() => null);
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (raw) headers["content-type"] = type;
  const res = await fetch("/api" + path, {
    method,
    headers,
    credentials: "same-origin",
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401) openAuth("login");
    throw new Error(data?.error || "Something went wrong. Please try again.");
  }
  return data;
}

function busy(button, on, label) {
  if (!button) return;
  if (on) { button.dataset.label = button.textContent; button.textContent = label || "Please wait…"; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
}

// ---------- Navigation ----------
const PAGES = ["home", "properties", "advertise", "roommates", "expenses", "businesses", "messages", "dashboard", "admin"];
const AUTH_PAGES = ["messages", "dashboard"];

function go(id, { push = true } = {}) {
  if (!PAGES.includes(id)) id = "home";
  $$(".modal").forEach((m) => m.classList.remove("open"));
  if (AUTH_PAGES.includes(id) && !state.user) { openAuth("login", id); id = "home"; }
  if (id === "admin" && !state.isAdmin) id = "home";
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === id));
  $$("#nav [data-page]").forEach((b) => b.classList.toggle("active", b.dataset.page === id));
  if (push && location.hash !== "#" + id) history.pushState(null, "", "#" + id);
  window.scrollTo(0, 0);
  ({
    home: loadHome, properties: loadListings, advertise: renderAdvertise, roommates: loadRoommates,
    expenses: calculate, businesses: loadAds, messages: loadMessages, dashboard: loadDashboard, admin: loadAdmin,
  })[id]?.();
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-page]");
  if (nav) { e.preventDefault(); go(nav.dataset.page); return; }
  if (e.target.closest("[data-login]")) { openAuth("login"); return; }
  if (e.target.closest("[data-close]") || e.target.classList.contains("modal")) closeModals();
  const brand = e.target.closest(".brand");
  if (brand) { e.preventDefault(); go("home"); }
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeModals());
window.addEventListener("popstate", () => routeFromHash());

function routeFromHash() {
  const hash = location.hash.slice(1);
  const listing = hash.match(/^listing-(\d+)$/);
  if (listing) { go("properties", { push: false }); openListing(Number(listing[1])); return; }
  go(hash || "home", { push: false });
}

function closeModals() {
  $$(".modal").forEach((m) => m.classList.remove("open"));
  if (/^#listing-/.test(location.hash)) history.replaceState(null, "", "#properties");
}

// ---------- Auth ----------
let authMode = "login";
let afterLogin = null;
let inviteToken = null;

function openAuth(mode = "login", next = null) {
  afterLogin = next;
  setAuthMode(mode);
  $("#authErr").textContent = "";
  $("#authModal").classList.add("open");
  setTimeout(() => $("#authForm input:not([hidden])")?.focus(), 30);
}

function setAuthMode(mode) {
  authMode = mode;
  const titles = { login: "Welcome back", signup: "Create your account", forgot: "Reset your password", reset: "Choose a new password", invite: "Accept your invite" };
  const buttons = { login: "Log in", signup: "Create account", forgot: "Send reset link", reset: "Save new password", invite: "Set password" };
  $("#authTitle").textContent = titles[mode];
  $("#authSubmit").textContent = buttons[mode];
  $("#authTabs").hidden = !["login", "signup"].includes(mode);
  $$("#authTabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === mode));
  $$("#authForm [data-for]").forEach((el) => {
    const show = el.dataset.for.split(" ").includes(mode);
    el.hidden = !show;
    const input = $("input", el);
    if (input) input.required = show && input.name !== "name";
  });
  $("#pwLabel").textContent = mode === "reset" || mode === "invite" ? "New password (at least 8 characters)" : "Password";
  $("#authForm [name=password]").autocomplete = mode === "login" ? "current-password" : "new-password";
}

$("#authTabs").addEventListener("click", (e) => e.target.dataset.tab && setAuthMode(e.target.dataset.tab));
$("#forgotLink").addEventListener("click", () => setAuthMode("forgot"));
$("#loginBtn").addEventListener("click", () => openAuth("login"));
$("#logoutBtn").addEventListener("click", async () => {
  await logout().catch(() => null);
  await refreshMe();
  toast("You're logged out.");
  go("home");
});

function authMessage(err) {
  if (err instanceof MissingIdentityError) return "Accounts aren't switched on for this site yet.";
  if (err instanceof AuthError) {
    if (err.status === 401) return /confirm/i.test(err.message) ? "Please confirm your email first. Check your inbox." : "Wrong email or password.";
    if (err.status === 403) return "New sign-ups are closed at the moment.";
    if (err.status === 422) return err.message || "Check your email and password (at least 8 characters).";
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const email = String(f.get("email") || "").trim();
  const password = String(f.get("password") || "");
  const button = $("#authSubmit");
  $("#authErr").textContent = "";
  busy(button, true);
  try {
    if (authMode === "login") {
      await login(email, password);
      await loggedIn("Welcome back!");
    } else if (authMode === "signup") {
      const user = await signup(email, password, { full_name: String(f.get("name") || "").trim() });
      if (user.emailVerified) await loggedIn("Your account is ready.");
      else { closeModals(); toast("Almost done! Check your email and click the link to confirm your account."); }
    } else if (authMode === "forgot") {
      await requestPasswordRecovery(email);
      closeModals();
      toast("If that email has an account, a reset link is on its way.");
    } else if (authMode === "reset") {
      await updateUser({ password });
      await loggedIn("Password updated.");
    } else if (authMode === "invite") {
      await acceptInvite(inviteToken, password);
      inviteToken = null;
      await loggedIn("Your account is ready.");
    }
    e.target.reset();
  } catch (err) {
    $("#authErr").textContent = authMessage(err);
  } finally {
    busy(button, false);
  }
});

async function loggedIn(message) {
  closeModals();
  await refreshMe();
  toast(message);
  const next = afterLogin;
  afterLogin = null;
  if (next) go(next);
  else routeFromHash();
}

async function refreshMe() {
  state.user = await getUser();
  try {
    const me = await api("/me");
    state.isAdmin = me.isAdmin;
    if (!me.user) state.user = null;
  } catch {
    state.isAdmin = false;
  }
  const loggedIn = !!state.user;
  $("#loginBtn").hidden = loggedIn;
  $("#logoutBtn").hidden = !loggedIn;
  $$("[data-auth]").forEach((el) => (el.hidden = !loggedIn));
  $$("[data-admin]").forEach((el) => (el.hidden = !state.isAdmin));
  loadUnread();
}

async function loadUnread() {
  const badge = $("#unread");
  if (!state.user) { badge.hidden = true; return; }
  const { count } = await api("/messages/unread").catch(() => ({ count: 0 }));
  badge.textContent = count;
  badge.hidden = !count;
}
setInterval(loadUnread, 60000);
onAuthChange(() => refreshMe());

// ---------- Listings ----------
const icon = (type) => (type === "Studio" ? "🛋️" : type === "Room" ? "🛏️" : "🏡");

function card(p, { owner = false } = {}) {
  state.listings.set(p.id, p);
  const cover = p.photos?.[0];
  const status = owner ? `<span class="status ${esc(p.status)}">${{ pending: "Waiting for review", approved: "Live", rejected: "Not approved" }[p.status] || esc(p.status)}</span>` : "";
  return `<article class="card">
    <div class="photo" ${cover ? `style="background-image:url('${esc(cover)}')"` : ""}>${cover ? "" : icon(p.type)}</div>
    <div class="card-content">
      <span class="pill">${esc(p.type)}</span> ${p.featured ? '<span class="badge featured">★ Featured</span>' : ""} ${status}
      <h3 style="margin-top:12px">${esc(p.title)}</h3>
      <p class="meta">📍 ${esc(p.area)} · ${Number(p.beds)} bedroom${p.beds === 1 ? "" : "s"}</p>
      <div class="price">${euro(p.rent)}<span class="meta"> / month</span></div>
      <p class="meta">Deposit: ${euro(p.deposit)} · Est. extra bills: ${euro(p.bills)}/mo</p>
      ${owner && p.status === "rejected" && p.rejectReason ? `<p class="meta danger">Reason: ${esc(p.rejectReason)}</p>` : ""}
      ${owner ? `<p class="meta">${Number(p.views)} views</p>` : ""}
      <div class="card-foot">
        <button class="btn secondary" data-listing="${p.id}">View details</button>
        ${owner ? `<button class="small-btn" data-delete-listing="${p.id}">Delete</button>` : ""}
      </div>
    </div></article>`;
}

const emptyBox = (text) => `<div class="empty wide" style="grid-column:1/-1">${text}</div>`;

async function loadHome() {
  const box = $("#homeListings");
  try {
    const list = await api("/listings?limit=3");
    box.innerHTML = list.map((p) => card(p)).join("") || emptyBox('No listings yet. <button class="link" data-page="advertise">Be the first to post one →</button>');
  } catch (err) { box.innerHTML = emptyBox(esc(err.message)); }
}

let listingsTimer;
async function loadListings() {
  const params = new URLSearchParams();
  const q = $("#q").value.trim();
  if (q) params.set("q", q);
  if ($("#typeFilter").value) params.set("type", $("#typeFilter").value);
  if ($("#priceFilter").value) params.set("max", $("#priceFilter").value);
  const box = $("#allListings");
  try {
    const list = await api("/listings?" + params);
    box.innerHTML = list.map((p) => card(p)).join("") || emptyBox("No listings match your search yet.");
  } catch (err) { box.innerHTML = emptyBox(esc(err.message)); }
}
$("#q").addEventListener("input", () => { clearTimeout(listingsTimer); listingsTimer = setTimeout(loadListings, 250); });
$("#typeFilter").addEventListener("change", loadListings);
$("#priceFilter").addEventListener("change", loadListings);
$("#heroSearchForm").addEventListener("submit", (e) => { e.preventDefault(); $("#q").value = $("#heroSearch").value; go("properties"); });

document.addEventListener("click", async (e) => {
  const view = e.target.closest("[data-listing]");
  if (view) { openListing(Number(view.dataset.listing)); return; }
  const del = e.target.closest("[data-delete-listing]");
  if (del) {
    if (!confirm("Delete this listing? This can't be undone.")) return;
    try { await api("/listings/" + del.dataset.deleteListing, { method: "DELETE" }); toast("Listing deleted."); closeModals(); refreshCurrent(); }
    catch (err) { toast(err.message); }
  }
});

async function openListing(id) {
  const body = $("#detailBody");
  body.innerHTML = '<p class="sub">Loading…</p>';
  $("#detailModal").classList.add("open");
  if (location.hash !== "#listing-" + id) history.replaceState(null, "", "#listing-" + id);
  try {
    const p = await api("/listings/" + id);
    const gallery = p.photos.length
      ? `<div class="gallery">${p.photos.map((src) => `<img src="${esc(src)}" alt="Photo of ${esc(p.title)}" loading="lazy">`).join("")}</div>`
      : `<div class="photo" style="border-radius:16px;margin:14px 0">${icon(p.type)}</div>`;
    let contact;
    if (p.isOwner) contact = `<div class="notice">This is your listing. Messages from students appear in your <button class="link" data-page="messages">inbox</button>.</div>`;
    else if (!state.user) contact = `<div class="panel"><h3>Interested?</h3><p class="sub">Log in or create a free account to message the landlord.</p><button class="btn" data-login style="margin-top:12px">Log in to message</button></div>`;
    else contact = `<form class="panel stack" id="contactForm"><h3>Message the landlord</h3>
        <textarea name="body" required maxlength="2000" style="border:1px solid #cfdedb;border-radius:10px;padding:12px;min-height:100px">Hi! I'm interested in "${esc(p.title)}". Is it still available?</textarea>
        <p class="err"></p><div><button class="btn">Send message</button></div>
        ${p.email ? `<p class="note">Or email: <a href="mailto:${esc(p.email)}" style="color:var(--green)">${esc(p.email)}</a></p>` : ""}</form>`;
    body.innerHTML = `
      <span class="pill">${esc(p.type)}</span> ${p.featured ? '<span class="badge featured">★ Featured</span>' : ""}
      <h2 style="margin-top:12px">${esc(p.title)}</h2>
      <p class="meta">📍 ${esc(p.area)} · ${Number(p.beds)} bedroom${p.beds === 1 ? "" : "s"} · Posted ${day(p.createdAt)}</p>
      ${gallery}
      <div class="price">${euro(p.rent)}<span class="meta"> / month</span></div>
      <p class="meta">Deposit: ${euro(p.deposit)} · Est. extra bills: ${euro(p.bills)}/mo · Total first month: ${euro(p.rent + p.deposit + p.bills)}</p>
      <p style="white-space:pre-wrap">${esc(p.description || "No description provided.")}</p>
      ${contact}
      <p class="note" style="margin-top:16px">Never pay a deposit before viewing the property. <button class="link" id="reportBtn">Report this listing</button></p>`;
    $("#contactForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button", e.target);
      busy(btn, true, "Sending…");
      try {
        await api("/messages", { method: "POST", body: { listingId: p.id, body: e.target.body.value } });
        e.target.innerHTML = `<h3>Message sent ✓</h3><p class="sub">You'll find the reply in <button class="link" data-page="messages">Messages</button>.</p>`;
      } catch (err) { $(".err", e.target).textContent = err.message; busy(btn, false); }
    });
    $("#reportBtn").addEventListener("click", () => report({ listingId: p.id }));
    $$(".gallery img", body).forEach((img) => img.addEventListener("click", () => img.classList.toggle("big")));
  } catch (err) {
    body.innerHTML = `<p class="err">${esc(err.message)}</p>`;
  }
}

async function report(target) {
  const reason = prompt("What's wrong with this post? (e.g. scam, wrong price, already rented)");
  if (!reason) return;
  const email = state.user?.email || prompt("Your email, so we can follow up:");
  if (!email) return;
  try { await api("/reports", { method: "POST", body: { ...target, reason, email } }); toast("Thanks, our team will take a look."); }
  catch (err) { toast(err.message); }
}

// ---------- Post a listing ----------
function renderAdvertise() {
  $("#advertiseGate").hidden = !!state.user;
  $("#listingForm").hidden = !state.user;
  if (state.user && !$("#listingForm").email.value) $("#listingForm").email.value = state.user.email || "";
}

// Shrinks photos in the browser so each upload stays small and fast.
async function shrink(file, max = 1600) {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.82));
}

$("#photoInput").addEventListener("change", (e) => {
  const files = [...e.target.files];
  if (files.length > 6) toast("Only the first 6 photos will be uploaded.");
  $("#photoPreview").innerHTML = files.slice(0, 6).map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join("");
});

$("#listingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return openAuth("login", "advertise");
  const form = e.target;
  const btn = $("button[type=submit]", form);
  const err = $("#listingErr");
  err.textContent = "";
  const data = Object.fromEntries(new FormData(form));
  delete data.photos;
  const files = [...$("#photoInput").files].slice(0, 6);
  busy(btn, true, "Submitting…");
  try {
    const listing = await api("/listings", { method: "POST", body: data });
    let failed = 0;
    for (const [i, file] of files.entries()) {
      btn.textContent = `Uploading photo ${i + 1} of ${files.length}…`;
      try {
        const blob = await shrink(file);
        await api(`/listings/${listing.id}/photos`, { method: "POST", raw: blob, type: blob.type || file.type });
      } catch { failed++; }
    }
    form.reset();
    $("#photoPreview").innerHTML = "";
    toast(failed ? `Listing submitted, but ${failed} photo(s) couldn't be uploaded.` : "Listing submitted! We'll review it shortly.");
    go("dashboard");
  } catch (e2) {
    err.textContent = e2.message;
  } finally {
    busy(btn, false);
  }
});

// ---------- Roommates ----------
function roommateCard(r) {
  const actions = r.isOwner
    ? `<button class="small-btn" data-delete-roommate="${r.id}">Delete my post</button>`
    : `<button class="small-btn" data-message-roommate="${r.id}" data-name="${esc(r.name)}">Message ${esc(r.name)}</button> <button class="link" data-report-roommate="${r.id}" style="font-size:13px;margin-left:8px">Report</button>`;
  return `<div class="panel" style="margin:12px 0"><span class="pill">Budget ${euro(r.budget)}/month</span>
    <h3 style="margin-top:12px">${esc(r.name)}${r.area ? " · " + esc(r.area) : ""}</h3>
    <p style="white-space:pre-wrap">${esc(r.about)}</p><p class="note">Posted ${day(r.createdAt || r.created_at)}</p>${actions}</div>`;
}

async function loadRoommates() {
  const box = $("#roommateList");
  try {
    const list = await api("/roommates");
    box.innerHTML = list.map(roommateCard).join("") || '<div class="empty">No roommate posts yet. Be the first!</div>';
  } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

$("#roommateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return openAuth("login", "roommates");
  const btn = $("button", e.target);
  $("#roommateErr").textContent = "";
  busy(btn, true, "Posting…");
  try {
    await api("/roommates", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast("Your roommate request is live.");
    loadRoommates();
  } catch (err) { $("#roommateErr").textContent = err.message; }
  finally { busy(btn, false); }
});

document.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-delete-roommate]");
  if (del) {
    if (!confirm("Delete this roommate request?")) return;
    try { await api("/roommates/" + del.dataset.deleteRoommate, { method: "DELETE" }); toast("Post deleted."); refreshCurrent(); }
    catch (err) { toast(err.message); }
    return;
  }
  const rep = e.target.closest("[data-report-roommate]");
  if (rep) { report({ roommateId: Number(rep.dataset.reportRoommate) }); return; }
  const msg = e.target.closest("[data-message-roommate]");
  if (msg) {
    if (!state.user) return openAuth("login", "roommates");
    const text = prompt(`Message to ${msg.dataset.name}:`, "Hi! I saw your roommate post and I'm also looking for a place.");
    if (!text) return;
    try { await api("/messages", { method: "POST", body: { roommateId: Number(msg.dataset.messageRoommate), body: text } }); toast("Message sent. Replies appear in Messages."); }
    catch (err) { toast(err.message); }
  }
});

// ---------- Messages ----------
async function loadMessages(keep = false) {
  try {
    state.threads = await api("/messages");
  } catch (err) {
    $("#threads").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  if (!keep) state.activeThread = state.threads[0]?.key || null;
  renderThreads();
  renderConvo();
}

function renderThreads() {
  $("#threads").innerHTML = state.threads.map((t) => `
    <button class="thread ${t.key === state.activeThread ? "active" : ""}" data-thread="${esc(t.key)}">
      <strong>${esc(t.otherName || "Student")}</strong>${t.unread ? ` <span class="count">${t.unread}</span>` : ""}
      <small>${esc(t.subject)}</small>
      <small>${esc(t.messages.at(-1).body.slice(0, 60))}</small>
    </button>`).join("") || '<div class="empty">No messages yet. Message a landlord or roommate to start a conversation.</div>';
}

async function renderConvo() {
  const t = state.threads.find((x) => x.key === state.activeThread);
  const box = $("#convo");
  if (!t) { box.innerHTML = '<div class="empty">Choose a conversation.</div>'; return; }
  const link = t.listingId ? `<button class="link" data-listing="${t.listingId}">View listing</button>` : "";
  box.innerHTML = `<h3>${esc(t.otherName || "Student")}</h3><p class="note" style="margin-top:0">${esc(t.subject)} ${link}</p>
    <div class="bubbles">${t.messages.map((m) => `<div class="bubble ${m.mine ? "mine" : ""}">${esc(m.body)}<time>${when(m.createdAt)}</time></div>`).join("")}</div>
    <form class="reply" id="replyForm"><textarea name="body" required maxlength="2000" placeholder="Write a reply…"></textarea><button class="btn">Send</button></form>`;
  const bubbles = $(".bubbles", box);
  bubbles.scrollTop = bubbles.scrollHeight;
  $("#replyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button", e.target);
    busy(btn, true, "…");
    try {
      await api("/messages", { method: "POST", body: { listingId: t.listingId, roommateId: t.roommateId, to: t.otherId, body: e.target.body.value } });
      await loadMessages(true);
    } catch (err) { toast(err.message); busy(btn, false); }
  });
  if (t.unread) {
    await api("/messages/read", { method: "POST", body: { otherId: t.otherId, listingId: t.listingId, roommateId: t.roommateId } }).catch(() => null);
    t.unread = 0;
    renderThreads();
    loadUnread();
  }
}

$("#threads").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-thread]");
  if (!btn) return;
  state.activeThread = btn.dataset.thread;
  renderThreads();
  renderConvo();
});

// ---------- Dashboard ----------
async function loadDashboard() {
  if (!state.user) return;
  $("#dashHello").textContent = `Logged in as ${state.user.name ? state.user.name + " · " : ""}${state.user.email}`;
  try {
    const { listings, roommates } = await api("/my");
    $("#myListings").innerHTML = listings.map((p) => card(p, { owner: true })).join("") || emptyBox('No listings yet. <button class="link" data-page="advertise">Post your first listing →</button>');
    $("#myRoommates").innerHTML = roommates.map(roommateCard).join("") || '<div class="empty">No roommate requests yet.</div>';
  } catch (err) { $("#myListings").innerHTML = emptyBox(esc(err.message)); }
}

// ---------- Student deals ----------
async function loadAds() {
  const box = $("#adsList");
  try {
    const ads = await api("/ads");
    box.innerHTML = ads.map((a) => `<article class="card deal"><div class="card-content deal" style="height:100%">
        <span class="pill">${esc(a.business)}</span> ${a.tier === "featured" ? '<span class="badge featured">★ Featured</span>' : ""}
        <h3 style="margin-top:12px">${esc(a.title)}</h3><p class="sub">${esc(a.description)}</p>
        ${a.url ? `<div class="card-foot"><a class="btn secondary" href="/api/ads/${a.id}/go" target="_blank" rel="noopener sponsored">Get the deal →</a></div>` : ""}
      </div></article>`).join("") || emptyBox("No deals right now. Local businesses: advertise below!");
  } catch (err) { box.innerHTML = emptyBox(esc(err.message)); }
}

$("#advertiseBizForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("button", e.target);
  $("#bizErr").textContent = "";
  busy(btn, true, "Sending…");
  try {
    await api("/reports", { method: "POST", body: { kind: "advertise", ...Object.fromEntries(new FormData(e.target)) } });
    e.target.reset();
    toast("Thanks! We'll be in touch about advertising.");
  } catch (err) { $("#bizErr").textContent = err.message; }
  finally { busy(btn, false); }
});

// ---------- Admin ----------
function adminListing(p, pending) {
  const featuredUntil = p.featuredUntil && new Date(p.featuredUntil) > new Date() ? `★ Featured until ${day(p.featuredUntil)}` : "";
  return `<div class="admin-row"><div>
      <strong>${esc(p.title)}</strong> <span class="status ${esc(p.status)}">${esc(p.status)}</span>
      <p class="meta" style="margin:6px 0">${esc(p.type)} · ${esc(p.area)} · ${euro(p.rent)}/mo · ${p.photos.length} photo(s) · ${esc(p.email)} · ${day(p.createdAt)}</p>
      ${featuredUntil ? `<p class="meta">${featuredUntil}</p>` : ""}
    </div><div class="actions">
      <button class="small-btn" data-listing="${p.id}">Open</button>
      ${p.status !== "approved" ? `<button class="btn" data-admin-action="approve" data-id="${p.id}">Approve</button>` : ""}
      ${p.status !== "rejected" ? `<button class="small-btn danger" data-admin-action="reject" data-id="${p.id}">Reject</button>` : ""}
      ${!pending && p.status === "approved" ? `<button class="small-btn" data-admin-action="feature" data-id="${p.id}">${featuredUntil ? "Change featured" : "Feature"}</button>` : ""}
      <button class="small-btn danger" data-delete-listing="${p.id}">Delete</button>
    </div></div>`;
}

async function loadAdmin() {
  if (!state.isAdmin) return;
  try {
    const { pending, recent, reports, ads } = await api("/admin/overview");
    $("#adminPending").innerHTML = pending.map((p) => adminListing(p, true)).join("") || '<div class="empty">Nothing waiting for review. 🎉</div>';
    $("#adminRecent").innerHTML = recent.map((p) => adminListing(p, false)).join("") || '<div class="empty">No reviewed listings yet.</div>';
    $("#adminReports").innerHTML = reports.map((r) => `<div class="admin-row"><div>
        <strong>${r.kind === "advertise" ? "📣 Advertising enquiry: " : "⚠️ Report: "}${esc(r.reason)}</strong>
        <p class="meta" style="margin:6px 0">${esc(r.email)} · ${day(r.created_at)}${r.listing_id ? ` · <button class="link" data-listing="${r.listing_id}">listing #${r.listing_id}</button>` : ""}${r.roommate_id ? ` · roommate post #${r.roommate_id} <button class="link danger" data-delete-roommate="${r.roommate_id}">delete post</button>` : ""}</p>
        ${r.message ? `<p style="margin:0;white-space:pre-wrap">${esc(r.message)}</p>` : ""}
      </div><div class="actions"><a class="small-btn" href="mailto:${esc(r.email)}">Email</a><button class="small-btn" data-resolve="${r.id}">Mark done</button></div></div>`).join("") || '<div class="empty">No open reports or enquiries.</div>';
    $("#adminAds").innerHTML = ads.map((a) => `<div class="admin-row"><div><strong>${esc(a.business)}: ${esc(a.title)}</strong>
        <p class="meta" style="margin:6px 0">${esc(a.tier)} · until ${day(a.ends_at)} · ${a.clicks} clicks${new Date(a.ends_at) < new Date() ? " · expired" : ""}</p></div>
        <div class="actions"><button class="small-btn danger" data-delete-ad="${a.id}">Remove</button></div></div>`).join("");
  } catch (err) { $("#adminPending").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

document.addEventListener("click", async (e) => {
  const action = e.target.closest("[data-admin-action]");
  const resolve = e.target.closest("[data-resolve]");
  const delAd = e.target.closest("[data-delete-ad]");
  try {
    if (action) {
      const body = { action: action.dataset.adminAction };
      if (body.action === "reject") {
        body.reason = prompt("Reason shown to the owner (optional):", "");
        if (body.reason === null) return;
      }
      if (body.action === "feature") {
        const days = prompt("Feature this listing for how many days? (0 to stop featuring)", "30");
        if (days === null) return;
        body.days = Number(days);
      }
      await api("/admin/listings/" + action.dataset.id, { method: "POST", body });
      toast("Saved.");
      loadAdmin();
    } else if (resolve) {
      await api(`/admin/reports/${resolve.dataset.resolve}/resolve`, { method: "POST", body: {} });
      loadAdmin();
    } else if (delAd) {
      if (!confirm("Remove this deal?")) return;
      await api("/admin/ads/" + delAd.dataset.deleteAd, { method: "DELETE" });
      loadAdmin();
    }
  } catch (err) { toast(err.message); }
});

$("#adForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/admin/ads", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast("Deal added.");
    loadAdmin();
  } catch (err) { toast(err.message); }
});

function refreshCurrent() {
  const page = $(".page.active")?.id;
  if (page) go(page, { push: false });
}

// ---------- Expenses calculator ----------
const COST_IDS = ["rent", "electric", "water", "internet", "common", "other"];
const val = (id) => Math.max(0, Number($("#" + id).value) || 0);
function calculate() {
  const total = COST_IDS.reduce((s, id) => s + val(id), 0);
  const people = Number($("#people").value);
  $("#total").textContent = euro(total);
  $("#each").textContent = euro(total / people);
}
$("#calc").addEventListener("input", calculate);
$("#copyBudget").addEventListener("click", async () => {
  const people = Number($("#people").value);
  const total = COST_IDS.reduce((s, id) => s + val(id), 0);
  const text = COST_IDS.map((id) => `${id}: ${euro(val(id))}`).join("\n") + `\nTotal: ${euro(total)}\nPer student (${people}): ${euro(total / people)}`;
  try { await navigator.clipboard.writeText(text); toast("Breakdown copied"); }
  catch { prompt("Copy your breakdown:", text); }
});

// ---------- Start ----------
async function start() {
  try {
    const result = await handleAuthCallback();
    if (result) {
      history.replaceState(null, "", location.pathname);
      await refreshMe();
      if (result.type === "recovery") { openAuth("reset"); }
      else if (result.type === "confirmation") toast("Email confirmed. Welcome to Student Living Cyprus!");
      else if (result.type === "invite") { inviteToken = result.token; openAuth("invite"); }
      else if (result.type === "email_change") toast("Your email address was updated.");
    } else {
      await refreshMe();
    }
  } catch (err) {
    await refreshMe();
    toast(authMessage(err));
  }
  calculate();
  routeFromHash();
}
start();
