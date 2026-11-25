"use strict";
/* ==========================================================================
   Vaultkeeper - interface logic
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CORE_LABELS = { username: "Username", password: "Password", url: "Link", totp: "2FA key" };

let API = null;
async function call(name, ...args) {
  const r = await API[name](...args);
  if (!r || !r.ok) throw new Error((r && r.error) || "Error");
  return r;
}

const S = {
  state: null,
  entries: [],
  filter: { kind: "all", value: null },
  q: "",
  sort: "name",
  selId: null,
  reveal: new Set(),
  settings: { auto_lock_min: 5, clip_seconds: 30, theme: "dark", lock_on_minimize: false },
  unlocked: false,
  lastActivity: Date.now(),
  lastPing: 0,
  lastSync: null,
  mini: null,
  quick: null,
  pendingQuick: false,
  recent: [],
  hotkeyLabel: "Ctrl + Shift + Space",
  gen: { length: 20, lower: true, upper: true, digits: true, symbols: true, avoid_ambiguous: true },
};

/* ------------------------------------------------------------------ util */

function typeOf(e) { return TYPES[e.type] || TYPES.other; }
function getVal(e, k) { return k.startsWith("f:") ? (e.fields || {})[k.slice(2)] || "" : e[k] || ""; }
function hostOf(url) {
  if (!url) return "";
  try { return new URL(url.includes("://") ? url : "https://" + url).hostname.replace(/^www\./, ""); } catch { return url; }
}
function subtitleOf(e) {
  const t = typeOf(e);
  if (t.sub && getVal(e, t.sub)) return getVal(e, t.sub);
  if (e.username) return e.username;
  if (e.url) return hostOf(e.url);
  return t.label;
}
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDay(iso) {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
function daysUntil(iso) {
  const t = Date.parse(iso + "T00:00:00");
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}
function strength(pw) {
  if (!pw) return { bits: 0, label: "", pct: 0, color: "var(--muted)" };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
  let bits = Math.round(pw.length * Math.log2(Math.max(pool, 2)));
  if (/^(.)\1+$/.test(pw) || /^(123|abc|qwe|pass|password)/i.test(pw)) bits = Math.min(bits, 20);
  const lv = bits < 40 ? ["Weak", "var(--danger)"] : bits < 60 ? ["Fair", "var(--warn)"] : bits < 80 ? ["Good", "#84cc16"] : ["Strong", "var(--ok)"];
  return { bits, label: lv[0], color: lv[1], pct: Math.min(100, Math.max(8, bits / 1.1)) };
}
function strengthHTML(pw, cls = "") {
  const s = strength(pw);
  return `<div class="strength ${cls}" style="--w:${s.pct}%;--c:${s.color}"><i></i><b>${s.label}${s.bits ? ` · ${s.bits} bits` : ""}</b></div>`;
}
function tileHTML(e, cls = "") {
  const t = typeof e === "string" ? TYPES[e] : typeOf(e);
  return `<div class="tile ${cls}" style="--c:${t.color}">${icon(t.icon)}</div>`;
}
function shortPath(p, max = 52) { return p.length <= max ? p : "…" + p.slice(-(max - 1)); }
function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }
function selected() { return S.entries.find((e) => e.id === S.selId) || null; }

/* ----------------------------------------------------------------- toast */

function toast(msg, kind = "ok", seconds = 0) {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = `${icon(kind === "err" ? "alert" : kind === "info" ? "clock" : "check")}<span>${esc(msg)}</span>` +
    (seconds ? `<div class="bar" style="animation-duration:${seconds}s"></div>` : "");
  const root = $("#toasts");
  root.querySelectorAll(".toast").forEach((t, i, all) => { if (all.length >= 3 && i === 0) t.remove(); });
  root.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 200); }, kind === "err" ? 4200 : 2600);
}

/* ---------------------------------------------------------------- modals */

function openModal({ title, iconName, body, foot, cls = "", onClose }) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal ${cls}" role="dialog">
    <div class="modal-head">${iconName ? icon(iconName, "lg") : ""}<h3>${esc(title)}</h3>
      <button class="icon-btn" data-close title="Close (Esc)">${icon("x")}</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div>`;
  const close = () => { ov.remove(); onClose && onClose(); };
  ov.addEventListener("mousedown", (ev) => { if (ev.target === ov) close(); });
  ov.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  ov._close = close;
  $("#modalRoot").appendChild(ov);
  return ov;
}
function topModal() { const m = $$("#modalRoot .overlay"); return m[m.length - 1] || null; }

function confirmModal(title, text, okLabel = "Confirm", danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, iconName: danger ? "alert" : "check", cls: "narrow",
      body: `<p style="margin:0;color:var(--text-2)">${text}</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? "danger" : "primary"}" data-ok>${esc(okLabel)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.querySelector("[data-ok]").addEventListener("click", () => { done = true; m._close(); resolve(true); });
    m.querySelector("[data-ok]").focus();
  });
}

function closeMenu() { $("#menuRoot").innerHTML = ""; }
function openMenu(x, y, items) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "menu";
  m.innerHTML = items.map((it, i) => it === "-" ? "<hr>" :
    `<button data-i="${i}" class="${it.danger ? "danger" : ""}">${icon(it.icon)}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${it.kbd}</kbd>` : ""}</button>`).join("");
  $("#menuRoot").appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  m.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (!b) return;
    closeMenu();
    items[+b.dataset.i].run();
  });
}
document.addEventListener("mousedown", (ev) => {
  if (!ev.target.closest(".menu")) closeMenu();
  if (!ev.target.closest("#vaultPicker")) $("#vaultPicker")?.classList.remove("open");
});

/* ==========================================================================
   Lock screen
   ========================================================================== */

async function showLock(message) {
  S.unlocked = false;
  S.entries = [];
  S.reveal.clear();
  const wasQuick = !!S.quick;
  S.mini = null;
  S.quick = null;
  document.body.classList.remove("is-mini");
  $("#quick").hidden = true;
  if (wasQuick) call("exit_quick", false).catch(() => {});
  $("#modalRoot").innerHTML = "";
  closeMenu();
  $("#app").hidden = true;
  $("#mini").hidden = true;
  $("#lock").hidden = false;
  document.title = "Vaultkeeper";
  const st = (await call("get_state"));
  S.state = st;
  S.settings = st.settings;
  applyTheme();
  renderLock(message);
}

function renderLock(message) {
  const st = S.state;
  const creating = !st.exists;
  $("#lockLogo").innerHTML = logo("full");
  $("#lockSubtitle").textContent = creating
    ? "Create a new vault. The master password cannot be recovered — write it down and keep it somewhere safe."
    : "Enter your master password to unlock";
  $("#vaultCurrent").innerHTML = `<div class="vc-icon">${icon("folder", "sm")}</div>
    <div class="vc-text"><b>${esc(st.vault_name)}${creating ? ' <span class="pill">NEW</span>' : ""}</b><small title="${esc(st.vault_path)}">${esc(shortPath(st.vault_path))}</small></div>${icon("chevronDown", "sm")}`;
  const recent = st.recent.filter((r) => r.path !== st.vault_path);
  $("#vaultMenu").innerHTML =
    recent.map((r) => `<button data-path="${esc(r.path)}" title="${esc(r.path)}">${icon("folder")}<span>${esc(r.name)}<small>${esc(shortPath(r.path))}</small></span></button>`).join("") +
    (recent.length ? "<hr>" : "") +
    `<button data-act="open">${icon("upload")}<span>Open existing vault…</span></button>
     <button data-act="new">${icon("plus")}<span>Create new vault…</span></button>`;
  $("#confirmWrap").hidden = !creating;
  $("#masterStrength").hidden = !creating;
  $("#lockSubmit").innerHTML = creating ? `${icon("plus")} Create vault` : `${icon("lock")} Unlock`;
  $("#lockError").textContent = message || "";
  $("#lockError").style.color = message ? "var(--warn)" : "";
  $("#lockFoot").innerHTML = `<span>${icon("check")}AES-256-GCM</span><span>${icon("check")}Argon2id</span><span>${icon("check")}100% local</span>`;
  $("#masterPw").value = "";
  $("#masterPw2").value = "";
  updateMasterStrength();
  $("#helloWrap").hidden = true;
  $("#lockSubmit").classList.add("primary");
  setTimeout(() => $("#masterPw").focus(), 30);
  if (!creating) refreshHello();
}

async function refreshHello() {
  try {
    const h = await call("hello_status");
    S.hello = h;
    const usable = h.enabled && !h.need_master;
    $("#helloWrap").hidden = !usable;
    $("#helloBtn").innerHTML = `${icon("fingerprint")} Unlock with Windows Hello`;
    $("#lockSubmit").classList.toggle("primary", !usable);
    if (h.enabled && h.need_master) {
      $("#lockSubtitle").textContent = `Enter your master password — it is required once every ${h.master_days} days so you don't forget it. Windows Hello works again afterwards.`;
    }
    if (usable) setTimeout(() => $("#helloBtn").focus(), 40);
    if (usable && S.pendingQuick) helloUnlock();
  } catch { S.hello = null; }
}

async function helloUnlock() {
  const btn = $("#helloBtn");
  const err = $("#lockError");
  btn.disabled = true;
  err.style.color = "var(--muted)";
  err.textContent = "Confirm with Windows Hello (fingerprint, face or PIN)…";
  try {
    const r = await API.hello_unlock();
    if (!r.ok) throw new Error(r.error);
    err.textContent = "";
    await enterApp();
  } catch (e) {
    err.style.color = "";
    err.textContent = e.message === "Cancelled." ? "" : e.message;
    if (/master password|was changed|does not match/i.test(e.message)) refreshHello();
    $("#masterPw").focus();
  } finally { btn.disabled = false; }
}

function updateMasterStrength() {
  const pw = $("#masterPw").value;
  const s = strength(pw);
  const el = $("#masterStrength");
  el.style.setProperty("--w", (pw ? s.pct : 0) + "%");
  el.style.setProperty("--c", s.color);
  el.querySelector("b").textContent = pw ? s.label : "";
}

function bindLock() {
  $('[data-toggle-pw="masterPw"]').innerHTML = icon("eye");
  $("#helloBtn").addEventListener("click", helloUnlock);
  $("#vaultCurrent").addEventListener("click", () => $("#vaultPicker").classList.toggle("open"));
  $("#vaultMenu").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    $("#vaultPicker").classList.remove("open");
    try {
      if (b.dataset.path) await call("set_vault_path", b.dataset.path);
      else {
        const r = await call("choose_vault", b.dataset.act);
        if (!r.path) return;
      }
      S.state = await call("get_state");
      renderLock();
    } catch (e) { $("#lockError").textContent = e.message; }
  });
  $("#masterPw").addEventListener("input", updateMasterStrength);
  const caps = (ev) => {
    const on = ev.getModifierState && ev.getModifierState("CapsLock");
    $("#capsWarn").hidden = !on;
    $("#capsWarn").innerHTML = icon("alert", "sm") + "Caps Lock is on";
  };
  $("#masterPw").addEventListener("keyup", caps);
  $("#masterPw").addEventListener("keydown", caps);
  $("#lockForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pw = $("#masterPw").value;
    if (!pw) return;
    const creating = !S.state.exists;
    const err = $("#lockError");
    err.style.color = "";
    if (creating) {
      if (pw.length < S.state.min_master_len) return lockFail(`The master password must be at least ${S.state.min_master_len} characters long.`);
      if (pw !== $("#masterPw2").value) return lockFail("Passwords do not match.");
    }
    const btn = $("#lockSubmit");
    btn.disabled = true;
    err.style.color = "var(--muted)";
    err.textContent = creating ? "Creating vault…" : "Unlocking…";
    try {
      await call(creating ? "create_vault" : "unlock", pw);
      $("#masterPw").value = "";
      $("#masterPw2").value = "";
      err.textContent = "";
      await enterApp();
    } catch (e) {
      lockFail(e.message);
    } finally {
      btn.disabled = false;
    }
  });
}

