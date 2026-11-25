// Vaultkeeper extension - popup shown when the icon is clicked
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));
const IC = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.2" r="3.7"/><path d="M4.8 20c.9-3.6 3.8-5.6 7.2-5.6s6.3 2 7.2 5.6"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="15.5" r="4.5"/><path d="M11.2 12.3L20 3.5M16.5 7l2.5 2.5M14 9.5l2 2"/></svg>',
  otp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M9.5 9.5l1.8 1.8 3.4-3.6"/></svg>',
};
let tab = null;

function toast(t) {
  document.querySelector(".toast")?.remove();
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = t;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1800);
}

async function getTab() {
  const p = new URLSearchParams(location.search);
  if (p.get("tab")) return chrome.tabs.get(+p.get("tab"));   // for testing
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

function itemHTML(x) {
  return `<div class="item" data-id="${esc(x.id)}"><span class="tile">${esc((x.title[0] || "?").toUpperCase())}</span>
    <span class="meta"><div class="t">${esc(x.title)}</div><div class="s">${esc(x.username || "—")}</div></span>
    <span class="acts">
      ${x.username ? `<button class="ib" data-copy="username" title="Copy username">${IC.user}</button>` : ""}
      ${x.has_password ? `<button class="ib" data-copy="password" title="Copy password">${IC.key}</button>` : ""}
      ${x.has_totp ? `<button class="ib" data-copy="totp" title="Copy 2FA code">${IC.otp}</button>` : ""}
      ${x.can_fill && (x.username || x.has_password) ? `<button class="fill" data-fill>Fill</button>` : ""}
    </span></div>`;
}

async function render() {
  tab = await getTab();
  let host = "";
  try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch {}
  $("#host").textContent = host || "—";
  const st = await send({ type: "status" });
  const dot = $("#dot");
  dot.className = st.state === "ready" ? "ok" : st.state === "locked" ? "warn" : "";
  $("#foot").innerHTML = "";

  if (st.state === "offline") {
    $("#main").innerHTML = `<div class="msg"><h3>Cannot reach Vaultkeeper</h3>Check that:<ol><li>Vaultkeeper is running (it can be minimized)</li><li>In Vaultkeeper: <b>Settings → Browser extension → Browser connection</b> is on and says “Active”</li><li>Only one Vaultkeeper is running</li></ol><br><button class="btn" id="retry">Try again</button></div>`;
    $("#retry").addEventListener("click", render);
    return;
  }
  if (st.state === "unpaired") {
    $("#main").innerHTML = `<div class="msg"><h3>Pair the extension with Vaultkeeper</h3>
      <ol><li>In Vaultkeeper, open <b>Settings</b></li><li>In the <b>Browser extension</b> section, click <b>Pair browser</b></li><li>Enter the code shown here</li></ol>
      <div class="code"><input id="code" maxlength="6" inputmode="numeric" placeholder="000000" autocomplete="off"><button class="btn" id="pair">Pair</button></div>
      <div class="err" id="err"></div></div>`;
    const go = async () => {
      const r = await send({ type: "pair", code: $("#code").value.trim() });
      if (r.ok) { toast("✓ Paired"); render(); } else $("#err").textContent = r.error || "Pairing failed";
    };
    $("#pair").addEventListener("click", go);
    $("#code").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    setTimeout(() => $("#code").focus(), 50);
    return;
  }
  if (st.state === "locked") {
    $("#main").innerHTML = `<div class="msg"><h3>Vaultkeeper is locked</h3>Unlock Vaultkeeper to fill in a login.<br><br><button class="btn" id="show">Open Vaultkeeper</button></div>`;
    $("#show").addEventListener("click", () => { send({ type: "show" }); window.close(); });
    footer();
    return;
  }

  const r = await send({ type: "logins", url: tab.url });
  const items = r.items || [];
  $("#main").innerHTML = `<input class="search" id="q" placeholder="Search the whole vault…" autocomplete="off">
    <div id="res">${items.length ? `<div class="group">For ${esc(host)}</div>${items.map(itemHTML).join("")}` : `<div class="note">No saved logins for <b>${esc(host)}</b>. Search the whole vault above.</div>`}</div>`;
  let t = 0;
  $("#q").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = $("#q").value.trim();
      if (!q) return render();
      const s = await send({ type: "search", q, url: tab.url });
      $("#res").innerHTML = (s.items || []).length ? `<div class="group">Results</div>${s.items.map(itemHTML).join("")}<div class="note">“Fill” is only available for entries whose link matches this site.</div>` : `<div class="note">No results.</div>`;
    }, 180);
  });
  footer();
}

function footer() {
  $("#foot").innerHTML = `<span><kbd>Ctrl+Shift+L</kbd> fills on the page</span><a id="unpair">Unpair</a>`;
  $("#unpair").addEventListener("click", async () => { await send({ type: "unpair" }); render(); });
}

document.addEventListener("click", async (ev) => {
  const it = ev.target.closest(".item");
  if (!it) return;
  const id = it.dataset.id;
  const cp = ev.target.closest("[data-copy]");
  if (cp) {
    const r = await send({ type: "copy", id, key: cp.dataset.copy });
    toast(r.error ? r.error : `✓ Copied${r.clear_in ? ` · clears in ${r.clear_in} s` : ""}`);
  } else if (ev.target.closest("[data-fill]")) {
    const r = await send({ type: "fillTab", id, tabId: tab.id });
    if (r.ok) window.close(); else toast(r.error || "Fill failed");
  }
});

render();
