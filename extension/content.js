// Vaultkeeper extension - the part that runs on the page: detects login fields,
// adds a Vaultkeeper icon to the field and fills in the chosen login.
(() => {
  if (window.__vaultkeeperLoaded) return;
  window.__vaultkeeperLoaded = true;

  // After the extension is installed/updated, tabs that are already open lose the connection ("context invalidated")
  // until the page is refreshed - that is NOT the same as "Vaultkeeper is not running".
  const STALE = { stale: true };
  const send = (msg) => new Promise((res) => {
    try {
      if (!chrome.runtime?.id) return res(STALE);
      chrome.runtime.sendMessage(msg, (r) => {
        const err = chrome.runtime.lastError;
        if (err) return res(/invalidated|receiving end/i.test(err.message || "") ? STALE : { offline: true });
        res(r || {});
      });
    } catch { res(STALE); }
  });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const LOGO = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><defs><linearGradient id="tzg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset=".5" stop-color="#4f8cff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="6" fill="#0d1428"/><circle cx="12" cy="12" r="6.6" fill="none" stroke="url(#tzg)" stroke-width="2.4"/><circle cx="12" cy="10.9" r="1.7" fill="url(#tzg)"/><path d="M10.9 11.8h2.2l.6 3.4c-.9.4-2.5.4-3.4 0z" fill="url(#tzg)"/></svg>`;

  // ------------------------------------------------------------- fields
  const OTP_RE = /(otp|totp|2fa|mfa|one.?time|verification.?code|security.?code|auth.?code|authenticator|token|kod)/i;
  const USER_RE = /(user|email|e-mail|login|account|korisni|ime|identifier|phone)/i;

  function visible(el) {
    if (!el.isConnected || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 14) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && +st.opacity > 0.05;
  }
  const isTextish = (el) => el.tagName === "INPUT" && ["text", "email", "tel", ""].includes((el.getAttribute("type") || "").toLowerCase());
  const attrs = (el) => [el.name, el.id, el.getAttribute("autocomplete"), el.getAttribute("placeholder"), el.getAttribute("aria-label")].join(" ");

  function isOtp(el) {
    if (el.getAttribute("autocomplete") === "one-time-code") return true;
    if (!isTextish(el) && (el.getAttribute("type") || "") !== "number") return false;
    const ml = +el.getAttribute("maxlength") || 0;
    return OTP_RE.test(attrs(el)) && !USER_RE.test(attrs(el)) && (ml === 0 || (ml >= 6 && ml <= 8));
  }

  function findUsernameFor(pw) {
    const scope = pw.form || document;
    const inputs = [...scope.querySelectorAll("input")].filter((i) => isTextish(i) && visible(i) && !isOtp(i));
    const before = inputs.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before[before.length - 1] || null;
  }

  function scan() {
    const fields = [];
    const pws = [...document.querySelectorAll('input[type="password"]')].filter(visible);
    for (const pw of pws) {
      fields.push({ el: pw, kind: "password", user: findUsernameFor(pw), pw });
      const u = findUsernameFor(pw);
      if (u) fields.push({ el: u, kind: "username", user: u, pw });
    }
    if (!pws.length) {
      // first login step (e.g. Google, Microsoft): only an email/username field
      const u = [...document.querySelectorAll("input")].find((i) => isTextish(i) && visible(i) && !isOtp(i) &&
        (i.getAttribute("autocomplete") === "username" || (i.getAttribute("type") || "") === "email" || USER_RE.test(attrs(i))));
      if (u) fields.push({ el: u, kind: "username", user: u, pw: null });
    }
    for (const o of document.querySelectorAll("input")) if (visible(o) && isOtp(o)) fields.push({ el: o, kind: "otp", otp: o });
    return fields;
  }

  // ------------------------------------------------------- display (shadow DOM)
  const host = document.createElement("vaultkeeper-ext");
  host.style.cssText = "all: initial; position: fixed; inset: 0 auto auto 0; z-index: 2147483647; pointer-events: none;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    * { box-sizing: border-box; font-family: "Segoe UI", Inter, system-ui, sans-serif; }
    .tz-icon { position: fixed; width: 24px; height: 24px; border: 0; padding: 3px; margin: 0; border-radius: 7px; background: transparent; cursor: pointer; pointer-events: auto; opacity: .9; transition: transform .1s, background .1s; }
    .tz-icon:hover { opacity: 1; background: rgba(79,140,255,.15); transform: scale(1.06); }
    .tz-icon svg { display: block; }
    .menu { position: fixed; width: 320px; max-height: 340px; overflow: auto; pointer-events: auto; background: #111723; color: #e7edf7; border: 1px solid #2b3649; border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.45); padding: 6px; font-size: 13px; animation: pop .12s ease-out; }
    .head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 8px; color: #7d8aa0; font-size: 11.5px; border-bottom: 1px solid #212a3a; margin-bottom: 4px; }
    .head b { color: #e7edf7; font-size: 12.5px; }
    .item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; font-size: 13px; }
    .item:hover, .item.sel { background: rgba(79,140,255,.16); }
    .tile { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: rgba(79,140,255,.15); color: #4f8cff; font-weight: 800; flex: none; }
    .meta { min-width: 0; flex: 1; }
    .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .s { color: #7d8aa0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 5px; color: #22d3ee; border: 1px solid rgba(34,211,238,.35); }
    .msg { padding: 14px 10px; color: #b6c1d3; line-height: 1.45; }
    .msg b { color: #e7edf7; }
    .btn { margin-top: 10px; height: 30px; padding: 0 12px; border-radius: 8px; border: 0; background: linear-gradient(135deg,#4f8cff,#5a5cf0); color: #fff; font-weight: 600; cursor: pointer; }
    .toast { position: fixed; pointer-events: none; background: #161d2b; color: #e7edf7; border: 1px solid #2b3649; border-radius: 9px; padding: 8px 12px; font-size: 12.5px; box-shadow: 0 10px 30px rgba(0,0,0,.4); animation: pop .15s; }
    @keyframes pop { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  </style><div id="icons"></div><div id="pop"></div>`;
  const iconsEl = root.getElementById("icons");
  const popEl = root.getElementById("pop");
  (document.body || document.documentElement).appendChild(host);

  let fields = [];
  let openFor = null;

  // Buttons are created once per field and then only moved. (Previously they were recreated on
  // every refresh, so a click sometimes got lost and the icon flickered.)
  const btns = new Map();
  function place() {
    const seen = new Set();
    for (const f of fields) {
      if (seen.has(f.el) || !visible(f.el)) continue;
      const r = f.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      let b = btns.get(f.el);
      if (!b) {
        b = document.createElement("button");
        b.className = "tz-icon";
        b.innerHTML = LOGO;
        const el = f.el;
        b.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
        b.addEventListener("click", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const i = fields.findIndex((x) => x.el === el);
          if (i >= 0) openMenu(i);
        });
        btns.set(el, b);
        iconsEl.appendChild(b);
      }
      b.title = f.kind === "otp" ? "Vaultkeeper: fill 2FA code" : "Vaultkeeper: fill login";
      b.style.left = r.right - 28 + "px";
      b.style.top = r.top + (r.height - 24) / 2 + "px";
      seen.add(f.el);
    }
    for (const [el, b] of btns) if (!seen.has(el)) { b.remove(); btns.delete(el); }
    if (openFor !== null && fields[openFor]) positionMenu();
  }

  function positionMenu() {
    const menu = popEl.firstElementChild;
    if (!menu) return;
    const r = fields[openFor].el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - 320, innerWidth - 328));
    let top = r.bottom + 6;
    if (top + menu.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  function closeMenu() { popEl.innerHTML = ""; openFor = null; }

  function showToast(text, field) {
    const r = field.getBoundingClientRect();
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    t.style.left = Math.max(8, r.left) + "px";
    t.style.top = Math.max(8, r.top - 40) + "px";
    popEl.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  function stateMessage(r) {
    if (r.stale) return `<div class="msg"><b>Refresh the page (F5).</b><br>The Vaultkeeper extension was installed or updated after this tab was opened.</div>`;
    if (r.offline) return `<div class="msg"><b>Cannot reach Vaultkeeper.</b><br>Check that Vaultkeeper is running and that “Browser connection” is on under <b>Settings → Browser extension</b>.</div>`;
    if (r.notPaired) return `<div class="msg"><b>Extension is not paired.</b><br>Click the Vaultkeeper icon in the browser toolbar and enter the code from Vaultkeeper.</div>`;
    if (r.locked) return `<div class="msg"><b>Vaultkeeper is locked.</b><br>Unlock it and try again.<br><button class="btn" data-show>Open Vaultkeeper</button></div>`;
    if (r.error) return `<div class="msg">${esc(r.error)}</div>`;
    return "";
  }

  async function openMenu(i) {
    const f = fields[i];
    openFor = i;
    popEl.innerHTML = `<div class="menu"><div class="msg">Loading…</div></div>`;
    positionMenu();
    const r = await send({ type: "logins" });
    if (openFor !== i) return;
    const menu = popEl.firstElementChild;
    const st = stateMessage(r);
    let items = (r.items || []);
    if (f.kind === "otp") items = items.filter((x) => x.has_totp);
    if (st) menu.innerHTML = st;
    else if (!items.length) {
      menu.innerHTML = `<div class="msg">${f.kind === "otp" ? "No saved <b>2FA key</b> for" : "No saved logins for"} <b>${esc(r.host || location.hostname)}</b>.<br>Add an entry with this link in Vaultkeeper.</div>`;
    } else {
      menu.innerHTML = `<div class="head">${LOGO}<b>Vaultkeeper</b> · ${esc(r.host || location.hostname)}</div>` +
        items.map((x, k) => `<button class="item ${k === 0 ? "sel" : ""}" data-id="${esc(x.id)}">
          <span class="tile">${esc((x.title[0] || "?").toUpperCase())}</span>
          <span class="meta"><div class="t">${esc(x.title)}</div><div class="s">${esc(f.kind === "otp" ? "2FA code" : x.username || "no username")}</div></span>
          ${x.has_totp && f.kind !== "otp" ? '<span class="pill">2FA</span>' : ""}</button>`).join("");
    }
    positionMenu();
    menu.addEventListener("click", async (ev) => {
      if (ev.target.closest("[data-show]")) { send({ type: "show" }); return closeMenu(); }
      const it = ev.target.closest(".item");
      if (!it) return;
      closeMenu();
      if (f.kind === "otp") await fillOtp(it.dataset.id, f.el);
      else await fillLogin(it.dataset.id, f);
    });
  }

  // ------------------------------------------------------------ filling
  function setValue(el, value) {
    if (!el || value == null) return;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillLogin(id, f) {
    const r = await send({ type: "fill", id });
    if (r.error || r.offline || r.locked || r.notPaired || r.stale) return showToast(r.error || (r.stale ? "Refresh the page (F5)" : r.locked ? "Vaultkeeper is locked" : "Cannot reach Vaultkeeper"), f.el);
    if (f.user && r.username) setValue(f.user, r.username);
    if (f.pw && r.password) setValue(f.pw, r.password);
    (f.pw || f.user)?.focus();
    showToast(f.pw ? "✓ Filled from Vaultkeeper" : "✓ Username filled — password on the next step", f.el);
  }

  async function fillOtp(id, el) {
    const r = await send({ type: "totp", id });
    if (r.error || !r.code) return showToast(r.error || "2FA code not available", el);
    setValue(el, r.code);
    showToast("✓ 2FA code filled", el);
  }

  async function fillFirst() {
    fields = scan();
    const target = fields.find((f) => f.kind === "password") || fields.find((f) => f.kind === "username") || fields.find((f) => f.kind === "otp");
    if (!target) return;
    const r = await send({ type: "logins" });
    let items = r.items || [];
    if (target.kind === "otp") items = items.filter((x) => x.has_totp);
    if (!items.length || r.locked || r.offline || r.notPaired || r.stale) { openMenu(fields.indexOf(target)); return; }
    if (items.length > 1 && items[0].rank === items[1].rank) { openMenu(fields.indexOf(target)); return; }
    if (target.kind === "otp") return fillOtp(items[0].id, target.el);
    return fillLogin(items[0].id, target);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "fillFirst") fillFirst();
    if (msg.type === "doFill") {
      fields = scan();
      const f = fields.find((x) => x.kind === "password") || fields.find((x) => x.kind === "username");
      if (!f) return;
      if (f.user && msg.username) setValue(f.user, msg.username);
      if (f.pw && msg.password) setValue(f.pw, msg.password);
      showToast("✓ Filled from Vaultkeeper", f.el);
    }
  });

  // ------------------------------------------------------- page watching
  // Scan at most once per ~300 ms, even when the page keeps changing (Gmail, Facebook...).
  // Previously every change postponed the scan, so the icon never appeared on such pages.
  let scanTimer = null, scanDelay = 300, dirty = false;
  const rescan = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (document.hidden) { dirty = true; return; }
      const t0 = performance.now();
      fields = scan();
      place();
      scanDelay = Math.min(2000, Math.max(300, (performance.now() - t0) * 25));  // heavy pages: less often
    }, scanDelay);
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && dirty) { dirty = false; rescan(); } });
  new MutationObserver(rescan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["type", "style", "class", "hidden"] });
  let raf = 0;
  const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
  addEventListener("scroll", onMove, true);
  addEventListener("resize", onMove);
  document.addEventListener("mousedown", (ev) => { if (!ev.composedPath().includes(host)) closeMenu(); }, true);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMenu(); }, true);
  setInterval(() => { if (fields.length && !document.hidden) place(); }, 1000);
  rescan();
})();