function lockFail(msg) {
  const err = $("#lockError");
  err.style.color = "";
  err.textContent = msg;
  const card = $(".lock-card");
  card.classList.remove("shake");
  void card.offsetWidth;
  card.classList.add("shake");
  $("#masterPw").select();
}

/* ==========================================================================
   Main screen
   ========================================================================== */

async function enterApp() {
  S.unlocked = true;
  S.selId = null;
  S.q = "";
  S.filter = { kind: "all", value: null };
  $("#search").value = "";
  await loadEntries();
  $("#lock").hidden = true;
  $("#app").hidden = false;
  S.lastActivity = Date.now();
  S.lastSync = new Date();
  renderAll();
  const first = filtered()[0];
  if (first) select(first.id);
  $("#search").focus();
  loadHotkeyLabel();
  checkBridge();
  if (S.pendingQuick) { S.pendingQuick = false; openQuick(); }
}

async function checkBridge() {
  try {
    const b = await call("bridge_status");
    if (b.enabled && !b.running) toast("Browser connection is not working: " + (b.error || "unknown error"), "err");
  } catch {}
}

async function loadHotkeyLabel() {
  try {
    const h = await call("hotkey_status");
    const o = h.options.find((x) => x.key === h.combo);
    S.hotkeyLabel = o && h.active ? o.label : "";
  } catch { S.hotkeyLabel = ""; }
}

async function loadEntries() {
  const r = await call("list_entries");
  S.entries = r.entries;
  S.vaultName = r.vault_name;
  document.title = "Vaultkeeper — " + r.vault_name;
}

function renderAll() {
  renderSidebar();
  renderList();
  renderDetail();
}

/* -------------------------------------------------------------- sidebar */

function counts() {
  const c = { all: S.entries.length, fav: 0, otp: 0, types: {}, tags: {} };
  for (const e of S.entries) {
    if (e.favorite) c.fav++;
    if (e.totp) c.otp++;
    c.types[e.type] = (c.types[e.type] || 0) + 1;
    for (const t of e.tags || []) c.tags[t] = (c.tags[t] || 0) + 1;
  }
  return c;
}

function navBtn(kind, value, iconHTML, label, count, extraCls = "") {
  const active = S.filter.kind === kind && S.filter.value === value ? "active" : "";
  return `<button class="nav-item ${active} ${extraCls}" data-kind="${kind}" data-value="${esc(value ?? "")}" title="${esc(label)}">${iconHTML}<span>${esc(label)}</span>${count !== null ? `<em>${count}</em>` : ""}</button>`;
}

function renderSidebar() {
  const c = counts();
  $("#vaultNameSide").textContent = S.vaultName || "";
  $(".brand .brand-mark").innerHTML = logo("small");
  $("#navMain").innerHTML =
    navBtn("all", null, icon("grid"), "All items", c.all) +
    navBtn("fav", null, icon("star"), "Favorites", c.fav) +
    navBtn("otp", null, icon("twofa"), "With 2FA code", c.otp);
  const shownTypes = TYPE_ORDER.filter((k) => c.types[k] || (S.filter.kind === "type" && S.filter.value === k));
  $("#navTypes").innerHTML = shownTypes.map((k) => {
    const t = TYPES[k];
    return navBtn("type", k, `<span style="color:${t.color};display:contents">${icon(t.icon)}</span>`, t.plural, c.types[k] || 0);
  }).join("") || `<div class="muted" style="font-size:12px;padding:4px 10px 8px">Categories appear once you add items.</div>`;
  $$("#navTypes .nav-item .ic").forEach((el) => { el.style.color = el.parentElement.style.color; });
  const tags = Object.keys(c.tags).sort((a, b) => a.localeCompare(b, "en"));
  $("#tagsTitle").hidden = !tags.length;
  $("#navTags").innerHTML = tags.map((t) => navBtn("tag", t, icon("tag"), t, c.tags[t])).join("");
  const issues = healthReport().issueCount;
  $("#navTools").innerHTML =
    `<button class="nav-item" data-tool="health">${icon("shieldCheck")}<span>Security</span>${issues ? `<em class="badge">${issues}</em>` : ""}</button>
     <button class="nav-item" data-tool="gen">${icon("wand")}<span>Password generator</span></button>
     <button class="nav-item" data-tool="import">${icon("upload")}<span>Import (CSV)</span></button>
     <button class="nav-item" data-tool="settings">${icon("settings")}<span>Settings</span></button>
     <button class="nav-item" data-tool="lock">${icon("lock")}<span>Lock</span><em><kbd>Ctrl L</kbd></em></button>
     <button class="nav-item" data-tool="quit">${icon("power")}<span>Exit Vaultkeeper</span></button>`;
  renderSync();
}

function renderSync() {
  if (!S.unlocked) return;
  call("backup_info").then((b) => {
    const ok = !S.settings.backup_enabled ? null : b.last && Date.now() / 1000 - b.last < 3 * 86400;
    $("#syncRow").innerHTML = `<i style="${ok === false ? "background:var(--warn);box-shadow:0 0 0 3px rgba(245,158,11,.15)" : ok === null ? "background:var(--muted);box-shadow:none" : ""}"></i>` +
      `<span title="${esc(b.dir)}">${S.settings.backup_enabled ? "Backup: " + esc(relTime(b.last)) : "Automatic backup is off"}</span>`;
  }).catch(() => {});
}

/* ----------------------------------------------------------------- list */

function matches(e, q) {
  if (!q) return true;
  const t = typeOf(e);
  const parts = [e.title, e.username, e.url, t.label, ...(e.tags || [])];
  for (const f of t.fields) if (f.k.startsWith("f:") && !f.secret) parts.push(getVal(e, f.k));
  return parts.some((p) => p && String(p).toLowerCase().includes(q));
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  const f = S.filter;
  let list = S.entries.filter((e) => {
    if (f.kind === "fav" && !e.favorite) return false;
    if (f.kind === "otp" && !e.totp) return false;
    if (f.kind === "type" && e.type !== f.value) return false;
    if (f.kind === "tag" && !(e.tags || []).includes(f.value)) return false;
    return matches(e, q);
  });
  if (S.sort === "recent") list.sort((a, b) => b.updated - a.updated);
  else list.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
  return list;
}

function listTitle() {
  const f = S.filter;
  if (f.kind === "fav") return "Favorites";
  if (f.kind === "otp") return "With 2FA code";
  if (f.kind === "type") return TYPES[f.value].plural;
  if (f.kind === "tag") return "#" + f.value;
  return "All items";
}

function renderList() {
  const list = filtered();
  $("#listTitle").textContent = S.q ? "Search results" : listTitle();
  $("#listCount").textContent = list.length;
  $("#btnSort").innerHTML = `${icon("sort", "sm")} ${S.sort === "recent" ? "Recently modified" : "By name"}`;
  if (!list.length) {
    $("#list").innerHTML = `<div class="empty-list">${icon(S.q ? "search" : "box")}<div>${S.q ? "No results for “" + esc(S.q) + "”" : "No items here yet"}</div></div>`;
    return;
  }
  let html = "";
  let group = null;
  for (const e of list) {
    if (S.sort === "name" && !S.q) {
      const g = (e.title[0] || "#").toUpperCase();
      const gg = /[A-Z]/.test(g) ? g : "#";
      if (gg !== group) { group = gg; html += `<div class="list-group">${esc(gg)}</div>`; }
    }
    html += `<div class="item ${e.id === S.selId ? "sel" : ""}" data-id="${e.id}">
      ${tileHTML(e)}
      <div class="meta"><div class="t">${esc(e.title)}</div><div class="s">${esc(subtitleOf(e))}</div></div>
      <div class="flags">${(e.attachments || []).length ? icon("paperclip") : ""}${e.totp ? '<span class="pill otp">2FA</span>' : ""}${e.favorite ? icon("star", "fav") : ""}</div>
    </div>`;
  }
  $("#list").innerHTML = html;
}

