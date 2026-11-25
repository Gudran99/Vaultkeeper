// Vaultkeeper extension - background part. The only one that talks to the Vaultkeeper app (127.0.0.1).
const API = "http://127.0.0.1:47123";

async function getToken() {
  return (await chrome.storage.local.get("token")).token || "";
}

async function req(path, body = {}) {
  const token = await getToken();
  let r;
  try {
    r = await fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    return { offline: true };
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) return { notPaired: true };
  if (!r.ok) return { error: j.error || "Error " + r.status };
  return j;
}

function browserName() {
  const ua = navigator.userAgent;
  const name = ua.includes("Edg/") ? "Microsoft Edge" : ua.includes("OPR/") ? "Opera" : "Google Chrome";
  return `${name} · ${new Date().toLocaleDateString("en-US")}`;
}

async function status() {
  const p = await req("/v1/ping");
  if (p.offline) return { state: "offline" };
  if (!p.paired) return { state: "unpaired" };
  return { state: p.unlocked ? "ready" : "locked" };
}

async function handle(msg, sender) {
  // URL to check: messages from the page (content script) use the real frame URL, which the
  // page cannot fake; only extension pages (popup) may send the tab URL.
  const fromExtension = (sender.url || "").startsWith(chrome.runtime.getURL(""));
  const url = fromExtension ? msg.url || "" : sender.url || (sender.tab && sender.tab.url) || "";
  switch (msg.type) {
    case "status": return status();
    case "pair": {
      const r = await req("/v1/pair", { code: msg.code, name: browserName() });
      if (r.token) { await chrome.storage.local.set({ token: r.token }); return { ok: true }; }
      return r;
    }
    case "unpair": await chrome.storage.local.remove("token"); return { ok: true };
    case "logins": return req("/v1/logins", { url });
    case "search": return req("/v1/search", { q: msg.q, url });
    case "fill": return req("/v1/fill", { id: msg.id, url });
    case "totp": return req("/v1/totp", { id: msg.id, url });
    case "copy": return req("/v1/copy", { id: msg.id, key: msg.key });
    case "show": return req("/v1/show");
    case "fillTab": {
      // from the popup: check the tab URL, then send the data to the page
      const tab = await chrome.tabs.get(msg.tabId);
      const r = await req("/v1/fill", { id: msg.id, url: tab.url });
      if (r.error || r.locked || r.offline || r.notPaired) return r;
      await chrome.tabs.sendMessage(msg.tabId, { type: "doFill", username: r.username, password: r.password }).catch(() => {});
      return { ok: true };
    }
    default: return { error: "unknown" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "fill-login") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "fillFirst" }).catch(() => {});
});
