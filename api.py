"""
Bridge between the interface (HTML/JS) and the vault core.
Every public method returns {"ok": True, ...} or {"ok": False, "error": "..."}.
"""

from __future__ import annotations

import base64
import functools
import hashlib
import mimetypes
import tempfile
import json
import shutil
import os
import threading
import time
import traceback
import webbrowser
from dataclasses import asdict

import bridge as bridge_mod
import winclip
import winhello
import winsys
from vault_core import (
    Vault, Entry, WrongPasswordError, VaultFormatError, ConflictError,
    parse_totp, totp_code, generate_password, password_strength,
    import_csv, default_vault_path,
)

MIN_MASTER_LEN = 10
DEFAULT_SETTINGS = {"auto_lock_min": 5, "clip_seconds": 30, "theme": "dark", "lock_on_minimize": False,
                    "backup_enabled": True, "backup_dir": "", "backup_keep": 30,
                    "hotkey": "ctrl+shift+space", "close_to_background": True,
                    "bridge_enabled": False}
BACKUP_EVERY_HOURS = 24
HISTORY_MAX = 30
HELLO_MASTER_EVERY_DAYS = 14   # the master password is required at least once every 14 days (so it is not forgotten)
# fields whose old values are kept in the history
HISTORY_FIELDS = ("password", "f:seed", "f:privkey", "f:key", "f:secret", "f:pin", "f:cvv")
NORMAL_SIZE = (1280, 800)
MINI_SIZE = (400, 600)
QUICK_SIZE = (720, 560)


def _config_path() -> str:
    return os.path.join(os.path.dirname(default_vault_path()), "config.json")


def default_backup_dir() -> str:
    # deliberately OUTSIDE the vault folder (Windows: %LOCALAPPDATA%, not synced to the cloud;
    # Linux: ~/.local/state/Vaultkeeper Backup)
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if not base:
        base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    new = os.path.join(base, "Vaultkeeper Backup")
    old = os.path.join(base, "Trezor Backup")   # folder used under the old app name
    return old if (os.path.isdir(old) and not os.path.isdir(new)) else new


def resource(*parts: str) -> str:
    import sys
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *parts)


def _hello_path() -> str:
    return os.path.join(os.path.dirname(default_vault_path()), "hello.json")


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _result(fn):
    @functools.wraps(fn)
    def wrapper(self, *a, **k):
        with self._lock:
            try:
                out = fn(self, *a, **k)
                return {"ok": True, **(out or {})}
            except (WrongPasswordError, VaultFormatError, ConflictError, ValueError, OSError) as e:
                return {"ok": False, "error": str(e)}
            except Exception as e:  # unexpected error
                traceback.print_exc()
                return {"ok": False, "error": "Unexpected error: %s" % e}
    return wrapper