function select(id, scroll = true) {
  if (S.selId !== id) S.reveal.clear();
  S.selId = id;
  $$("#list .item").forEach((el) => el.classList.toggle("sel", el.dataset.id === id));
  if (scroll) $(`#list .item[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  renderDetail();
}

function moveSel(delta) {
  const list = filtered();
  if (!list.length) return;
  let i = list.findIndex((e) => e.id === S.selId);
  i = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + delta));
  select(list[i].id);
}

/* -------------------------------------------------------------- details */

function fieldRows(e) {
  const t = typeOf(e);
  const defs = [...t.fields];
  const known = new Set(defs.map((f) => f.k));
  for (const k of ["username", "password", "url", "totp"]) if (!known.has(k) && e[k]) defs.push({ k, label: CORE_LABELS[k], secret: k === "password", url: k === "url", totp: k === "totp" });
  for (const k of Object.keys(e.fields || {})) if (!known.has("f:" + k) && e.fields[k]) defs.push({ k: "f:" + k, label: k, extra: true });
  return defs.filter((f) => getVal(e, f.k));
}

function maskCard(num) {
  const d = num.replace(/\s+/g, "");
  return "•••• ".repeat(3) + d.slice(-4);
}
function groupCard(num) { return num.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim(); }

function renderField(e, f) {
  const v = getVal(e, f.k);
  const shown = S.reveal.has(f.k);
  const copyBtn = `<button class="icon-btn" data-copy="${f.k}" title="Copy">${icon("copy")}</button>`;
  const eyeBtn = `<button class="icon-btn" data-reveal="${f.k}" title="${shown ? "Hide" : "Show"}">${icon(shown ? "eyeOff" : "eye")}</button>`;
  let val = "", acts = copyBtn, extra = "";

  if (f.totp) {
    val = `<div class="otp-wrap"><span class="otp-code" id="otpCode">••• •••</span><div class="ring" id="otpRing"><svg viewBox="0 0 30 30"><circle class="bg" cx="15" cy="15" r="12"/><circle class="fg" cx="15" cy="15" r="12" stroke-dasharray="75.4" stroke-dashoffset="0"/></svg><b></b></div></div>`;
    return `<div class="frow" data-k="totp"><div class="fl"><label>2FA code</label>${val}</div><div class="fa" style="opacity:1"><button class="icon-btn" data-copy="totp" title="Copy 2FA code (Ctrl+T)">${icon("copy")}</button></div></div>`;
  }
  if (f.secret) {
    acts = eyeBtn + copyBtn;
    if (!shown) {
      val = `<div class="fv mono masked">${f.cardnum ? esc(maskCard(v)) : f.multiline ? "•••• •••• •••• ••••" : "••••••••••••"}</div>`;
    } else if (f.seed) {
      const words = v.trim().split(/\s+/);
      val = `<div class="seed-grid selectable">${words.map((w, i) => `<span><i>${i + 1}</i>${esc(w)}</span>`).join("")}</div>`;
    } else if (f.multiline) {
      val = `<div class="fv mono selectable"><pre>${esc(v)}</pre></div>`;
    } else {
      val = `<div class="fv mono selectable">${esc(f.cardnum ? groupCard(v) : v)}</div>`;
    }
    if (f.k === "password") extra = strengthHTML(v, "str");
    if (f.seed) extra = `<div class="hint" style="color:var(--warn);display:flex;gap:6px;align-items:center">${icon("alert", "sm")}Anyone with the seed phrase has full access to the wallet. Never share it.</div>`;
  } else if (f.url) {
    val = `<div class="fv"><a data-open-url title="Open in browser">${esc(v)}</a></div>`;
    acts = `<button class="icon-btn" data-open-url title="Open in browser">${icon("external")}</button>` + copyBtn;
  } else if (f.date) {
    const d = daysUntil(v);
    let note = "";
    if (d !== null) note = d < 0 ? `<span style="color:var(--danger)"> · expired ${-d} d ago</span>` : d <= 30 ? `<span style="color:var(--warn)"> · in ${d} d</span>` : `<span class="muted"> · in ${d} d</span>`;
    val = `<div class="fv">${esc(fmtDay(v))}${note}</div>`;
  } else if (f.multiline) {
    val = `<div class="fv ${f.mono ? "mono" : ""} selectable"><pre>${esc(v)}</pre></div>`;
  } else {
    val = `<div class="fv ${f.mono ? "mono" : ""} selectable">${esc(v)}</div>`;
  }
  return `<div class="frow" data-k="${f.k}"><div class="fl"><label>${esc(f.label)}</label>${val}${extra}</div><div class="fa">${acts}</div></div>`;
}

function renderDetail() {
  const e = selected();
  const d = $("#detail");
  if (!e) {
    d.innerHTML = `<div class="empty-detail"><div>
      <div class="hero">${icon("shieldCheck")}</div>
      <h3>${S.entries.length ? "Select an item" : "Vaultkeeper is ready"}</h3>
      <p>${S.entries.length ? "Select an item from the list to see its details, or add a new one." : "Add your first password or import existing ones from 1Password, Bitwarden or Chrome."}</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn primary" data-act="new">${icon("plus")} New item</button>
        ${S.entries.length ? "" : `<button class="btn" data-act="import">${icon("upload")} Import CSV</button>`}
      </div>
      <div class="shortcuts muted">
        <kbd>Ctrl K</kbd><span>Search</span><kbd>Ctrl N</kbd><span>New item</span>
        <kbd>↑ ↓</kbd><span>Move through the list</span><kbd>Ctrl B / C / T</kbd><span>Copy username / password / 2FA</span>
        <kbd>Ctrl Enter</kbd><span>Log in</span><kbd>Ctrl L</kbd><span>Lock</span>
        ${S.hotkeyLabel ? `<kbd>${esc(S.hotkeyLabel)}</kbd><span>Quick search from any app</span>` : ""}
      </div></div></div>`;
    return;
  }
  const t = typeOf(e);
  const rows = fieldRows(e);
  const host = e.url ? hostOf(e.url) : "";
  d.innerHTML = `<div class="detail-inner">
    <div class="d-head">
      ${tileHTML(e, "xl")}
      <div class="d-titles">
        <h2 class="selectable">${esc(e.title)}</h2>
        <div class="d-sub"><span class="type-badge" style="--c:${t.color}">${icon(t.icon)}${esc(t.label)}</span>${host ? `<span>${esc(host)}</span>` : ""}</div>
      </div>
      <div class="d-actions">
        ${e.url ? `<button class="btn primary" data-act="login" title="Open the site and a small copy window (Ctrl+Enter)">${icon("login")} Log in</button>` : ""}
        ${e.type === "server" && e.fields?.host ? `<button class="btn" data-act="ssh" title="Copy SSH command">${icon("terminal")} SSH</button>` : ""}
        <button class="icon-btn ${e.favorite ? "on" : ""}" data-act="fav" title="${e.favorite ? "Remove from favorites" : "Add to favorites"}">${e.favorite ? icon("star").replace('fill="none"', 'fill="currentColor"') : icon("star")}</button>
        <button class="btn" data-act="edit" title="Edit (Enter)">${icon("edit", "sm")} Edit</button>
        <button class="icon-btn" data-act="more" title="More">${icon("more")}</button>
      </div>
    </div>
    ${rows.length ? `<div class="card">${rows.map((f) => renderField(e, f)).join("")}</div>` : ""}
    ${attachmentsCard(e)}
    ${historyCard(e)}
    ${e.notes ? `<div class="card"><div class="card-title">Notes</div><div class="notes">${esc(e.notes)}</div></div>` : ""}
    ${(e.tags || []).length ? `<div class="card"><div class="card-title">Tags</div><div class="tags">${e.tags.map((g) => `<span class="chip">${icon("tag")}${esc(g)}</span>`).join("")}</div></div>` : ""}
    <div class="d-meta"><span>${icon("clock")}Modified ${fmtDate(e.updated)}</span><span>${icon("plus")}Created ${fmtDate(e.created)}</span></div>
  </div>`;
  if (e.totp) tickTotp();
  if ((e.attachments || []).some((a) => IMG_EXT.test(a.name))) loadThumbs(e);
}

function fmtSize(n) {
  return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
}
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

function attachmentsCard(e) {
  const list = e.attachments || [];
  const rows = list.map((a) => `<div class="att" data-fid="${a.id}">
      <div class="thumb" data-thumb="${IMG_EXT.test(a.name) ? a.id : ""}">${icon(IMG_EXT.test(a.name) ? "image" : "file")}</div>
      <div class="meta"><b title="${esc(a.name)}">${esc(a.name)}</b><small>${fmtSize(a.size)} · added ${esc(fmtDate(a.added))}</small></div>
      <div class="fa"><button class="icon-btn" data-aopen="${a.id}" title="Open">${icon("external")}</button>
        <button class="icon-btn" data-asave="${a.id}" title="Save as…">${icon("download")}</button>
        <button class="icon-btn" data-adel="${a.id}" title="Delete">${icon("trash")}</button></div></div>`).join("");
  return `<div class="card" id="attCard"><div class="hist-head"><div class="card-title">${icon("paperclip")}Attachments${list.length ? " · " + list.length : ""}</div>
    <button class="btn ghost sm" data-aadd>${icon("plus", "sm")} Add file</button></div>
    ${rows || `<div class="att-empty">Drag a file here or click “Add file” (contracts, recovery codes, SSH keys… up to 10 MB). Files are stored encrypted in the vault.</div>`}</div>`;
}

async function loadThumbs(e) {
  for (const el of $$("#attCard [data-thumb]")) {
    const fid = el.dataset.thumb;
    if (!fid) continue;
    try {
      const r = await call("attachment_preview", e.id, fid);
      if (r.url && S.selId === e.id) el.innerHTML = `<img src="${r.url}" alt="">`;
    } catch {}
  }
}

function replaceEntry(entry) {
  const i = S.entries.findIndex((x) => x.id === entry.id);
  if (i >= 0) S.entries[i] = entry; else S.entries.push(entry);
}

async function attachmentAction(e, b) {
  try {
    if (b.hasAttribute("data-aadd")) {
      const r = await call("add_attachments", e.id);
      if (r.cancelled) return;
      replaceEntry(r.entry); renderList(); renderDetail();
      return toast(r.added.length === 1 ? "Attachment added" : `Attachments added: ${r.added.length}`);
    }
    if (b.dataset.aopen) { await call("open_attachment", e.id, b.dataset.aopen); return toast("Opened · the temporary copy is deleted when the vault locks", "info"); }
    if (b.dataset.asave) { const r = await call("save_attachment", e.id, b.dataset.asave); if (!r.cancelled) toast("File saved (unencrypted) to the chosen location"); return; }
    if (b.dataset.adel) {
      const a = e.attachments.find((x) => x.id === b.dataset.adel);
      if (!(await confirmModal("Delete attachment?", `The file <b>${esc(a ? a.name : "")}</b> will be permanently deleted from the vault.`, "Delete", true))) return;
      const r = await call("delete_attachment", e.id, b.dataset.adel);
      replaceEntry(r.entry); renderList(); renderDetail();
      toast("Attachment deleted");
    }
  } catch (err) { toast(err.message, "err"); }
}

async function addDroppedFiles(files) {
  const e = selected();
  if (!e) return toast("Select an item first", "err");
  let n = 0;
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name}: larger than 10 MB`, "err"); continue; }
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    try { const r = await call("add_attachment_data", e.id, f.name, b64); replaceEntry(r.entry); n++; } catch (err) { toast(err.message, "err"); }
  }
  if (n) { renderList(); renderDetail(); toast(n === 1 ? "Attachment added" : `Attachments added: ${n}`); }
}

function historyLabel(e, k) {
  const f = typeOf(e).fields.find((x) => x.k === k);
  return f ? f.label : CORE_LABELS[k] || k.replace(/^f:/, "");
}

function historyCard(e) {
  const h = e.history || [];
  if (!h.length) return "";
  const rows = h.map((it, i) => ({ it, i })).reverse().map(({ it, i }) => {
    const shown = S.reveal.has("h:" + i);
    const val = shown ? `<div class="fv mono selectable">${esc(it.value)}</div>` : `<div class="fv mono masked">••••••••••••</div>`;
    return `<div class="frow hist" data-k="h:${i}"><div class="fl"><label>${esc(historyLabel(e, it.field))} · used until ${esc(fmtDate(it.changed))}</label>${val}</div>
      <div class="fa"><button class="icon-btn" data-hreveal="${i}" title="${shown ? "Hide" : "Show"}">${icon(shown ? "eyeOff" : "eye")}</button>
      <button class="icon-btn" data-hcopy="${i}" title="Copy old value">${icon("copy")}</button>
      <button class="icon-btn" data-hdel="${i}" title="Delete from history">${icon("trash")}</button></div></div>`;
  }).join("");
  return `<div class="card"><div class="hist-head"><div class="card-title">${icon("history")}Password history · ${h.length}</div>
    <button class="btn ghost sm" data-hclear>Clear history</button></div>${rows}</div>`;
}

async function historyAction(e, b) {
  try {
    if (b.dataset.hreveal !== undefined) {
      const k = "h:" + b.dataset.hreveal;
      S.reveal.has(k) ? S.reveal.delete(k) : S.reveal.add(k);
      return renderDetail();
    }
    if (b.dataset.hcopy !== undefined) {
      const r = await call("copy_history", e.id, +b.dataset.hcopy);
      return toast(`Copied: old value${r.clear_in ? ` · clears in ${r.clear_in} s` : ""}`, "ok", r.clear_in);
    }
    const all = b.hasAttribute("data-hclear");
    const ok = await confirmModal(all ? "Delete the entire history?" : "Delete from history?",
      all ? `All old passwords for <b>${esc(e.title)}</b> will be permanently deleted.` : "This old value will be permanently deleted.", "Delete", true);
    if (!ok) return;
    const r = await call("delete_history", e.id, all ? -1 : +b.dataset.hdel);
    const i = S.entries.findIndex((x) => x.id === e.id);
    S.entries[i] = r.entry;
    S.reveal.forEach((k) => k.startsWith("h:") && S.reveal.delete(k));
    renderDetail();
    toast("History updated");
  } catch (err) { toast(err.message, "err"); }
}

async function tickTotp() {
  const e = selected();
  if (!S.unlocked) return;
  if (e && e.totp && $("#otpCode")) {
    try {
      const r = await call("totp", e.id);
      if (r.code && $("#otpCode") && S.selId === e.id) paintOtp($("#otpCode"), $("#otpRing"), r);
    } catch { if ($("#otpCode")) $("#otpCode").textContent = "invalid key"; }
  }
  if (S.mini) {
    const me = S.entries.find((x) => x.id === S.mini.id);
    const el = $("#miniOtp");
    if (me && me.totp && el) {
      try { const r = await call("totp", me.id); el.textContent = r.code.slice(0, 3) + " " + r.code.slice(3); el.nextElementSibling && (el.nextElementSibling.textContent = r.remaining + " s"); } catch {}
    }
  }
}

function paintOtp(codeEl, ringEl, r) {
  const half = Math.ceil(r.code.length / 2);
  codeEl.textContent = r.code.slice(0, half) + " " + r.code.slice(half);
  const low = r.remaining <= 5;
  codeEl.classList.toggle("low", low);
  if (ringEl) {
    ringEl.classList.toggle("low", low);
    ringEl.querySelector(".fg").setAttribute("stroke-dashoffset", String(75.4 * (1 - r.remaining / r.period)));
    ringEl.querySelector("b").textContent = r.remaining;
  }
}

/* ---------------------------------------------------------------- actions */

const COPY_LABELS = { username: "Username", password: "Password", totp: "2FA code", url: "Link", ssh: "SSH command" };

async function copyField(id, key, label) {
  try {
    const r = await call("copy", id, key);
    S.recent = [id, ...S.recent.filter((x) => x !== id)].slice(0, 12);
    const e = S.entries.find((x) => x.id === id);
    let name = label || COPY_LABELS[key];
    if (!name && e) {
      const f = typeOf(e).fields.find((x) => x.k === key);
      name = f ? f.label : key.replace(/^f:/, "");
    }
    if (!S.mini) toast(`Copied: ${name}${r.clear_in ? ` · clears in ${r.clear_in} s` : ""}`, "ok", r.clear_in || 0);
    const row = $(`.frow[data-k="${CSS.escape(key)}"]`);
    if (row) { row.classList.remove("copied-flash"); void row.offsetWidth; row.classList.add("copied-flash"); }
    return true;
  } catch (err) { toast(err.message, "err"); return false; }
}

