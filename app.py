"""
Vaultkeeper - local password and 2FA code manager.
Run with:  py app.py   (or Vaultkeeper.exe after packaging)
"""

from __future__ import annotations

import os
import sys
import threading
import time

import webview

from api import Api, NORMAL_SIZE

BG = "#0b0f17"


def resource(*parts: str) -> str:
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *parts)


def _style_titlebar(window) -> None:
    """Dark title bar on Windows 10/11 (to match the theme)."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        hwnd = window.native.Handle.ToInt64()
        dwm = ctypes.windll.dwmapi
        on = ctypes.c_int(1)
        dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(on), ctypes.sizeof(on))   # dark mode
        color = ctypes.c_int(0x00170F0B)  # #0b0f17 in BGR format
        dwm.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(color), ctypes.sizeof(color))  # Win11 title bar color
    except Exception:
        pass


def main():
    import instance
    import winsys
    inst = instance.Instance()
    if not inst.acquire(instance.command_from_argv()):
        return  # Vaultkeeper is already running - the command (show / quick search) was forwarded to it
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Vaultkeeper.PasswordManager")
        except Exception:
            pass

    api = Api()
    window = webview.create_window(
        "Vaultkeeper",
        url=resource("ui", "index.html"),
        js_api=api,
        width=NORMAL_SIZE[0],
        height=NORMAL_SIZE[1],
        min_size=(380, 520),
        background_color=BG,
        text_select=True,
        minimized="--minimized" in sys.argv,
    )
    api._window = window
    api._minimized = "--minimized" in sys.argv

    def on_command(cmd):
        if cmd == "quick":
            api._on_hotkey()
        else:
            winsys.bring_to_front(window)

    def on_shown():
        _style_titlebar(window)
        api._start_hotkey()
        inst.set_handler(on_command)
        if "--quick" in sys.argv:
            threading.Timer(0.8, api._on_hotkey).start()

    def on_closing():
        # "closing" only minimizes the window to the taskbar, so the global hotkey keeps working
        if api._cfg["settings"].get("close_to_background") and not api._quitting:
            if api._quick:
                api.exit_quick(True)
                api._no_min_lock_until = 0
            window.minimize()
            return False
        return True

    def on_minimized():
        api._minimized = True
        if (api._cfg["settings"].get("lock_on_minimize") and not api._quick
                and time.time() > getattr(api, "_no_min_lock_until", 0)):
            with api._lock:
                api._do_lock()
            api._js("window.app && app.onLocked('minimize')")

    def on_restored():
        api._minimized = False

    window.events.shown += on_shown
    window.events.loaded += lambda: (api._hotkey.ok or api._start_hotkey())
    window.events.closing += on_closing
    window.events.closed += api._shutdown
    window.events.closed += inst.close
    for name, fn in (("minimized", on_minimized), ("restored", on_restored), ("maximized", on_restored)):
        try:
            getattr(window.events, name).__iadd__(fn)
        except AttributeError:
            pass

    icon = resource("vaultkeeper.png")
    try:
        webview.start(debug="--debug" in sys.argv, private_mode=True, icon=icon if os.path.exists(icon) else None)
    except TypeError:  # older pywebview version without the icon parameter
        webview.start(debug="--debug" in sys.argv, private_mode=True)


if __name__ == "__main__":
    main()