class Api:
    def __init__(self):
        self._lock = threading.RLock()
        self._window = None
        self._vault: Vault | None = None
        self._cfg = self._load_cfg()
        self._last_ping = time.time()
        self._clip_timer: threading.Timer | None = None
        self._mini = False
        self._quick = False
        self._quick_prev = None          # (minimized, x, y, w, h) before quick search
        self._minimized = False
        self._quitting = False
        self._hotkey = winsys.GlobalHotkey(self._on_hotkey)
        self._temp_files: list[str] = []
        self._bridge = bridge_mod.Bridge(self)
        if self._cfg["settings"].get("bridge_enabled"):
            self._bridge.start()
        self._stop = threading.Event()
        threading.Thread(target=self._watchdog, daemon=True).start()

    # ------------------------------------------------------------------ cfg

    def _load_cfg(self) -> dict:
        try:
            with open(_config_path(), "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, ValueError):
            cfg = {}
        cfg.setdefault("vault_path", default_vault_path())
        cfg.setdefault("recent", [])
        cfg["settings"] = {**DEFAULT_SETTINGS, **cfg.get("settings", {})}
        return cfg

    def _save_cfg(self) -> None:
        try:
            os.makedirs(os.path.dirname(_config_path()), exist_ok=True)
            with open(_config_path(), "w", encoding="utf-8") as f:
                json.dump(self._cfg, f, indent=2, ensure_ascii=False)
        except OSError:
            pass

    def _remember(self, path: str) -> None:
        path = os.path.abspath(path)
        self._cfg["vault_path"] = path
        self._cfg["recent"] = [path] + [p for p in self._cfg["recent"] if p != path][:7]
        self._save_cfg()

    def _require(self) -> Vault:
        if self._vault is None:
            raise ValueError("Vaultkeeper is locked.")
        return self._vault

    def _js(self, code: str) -> None:
        if self._window is not None:
            try:
                self._window.evaluate_js(code)
            except Exception:
                pass

    # ------------------------------------------------------------ state

    @_result
    def get_state(self):
        recent = [{"path": p, "name": os.path.splitext(os.path.basename(p))[0], "exists": os.path.exists(p)}
                  for p in self._cfg["recent"]]
        path = self._cfg["vault_path"]
        return {
            "unlocked": self._vault is not None,
            "vault_path": path,
            "vault_name": os.path.splitext(os.path.basename(path))[0],
            "exists": os.path.exists(path),
            "recent": recent,
            "settings": self._cfg["settings"],
            "min_master_len": MIN_MASTER_LEN,
            "platform": winsys.platform_name(),
        }

    @_result
    def set_vault_path(self, path: str):
        self._cfg["vault_path"] = os.path.abspath(path)
        self._save_cfg()
        return {"exists": os.path.exists(path)}

    @_result
    def choose_vault(self, mode: str = "open"):
        if self._window is None:
            raise ValueError("The dialog is not available.")
        import webview
        fd = getattr(webview, "FileDialog", None)
        start = os.path.dirname(self._cfg["vault_path"])
        if mode == "new":
            kind = fd.SAVE if fd else webview.SAVE_DIALOG
            res = self._window.create_file_dialog(kind, directory=start, save_filename="vaultkeeper.vault",
                                                  file_types=("Vaultkeeper file (*.vault)",))
        else:
            kind = fd.OPEN if fd else webview.OPEN_DIALOG
            res = self._window.create_file_dialog(kind, directory=start,
                                                  file_types=("Vaultkeeper file (*.vault)", "All files (*.*)"))
        if not res:
            return {"path": None}
        path = res if isinstance(res, str) else res[0]
        if mode == "new" and not path.lower().endswith(".vault"):
            path += ".vault"
        self._cfg["vault_path"] = os.path.abspath(path)
        self._save_cfg()
        return {"path": path, "exists": os.path.exists(path)}

    # ------------------------------------------------- unlocking

    @_result
    def create_vault(self, password: str):
        path = self._cfg["vault_path"]
        if len(password) < MIN_MASTER_LEN:
            raise ValueError("The master password must be at least %d characters long." % MIN_MASTER_LEN)
        if os.path.exists(path):
            raise ValueError("A vault with that name already exists.")
        self._vault = Vault.create(path, password)
        self._remember(path)
        self._cfg.setdefault("master_unlock", {})[os.path.abspath(path)] = time.time()
        self._last_ping = time.time()
        return {}

    @_result
    def unlock(self, password: str):
        path = self._cfg["vault_path"]
        if not os.path.exists(path):
            raise ValueError("The vault file does not exist: %s" % path)
        self._vault = Vault.open(path, password)
        self._remember(path)
        self._last_ping = time.time()
        self._cfg.setdefault("master_unlock", {})[os.path.abspath(path)] = time.time()
        self._save_cfg()
        try:
            self._backup(force=False)
        except Exception:
            traceback.print_exc()
        return {}

    @_result
    def lock(self):
        self._do_lock()
        return {}

    def _do_lock(self):
        if self._vault is not None:
            self._vault.lock()
        self._vault = None
        self._clear_clipboard_now()
        self._cleanup_temp()
        if self._mini:
            self._set_mini(False)

    @_result
    def ping(self):
        self._last_ping = time.time()
        return {}

    def _idle_seconds(self) -> float:
        """Idle time of the whole computer (where available); otherwise the time since the last activity in Vaultkeeper."""
        sys_idle = winsys.system_idle_seconds()
        app_idle = time.time() - self._last_ping
        return app_idle if sys_idle is None else min(sys_idle, app_idle)

    def _auto_lock_due(self) -> bool:
        limit = int(self._cfg["settings"].get("auto_lock_min", 5)) * 60
        return self._vault is not None and limit > 0 and self._idle_seconds() > limit

    def _watchdog(self):
        last_backup_check = 0.0
        while not self._stop.wait(5):
            if time.time() - last_backup_check > 1800 or last_backup_check == 0:
                last_backup_check = time.time()
                try:
                    with self._lock:
                        self._backup(force=False)
                except Exception:
                    traceback.print_exc()
            locked_now = False
            with self._lock:
                if self._auto_lock_due():
                    self._do_lock()
                    locked_now = True
            if self._vault is None and self._temp_files:
                with self._lock:
                    self._cleanup_temp()
            if locked_now:  # outside the lock, so JS can call the API right away
                self._js("window.app && app.onLocked('auto')")

    # ------------------------------------------------------ entries

    @_result
    def list_entries(self):
        v = self._require()
        return {"entries": [asdict(e) for e in v.entries], "vault_name": os.path.splitext(os.path.basename(v.path))[0]}

    @_result
    def sync(self):
        v = self._require()
        return {"changed": v.reload()}

    @_result
    def save_entry(self, data: dict):
        v = self._require()
        data = dict(data or {})
        if not str(data.get("title", "")).strip():
            raise ValueError("Enter a title.")
        totp = str(data.get("totp", "")).strip()
        if totp:
            parse_totp(totp)
        data["fields"] = {k: v_ for k, v_ in (data.get("fields") or {}).items() if str(v_).strip()}
        existing = v.get(data.get("id", "")) if data.get("id") else None
        data.pop("history", None)      # only the backend maintains the history
        data.pop("attachments", None)  # attachments too
        if existing:
            merged = {**asdict(existing), **data, "id": existing.id, "created": existing.created}
            e = Entry.from_dict(merged)
            e.history = list(existing.history) + self._history_changes(existing, e)
            e.history = e.history[-HISTORY_MAX:]
            v.update(e)
        else:
            data.pop("id", None)
            data.pop("created", None)
            data.pop("updated", None)
            e = Entry.from_dict(data)
            v.add(e)
        return {"entry": asdict(e)}

    @staticmethod
    def _history_changes(old: Entry, new: Entry) -> list[dict]:
        out = []
        now = time.time()
        for k in HISTORY_FIELDS:
            if k.startswith("f:"):
                before, after = old.fields.get(k[2:], ""), new.fields.get(k[2:], "")
            else:
                before, after = getattr(old, k), getattr(new, k)
            if before and before != after:
                out.append({"field": k, "value": before, "changed": now})
        return out

    @_result
    def copy_history(self, entry_id: str, index: int):
        e = self._require().get(entry_id)
        if not e or not (0 <= int(index) < len(e.history)):
            raise ValueError("The history item does not exist.")
        return self._copy_value(e.history[int(index)]["value"])

    @_result
    def delete_history(self, entry_id: str, index: int = -1):
        """index -1 deletes the entire history of the entry."""
        v = self._require()
        e = v.get(entry_id)
        if not e:
            raise ValueError("Entry does not exist.")
        if int(index) < 0:
            e.history = []
        elif int(index) < len(e.history):
            e.history.pop(int(index))
        v.update(e)
        return {"entry": asdict(e)}

    @_result
    def delete_entry(self, entry_id: str):
        self._require().delete(entry_id)
        return {}

    @_result
    def toggle_favorite(self, entry_id: str):
        v = self._require()
        e = v.get(entry_id)
        if not e:
            raise ValueError("Entry does not exist.")
        e.favorite = not e.favorite
        v.update(e)
        return {"favorite": e.favorite}

    @_result
    def duplicate_entry(self, entry_id: str):
        v = self._require()
        e = v.get(entry_id)
        if not e:
            raise ValueError("Entry does not exist.")
        d = asdict(e)
        for k in ("id", "created", "updated"):
            d.pop(k)
        d["history"] = []
        d["title"] = e.title + " (copy)"
        n = Entry.from_dict(d)
        v.add(n)
        return {"entry": asdict(n)}

    # ------------------------------------------------------ 2FA

    @_result
    def totp(self, entry_id: str):
        e = self._require().get(entry_id)
        if not e or not e.totp:
            return {"code": None}
        p = parse_totp(e.totp)
        code, rem = totp_code(p)
        return {"code": code, "remaining": rem, "period": p.period}

    @_result
    def totp_preview(self, secret: str):
        p = parse_totp(secret)
        code, rem = totp_code(p)
        return {"code": code, "remaining": rem, "period": p.period, "issuer": p.issuer, "account": p.account}

    # ------------------------------------------------- clipboard

    @_result
    def copy(self, entry_id: str, key: str):
        e = self._require().get(entry_id)
        if not e:
            raise ValueError("Entry does not exist.")
        if key == "totp":
            value = totp_code(e.totp)[0] if e.totp else ""
        elif key == "ssh":
            host = e.fields.get("host", "")
            port = e.fields.get("port", "")
            value = "ssh %s%s%s" % (e.username + "@" if e.username else "", host, " -p " + port if port and port != "22" else "")
        elif key.startswith("f:"):
            value = e.fields.get(key[2:], "")
        elif key in ("username", "password", "url", "notes"):
            value = getattr(e, key)
        else:
            raise ValueError("Unknown field.")
        if not value:
            raise ValueError("The field is empty.")
        return self._copy_value(value)

    @_result
    def copy_text(self, text: str):
        """For the password generator (the value is not in the vault yet)."""
        if not text:
            raise ValueError("No text.")
        return self._copy_value(text)

    def _copy_value(self, value: str) -> dict:
        seq = winclip.copy(value)
        secs = int(self._cfg["settings"].get("clip_seconds", 30))
        if self._clip_timer:
            self._clip_timer.cancel()
        if secs > 0:
            self._clip_timer = threading.Timer(secs, self._clip_expired, args=(seq,))
            self._clip_timer.daemon = True
            self._clip_timer.start()
        self._clip_seq = seq
        self._last_ping = time.time()
        return {"clear_in": secs}

    def _clip_expired(self, seq: int):
        if winclip.clear_if_unchanged(seq):
            self._js("window.app && app.onClipboardCleared()")

    def _clear_clipboard_now(self):
        if self._clip_timer:
            self._clip_timer.cancel()
            self._clip_timer = None
        seq = getattr(self, "_clip_seq", None)
        if seq is not None:
            winclip.clear_if_unchanged(seq)
            self._clip_seq = None

    # --------------------------------------------- login / mini

    @_result
    def open_login(self, entry_id: str, mini: bool = True):
        e = self._require().get(entry_id)
        if not e or not e.url:
            raise ValueError("The entry has no link.")
        url = e.url if "://" in e.url else "https://" + e.url
        if not url.lower().startswith(("http://", "https://")):
            raise ValueError("Only http/https links are supported.")
        webbrowser.open(url)
        if mini:
            self._set_mini(True)
        return {"url": url}

    @_result
    def set_mini(self, on: bool):
        self._set_mini(bool(on))
        return {}

    def _set_mini(self, on: bool):
        self._mini = on
        w = self._window
        if w is None:
            return
        try:
            if on:
                w.resize(*MINI_SIZE)
                w.on_top = True
            else:
                w.on_top = False
                w.resize(*NORMAL_SIZE)
        except Exception:
            pass

    # ------------------------------------------------------ tools

    @_result
    def generate(self, length: int = 20, lower: bool = True, upper: bool = True, digits: bool = True,
                 symbols: bool = True, avoid_ambiguous: bool = True):
        pw = generate_password(int(length), lower, upper, digits, symbols, avoid_ambiguous)
        bits, label = password_strength(pw)
        return {"password": pw, "bits": bits, "label": label}

    @_result
    def import_csv(self):
        v = self._require()
        if self._window is None:
            raise ValueError("The dialog is not available.")
        import webview
        fd = getattr(webview, "FileDialog", None)
        res = self._window.create_file_dialog(fd.OPEN if fd else webview.OPEN_DIALOG,
                                              file_types=("CSV files (*.csv)", "All files (*.*)"))
        if not res:
            return {"cancelled": True}
        return self._import_path(res if isinstance(res, str) else res[0])

    @_result
    def import_csv_path(self, path: str):
        self._require()
        return self._import_path(path)

    def _import_path(self, path: str) -> dict:
        v = self._require()
        items = import_csv(path)
        existing = {(e.title, e.username, e.password) for e in v.entries}
        new = [e for e in items if (e.title, e.username, e.password) not in existing]
        bad = []
        for e in new:
            if e.totp:
                try:
                    parse_totp(e.totp)
                except ValueError:
                    bad.append(e.title)
                    e.notes = (e.notes + "\n\n2FA (invalid): " + e.totp).strip()
                    e.totp = ""
        v.entries.extend(new)
        v.save()
        return {"imported": len(new), "skipped": len(items) - len(new), "bad_totp": bad, "path": path}

    @_result
    def save_settings(self, settings: dict):
        s = self._cfg["settings"]
        old_hotkey = s.get("hotkey")
        for k in DEFAULT_SETTINGS:
            if k in settings:
                s[k] = settings[k]
        self._save_cfg()
        if s.get("hotkey") != old_hotkey:
            self._start_hotkey()
        return {"settings": s}

    @_result
    def change_master(self, old: str, new: str):
        v = self._require()
        Vault.open(v.path, old)  # verify the current password
        if len(new) < MIN_MASTER_LEN:
            raise ValueError("The new password must be at least %d characters long." % MIN_MASTER_LEN)
        v.change_master_password(new)
        had = self._hello_remove(v.path)
        self._cfg.setdefault("master_unlock", {})[os.path.abspath(v.path)] = time.time()
        self._save_cfg()
        return {"hello_disabled": had}

    @_result
    def vault_info(self):
        v = self._require()
        st = os.stat(v.path)
        return {"path": v.path, "size": st.st_size, "modified": st.st_mtime, "count": len(v.entries)}

    @_result
    def open_folder(self):
        v = self._require()
        folder = os.path.dirname(v.path)
        winsys.open_path(folder)
        return {}

    # ------------------------------------------------------ attachments

    def _entry_dict(self, entry_id: str) -> dict:
        e = self._require().get(entry_id)
        if not e:
            raise ValueError("Entry does not exist.")
        return asdict(e)

    @_result
    def add_attachments(self, entry_id: str):
        v = self._require()
        if self._window is None:
            raise ValueError("The dialog is not available.")
        import webview
        fd = getattr(webview, "FileDialog", None)
        res = self._window.create_file_dialog(fd.OPEN if fd else webview.OPEN_DIALOG, allow_multiple=True)
        if not res:
            return {"cancelled": True}
        paths = [res] if isinstance(res, str) else list(res)
        added = []
        for p in paths:
            with open(p, "rb") as f:
                added.append(v.add_file(entry_id, os.path.basename(p), f.read()))
        return {"added": added, "entry": self._entry_dict(entry_id)}

    @_result
    def add_attachment_data(self, entry_id: str, name: str, b64: str):
        v = self._require()
        if "," in b64[:100] and b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        data = base64.b64decode(b64)
        meta = v.add_file(entry_id, name, data)
        return {"added": [meta], "entry": self._entry_dict(entry_id)}

    @_result
    def delete_attachment(self, entry_id: str, file_id: str):
        self._require().remove_file(entry_id, file_id)
        return {"entry": self._entry_dict(entry_id)}

    @_result
    def save_attachment(self, entry_id: str, file_id: str):
        meta, data = self._require().get_file(entry_id, file_id)
        if self._window is None:
            raise ValueError("The dialog is not available.")
        import webview
        fd = getattr(webview, "FileDialog", None)
        res = self._window.create_file_dialog(fd.SAVE if fd else webview.SAVE_DIALOG, save_filename=meta["name"])
        if not res:
            return {"cancelled": True}
        path = res if isinstance(res, str) else res[0]
        with open(path, "wb") as f:
            f.write(data)
        return {"path": path}

    @_result
    def open_attachment(self, entry_id: str, file_id: str):
        """Decrypts into a temporary folder and opens it with the default program; deleted on lock."""
        meta, data = self._require().get_file(entry_id, file_id)
        folder = tempfile.mkdtemp(prefix="vaultkeeper-")
        path = os.path.join(folder, meta["name"])
        with open(path, "wb") as f:
            f.write(data)
        self._temp_files.append(path)
        winsys.open_path(path)
        return {"path": path}

    @_result
    def attachment_preview(self, entry_id: str, file_id: str):
        meta, data = self._require().get_file(entry_id, file_id)
        mime = mimetypes.guess_type(meta["name"])[0] or ""
        if not mime.startswith("image/") or mime == "image/svg+xml" or len(data) > 4 * 1024 * 1024:
            return {"url": None}
        return {"url": "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))}

    def _cleanup_temp(self):
        left = []
        for p in self._temp_files:
            try:
                os.remove(p)
                os.rmdir(os.path.dirname(p))
            except OSError:
                if os.path.exists(p):
                    left.append(p)  # the file is still open in another program - try later
        self._temp_files = left

    # ------------------------------------------- global hotkey / quick search

    def _start_hotkey(self) -> None:
        combo = self._cfg["settings"].get("hotkey", "off")
        if combo in winsys.HOTKEYS:
            self._hotkey.start(combo)
        else:
            self._hotkey.stop()

    def _hwnd(self):
        h = getattr(self, "_hwnd_cache", None)
        if not h:
            h = self._hwnd_cache = winsys.window_handle(self._window)
        return h

    def _js_async(self, code: str) -> threading.Thread:
        t = threading.Thread(target=self._js, args=(code,), daemon=True)
        t.start()
        return t

    def _on_hotkey(self):
        if self._quick:
            if winsys.is_foreground(self._hwnd()):
                self._js_async("window.app && app.onQuickToggle && app.onQuickToggle()")  # a second press closes it
            else:
                winsys.bring_to_front(self._window)
                winsys.focus_webview(self._window)
                self._js_async("window.app && app.focusQuick && app.focusQuick()")
            return
        # first switch the interface to search (while the window is still hidden), then show the window
        self._js_async("window.app && app.onQuick()").join(0.15)
        self._enter_quick()
        self._js_async("window.app && app.focusQuick && app.focusQuick()")

    def _enter_quick(self):
        w = self._window
        first = not self._quick
        was_mini = self._mini
        if first:
            self._quick_state = None
            geo = None
            try:
                geo = (w.x, w.y, w.width, w.height)
            except Exception:
                pass
            self._quick_prev = (self._minimized or self._mini, geo)
        self._quick = True
        self._mini = False
        if w is None:
            return
        if first:
            st = winsys.quick_show(self._hwnd(), *QUICK_SIZE)
            if st is not None:
                st["was_mini"] = was_mini
                self._quick_state = st
                winsys.focus_webview(w)
                return
        elif getattr(self, "_quick_state", None) is not None:
            winsys.bring_to_front(w)
            return
        try:  # fallback (if the Win32 path failed)
            w.on_top = True
            w.resize(*QUICK_SIZE)
            sw, sh = winsys.screen_size()
            w.move(max(0, (sw - QUICK_SIZE[0]) // 2), max(0, int(sh * 0.16)))
        except Exception:
            pass
        winsys.bring_to_front(w)

    @_result
    def exit_quick(self, minimize: bool = False, to_app: bool = False):
        prev_min, geo = self._quick_prev or (False, None)
        st = getattr(self, "_quick_state", None)
        self._quick = False
        self._quick_prev = None
        self._quick_state = None
        self._no_min_lock_until = time.time() + 2   # this lowering is not a "minimize" that locks
        w = self._window
        if st is not None and winsys.quick_hide(self._hwnd(), st, bool(to_app), NORMAL_SIZE):
            return {}
        if w is not None:
            try:
                w.on_top = False
                if geo and geo[2] >= 600:
                    w.resize(geo[2], geo[3])
                    w.move(geo[0], geo[1])
                else:
                    w.resize(*NORMAL_SIZE)
                    sw, sh = winsys.screen_size()
                    w.move(max(0, (sw - NORMAL_SIZE[0]) // 2), max(0, (sh - NORMAL_SIZE[1]) // 2))
                if (minimize or prev_min) and not to_app:
                    w.minimize()
            except Exception:
                pass
        return {}

    @_result
    def hotkey_status(self):
        s = self._cfg["settings"]
        return {
            "combo": s.get("hotkey", "off"),
            "active": self._hotkey.ok,
            "error": self._hotkey.error,
            "options": [{"key": k, "label": v[2]} for k, v in winsys.HOTKEYS.items()],
            "autostart": winsys.get_autostart(),
            "supported": winsys.IS_WIN,
            "platform": winsys.platform_name(),
            "command": (winsys.linux_launcher() or "vaultkeeper") + " --quick",
            "autostart_supported": winsys.platform_name() in ("windows", "linux"),
        }

    @_result
    def set_autostart(self, enabled: bool):
        if winsys.platform_name() not in ("windows", "linux"):
            raise ValueError("Not available on this system.")
        winsys.set_autostart(bool(enabled))
        return {"autostart": winsys.get_autostart()}

    @_result
    def quit_app(self):
        self._quitting = True
        if self._window is not None:
            threading.Timer(0.05, self._window.destroy).start()
        return {}

    # ------------------------------------------------------ browser extension

    def _add_browser_pair(self, name: str, token_hash: str) -> None:
        with self._lock:
            pairs = self._cfg.setdefault("browser_pairs", [])
            pairs.append({"id": os.urandom(6).hex(), "name": (name or "Browser")[:60], "hash": token_hash,
                          "created": time.time(), "last_used": time.time()})
            self._save_cfg()
        self._js("window.app && app.onBrowserPaired()")

    def _bridge_request(self, path: str, data: dict, token: str, br) -> tuple[int, dict]:
        if path == "/v1/ping":
            return 200, {"app": "vaultkeeper", "version": bridge_mod.VERSION, "paired": br.check_token(token),
                         "unlocked": self._vault is not None}
        if path == "/v1/pair":
            tok = br.try_pair(str(data.get("code", "")), str(data.get("name", "Browser")))
            if not tok:
                return 403, {"error": "Wrong or expired code. In Vaultkeeper, click “Pair browser” for a new code."}
            return 200, {"token": tok}
        if not br.check_token(token):
            return 401, {"error": "not_paired"}
        if path in ("/v1/fill", "/v1/totp", "/v1/copy"):
            self._last_ping = time.time()
        if path == "/v1/show":
            if self._window is not None:
                winsys.bring_to_front(self._window)
            return 200, {}
        with self._lock:
            v = self._vault
            if v is None:
                return 200, {"locked": True}
            url = str(data.get("url", ""))

            def item(e, rank):
                return {"id": e.id, "title": e.title, "username": e.username, "type": e.type,
                        "has_password": bool(e.password), "has_totp": bool(e.totp),
                        "rank": rank, "can_fill": rank is not None}

            if path == "/v1/logins":
                found = [(bridge_mod.best_rank(e, url), e) for e in v.entries]
                found = [(r, e) for r, e in found if r is not None and (e.username or e.password or e.totp)]
                found.sort(key=lambda x: (x[0], -x[1].favorite, x[1].title.lower()))
                return 200, {"items": [item(e, r) for r, e in found[:30]], "host": bridge_mod.host_of(url)}
            if path == "/v1/search":
                q = str(data.get("q", "")).strip().lower()
                res = [e for e in v.entries if q and (q in e.title.lower() or q in e.username.lower() or q in e.url.lower())]
                res.sort(key=lambda e: (not e.title.lower().startswith(q), e.title.lower()))
                return 200, {"items": [item(e, bridge_mod.best_rank(e, url)) for e in res[:20]]}
            e = v.get(str(data.get("id", "")))
            if not e:
                return 404, {"error": "Entry does not exist."}
            if path in ("/v1/fill", "/v1/totp"):
                if bridge_mod.best_rank(e, url) is None:
                    return 403, {"error": "The site address does not match the link saved in the entry. Autofill is blocked (protection against fake sites)."}
                if path == "/v1/totp":
                    if not e.totp:
                        return 404, {"error": "The entry has no 2FA key."}
                    code, rem = totp_code(e.totp)
                    return 200, {"code": code, "remaining": rem}
                title = e.title
                out = {"username": e.username, "password": e.password, "has_totp": bool(e.totp)}
            elif path == "/v1/copy":
                key = str(data.get("key", ""))
                if key not in ("username", "password", "totp"):
                    return 400, {"error": "Unknown field."}
                value = (totp_code(e.totp)[0] if e.totp else "") if key == "totp" else getattr(e, key)
                if not value:
                    return 404, {"error": "The field is empty."}
                return 200, self._copy_value(value)
            else:
                return 404, {"error": "unknown"}
        self._js("window.app && app.onBrowserFill(%s)" % json.dumps(title))
        return 200, out

    @_result
    def bridge_status(self):
        pairs = [{k: p.get(k) for k in ("id", "name", "created", "last_used")} for p in self._cfg.get("browser_pairs", [])]
        return {"enabled": bool(self._cfg["settings"].get("bridge_enabled")), "running": self._bridge.running,
                "port": self._bridge.port, "error": self._bridge.error, "pairs": pairs}

    @_result
    def bridge_set_enabled(self, on: bool):
        self._cfg["settings"]["bridge_enabled"] = bool(on)
        self._save_cfg()
        if on:
            if not self._bridge.start():
                raise ValueError(self._bridge.error)
        else:
            self._bridge.stop()
        return {}

    @_result
    def bridge_pair_code(self):
        if not self._bridge.running:
            self._cfg["settings"]["bridge_enabled"] = True
            self._save_cfg()
            if not self._bridge.start():
                raise ValueError(self._bridge.error)
        code, secs = self._bridge.new_pair_code()
        return {"code": code, "seconds": secs}

    @_result
    def bridge_cancel_pair(self):
        self._bridge.cancel_pair_code()
        return {}

    @_result
    def bridge_unpair(self, pair_id: str):
        self._cfg["browser_pairs"] = [p for p in self._cfg.get("browser_pairs", []) if p.get("id") != pair_id]
        self._save_cfg()
        return {}

    @_result
    def export_extension(self):
        """Copies the extension to a permanent folder (Chrome needs a stable path for 'Load unpacked')."""
        src = resource("extension")
        base = os.environ.get("LOCALAPPDATA")
        dst = os.path.join(base, "Vaultkeeper", "browser-extension") if base else \
            os.path.join(os.path.dirname(default_vault_path()), "browser-extension")
        if os.path.isdir(dst):
            shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(src, dst)
        winsys.open_path(dst)
        return {"path": dst}

    # ------------------------------------------------------ Windows Hello

    def _hello_load(self) -> dict:
        try:
            with open(_hello_path(), "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _hello_save(self, data: dict) -> None:
        os.makedirs(os.path.dirname(_hello_path()), exist_ok=True)
        tmp = _hello_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1)
        os.replace(tmp, _hello_path())

    def _hello_remove(self, path: str) -> bool:
        data = self._hello_load()
        had = data.pop(os.path.abspath(path), None) is not None
        if had:
            self._hello_save(data)
        return had

    def _master_age_days(self, path: str) -> float:
        ts = self._cfg.get("master_unlock", {}).get(os.path.abspath(path), 0)
        return (time.time() - ts) / 86400

    @_result
    def hello_status(self):
        path = self._vault.path if self._vault else self._cfg["vault_path"]
        hello_ok_here = winsys.IS_WIN or os.environ.get("VAULTKEEPER_TEST_FAKE_DPAPI") == "1"
        enabled = hello_ok_here and os.path.abspath(path) in self._hello_load()
        supported, reason = (True, "") if enabled else winhello.status()
        age = self._master_age_days(path)
        return {
            "supported": supported, "reason": reason, "enabled": enabled,
            "need_master": enabled and age > HELLO_MASTER_EVERY_DAYS,
            "master_days": HELLO_MASTER_EVERY_DAYS,
        }

    def hello_enable(self):
        """Enables Hello for an unlocked vault. The Hello prompt runs OUTSIDE the lock (the user may take a while)."""
        try:
            with self._lock:
                v = self._require()
                path, key, salt = v.path, v.key, v.salt
            winhello.verify("Enable Windows Hello for Vaultkeeper")
            entropy = os.urandom(32)
            blob = winsys.dpapi_protect(key, entropy + salt.encode())
            with self._lock:
                data = self._hello_load()
                data[os.path.abspath(path)] = {
                    "entropy": base64.b64encode(entropy).decode(), "blob": base64.b64encode(blob).decode(),
                    "salt": salt, "created": time.time(),
                }
                self._hello_save(data)
            return {"ok": True}
        except (winhello.HelloError, OSError, ValueError) as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": "Windows Hello error: %s" % e}

    @_result
    def hello_disable(self):
        path = self._vault.path if self._vault else self._cfg["vault_path"]
        self._hello_remove(path)
        return {}

    def hello_unlock(self):
        try:
            with self._lock:
                path = self._cfg["vault_path"]
                rec = self._hello_load().get(os.path.abspath(path))
                if not rec:
                    raise ValueError("Windows Hello is not enabled for this vault.")
                if self._master_age_days(path) > HELLO_MASTER_EVERY_DAYS:
                    raise ValueError("Enter the master password (it is required once every %d days so you do not forget it)." % HELLO_MASTER_EVERY_DAYS)
            winhello.verify("Unlock Vaultkeeper")
            try:
                key = winsys.dpapi_unprotect(base64.b64decode(rec["blob"]),
                                             base64.b64decode(rec["entropy"]) + rec["salt"].encode())
            except (OSError, KeyError, ValueError):
                raise ValueError("The Windows Hello key does not match (different Windows account?). Unlock with the master password and enable Hello again.")
            with self._lock:
                try:
                    v = Vault.open_with_key(path, key, expected_salt=rec["salt"])
                except WrongPasswordError:
                    self._hello_remove(path)
                    raise ValueError("The master password was changed. Unlock with the new password and enable Windows Hello again.")
                self._vault = v
                self._remember(path)
                self._last_ping = time.time()
                try:
                    self._backup(force=False)
                except Exception:
                    traceback.print_exc()
            return {"ok": True}
        except (winhello.HelloError, OSError, ValueError, VaultFormatError) as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": "Windows Hello error: %s" % e}

    # ------------------------------------------------------ backup

    def _backup_dir(self) -> str:
        return self._cfg["settings"].get("backup_dir") or default_backup_dir()

    def _backup_prefix(self, vault_path: str) -> str:
        return os.path.splitext(os.path.basename(vault_path))[0] + "_"

    def _list_backups(self, vault_path: str) -> list[dict]:
        folder = self._backup_dir()
        prefix = self._backup_prefix(vault_path)
        try:
            names = [n for n in os.listdir(folder) if n.startswith(prefix) and n.endswith(".vault")]
        except OSError:
            return []
        out = []
        for n in sorted(names, reverse=True):
            p = os.path.join(folder, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            out.append({"name": n, "path": p, "time": st.st_mtime, "size": st.st_size})
        return out

    def _backup(self, force: bool) -> dict | None:
        """Copy of the encrypted vault file. Without force: at most once every 24h and only if there were changes."""
        s = self._cfg["settings"]
        path = self._vault.path if self._vault else self._cfg["vault_path"]
        if not os.path.exists(path):
            if force:
                raise ValueError("The vault does not exist yet.")
            return None
        if not force and not s.get("backup_enabled", True):
            return None
        states = self._cfg.setdefault("backup_state", {})
        st = states.get(path, {})
        digest = _sha256(path)
        if not force:
            if time.time() - st.get("last", 0) < BACKUP_EVERY_HOURS * 3600:
                return None
            if st.get("sha256") == digest:
                return None  # nothing changed since the last backup
        folder = self._backup_dir()
        os.makedirs(folder, exist_ok=True)
        stamp = time.strftime("%Y-%m-%d_%H-%M-%S")
        target = os.path.join(folder, self._backup_prefix(path) + stamp + ".vault")
        n = 2
        while os.path.exists(target):  # two backups within the same second
            target = os.path.join(folder, "%s%s-%d.vault" % (self._backup_prefix(path), stamp, n))
            n += 1
        shutil.copy2(path, target)
        os.utime(target, None)  # backup time, not the vault's modification time
        states[path] = {"last": time.time(), "sha256": digest, "file": target}
        keep = max(1, int(s.get("backup_keep", 30)))
        for old in self._list_backups(path)[keep:]:
            try:
                os.remove(old["path"])
            except OSError:
                pass
        self._save_cfg()
        return {"file": target}

    @_result
    def backup_now(self):
        r = self._backup(force=True)
        return {"file": r["file"]} if r else {}

    @_result
    def backup_info(self):
        path = self._vault.path if self._vault else self._cfg["vault_path"]
        st = self._cfg.get("backup_state", {}).get(path, {})
        files = self._list_backups(path)
        return {
            "dir": self._backup_dir(),
            "default_dir": default_backup_dir(),
            "last": st.get("last"),
            "count": len(files),
            "files": files[:8],
        }

    @_result
    def choose_backup_dir(self):
        if self._window is None:
            raise ValueError("The dialog is not available.")
        import webview
        fd = getattr(webview, "FileDialog", None)
        res = self._window.create_file_dialog(fd.FOLDER if fd else webview.FOLDER_DIALOG,
                                              directory=self._backup_dir())
        if not res:
            return {"dir": None}
        folder = res if isinstance(res, str) else res[0]
        self._cfg["settings"]["backup_dir"] = folder
        self._save_cfg()
        try:
            self._backup(force=True)  # immediately make the first backup in the new folder
        except Exception:
            pass
        return {"dir": folder}

    @_result
    def open_backup_dir(self):
        folder = self._backup_dir()
        os.makedirs(folder, exist_ok=True)
        winsys.open_path(folder)
        return {}

    @_result
    def restore_backup(self, name: str):
        """Restore the vault from a backup. The current state is saved as a backup first."""
        v = self._require()
        folder = self._backup_dir()
        src = os.path.join(folder, os.path.basename(name))
        if not os.path.exists(src):
            raise ValueError("The backup does not exist.")
        Vault._read_doc(src)  # check that it is a valid vault
        path = v.path
        tmp = path + ".restore"
        shutil.copy2(src, tmp)      # take a copy first (pruning old ones could delete this very backup)
        self._backup(force=True)    # save the current state before restoring
        os.replace(tmp, path)
        self._do_lock()
        return {"restored": os.path.basename(src)}

    def _shutdown(self):
        self._stop.set()
        self._hotkey.stop()
        self._bridge.stop()
        self._cleanup_temp()
        with self._lock:
            self._do_lock()