async function toggleFav(id) {
  try {
    const r = await call("toggle_favorite", id);
    const e = S.entries.find((x) => x.id === id);
    e.favorite = r.favorite;
    e.updated = Date.now() / 1000;
    renderSidebar(); renderList(); renderDetail();
  } catch (err) { toast(err.message, "err"); }
}

async function deleteEntry(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return;
  const ok = await confirmModal("Delete item?", `The item <b>${esc(e.title)}</b> will be permanently deleted from the vault.`, "Delete", true);
  if (!ok) return;
  try {
    const list = filtered();
    const idx = list.findIndex((x) => x.id === id);
    await call("delete_entry", id);
    S.entries = S.entries.filter((x) => x.id !== id);
    const next = filtered()[Math.min(idx, filtered().length - 1)];
    S.selId = next ? next.id : null;
    renderAll();
    toast("Item deleted");
  } catch (err) { toast(err.message, "err"); }
}

async function duplicateEntry(id) {
  try {
    const r = await call("duplicate_entry", id);
    S.entries.push(r.entry);
    S.selId = r.entry.id;
    renderAll();
    toast("Copy created");
  } catch (err) { toast(err.message, "err"); }
}

async function openUrl(id) {
  try { await call("open_login", id, false); } catch (err) { toast(err.message, "err"); }
}

function moreMenu(e, x, y) {
  const items = [];
  if (e.username) items.push({ icon: "user", label: "Copy username", kbd: "Ctrl B", run: () => copyField(e.id, "username") });
  if (e.password) items.push({ icon: "key", label: "Copy password", kbd: "Ctrl C", run: () => copyField(e.id, "password") });
  if (e.totp) items.push({ icon: "twofa", label: "Copy 2FA code", kbd: "Ctrl T", run: () => copyField(e.id, "totp") });
  if (items.length) items.push("-");
  if (e.url) {
    items.push({ icon: "login", label: "Log in (small window)", kbd: "Ctrl ↵", run: () => startMini(e.id) });
    items.push({ icon: "external", label: "Just open the site", run: () => openUrl(e.id) });
    items.push("-");
  }
  items.push({ icon: "edit", label: "Edit", kbd: "Enter", run: () => openEditor(e) });
  items.push({ icon: "star", label: e.favorite ? "Remove from favorites" : "Add to favorites", run: () => toggleFav(e.id) });
  items.push({ icon: "copy", label: "Duplicate", run: () => duplicateEntry(e.id) });
  items.push("-");
  items.push({ icon: "trash", label: "Delete", kbd: "Del", danger: true, run: () => deleteEntry(e.id) });
  openMenu(x, y, items);
}

/* ==========================================================================
   Item editor
   ========================================================================== */

function editorDefs(draft) {
  const t = TYPES[draft.type] || TYPES.other;
  const defs = [...t.fields];
  const known = new Set(defs.map((f) => f.k));
  for (const k of ["username", "password", "url", "totp"]) if (!known.has(k) && draft[k]) defs.push({ k, label: CORE_LABELS[k] + " (from another type)", secret: k === "password", url: k === "url", totp: k === "totp" });
  for (const k of Object.keys(draft.fields)) if (!known.has("f:" + k) && draft.fields[k]) defs.push({ k: "f:" + k, label: k + " (extra field)" });
  return defs;
}

function openEditor(entry, presetType) {
  const isNew = !entry;
  const draft = entry
    ? JSON.parse(JSON.stringify(entry))
    : { type: presetType || (S.filter.kind === "type" ? S.filter.value : "login"), title: "", username: "", password: "", url: "", totp: "", notes: "", tags: S.filter.kind === "tag" ? [S.filter.value] : [], fields: {}, favorite: false };
  let pickerOpen = isNew;

  const m = openModal({
    title: isNew ? "New item" : "Edit item",
    iconName: isNew ? "plus" : "edit",
    cls: "wide",
    body: `<div id="edType"></div><div id="edFields"></div>`,
    foot: `<div class="left">${icon("keyboard", "sm")} Ctrl+S saves · Esc closes</div>
           <button class="btn" data-close>Cancel</button>
           <button class="btn primary" data-save>${icon("check", "sm")} Save</button>`,
  });
  m.classList.add("editor");

  const setVal = (k, v) => { if (k.startsWith("f:")) draft.fields[k.slice(2)] = v; else draft[k] = v; };

  function renderType() {
    const t = TYPES[draft.type];
    if (pickerOpen) {
      $("#edType", m).innerHTML = `<div class="field"><span>What are you storing?</span></div><div class="type-grid">` +
        TYPE_ORDER.map((k) => `<button type="button" class="type-opt ${k === draft.type ? "sel" : ""}" data-type="${k}" style="--c:${TYPES[k].color}">${tileHTML(k)}${esc(TYPES[k].label)}</button>`).join("") + `</div>`;
    } else {
      $("#edType", m).innerHTML = `<div class="type-select">${tileHTML(draft.type)}<b>${esc(t.label)}</b><button type="button" class="btn sm" data-change-type>Change type</button></div>`;
    }
  }

  function inputFor(f) {
    const v = esc(getVal(draft, f.k));
    const id = "ed_" + f.k.replace(":", "_");
    const ph = f.ph ? ` placeholder="${esc(f.ph)}"` : "";
    const mono = f.mono ? "mono" : "";
    if (f.totp) {
      return `<label class="field"><span>${esc(f.label)} <em>— optional</em></span>
        <input id="${id}" data-k="${f.k}" value="${v}" class="mono" spellcheck="false" placeholder="Secret key (JBSW Y3DP…) or otpauth:// link">
        <div class="totp-preview" id="totpPrev"></div></label>`;
    }
    if (f.multiline) {
      return `<label class="field"><span>${esc(f.label)}</span><textarea id="${id}" data-k="${f.k}" class="${mono}" spellcheck="false"${ph} style="${f.secret ? "-webkit-text-security:disc" : ""}">${v}</textarea>
        ${f.secret ? `<div class="hint"><a href="#" data-show-ta="${id}" style="color:var(--accent)">Show content</a></div>` : ""}</label>`;
    }
    if (f.secret) {
      const gen = f.gen ? `<button type="button" class="icon-btn" data-gen="${id}" title="Generate a strong password">${icon("wand")}</button>` : "";
      return `<label class="field"><span>${esc(f.label)}</span>
        <div class="input-wrap ${f.gen ? "has-2" : ""}"><input id="${id}" data-k="${f.k}" type="password" value="${v}" class="mono" spellcheck="false" autocomplete="new-password"${ph}>
        <div class="actions"><button type="button" class="icon-btn" data-toggle-pw="${id}" title="Show">${icon("eye")}</button>${gen}</div></div>
        ${f.k === "password" ? `<div id="edStrength" style="margin-top:8px">${strengthHTML(getVal(draft, f.k))}</div>` : ""}</label>`;
    }
    const type = f.date ? "date" : "text";
    return `<label class="field"><span>${esc(f.label)}</span><input id="${id}" data-k="${f.k}" type="${type}" value="${v}" class="${mono}" spellcheck="false"${ph}></label>`;
  }

  function renderFields() {
    const defs = editorDefs(draft);
    // short fields (port, date...) go two per row
    const half = (f) => ["f:port", "f:expiry", "f:cvv", "f:pin", "f:expires", "f:security"].includes(f.k);
    let html = `<label class="field"><span>Name *</span><input id="ed_title" data-k="title" value="${esc(draft.title)}" placeholder="e.g. Gmail – ${esc(TYPES[draft.type].label)}" spellcheck="false"></label>`;
    let pend = [];
    const flush = () => { if (pend.length) { html += pend.length === 2 ? `<div class="grid-2">${pend.join("")}</div>` : pend[0]; pend = []; } };
    for (const f of defs) {
      if (half(f)) { pend.push(inputFor(f)); if (pend.length === 2) flush(); }
      else { flush(); html += inputFor(f); }
    }
    flush();
    html += `<label class="field"><span>Tags <em>— comma-separated (e.g. IT, Marketing, Client X)</em></span><input id="ed_tags" value="${esc((draft.tags || []).join(", "))}" spellcheck="false"></label>`;
    html += `<label class="field"><span>Notes</span><textarea id="ed_notes" data-k="notes" spellcheck="false" placeholder="Additional info, security questions, backup codes…">${esc(draft.notes)}</textarea></label>`;
    $("#edFields", m).innerHTML = html;
    updateTotpPreview();
  }

  const updateTotpPreview = debounce(async () => {
    const el = $("#totpPrev", m);
    if (!el) return;
    const v = (draft.totp || "").trim();
    if (!v) { el.className = "totp-preview"; el.innerHTML = `<span class="muted">On the site, choose “can't scan the code” and paste the key here.</span>`; return; }
    try {
      const r = await call("totp_preview", v);
      el.className = "totp-preview ok";
      el.innerHTML = `${icon("check", "sm")} Current code: <b>${r.code.slice(0, 3)} ${r.code.slice(3)}</b> — compare it with the site before saving`;
    } catch (err) { el.className = "totp-preview err"; el.innerHTML = icon("alert", "sm") + esc(err.message); }
  }, 250);

  m.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.id === "ed_tags") { draft.tags = el.value.split(",").map((s) => s.trim()).filter(Boolean); return; }
    if (!el.dataset.k) return;
    setVal(el.dataset.k, el.value);
    if (el.dataset.k === "password" && $("#edStrength", m)) $("#edStrength", m).innerHTML = strengthHTML(el.value);
    if (el.dataset.k === "totp") updateTotpPreview();
  });

  m.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button, a");
    if (!b) return;
    if (b.dataset.type) {
      draft.type = b.dataset.type;
      if (!isNew) pickerOpen = false;
      renderType(); renderFields();
      if (isNew) $("#ed_title", m).focus();
    } else if (b.hasAttribute("data-change-type")) {
      pickerOpen = true; renderType();
    } else if (b.dataset.gen) {
      ev.preventDefault();
      try {
        const r = await call("generate", S.gen.length, S.gen.lower, S.gen.upper, S.gen.digits, S.gen.symbols, S.gen.avoid_ambiguous);
        const inp = $("#" + b.dataset.gen, m);
        inp.value = r.password;
        inp.type = "text";
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (err) { toast(err.message, "err"); }
    } else if (b.dataset.showTa) {
      ev.preventDefault();
      const ta = $("#" + b.dataset.showTa, m);
      const hidden = ta.style.webkitTextSecurity === "disc";
      ta.style.webkitTextSecurity = hidden ? "none" : "disc";
      b.textContent = hidden ? "Hide content" : "Show content";
    } else if (b.hasAttribute("data-save")) {
      save();
    }
  });

  async function save() {
    draft.title = draft.title.trim();
    if (!draft.title) {
      const t = $("#ed_title", m);
      t.focus(); t.classList.remove("shake"); void t.offsetWidth; t.classList.add("shake");
      toast("Enter a name", "err");
      return;
    }
    const btn = $("[data-save]", m);
    btn.disabled = true;
    try {
      const r = await call("save_entry", draft);
      const i = S.entries.findIndex((x) => x.id === r.entry.id);
      if (i >= 0) S.entries[i] = r.entry; else S.entries.push(r.entry);
      S.selId = r.entry.id;
      m._close();
      renderAll();
      select(r.entry.id);
      const hadOld = !isNew && (r.entry.history || []).length > (entry.history || []).length;
      toast(isNew ? "Item added" : hadOld ? "Saved · the old password is in the history" : "Changes saved");
    } catch (err) { toast(err.message, "err"); btn.disabled = false; }
  }
  m._save = save;

  renderType();
  renderFields();
  setTimeout(() => (isNew ? $(".type-opt.sel", m) : $("#ed_title", m))?.focus(), 30);
}

/* ==========================================================================
   Generator, health, settings, import
   ========================================================================== */

