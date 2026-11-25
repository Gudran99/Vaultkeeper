"""
Local bridge between Vaultkeeper and the browser extension.

Security:
  * listens ONLY on 127.0.0.1 (not reachable from the network)
  * each browser is paired once with a 6-digit code shown by Vaultkeeper; it receives a long token
    (only the token's hash is stored in the settings)
  * requests from ordinary web pages are rejected (Origin and Host header checks)
  * a password is handed out only if the site address matches the link saved in the entry (phishing protection)
  * the vault must be unlocked
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

DEFAULT_PORT = 47123
VERSION = 1
_SECOND_LEVEL = {"co", "com", "org", "net", "gov", "edu", "ac", "in", "or", "ne", "go"}


# ------------------------------------------------------------ address comparison

def host_of(url: str) -> str:
    if not url:
        return ""
    if "://" not in url:
        url = "https://" + url
    try:
        h = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def base_domain(host: str) -> str:
    parts = host.split(".")
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in _SECOND_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def match_rank(entry_url: str, page_url: str) -> int | None:
    """0 = same host, 1 = subdomain of the saved one, 2 = same base domain, None = no match."""
    eh, ph = host_of(entry_url), host_of(page_url)
    if not eh or not ph:
        return None
    if eh == ph:
        return 0
    if ph.endswith("." + eh):
        return 1
    if "." in eh and base_domain(eh) == base_domain(ph):
        return 2
    return None


def entry_urls(e) -> list[str]:
    urls = [e.url] if e.url else []
    dom = (e.fields or {}).get("domain")
    if dom:
        urls.append(dom)
    return urls


def best_rank(e, page_url: str) -> int | None:
    ranks = [r for r in (match_rank(u, page_url) for u in entry_urls(e)) if r is not None]
    return min(ranks) if ranks else None


# ------------------------------------------------------------------- server

class Bridge:
    def __init__(self, api, port: int = DEFAULT_PORT):
        self.api = api
        self.port = port
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.error = ""
        self._pair_code: str | None = None
        self._pair_expires = 0.0
        self._pair_fails = 0

    # ---- lifecycle
    @property
    def running(self) -> bool:
        return self._server is not None

    def start(self) -> bool:
        if self._server:
            return True
        self.error = ""
        bridge = self

        class Handler(_Handler):
            ctx = bridge

        try:
            self._server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        except OSError as e:
            self._server = None
            self.error = "Port %d is in use (%s)." % (self.port, e.strerror or e)
            return False
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return True

    def stop(self):
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        self._server = None

    # ---- pairing
    def new_pair_code(self) -> tuple[str, int]:
        self._pair_code = "%06d" % secrets.randbelow(1_000_000)
        self._pair_expires = time.time() + 120
        self._pair_fails = 0
        return self._pair_code, 120

    def cancel_pair_code(self):
        self._pair_code = None

    def try_pair(self, code: str, name: str) -> str | None:
        if not self._pair_code or time.time() > self._pair_expires:
            return None
        if not hmac.compare_digest(str(code).strip(), self._pair_code):
            self._pair_fails += 1
            if self._pair_fails >= 5:
                self._pair_code = None  # too many attempts - new code in Vaultkeeper
            return None
        self._pair_code = None
        token = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
        self.api._add_browser_pair(name, hashlib.sha256(token.encode()).hexdigest())
        return token

    def check_token(self, token: str) -> bool:
        if not token:
            return False
        h = hashlib.sha256(token.encode()).hexdigest()
        for p in self.api._cfg.get("browser_pairs", []):
            if hmac.compare_digest(p.get("hash", ""), h):
                p["last_used"] = time.time()
                return True
        return False


class _Handler(BaseHTTPRequestHandler):
    ctx: Bridge
    server_version = "Vaultkeeper"
    sys_version = ""

    def log_message(self, *a):  # no console logging
        pass

    # ---- helpers
    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin", "")
        return origin == "" or origin.startswith(("chrome-extension://", "moz-extension://", "extension://"))

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        return host in ("127.0.0.1:%d" % self.ctx.port, "localhost:%d" % self.ctx.port)

    def _send(self, code: int, obj: dict):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin", "")
        if origin and self._origin_ok():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not (self._host_ok() and self._origin_ok()):
            return self._send(403, {"error": "forbidden"})
        self._send(204, {})

    def do_GET(self):
        self._send(405, {"error": "use POST"})

    def do_POST(self):
        if not (self._host_ok() and self._origin_ok()):
            return self._send(403, {"error": "forbidden"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 65536:
                return self._send(413, {"error": "too large"})
            data = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            return self._send(400, {"error": "bad json"})
        auth = self.headers.get("Authorization", "")
        token = auth[7:] if auth.startswith("Bearer ") else ""
        path = self.path.split("?")[0]
        try:
            code, out = self.ctx.api._bridge_request(path, data, token, self.ctx)
        except Exception as e:  # never take the server down
            code, out = 500, {"error": "internal: %s" % e.__class__.__name__}
        self._send(code, out)
