"""
System functions (Windows and Linux): global hotkey (works in any program),
bringing the window to the front and starting at login.
Where a feature is unsupported it has no effect (for development and tests).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading

IS_WIN = sys.platform == "win32"

# Offered hotkeys: key -> (modifiers, virtual-key, display name)
MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT = 0x1, 0x2, 0x4, 0x4000
HOTKEYS = {
    "ctrl+shift+space": (MOD_CONTROL | MOD_SHIFT, 0x20, "Ctrl + Shift + Space"),
    "ctrl+alt+space": (MOD_CONTROL | MOD_ALT, 0x20, "Ctrl + Alt + Space"),
    "ctrl+shift+k": (MOD_CONTROL | MOD_SHIFT, 0x4B, "Ctrl + Shift + K"),
    "ctrl+alt+t": (MOD_CONTROL | MOD_ALT, 0x54, "Ctrl + Alt + T"),
}

if IS_WIN:
    import ctypes
    from ctypes import wintypes

    _user32 = ctypes.WinDLL("user32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
    _user32.RegisterHotKey.restype = wintypes.BOOL
    _user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
    _user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    _user32.GetMessageW.restype = ctypes.c_int
    _user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    _user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    _user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    _user32.IsIconic.argtypes = [wintypes.HWND]
    _user32.GetSystemMetrics.argtypes = [ctypes.c_int]
    _kernel32.GetCurrentThreadId.restype = wintypes.DWORD

_WM_HOTKEY = 0x0312
_WM_QUIT = 0x0012


class GlobalHotkey:
    """Registers the system hotkey in a dedicated thread with a Windows message loop."""

    def __init__(self, callback):
        self._callback = callback
        self._thread: threading.Thread | None = None
        self._tid = 0
        self.combo: str | None = None
        self.ok = False
        self.error = ""

    def start(self, combo: str) -> bool:
        self.stop()
        self.combo = combo
        self.ok, self.error = False, ""
        if combo not in HOTKEYS:
            return False
        if not IS_WIN:
            self.error = "Hotkeys only work on Windows."
            return False
        ready = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(combo, ready), daemon=True)
        self._thread.start()
        ready.wait(3)
        return self.ok

    def _run(self, combo: str, ready: threading.Event):
        mods, vk, _ = HOTKEYS[combo]
        self._tid = _kernel32.GetCurrentThreadId()
        if not _user32.RegisterHotKey(None, 1, mods | MOD_NOREPEAT, vk):
            self.error = "Another program already uses this hotkey. Choose a different one."
            ready.set()
            return
        self.ok = True
        ready.set()
        msg = wintypes.MSG()
        try:
            while _user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                if msg.message == _WM_HOTKEY:
                    try:
                        self._callback()
                    except Exception:
                        pass
        finally:
            _user32.UnregisterHotKey(None, 1)
            self.ok = False

    def stop(self):
        if self._thread and self._thread.is_alive() and IS_WIN and self._tid:
            _user32.PostThreadMessageW(self._tid, _WM_QUIT, 0, 0)
            self._thread.join(2)
        self._thread = None
        self._tid = 0
        self.ok = False


def bring_to_front(window) -> None:
    """Restore the window from the minimized state and bring it to the front."""
    if not IS_WIN:
        if window is None:
            return
        for m in ("restore", "show"):
            try:
                getattr(window, m)()
            except Exception:
                pass
        try:  # a brief "always on top" raises the window on X11 window managers too
            window.on_top = True
            threading.Timer(0.4, lambda: setattr(window, "on_top", False)).start()
        except Exception:
            pass
        return
    try:
        hwnd = window.native.Handle.ToInt64()
        if _user32.IsIconic(hwnd):
            _user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        else:
            _user32.ShowWindow(hwnd, 5)  # SW_SHOW
        _user32.SetForegroundWindow(hwnd)
    except Exception:
        pass


def screen_size() -> tuple[int, int]:
    if IS_WIN:
        try:
            return _user32.GetSystemMetrics(0), _user32.GetSystemMetrics(1)
        except Exception:
            pass
    try:
        import webview
        sc = webview.screens[0]
        return int(sc.width), int(sc.height)
    except Exception:
        return 1920, 1080


# --------------------------------------------------------- computer idle time

if IS_WIN:
    class _LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]

    _user32.GetLastInputInfo.argtypes = [ctypes.POINTER(_LASTINPUTINFO)]
    _kernel32.GetTickCount.restype = wintypes.DWORD


_xss = None


def _linux_idle_x11() -> float | None:
    """X11: XScreenSaver extension (libXss), without launching external programs."""
    global _xss
    if not os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
        return None
    try:
        import ctypes
        import ctypes.util
        if _xss is None:
            x11 = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
            xss = ctypes.CDLL(ctypes.util.find_library("Xss") or "libXss.so.1")

            class Info(ctypes.Structure):
                _fields_ = [("window", ctypes.c_ulong), ("state", ctypes.c_int), ("kind", ctypes.c_int),
                            ("til_or_since", ctypes.c_ulong), ("idle", ctypes.c_ulong), ("eventMask", ctypes.c_ulong)]

            x11.XOpenDisplay.restype = ctypes.c_void_p
            x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
            x11.XDefaultRootWindow.restype = ctypes.c_ulong
            x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
            xss.XScreenSaverAllocInfo.restype = ctypes.POINTER(Info)
            xss.XScreenSaverQueryInfo.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(Info)]
            dpy = x11.XOpenDisplay(None)
            if not dpy:
                _xss = False
                return None
            _xss = (xss, dpy, x11.XDefaultRootWindow(dpy), xss.XScreenSaverAllocInfo())
        if not _xss:
            return None
        xss, dpy, root, info = _xss
        if not xss.XScreenSaverQueryInfo(dpy, root, info):
            return None
        return info.contents.idle / 1000.0
    except Exception:
        _xss = False
        return None


def _linux_idle_gnome() -> float | None:
    """GNOME (also on Wayland): org.gnome.Mutter.IdleMonitor."""
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS") or not shutil.which("gdbus"):
        return None
    try:
        out = subprocess.run(["gdbus", "call", "--session", "--dest", "org.gnome.Mutter.IdleMonitor",
                              "--object-path", "/org/gnome/Mutter/IdleMonitor/Core",
                              "--method", "org.gnome.Mutter.IdleMonitor.GetIdletime"],
                             capture_output=True, text=True, timeout=2)
        if out.returncode != 0:
            return None
        import re
        m = re.search(r"uint64\s+(\d+)", out.stdout) or re.search(r"(\d+)\s*,?\s*\)", out.stdout)
        return int(m.group(1)) / 1000.0 if m else None
    except Exception:
        return None


def system_idle_seconds() -> float | None:
    """How long there has been no mouse/keyboard input ANYWHERE on the computer (None = unknown)."""
    if not IS_WIN:
        if sys.platform.startswith("linux"):
            v = _linux_idle_x11()
            return v if v is not None else _linux_idle_gnome()
        return None
    try:
        info = _LASTINPUTINFO(ctypes.sizeof(_LASTINPUTINFO), 0)
        if not _user32.GetLastInputInfo(ctypes.byref(info)):
            return None
        return ((_kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000.0
    except Exception:
        return None


# --------------------------------------------------------- single running instance

_mutex = None


def another_instance_running() -> bool:
    """True if Vaultkeeper is already running; in that case bring it to the front."""
    global _mutex
    if not IS_WIN:
        return False
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = wintypes.HANDLE
    k32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    _mutex = k32.CreateMutexW(None, False, "Local\\VaultkeeperPasswordManager")
    if ctypes.get_last_error() != 183:  # ERROR_ALREADY_EXISTS
        return False
    try:
        _user32.FindWindowW.restype = wintypes.HWND
        hwnd = _user32.FindWindowW(None, "Vaultkeeper")
        if hwnd:
            _user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            _user32.SetForegroundWindow(hwnd)
    except Exception:
        pass
    return True


# --------------------------------------------------------- quick search: window display

if IS_WIN:
    class _WINDOWPLACEMENT(ctypes.Structure):
        _fields_ = [("length", wintypes.UINT), ("flags", wintypes.UINT), ("showCmd", wintypes.UINT),
                    ("ptMinPosition", wintypes.POINT), ("ptMaxPosition", wintypes.POINT),
                    ("rcNormalPosition", wintypes.RECT)]

    class _MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD)]

    _user32.GetWindowPlacement.argtypes = [wintypes.HWND, ctypes.POINTER(_WINDOWPLACEMENT)]
    _user32.SetWindowPlacement.argtypes = [wintypes.HWND, ctypes.POINTER(_WINDOWPLACEMENT)]
    _user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
    _user32.MonitorFromPoint.argtypes = [wintypes.POINT, wintypes.DWORD]
    _user32.MonitorFromPoint.restype = wintypes.HANDLE
    _user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_MONITORINFO)]
    _user32.GetForegroundWindow.restype = wintypes.HWND
    _user32.IsWindow.argtypes = [wintypes.HWND]
    _user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                     ctypes.c_int, wintypes.UINT]
    _user32.SystemParametersInfoW.argtypes = [wintypes.UINT, wintypes.UINT, ctypes.c_void_p, wintypes.UINT]
    _user32.FindWindowW.restype = wintypes.HWND
    _user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]

    def _cursor_work_area():
        pt = wintypes.POINT()
        _user32.GetCursorPos(ctypes.byref(pt))
        mi = _MONITORINFO()
        mi.cbSize = ctypes.sizeof(_MONITORINFO)
        _user32.GetMonitorInfoW(_user32.MonitorFromPoint(pt, 2), ctypes.byref(mi))
        return mi.rcWork

    def _workspace_offset():
        # rcNormalPosition is in "workspace" coordinates (shifted if the taskbar is at the top or left)
        r = wintypes.RECT()
        _user32.SystemParametersInfoW(0x30, 0, ctypes.byref(r), 0)
        return r.left, r.top

    def _scale(hwnd) -> float:
        try:
            return max(1.0, _user32.GetDpiForWindow(wintypes.HWND(hwnd)) / 96.0)
        except Exception:
            return 1.0

    def _centered(hwnd, width, height, top_ratio):
        wk = _cursor_work_area()
        sc = _scale(hwnd)
        w = min(int(width * sc), wk.right - wk.left)
        h = min(int(height * sc), wk.bottom - wk.top)
        x = wk.left + (wk.right - wk.left - w) // 2
        y = wk.top + int((wk.bottom - wk.top - h) * top_ratio)
        ox, oy = _workspace_offset()
        return wintypes.RECT(x - ox, y - oy, x - ox + w, y - oy + h)


def window_handle(window):
    if not IS_WIN or window is None:
        return None
    try:
        return int(window.native.Handle.ToInt64())
    except Exception:
        try:
            return _user32.FindWindowW(None, "Vaultkeeper") or None
        except Exception:
            return None


def is_foreground(hwnd) -> bool:
    if not IS_WIN or not hwnd:
        return False
    try:
        return _user32.GetForegroundWindow() == hwnd
    except Exception:
        return False


def quick_show(hwnd, width: int, height: int):
    """In one move: restore the window, place it on the monitor where the mouse is, on top, in front.
    Returns the previous state (for quick_hide) or None on failure."""
    if not IS_WIN or not hwnd:
        return None
    try:
        fg = _user32.GetForegroundWindow()
        wp = _WINDOWPLACEMENT()
        wp.length = ctypes.sizeof(_WINDOWPLACEMENT)
        if not _user32.GetWindowPlacement(hwnd, ctypes.byref(wp)):
            return None
        r = wp.rcNormalPosition
        state = {"show": int(wp.showCmd), "flags": int(wp.flags), "rect": (r.left, r.top, r.right, r.bottom),
                 "fg": fg if fg and fg != hwnd else None}
        new = _WINDOWPLACEMENT()
        new.length = ctypes.sizeof(_WINDOWPLACEMENT)
        new.showCmd = 1  # SW_SHOWNORMAL
        new.rcNormalPosition = _centered(hwnd, width, height, 0.28)
        if not _user32.SetWindowPlacement(hwnd, ctypes.byref(new)):
            return None
        _user32.SetWindowPos(hwnd, wintypes.HWND(-1), 0, 0, 0, 0, 0x0003)  # TOPMOST
        _user32.SetForegroundWindow(hwnd)
        return state
    except Exception:
        return None


def quick_hide(hwnd, state: dict, to_app: bool, normal_size: tuple) -> bool:
    """Restore the window exactly to its state before quick search (no flicker) and give focus back to the program you were in."""
    if not IS_WIN or not hwnd:
        return False
    try:
        _user32.SetWindowPos(hwnd, wintypes.HWND(-2), 0, 0, 0, 0, 0x0013)  # NOTOPMOST, without activating
        was_min = state["show"] == 2
        was_max = state["show"] == 3 or (was_min and state["flags"] & 0x2)
        wp = _WINDOWPLACEMENT()
        wp.length = ctypes.sizeof(_WINDOWPLACEMENT)
        if state.get("was_mini"):
            wp.rcNormalPosition = _centered(hwnd, normal_size[0], normal_size[1], 0.5)
        else:
            wp.rcNormalPosition = wintypes.RECT(*state["rect"])
        fg = state.get("fg")
        fg = fg if fg and _user32.IsWindow(fg) else None
        if to_app:
            wp.showCmd = 3 if was_max else 1
        elif was_min:
            wp.showCmd = 7 if fg else 6          # minimize (7 = without activating)
            wp.flags = 0x2 if was_max else 0     # restore maximized on next open
        else:
            wp.showCmd = 3 if was_max else 1
        _user32.SetWindowPlacement(hwnd, ctypes.byref(wp))
        if fg and not to_app:
            _user32.SetForegroundWindow(fg)
        return True
    except Exception:
        return False


def focus_webview(window) -> None:
    """Keyboard goes straight to the search field (focus on the WebView2 control)."""
    if not IS_WIN:
        return
    try:
        from System import Action  # type: ignore
        form = window.native
        ctl = getattr(form.browser, "webview", None) or getattr(form.browser, "web_view", None)

        def go():
            form.Activate()
            if ctl is not None:
                ctl.Focus()

        form.BeginInvoke(Action(go))
    except Exception:
        pass


# --------------------------------------------------------- start at login

_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_RUN_NAME = "Vaultkeeper"


def _linux_autostart_file() -> str:
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "autostart", "vaultkeeper.desktop")


def linux_launcher() -> str | None:
    p = os.path.join(os.path.expanduser("~"), ".local", "bin", "vaultkeeper")
    return p if os.path.exists(p) else None


def autostart_command() -> str:
    if getattr(sys, "frozen", False):
        return '"%s" --minimized' % sys.executable
    if not IS_WIN and linux_launcher():
        return '"%s" --minimized' % linux_launcher()
    exe = sys.executable
    pyw = os.path.join(os.path.dirname(exe), "pythonw.exe")
    if os.path.exists(pyw):
        exe = pyw
    script = os.path.abspath(os.path.join(os.path.dirname(__file__), "app.py"))
    return '"%s" "%s" --minimized' % (exe, script)


def set_autostart(enabled: bool) -> None:
    if not IS_WIN:
        path = _linux_autostart_file()
        if enabled:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write("[Desktop Entry]\nType=Application\nName=Vaultkeeper\nComment=Password manager\n"
                        "Exec=%s\nIcon=vaultkeeper\nTerminal=false\nX-GNOME-Autostart-enabled=true\n" % autostart_command())
        elif os.path.exists(path):
            os.remove(path)
        old = os.path.join(os.path.dirname(path), "trezor.desktop")   # entry from the old app name
        if os.path.exists(old):
            os.remove(old)
        return
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        try:
            winreg.DeleteValue(k, "Trezor")   # startup entry from the old app name
        except FileNotFoundError:
            pass
        if enabled:
            winreg.SetValueEx(k, _RUN_NAME, 0, winreg.REG_SZ, autostart_command())
        else:
            try:
                winreg.DeleteValue(k, _RUN_NAME)
            except FileNotFoundError:
                pass


def get_autostart() -> bool:
    if not IS_WIN:
        return os.path.exists(_linux_autostart_file())
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_READ) as k:
            winreg.QueryValueEx(k, _RUN_NAME)
            return True
    except OSError:
        return False


# --------------------------------------------------------- DPAPI (bound to the Windows account)

if IS_WIN:
    class _BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    _crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    _crypt32.CryptProtectData.argtypes = [ctypes.POINTER(_BLOB), wintypes.LPCWSTR, ctypes.POINTER(_BLOB),
                                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_BLOB)]
    _crypt32.CryptUnprotectData.argtypes = [ctypes.POINTER(_BLOB), ctypes.c_void_p, ctypes.POINTER(_BLOB),
                                            ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_BLOB)]
    _kernel32.LocalFree.argtypes = [ctypes.c_void_p]

    def _blob(data: bytes):
        buf = ctypes.create_string_buffer(data, len(data))
        return _BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf


def _dpapi_test_mode() -> bool:
    return os.environ.get("VAULTKEEPER_TEST_FAKE_DPAPI") == "1"


def dpapi_protect(data: bytes, entropy: bytes = b"") -> bytes:
    if not IS_WIN:
        if _dpapi_test_mode():
            return data
        raise OSError("Key protection (DPAPI) is only available on Windows.")
    src, _keep = _blob(data)
    ent, _keep2 = _blob(entropy or b"\0")
    out = _BLOB()
    if not _crypt32.CryptProtectData(ctypes.byref(src), "Vaultkeeper", ctypes.byref(ent), None, None, 0x1, ctypes.byref(out)):
        raise OSError("DPAPI protection failed.")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        _kernel32.LocalFree(out.pbData)


def dpapi_unprotect(data: bytes, entropy: bytes = b"") -> bytes:
    if not IS_WIN:
        if _dpapi_test_mode():
            return data
        raise OSError("Key protection (DPAPI) is only available on Windows.")
    src, _keep = _blob(data)
    ent, _keep2 = _blob(entropy or b"\0")
    out = _BLOB()
    if not _crypt32.CryptUnprotectData(ctypes.byref(src), None, ctypes.byref(ent), None, None, 0x1, ctypes.byref(out)):
        raise OSError("DPAPI unprotect failed (different Windows account?).")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        _kernel32.LocalFree(out.pbData)


# --------------------------------------------------------- opening a file / folder

def open_path(path: str) -> None:
    """Open a file or folder with the system default program."""
    if IS_WIN:
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        if not shutil.which("xdg-open"):
            raise OSError("The xdg-open program was not found.")
        subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)


def platform_name() -> str:
    return "windows" if IS_WIN else "mac" if sys.platform == "darwin" else "linux"