function colorPw(pw) {
  return esc(pw).replace(/(\d+)/g, '<span class="d">$1</span>').replace(/([!@#$%^*()\-_=+\[\]{};:,.?/]|&amp;)+/g, (m) => `<span class="s">${m}</span>`);
}

function openGenerator() {
  const g = S.gen;
  const opts = [["lower", "Lowercase letters (a-z)"], ["upper", "Uppercase letters (A-Z)"], ["digits", "Numbers (0-9)"], ["symbols", "Symbols (!@#…)"], ["avoid_ambiguous", "Avoid look-alike characters (I, l, 1, O, 0)"]];
  const m = openModal({
    title: "Password generator", iconName: "wand", cls: "narrow",
    body: `<div class="gen-out"><code id="genOut"></code>
        <button class="icon-btn" id="genRe" title="New">${icon("refresh")}</button>
        <button class="icon-btn" id="genCp" title="Copy">${icon("copy")}</button></div>
      <div id="genStr"></div>
      <div class="field" style="margin:4px 0 0"><span>Length</span></div>
      <div class="range-row"><input type="range" id="genLen" min="8" max="64" value="${g.length}"><b id="genLenV">${g.length}</b></div>
      ${opts.map(([k, l]) => `<label class="switch"><span>${l}</span><input type="checkbox" data-opt="${k}" ${g[k] ? "checked" : ""}><span class="track"></span></label>`).join("")}`,
    foot: `<button class="btn" data-close>Close</button><button class="btn primary" id="genCopy2">${icon("copy", "sm")} Copy password</button>`,
  });
  let current = "";
  async function regen() {
    try {
      const r = await call("generate", g.length, g.lower, g.upper, g.digits, g.symbols, g.avoid_ambiguous);
      current = r.password;
      $("#genOut", m).innerHTML = colorPw(current);
      $("#genStr", m).innerHTML = strengthHTML(current);
    } catch (err) { $("#genOut", m).textContent = err.message; current = ""; }
  }
  const copy = async () => { if (!current) return; try { const r = await call("copy_text", current); toast(`Copied: Password${r.clear_in ? ` · clears in ${r.clear_in} s` : ""}`, "ok", r.clear_in); } catch (err) { toast(err.message, "err"); } };
  $("#genLen", m).addEventListener("input", (ev) => { g.length = +ev.target.value; $("#genLenV", m).textContent = g.length; regen(); });
  m.addEventListener("change", (ev) => { if (ev.target.dataset.opt) { g[ev.target.dataset.opt] = ev.target.checked; regen(); } });
  $("#genRe", m).addEventListener("click", regen);
  $("#genCp", m).addEventListener("click", copy);
  $("#genCopy2", m).addEventListener("click", copy);
  regen();
}

function healthReport() {
  const pwEntries = S.entries.filter((e) => e.password);
  const weak = pwEntries.filter((e) => strength(e.password).bits < 60);
  const byPw = {};
  for (const e of pwEntries) (byPw[e.password] = byPw[e.password] || []).push(e);
  const reusedGroups = Object.values(byPw).filter((g) => g.length > 1);
  const reused = reusedGroups.flat();
  const no2fa = S.entries.filter((e) => ["login", "email", "bank", "domain"].includes(e.type) && e.password && !e.totp);
  const yearAgo = Date.now() / 1000 - 365 * 86400;
  const old = pwEntries.filter((e) => e.updated < yearAgo);
  const expiring = S.entries.filter((e) => { const d = daysUntil(e.fields?.expires || ""); return d !== null && d <= 30; });
  const n = Math.max(pwEntries.length, 1);
  const score = S.entries.length ? Math.max(0, Math.round(100 - (weak.length / n) * 45 - (reused.length / n) * 35 - (no2fa.length / n) * 12 - (old.length / n) * 8)) : 100;
  return { weak, reusedGroups, reused, no2fa, old, expiring, score, issueCount: new Set([...weak, ...reused, ...expiring].map((e) => e.id)).size };
}

function openHealth() {
  const h = healthReport();
  const color = h.score >= 80 ? "var(--ok)" : h.score >= 55 ? "var(--warn)" : "var(--danger)";
  const C = 2 * Math.PI * 40;
  const issue = (e, why) => `<div class="issue" data-id="${e.id}">${tileHTML(e)}<div class="meta"><b>${esc(e.title)}</b><small>${esc(why)}</small></div>${icon("arrowLeft", "sm").replace('class="ic', 'style="transform:rotate(180deg)" class="ic')}</div>`;
  const group = (title, ic, list, why) => list.length ? `<div class="issue-group"><h4>${icon(ic, "sm")}${title} <span class="muted">(${list.length})</span></h4>${list.map((e) => issue(e, typeof why === "function" ? why(e) : why)).join("")}</div>` : "";
  const reusedWhy = (e) => { const g = h.reusedGroups.find((gr) => gr.includes(e)); return "Same password also used in: " + g.filter((x) => x !== e).map((x) => x.title).join(", "); };
  const body = `<div class="health-top">
      <div class="score"><svg viewBox="0 0 96 96"><circle class="bg" cx="48" cy="48" r="40"/><circle class="fg" cx="48" cy="48" r="40" stroke="${color}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - h.score / 100)}"/></svg><b style="color:${color}">${h.score}</b></div>
      <div class="stat-grid">
        <div class="stat ${h.weak.length ? "bad" : ""}"><b>${h.weak.length}</b><span>Weak passwords</span></div>
        <div class="stat ${h.reused.length ? "bad" : ""}"><b>${h.reused.length}</b><span>Reused</span></div>
        <div class="stat ${h.no2fa.length ? "warn" : ""}"><b>${h.no2fa.length}</b><span>No 2FA</span></div>
        <div class="stat ${h.old.length + h.expiring.length ? "warn" : ""}"><b>${h.old.length + h.expiring.length}</b><span>Old / expiring</span></div>
      </div></div>
    ${h.weak.length + h.reused.length + h.no2fa.length + h.old.length + h.expiring.length === 0 ? `<div class="empty-list">${icon("shieldCheck")}<div>Everything looks great. No issues found.</div></div>` : ""}
    ${group("Weak passwords", "alert", h.weak, (e) => "Strength: " + strength(e.password).label.toLowerCase() + " (" + strength(e.password).bits + " bits)")}
    ${group("Same password in multiple places", "copy", h.reused, reusedWhy)}
    ${group("Expiring soon / expired", "clock", h.expiring, (e) => { const d = daysUntil(e.fields.expires); return d < 0 ? `Expired ${-d} days ago` : `Expires in ${d} days`; })}
    ${group("Accounts without 2FA", "twofa", h.no2fa, "Recommended: enable two-factor authentication on the site")}
    ${group("Passwords older than a year", "clock", h.old, (e) => "Last modified " + fmtDate(e.updated))}`;
  const m = openModal({ title: "Security report", iconName: "shieldCheck", cls: "wide", body });
  m.addEventListener("click", (ev) => {
    const it = ev.target.closest(".issue");
    if (!it) return;
    m._close();
    S.filter = { kind: "all", value: null }; S.q = ""; $("#search").value = "";
    renderSidebar(); renderList(); select(it.dataset.id);
  });
}

async function doImport() {
  try {
    const r = await call("import_csv");
    if (r.cancelled) return;
    await afterImport(r);
  } catch (err) { toast(err.message, "err"); }
}
async function afterImport(r) {
  await loadEntries();
  renderAll();
  openModal({
    title: "Import complete", iconName: "upload", cls: "narrow",
    body: `<p style="margin-top:0">Imported <b>${r.imported}</b> items${r.skipped ? `, skipped ${r.skipped} duplicates` : ""}.</p>
      ${r.bad_totp.length ? `<p class="muted">2FA key not recognized for: ${esc(r.bad_totp.slice(0, 8).join(", "))} (saved in the notes).</p>` : ""}
      <div class="warn-box" style="margin:14px 0 0">${icon("alert")}<div><b>Delete the CSV file.</b> It contains passwords in readable form. Delete it and empty the Recycle Bin:<div class="path-box" style="margin-top:8px">${esc(r.path)}</div></div></div>`,
    foot: `<button class="btn primary" data-close>Got it</button>`,
  });
}

function applyTheme() { document.documentElement.dataset.theme = S.settings.theme === "light" ? "light" : "dark"; }

function relTime(ts) {
  if (!ts) return "never";
  const d = new Date(ts * 1000), now = new Date();
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days === 0) return "today at " + hm;
  if (days === 1) return "yesterday at " + hm;
  return fmtDate(ts);
}

function backupSection(b) {
  const s = S.settings;
  return `<div class="settings-sec" id="backupSec"><h4>Automatic backup</h4>
    <label class="row switch" style="padding:10px 0"><div>Daily backup<small>Once a day, only if something changed. The copy is encrypted.</small></div>
      <input type="checkbox" data-set="backup_enabled" ${s.backup_enabled ? "checked" : ""}><span class="track"></span></label>
    <div class="row"><div>Keep the last<small>Older copies are deleted automatically</small></div>
      <select data-set="backup_keep">${[[7, "7 copies"], [14, "14 copies"], [30, "30 copies"], [60, "60 copies"], [90, "90 copies"]].map(([v, l]) => `<option value="${v}" ${+s.backup_keep === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div>Backup folder<small>${b.dir === b.default_dir ? "Default folder. For extra safety choose a USB or another drive." : "Selected folder"}</small></div>
        <div style="display:flex;gap:6px"><button class="btn sm" data-act="bdir">${icon("folder", "sm")} Change</button><button class="btn sm" data-act="bopen">${icon("external", "sm")} Open</button></div></div>
      <div class="path-box">${esc(b.dir)}</div></div>
    <div class="row"><div>Last backup: <b>${esc(relTime(b.last))}</b><small>${b.count} ${b.count === 1 ? "copy" : "copies"} in the folder</small></div>
      <button class="btn sm primary" data-act="bnow">${icon("refresh", "sm")} Back up now</button></div>
    ${b.files.length ? `<div class="backup-list">${b.files.map((f) => `<div class="backup-item">${icon("clock", "sm")}<span>${esc(fmtDate(f.time))}</span><small>${(f.size / 1024).toFixed(1)} KB</small><button class="btn ghost sm" data-restore="${esc(f.name)}">Restore</button></div>`).join("")}</div>` : ""}
  </div>`;
}

function quickSection(h) {
  const s = S.settings;
  const linux = h.platform === "linux";
  let hotkeyRow;
  if (linux) {
    // Linux (especially Wayland) does not let apps register global hotkeys: it is set up in the system settings
    hotkeyRow = `<div class="row" style="display:block"><div>Quick search hotkey<small>On Linux the hotkey is set in the system settings and runs this command:</small></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><div class="path-box" style="flex:1" id="qCmd">${esc(h.command)}</div>
        <button class="btn sm" data-act="copycmd">${icon("copy", "sm")} Copy</button></div>
      <div class="hint" style="line-height:1.6;margin-top:8px"><b>GNOME:</b> Settings → Keyboard → Shortcuts → Custom Shortcuts → +<br>
        <b>KDE:</b> System Settings → Shortcuts → Custom Shortcuts → New → Global Shortcut → Command<br>
        Suggestion: <kbd>Ctrl Shift Space</kbd></div></div>`;
  } else {
    const status = !h.supported ? `<span class="muted">Not available on this system</span>`
      : h.combo === "off" ? `<span class="muted">Off</span>`
      : h.active ? `<span style="color:var(--ok)">● Active</span>` : `<span style="color:var(--danger)">${esc(h.error || "Not active")}</span>`;
    hotkeyRow = `<div class="row"><div>Quick search hotkey<small>Works from any app. Opens search; Enter copies the password. ${status}</small></div>
      <select data-set="hotkey" data-str="1" style="width:210px">${h.options.map((o) => `<option value="${o.key}" ${h.combo === o.key ? "selected" : ""}>${esc(o.label)}</option>`).join("")}<option value="off" ${h.combo === "off" ? "selected" : ""}>Off</option></select></div>`;
  }
  const auto = h.autostart_supported !== undefined ? h.autostart_supported : h.supported;
  return `<div class="settings-sec" id="quickSec"><h4>Quick access</h4>
    ${hotkeyRow}
    <label class="row switch" style="padding:10px 0"><div>The ✕ button sends Vaultkeeper ${linux ? "to the background" : "to the taskbar"}<small>The hotkey stays active. To quit completely: “Exit Vaultkeeper” in the left menu.</small></div>
      <input type="checkbox" data-set="close_to_background" ${s.close_to_background ? "checked" : ""}><span class="track"></span></label>
    <label class="row switch" style="padding:10px 0;${auto ? "" : "opacity:.5;pointer-events:none"}"><div>${linux ? "Start at login" : "Start with Windows"}<small>Vaultkeeper starts minimized, so the hotkey is always ready</small></div>
      <input type="checkbox" data-autostart ${h.autostart ? "checked" : ""}><span class="track"></span></label>
  </div>`;
}

function helloRow(h) {
  const sub = !h.supported && !h.enabled ? esc(h.reason || "Not available")
    : h.enabled ? `Enabled. The master password is still required once every ${h.master_days} days.`
    : "Unlock with fingerprint, face or PIN instead of typing the master password";
  return `<label class="row switch" id="helloRow" style="padding:10px 0;${!h.supported && !h.enabled ? "opacity:.55;pointer-events:none" : ""}">
    <div>${icon("fingerprint", "sm").replace('class="ic', 'style="display:inline;vertical-align:-3px;margin-right:6px" class="ic')}Windows Hello<small>${sub}</small></div>
    <input type="checkbox" data-hello ${h.enabled ? "checked" : ""}><span class="track"></span></label>`;
}

function bridgeSection(b, code) {
  const status = b.running ? `<span style="color:var(--ok)">● Active on 127.0.0.1:${b.port}</span>` : b.error ? `<span style="color:var(--danger)">${esc(b.error)}</span>` : `<span class="muted">Off</span>`;
  return `<div class="settings-sec" id="bridgeSec"><h4>Browser extension (Chrome / Edge)</h4>
    <label class="row switch" style="padding:10px 0"><div>Browser connection<small>The extension fills in logins on websites. Works only on this computer. ${status}</small></div>
      <input type="checkbox" data-bridge ${b.enabled ? "checked" : ""}><span class="track"></span></label>
    <div class="row"><div>1. Install the extension<small>Once, in Chrome or Edge</small></div><button class="btn sm" data-act="ext">${icon("puzzle", "sm")} Install extension</button></div>
    <div class="row" style="${code ? "display:block" : ""}">${code ? `
      <div style="text-align:center;padding:6px 0 4px"><div class="muted" style="font-size:12px">Enter this code in the Vaultkeeper extension (click its icon in the browser toolbar)</div>
      <div class="mono" style="font-size:34px;font-weight:800;letter-spacing:10px;color:var(--accent-2);margin:8px 0">${esc(code.code)}</div>
      <div class="muted" style="font-size:12px">Valid for <b id="pairLeft">${code.seconds}</b> s · <a href="#" data-act="paircancel" style="color:var(--accent)">Cancel</a></div></div>` : `
      <div>2. Pair the browser<small>A 6-digit code is shown; enter it in the extension</small></div><button class="btn sm primary" data-act="pair">${icon("link", "sm")} Pair browser</button>`}</div>
    ${b.pairs.length ? `<div class="backup-list">${b.pairs.map((p) => `<div class="backup-item">${icon("puzzle", "sm")}<span>${esc(p.name)}</span><small style="min-width:120px">used ${esc(relTime(p.last_used))}</small><button class="btn ghost sm" data-unpair="${esc(p.id)}">Remove</button></div>`).join("")}</div>` : ""}
  </div>`;
}

function showExtensionHelp(path) {
  const m = openModal({
    title: "Install the extension", iconName: "puzzle", cls: "narrow",
    body: `<p style="margin-top:0;color:var(--text-2)">The extension folder is open. In Chrome or Edge:</p>
      <ol style="padding-left:18px;color:var(--text-2);line-height:1.8;margin:0 0 12px">
        <li>Type <b class="mono">chrome://extensions</b> in the address bar (Edge: <b class="mono">edge://extensions</b>${S.state && S.state.platform === "linux" ? ", Chromium/Brave: also <b class=\"mono\">chrome://extensions</b>" : ""})</li>
        <li>Turn on <b>Developer mode</b> (top right; bottom left in Edge)</li>
        <li>Click <b>Load unpacked</b> and select this folder:</li></ol>
      <div class="path-box">${esc(path)}</div>
      <p class="hint" style="margin-top:12px">Then pin the Vaultkeeper icon in the toolbar (puzzle icon → pin) and pair the browser in Settings.</p>`,
    foot: `<button class="btn primary" data-close>Got it</button>`,
  });
  return m;
}

async function openSettings() {
  let brg = { enabled: false, running: false, pairs: [], port: 47123, error: "" };
  try { brg = await call("bridge_status"); } catch {}
  let hel = { supported: false, enabled: false, reason: "", master_days: 14 };
  try { hel = await call("hello_status"); } catch {}
  let info = {}, binfo = { dir: "", default_dir: "", files: [], count: 0 }, hinfo = { options: [], combo: "off", supported: false };
  try { info = await call("vault_info"); } catch {}
  try { binfo = await call("backup_info"); } catch {}
  try { hinfo = await call("hotkey_status"); } catch {}
  const s = S.settings;
  const sel = (key, opts) => `<select data-set="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[key]) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const m = openModal({
    title: "Settings", iconName: "settings", cls: "wide",
    body: `<div class="settings-sec"><h4>Appearance</h4>
        <div class="row"><div>Theme<small>Dark or light</small></div>
          <div class="seg"><button data-theme="dark" class="${s.theme !== "light" ? "on" : ""}">${icon("moon")}Dark</button><button data-theme="light" class="${s.theme === "light" ? "on" : ""}">${icon("sun")}Light</button></div></div></div>
      ${quickSection(hinfo)}
      <div class="settings-sec"><h4>Security</h4>
        ${S.state && S.state.platform === "linux" && !hel.enabled ? "" : helloRow(hel)}
        <div class="row"><div>Auto-lock<small>When the computer is idle (mouse and keyboard anywhere, not only in Vaultkeeper)</small></div>${sel("auto_lock_min", [[1, "1 minute"], [2, "2 minutes"], [5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"], [0, "Never"]])}</div>
        <div class="row"><div>Clear clipboard<small>Copied passwords are cleared after</small></div>${sel("clip_seconds", [[10, "10 seconds"], [20, "20 seconds"], [30, "30 seconds"], [60, "1 minute"], [90, "90 seconds"], [0, "Never clear"]])}</div>
        <label class="row switch" style="padding:10px 0"><div>Lock when minimized<small>If on, Vaultkeeper locks as soon as you minimize it (and the extension can't fill logins then)</small></div><input type="checkbox" data-set="lock_on_minimize" ${s.lock_on_minimize ? "checked" : ""}><span class="track"></span></label></div>
      ${bridgeSection(brg, null)}
      ${backupSection(binfo)}
      <div class="settings-sec"><h4>Vault</h4>
        <div class="row" style="display:block"><div class="path-box">${esc(info.path || "")}</div>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center"><span class="muted" style="flex:1">${info.count ?? 0} items · ${info.size ? (info.size / 1024).toFixed(1) + " KB" : ""}</span>
          <button class="btn sm" data-act="folder">${icon("folder", "sm")} Open folder</button></div></div></div>
      <div class="settings-sec"><h4>Change master password</h4>
        <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr;gap:0 10px;margin-top:10px">
          <label class="field"><span>Current</span><input type="password" id="cmOld"></label>
          <label class="field"><span>New</span><input type="password" id="cmNew"></label>
          <label class="field"><span>Repeat new</span><input type="password" id="cmNew2"></label></div>
        <div id="cmStr"></div>
        <button class="btn" data-act="master">${icon("key", "sm")} Change master password</button>
        <div class="hint">Everyone who uses this vault will have to use the new password.</div></div>`,
    foot: `<button class="btn primary" data-close>Done</button>`,
  });
  const persist = async () => { try { const r = await call("save_settings", S.settings); S.settings = r.settings; } catch (err) { toast(err.message, "err"); } };
  let pairCode = null, pairTimer = 0;
  async function refreshBridge() {
    try { const nb = await call("bridge_status"); $("#bridgeSec", m).outerHTML = bridgeSection(nb, pairCode && pairCode.until > Date.now() ? { code: pairCode.code, seconds: Math.round((pairCode.until - Date.now()) / 1000) } : null); } catch {}
  }
  m._refreshBridge = () => { pairCode = null; refreshBridge(); };
  async function refreshBackup() {
    try { const nb = await call("backup_info"); $("#backupSec", m).outerHTML = backupSection(nb); renderSync(); } catch {}
  }
  m.addEventListener("change", async (ev) => {
    if (ev.target.hasAttribute("data-bridge")) {
      try { await call("bridge_set_enabled", ev.target.checked); } catch (err) { toast(err.message, "err"); }
      await refreshBridge();
      return;
    }
    if (ev.target.hasAttribute("data-hello")) {
      const on = ev.target.checked;
      ev.target.disabled = true;
      try {
        if (on) { toast("Confirm Windows Hello…", "info"); const r = await API.hello_enable(); if (!r.ok) throw new Error(r.error); toast("Windows Hello enabled"); }
        else { await call("hello_disable"); toast("Windows Hello disabled"); }
      } catch (err) { ev.target.checked = !on; if (err.message !== "Cancelled.") toast(err.message, "err"); }
      try { const h = await call("hello_status"); $("#helloRow", m).outerHTML = helloRow(h); } catch {}
      return;
    }
    if (ev.target.hasAttribute("data-autostart")) {
      try { const r = await call("set_autostart", ev.target.checked); ev.target.checked = r.autostart; toast(r.autostart ? (S.state && S.state.platform === "linux" ? "Vaultkeeper will start at login" : "Vaultkeeper will start with Windows") : "Autostart disabled"); }
      catch (err) { ev.target.checked = !ev.target.checked; toast(err.message, "err"); }
      return;
    }
    const k = ev.target.dataset.set;
    if (!k) return;
    S.settings[k] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.dataset.str ? ev.target.value : +ev.target.value;
    await persist();
    if (k === "hotkey") {
      try { const h = await call("hotkey_status"); $("#quickSec", m).outerHTML = quickSection(h); await loadHotkeyLabel();
        if (h.combo !== "off" && h.supported && !h.active) return toast(h.error || "The hotkey is not active", "err"); } catch {}
    }
    toast("Setting saved");
  });
  $("#cmNew", m).addEventListener("input", (ev) => { $("#cmStr", m).innerHTML = ev.target.value ? strengthHTML(ev.target.value) : ""; });
  m.addEventListener("click", async (ev) => {
    if (ev.target.closest('[data-act="paircancel"]')) {
      ev.preventDefault(); pairCode = null; clearInterval(pairTimer);
      await call("bridge_cancel_pair").catch(() => {}); return refreshBridge();
    }
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.theme) {
      S.settings.theme = b.dataset.theme;
      applyTheme();
      $$(".seg button", m).forEach((x) => x.classList.toggle("on", x === b));
      persist();
    } else if (b.dataset.act === "folder") {
      call("open_folder").catch(() => {});
    } else if (b.dataset.act === "copycmd") {
      try { const r = await call("copy_text", $("#qCmd", m).textContent); toast("Command copied"); } catch (err) { toast(err.message, "err"); }
    } else if (b.dataset.act === "ext") {
      try { const r = await call("export_extension"); showExtensionHelp(r.path); } catch (err) { toast(err.message, "err"); }
    } else if (b.dataset.act === "pair") {
      try {
        const r = await call("bridge_pair_code");
        pairCode = { code: r.code, seconds: r.seconds, until: Date.now() + r.seconds * 1000 };
        await refreshBridge();
        clearInterval(pairTimer);
        pairTimer = setInterval(() => {
          const left = Math.max(0, Math.round((pairCode?.until - Date.now()) / 1000));
          const el = $("#pairLeft", m);
          if (el) el.textContent = left;
          if (!pairCode || left <= 0 || !document.body.contains(m)) { clearInterval(pairTimer); pairCode = null; if (document.body.contains(m)) refreshBridge(); }
        }, 1000);
      } catch (err) { toast(err.message, "err"); }
    } else if (b.dataset.unpair) {
      if (!(await confirmModal("Remove browser?", "The extension in that browser will no longer be able to fill logins until you pair it again.", "Remove", true))) return;
      await call("bridge_unpair", b.dataset.unpair).catch(() => {});
      await refreshBridge();
    } else if (b.dataset.act === "bopen") {
      call("open_backup_dir").catch((err) => toast(err.message, "err"));
    } else if (b.dataset.act === "bdir") {
      try { const r = await call("choose_backup_dir"); if (r.dir) { S.settings.backup_dir = r.dir; await refreshBackup(); toast("Backup folder changed"); } } catch (err) { toast(err.message, "err"); }
    } else if (b.dataset.act === "bnow") {
      b.disabled = true;
      try { await call("backup_now"); await refreshBackup(); toast("Backup created"); } catch (err) { toast(err.message, "err"); }
      b.disabled = false;
    } else if (b.dataset.restore) {
      const ok = await confirmModal("Restore vault from backup?",
        `The vault will be restored to its state from <b>${esc(b.closest(".backup-item").querySelector("span").textContent)}</b>.<br><br>The current state is saved as a new backup first, so you lose nothing. Afterwards, unlock the vault with the master password that was valid at that time.`, "Restore backup", true);
      if (!ok) return;
      try { await call("restore_backup", b.dataset.restore); showLock("The vault was restored from the backup. Unlock it."); } catch (err) { toast(err.message, "err"); }
    } else if (b.dataset.act === "master") {
      const o = $("#cmOld", m).value, n = $("#cmNew", m).value, n2 = $("#cmNew2", m).value;
      if (!o || !n) return toast("Fill in all fields", "err");
      if (n !== n2) return toast("The new passwords do not match", "err");
      b.disabled = true;
      try {
        const r = await call("change_master", o, n);
        $$("#cmOld, #cmNew, #cmNew2", m).forEach((x) => (x.value = ""));
        $("#cmStr", m).innerHTML = "";
        toast(r.hello_disabled ? "Master password changed · turn Windows Hello on again" : "Master password changed");
        if (r.hello_disabled) { try { const h = await call("hello_status"); $("#helloRow", m).outerHTML = helloRow(h); } catch {} }
      } catch (err) { toast(err.message, "err"); }
      b.disabled = false;
    }
  });
}

/* ==========================================================================
   Mini mode - quick login
   ========================================================================== */

async function startMini(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return;
  try { await call("open_login", id, true); } catch (err) { return toast(err.message, "err"); }
  S.mini = { id, done: new Set() };
  $$("#modalRoot .overlay").forEach((o) => o.remove());
  $("#app").hidden = true;
  $("#mini").hidden = false;
  document.body.classList.add("is-mini");
  renderMini();
  tickTotp();
}

function miniSteps(e) {
  const steps = [];
  if (e.username) steps.push({ key: "username", label: "Username", value: esc(e.username) });
  if (e.password) steps.push({ key: "password", label: "Password", value: "••••••••••" });
  if (e.totp) steps.push({ key: "totp", label: "2FA code", value: `<b class="otp" id="miniOtp">••• •••</b><small id="miniOtpRem"></small>`, raw: true });
  return steps;
}

function renderMini() {
  const e = S.entries.find((x) => x.id === S.mini.id);
  if (!e) return exitMini();
  const steps = miniSteps(e);
  const nextKey = (steps.find((s) => !S.mini.done.has(s.key)) || {}).key;
  $("#mini").innerHTML = `
    <div class="mini-head">${tileHTML(e)}<div class="meta"><b>${esc(e.title)}</b><small>${esc(hostOf(e.url))}</small></div>
      <button class="icon-btn" data-mini="back" title="Back to the vault">${icon("x")}</button></div>
    <div class="mini-body">
      <div class="mini-hint">${icon("login", "sm")}<span>The site is open. Click in order and paste with <kbd>Ctrl V</kbd>.</span></div>
      ${steps.map((s, i) => `<button class="mini-step ${S.mini.done.has(s.key) ? "done" : ""} ${s.key === nextKey ? "next" : ""}" data-step="${s.key}">
        <span class="num">${S.mini.done.has(s.key) ? icon("check", "sm") : i + 1}</span>
        <span class="meta"><small>${s.label}</small>${s.raw ? s.value : `<b>${s.value}</b>`}</span>
        <span class="cp">${icon("copy")}</span></button>`).join("")}
      ${!steps.length ? `<div class="empty-list">This item has no login data.</div>` : ""}
      <div class="hint" style="text-align:center;margin-top:4px">Shortcuts: ${steps.map((s, i) => `<kbd>${i + 1}</kbd>`).join(" ")}</div>
    </div>
    <div class="mini-foot">
      <button class="btn" data-mini="reopen">${icon("external", "sm")} Reopen</button>
      <button class="btn primary" data-mini="back">${icon("arrowLeft", "sm")} Back</button>
    </div>`;
}

async function exitMini() {
  S.mini = null;
  document.body.classList.remove("is-mini");
  try { await call("set_mini", false); } catch {}
  $("#mini").hidden = true;
  if (S.unlocked) { $("#app").hidden = false; renderDetail(); }
}

function bindMini() {
  $("#mini").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b || !S.mini) return;
    if (b.dataset.step) {
      if (await copyField(S.mini.id, b.dataset.step)) { S.mini.done.add(b.dataset.step); renderMini(); tickTotp(); }
    } else if (b.dataset.mini === "back") exitMini();
    else if (b.dataset.mini === "reopen") openUrl(S.mini.id);
  });
}


/* ==========================================================================
   Quick search (global hotkey from any app)
   ========================================================================== */

function quickResults() {
  const q = S.quick.q.trim().toLowerCase();
  if (!q) {
    const recent = S.recent.map((id) => S.entries.find((e) => e.id === id)).filter(Boolean);
    const favs = S.entries.filter((e) => e.favorite && !S.recent.includes(e.id)).sort((a, b) => a.title.localeCompare(b.title, "en"));
    const groups = [];
    if (recent.length) groups.push(["Recently used", recent]);
    if (favs.length) groups.push(["Favorites", favs]);
    if (!groups.length) groups.push(["All items", [...S.entries].sort((a, b) => a.title.localeCompare(b.title, "en")).slice(0, 30)]);
    return groups;
  }
  const scored = S.entries.filter((e) => matches(e, q)).map((e) => {
    const t = e.title.toLowerCase();
    const sc = t === q ? 0 : t.startsWith(q) ? 1 : t.split(/[\s\-–._@]+/).some((w) => w.startsWith(q)) ? 2 : t.includes(q) ? 3 : 4;
    return [sc + (e.favorite ? -0.5 : 0) + (S.recent.includes(e.id) ? -0.3 : 0), e];
  }).sort((a, b) => a[0] - b[0] || a[1].title.localeCompare(b[1].title, "sr"));
  return [["Results", scored.map((x) => x[1]).slice(0, 40)]];
}

function quickFlat() { return quickResults().flatMap((g) => g[1]); }

function openQuick() {
  S.mini = null;
  document.body.classList.remove("is-mini");
  $$("#modalRoot .overlay").forEach((o) => o.remove());
  closeMenu();
  S.quick = { q: "", sel: 0 };
  $("#toasts").innerHTML = "";
  $("#app").hidden = true;
  $("#mini").hidden = true;
  $("#lock").hidden = true;
  $("#quick").hidden = false;
  $("#quick").innerHTML = `
    <div class="q-head"><div class="brand-mark">${logo("small")}</div>
      <input id="qInput" placeholder="Search vault…" spellcheck="false" autocomplete="off"><kbd>Esc</kbd></div>
    <div class="q-list" id="qList"></div>
    <div class="q-foot">
      <span><kbd>↵</kbd> password</span><span><kbd>Ctrl B</kbd> username</span><span><kbd>Ctrl T</kbd> 2FA code</span>
      <span><kbd>Ctrl ↵</kbd> log in</span><span><kbd>Tab</kbd> open in Vaultkeeper</span></div>`;
  const inp = $("#qInput");
  inp.addEventListener("input", () => { S.quick.q = inp.value; S.quick.sel = 0; renderQuickList(); });
  $("#qList").addEventListener("click", (ev) => {
    const act = ev.target.closest("[data-qact]");
    const it = ev.target.closest(".q-item");
    if (!it) return;
    S.quick.sel = +it.dataset.i;
    if (act) quickDo(act.dataset.qact);
    else renderQuickList();
  });
  $("#qList").addEventListener("dblclick", (ev) => { if (ev.target.closest(".q-item") && !ev.target.closest("[data-qact]")) quickDo("main"); });
  renderQuickList();
  setTimeout(() => inp.focus(), 20);
}

function renderQuickList() {
  if (!S.quick) return;
  const groups = quickResults();
  const flat = groups.flatMap((g) => g[1]);
  S.quick.sel = Math.max(0, Math.min(S.quick.sel, flat.length - 1));
  let i = 0, html = "";
  for (const [title, list] of groups) {
    if (!list.length) continue;
    html += `<div class="q-group">${esc(title)}</div>`;
    for (const e of list) {
      const main = e.password ? "password" : e.username ? "username" : e.totp ? "2FA code" : "";
      html += `<div class="q-item ${i === S.quick.sel ? "sel" : ""}" data-i="${i}">${tileHTML(e)}
        <div class="meta"><div class="t">${esc(e.title)}</div><div class="s">${esc(subtitleOf(e))}</div></div>
        <div class="acts">
          ${e.username ? `<button class="icon-btn" data-qact="username" title="Copy username (Ctrl+B)">${icon("user")}</button>` : ""}
          ${e.password ? `<button class="icon-btn" data-qact="password" title="Copy password (Enter)">${icon("key")}</button>` : ""}
          ${e.totp ? `<button class="icon-btn" data-qact="totp" title="Copy 2FA code (Ctrl+T)">${icon("twofa")}</button>` : ""}
          ${e.url ? `<button class="icon-btn" data-qact="login" title="Log in (Ctrl+Enter)">${icon("login")}</button>` : ""}
        </div>
        ${main ? `<span class="enter"><kbd>↵</kbd>${main}</span>` : ""}</div>`;
      i++;
    }
  }
  $("#qList").innerHTML = html || `<div class="empty-list">${icon("search")}<div>${S.quick.q ? "No results for “" + esc(S.quick.q) + "”" : "The vault is empty"}</div></div>`;
  $("#qList .q-item.sel")?.scrollIntoView({ block: "nearest" });
}

async function quickDo(action) {
  const e = quickFlat()[S.quick.sel];
  if (!e) return;
  if (action === "open") { S.selId = e.id; return closeQuick(false, true); }
  if (action === "login") {
    if (!e.url) return toast("This item has no link", "err");
    await closeQuick(false, true);
    return startMini(e.id);
  }
  const key = action === "main" ? (e.password ? "password" : e.username ? "username" : e.totp ? "totp" : null) : action;
  if (!key || (key === "totp" && !e.totp)) return toast("This field is empty", "err");
  try {
    const r = await call("copy", e.id, key);
    S.recent = [e.id, ...S.recent.filter((x) => x !== e.id)].slice(0, 12);
    const label = { password: "Password", username: "Username", totp: "2FA code" }[key];
    const done = document.createElement("div");
    done.className = "q-done";
    done.innerHTML = `<div><div class="ok">${icon("check")}</div><b>${label} copied</b><small>${esc(e.title)} · paste with Ctrl+V${r.clear_in ? ` · clears in ${r.clear_in} s` : ""}</small></div>`;
    $("#quick").appendChild(done);
    setTimeout(() => closeQuick(true), 450);
  } catch (err) { toast(err.message, "err"); }
}

async function closeQuick(minimize, showApp = false) {
  if (!S.quick && !S.pendingQuick) return;
  S.quick = null;
  S.pendingQuick = false;
  $("#quick").hidden = true;
  $("#quick").innerHTML = "";
  if (S.unlocked) {
    $("#app").hidden = false;
    renderAll();
    if (S.selId) select(S.selId);
  } else {
    $("#lock").hidden = false;
  }
  try { await call("exit_quick", !!minimize && !showApp, !!showApp); } catch {}
}

function quickKey(ev) {
  const ctrl = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();
  const n = quickFlat().length;
  if (ev.key === "Escape") { ev.preventDefault(); return closeQuick(false); }
  if (ev.key === "ArrowDown") { ev.preventDefault(); S.quick.sel = Math.min(n - 1, S.quick.sel + 1); return renderQuickList(); }
  if (ev.key === "ArrowUp") { ev.preventDefault(); S.quick.sel = Math.max(0, S.quick.sel - 1); return renderQuickList(); }
  if (ev.key === "Tab") { ev.preventDefault(); return quickDo("open"); }
  if (ev.key === "Enter") { ev.preventDefault(); return quickDo(ctrl ? "login" : "main"); }
  if (ctrl && k === "b") { ev.preventDefault(); return quickDo("username"); }
  if (ctrl && k === "t") { ev.preventDefault(); return quickDo("totp"); }
  if (ctrl && k === "c" && !String(getSelection()) && $("#qInput").selectionStart === $("#qInput").selectionEnd) { ev.preventDefault(); return quickDo("password"); }
}

/* ==========================================================================
   Events
   ========================================================================== */

function bindApp() {
  $("#searchIcon").outerHTML = icon("search");
  $("#btnNew").innerHTML = `${icon("plus", "sm")} New`;
  $("#btnNew").addEventListener("click", () => openEditor(null));
  $("#search").addEventListener("input", (ev) => {
    S.q = ev.target.value;
    renderList();
    const list = filtered();
    if (list.length && !list.some((e) => e.id === S.selId)) select(list[0].id, false);
  });
  $("#search").addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); moveSel(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); moveSel(-1); }
    else if (ev.key === "Enter") { ev.preventDefault(); const e = selected(); if (e) (ev.ctrlKey && e.url ? startMini(e.id) : copyField(e.id, e.password ? "password" : "username")); }
    else if (ev.key === "Escape") { if (S.q) { ev.target.value = ""; S.q = ""; renderList(); } }
  });
  $("#btnSort").addEventListener("click", () => { S.sort = S.sort === "name" ? "recent" : "name"; renderList(); });

  $(".sidebar").addEventListener("click", async (ev) => {
    const b = ev.target.closest(".nav-item");
    if (!b) return;
    if (b.dataset.tool) {
      const t = b.dataset.tool;
      if (t === "health") openHealth();
      else if (t === "gen") openGenerator();
      else if (t === "import") doImport();
      else if (t === "settings") openSettings();
      else if (t === "lock") lockNow();
      else if (t === "quit") { if (await confirmModal("Exit Vaultkeeper?", "Vaultkeeper will shut down completely and the quick search hotkey will not work until you start it again.", "Exit")) call("quit_app").catch(() => {}); }
      return;
    }
    S.filter = { kind: b.dataset.kind, value: b.dataset.value || null };
    renderSidebar();
    renderList();
    const list = filtered();
    if (!list.some((e) => e.id === S.selId)) { S.selId = list[0]?.id || null; renderList(); renderDetail(); }
  });

  $("#list").addEventListener("click", (ev) => {
    const it = ev.target.closest(".item");
    if (it) select(it.dataset.id, false);
  });
  $("#list").addEventListener("dblclick", (ev) => {
    const it = ev.target.closest(".item");
    const e = it && S.entries.find((x) => x.id === it.dataset.id);
    if (e) openEditor(e);
  });
  $("#list").addEventListener("contextmenu", (ev) => {
    const it = ev.target.closest(".item");
    if (!it) return;
    ev.preventDefault();
    select(it.dataset.id, false);
    moreMenu(selected(), ev.clientX, ev.clientY);
  });

  $("#detail").addEventListener("click", (ev) => {
    const hb = ev.target.closest("[data-hreveal], [data-hcopy], [data-hdel], [data-hclear]");
    if (hb && selected()) return historyAction(selected(), hb);
    const ab = ev.target.closest("[data-aadd], [data-aopen], [data-asave], [data-adel]");
    if (ab && selected()) return attachmentAction(selected(), ab);
    const b = ev.target.closest("[data-act], [data-copy], [data-reveal], [data-open-url]");
    if (!b) return;
    const e = selected();
    if (b.dataset.act === "new") return openEditor(null);
    if (b.dataset.act === "import") return doImport();
    if (!e) return;
    if (b.dataset.copy) copyField(e.id, b.dataset.copy);
    else if (b.dataset.reveal) { const k = b.dataset.reveal; S.reveal.has(k) ? S.reveal.delete(k) : S.reveal.add(k); renderDetail(); }
    else if (b.hasAttribute("data-open-url")) openUrl(e.id);
    else if (b.dataset.act === "login") startMini(e.id);
    else if (b.dataset.act === "ssh") copyField(e.id, "ssh");
    else if (b.dataset.act === "fav") toggleFav(e.id);
    else if (b.dataset.act === "edit") openEditor(e);
    else if (b.dataset.act === "more") { const r = b.getBoundingClientRect(); moreMenu(e, r.right - 220, r.bottom + 6); }
  });

  // show/hide password in input fields (everywhere)
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-toggle-pw]");
    if (!b) return;
    const inp = document.getElementById(b.dataset.togglePw);
    inp.type = inp.type === "password" ? "text" : "password";
    b.innerHTML = icon(inp.type === "password" ? "eye" : "eyeOff");
  });

  // file drag & drop: never let the window "open" a file; on the details pane, add it as an attachment
  let dragDepth = 0;
  const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");
  const dz = () => $("#dropZone");
  document.addEventListener("dragenter", (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth++;
    if (S.unlocked && !S.quick && !S.mini && selected() && !dz()) {
      const d = document.createElement("div");
      d.id = "dropZone"; d.className = "drop-zone";
      d.innerHTML = `<div>${icon("paperclip")}<b>Drop a file to add it</b><small>to “${esc(selected().title)}” · encrypted, up to 10 MB</small></div>`;
      document.body.appendChild(d);
    }
  });
  document.addEventListener("dragover", (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
  document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; dz()?.remove(); } });
  document.addEventListener("drop", (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    const had = !!dz();
    dz()?.remove();
    if (had && ev.dataTransfer.files.length) addDroppedFiles([...ev.dataTransfer.files]);
  });

  document.addEventListener("keydown", onKey);
  ["mousemove", "keydown", "mousedown", "wheel"].forEach((t) => document.addEventListener(t, activity, { passive: true }));
}

function inField(ev) { return ev.target.matches("input, textarea, select"); }

function onKey(ev) {
  const ctrl = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();
  if (S.quick && !topModal()) return quickKey(ev);
  if (ev.key === "Escape" && S.pendingQuick && !S.unlocked) { ev.preventDefault(); return closeQuick(true); }
  const modal = topModal();
  if (ev.key === "Escape") {
    if ($("#menuRoot").children.length) return closeMenu();
    if (modal) { ev.preventDefault(); return modal._close(); }
    if (S.mini) return exitMini();
  }
  if (!S.unlocked) return;
  if (modal) {
    if (ctrl && k === "s" && modal.classList.contains("editor")) { ev.preventDefault(); modal._save?.(); }
    return;
  }
  if (S.mini) {
    const steps = miniSteps(S.entries.find((x) => x.id === S.mini.id) || {});
    const n = parseInt(ev.key, 10);
    if (n >= 1 && n <= steps.length) $(`.mini-step[data-step="${steps[n - 1].key}"]`)?.click();
    return;
  }
  const e = selected();
  if (ctrl && (k === "k" || k === "f")) { ev.preventDefault(); $("#search").focus(); $("#search").select(); }
  else if (ctrl && k === "n") { ev.preventDefault(); openEditor(null); }
  else if (ctrl && k === "l") { ev.preventDefault(); lockNow(); }
  else if (ctrl && k === "b" && e) { ev.preventDefault(); copyField(e.id, "username"); }
  else if (ctrl && k === "t" && e && e.totp) { ev.preventDefault(); copyField(e.id, "totp"); }
  else if (ctrl && k === "c" && e && e.password && !String(getSelection()) && !(inField(ev) && ev.target.selectionStart !== ev.target.selectionEnd)) { ev.preventDefault(); copyField(e.id, "password"); }
  else if (ctrl && ev.key === "Enter" && e && e.url) { ev.preventDefault(); startMini(e.id); }
  else if (!inField(ev)) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); moveSel(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); moveSel(-1); }
    else if (ev.key === "Enter" && e) openEditor(e);
    else if (ev.key === "Delete" && e) deleteEntry(e.id);
    else if (ev.key.length === 1 && !ctrl && !ev.altKey && /\S/.test(ev.key)) { $("#search").focus(); }
  }
}

function activity() {
  S.lastActivity = Date.now();
  if (S.unlocked && Date.now() - S.lastPing > 20000) { S.lastPing = Date.now(); API.ping(); }
}

async function lockNow(message) {
  try { await call("lock"); } catch {}
  showLock(message);
}

// timers: 2FA every second, auto-lock, sync with disk
setInterval(() => { if (S.unlocked) tickTotp(); }, 1000);
// auto-lock is handled by the Python side (measures idle time of the WHOLE computer, not only the Vaultkeeper window)
setInterval(async () => {
  if (!S.unlocked || topModal()) return;
  try {
    const r = await call("sync");
    S.lastSync = new Date();
    if (r.changed) {
      await loadEntries();
      if (!S.entries.some((e) => e.id === S.selId)) S.selId = null;
      if (S.mini) renderMini(); else renderAll();
      toast("Changes from another computer were loaded", "info");
    } else renderSync();
  } catch (err) {
    if (/master password was changed/i.test(err.message)) lockNow(err.message);
  }
}, 15000);

/* ==========================================================================
   Startup
   ========================================================================== */

const app = {
  onQuickToggle() {
    if (S.quick) closeQuick(false);
    else if (S.pendingQuick && !S.unlocked) closeQuick(true);
  },
  focusQuick() {
    const el = S.quick ? $("#qInput") : !S.unlocked ? $("#masterPw") : null;
    if (el) { window.focus(); el.focus(); }
  },
  onQuick() {
    if (S.quick) return;
    if (!S.unlocked) {
      S.pendingQuick = true;
      $("#lock").hidden = false;
      $("#lockError").style.color = "var(--muted)";
      $("#lockError").textContent = "Unlock the vault to use quick search (Esc to cancel)";
      setTimeout(() => $("#masterPw").focus(), 30);
      if (S.hello && S.hello.enabled && !S.hello.need_master) helloUnlock();
      return;
    }
    openQuick();
  },
  onLocked(reason) {
    showLock(reason === "auto" ? "Vaultkeeper was locked due to inactivity." : reason === "minimize" ? "Vaultkeeper was locked when minimized." : "");
  },
  onClipboardCleared() { toast("Clipboard cleared", "info"); },
  onBrowserPaired() {
    toast("Browser paired with Vaultkeeper");
    $$("#modalRoot .overlay").forEach((o) => o._refreshBridge && o._refreshBridge());
  },
  onBrowserFill(title) { if (S.unlocked && !S.quick) toast("Filled in browser: " + title, "info"); },
};
window.app = app;

let booted = false;
async function boot() {
  if (booted || !(window.pywebview && window.pywebview.api)) return;
  booted = true;
  API = window.pywebview.api;
  bindLock();
  bindApp();
  bindMini();
  const st = await call("get_state");
  S.state = st;
  S.settings = st.settings;
  document.documentElement.dataset.platform = st.platform || "";
  if (st.unlocked) { applyTheme(); await enterApp(); } else await showLock();
}
window.addEventListener("pywebviewready", boot);
document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 50));
