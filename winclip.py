"""
Clipboard that can be safely cleared only if the content is still ours.
  * Windows: stays out of the clipboard history (Win+V) and cloud sync.
  * Linux: wl-copy (Wayland) or xclip / xsel (X11); marked as sensitive content
    so history managers (KDE Klipper etc.) do not remember it.
  * Without a display / tools: in-memory substitute (for development and tests only).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import time

_IS_WIN = sys.platform == "win32"
_fallback = {"text": "", "seq": 0}
_linux = {"seq": 0, "hash": None}


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def linux_tool() -> str | None:
    """Which clipboard tool is available on Linux (None = none / no display)."""
    if _IS_WIN or sys.platform == "darwin":
        return None
    if os.environ.get("WAYLAND_DISPLAY") and shutil.which("wl-copy") and shutil.which("wl-paste"):
        return "wl"
    if os.environ.get("DISPLAY"):
        if shutil.which("xclip"):
            return "xclip"
        if shutil.which("xsel"):
            return "xsel"
    return None


_wl_sensitive: bool | None = None


def _wl_supports_sensitive() -> bool:
    global _wl_sensitive
    if _wl_sensitive is None:
        try:
            out = subprocess.run(["wl-copy", "--help"], capture_output=True, text=True, timeout=2)
            _wl_sensitive = "--sensitive" in (out.stdout + out.stderr)
        except Exception:
            _wl_sensitive = False
    return _wl_sensitive


def _run_detached(cmd: list[str], text: str | None = None) -> None:
    # wl-copy / xclip stay in the background to "hold" the clipboard: stdout/stderr must NOT be pipes,
    # otherwise we would wait forever.
    subprocess.run(cmd, input=(text or "").encode("utf-8") if text is not None else None,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=True)


def _linux_copy(tool: str, text: str) -> None:
    if tool == "wl":
        _run_detached(["wl-copy", "--sensitive"] if _wl_supports_sensitive() else ["wl-copy"], text)
    elif tool == "xclip":
        _run_detached(["xclip", "-selection", "clipboard", "-i"], text)
    else:
        _run_detached(["xsel", "--clipboard", "--input"], text)


def _linux_read(tool: str) -> str | None:
    cmd = {"wl": ["wl-paste", "--no-newline"], "xclip": ["xclip", "-selection", "clipboard", "-o"],
           "xsel": ["xsel", "--clipboard", "--output"]}[tool]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=2)
        return out.stdout.decode("utf-8", "replace") if out.returncode == 0 else ""
    except Exception:
        return None


def _linux_clear(tool: str) -> None:
    if tool == "wl":
        _run_detached(["wl-copy", "--clear"])
    elif tool == "xsel":
        _run_detached(["xsel", "--clipboard", "--clear"])
    else:
        _run_detached(["xclip", "-selection", "clipboard", "-i"], "")

if _IS_WIN:
    import ctypes
    from ctypes import wintypes

    _u32 = ctypes.WinDLL("user32", use_last_error=True)
    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    _u32.OpenClipboard.argtypes = [wintypes.HWND]
    _u32.OpenClipboard.restype = wintypes.BOOL
    _u32.CloseClipboard.restype = wintypes.BOOL
    _u32.EmptyClipboard.restype = wintypes.BOOL
    _u32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    _u32.SetClipboardData.restype = wintypes.HANDLE
    _u32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
    _u32.RegisterClipboardFormatW.restype = wintypes.UINT
    _u32.GetClipboardSequenceNumber.restype = wintypes.DWORD
    _k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    _k32.GlobalAlloc.restype = wintypes.HGLOBAL
    _k32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    _k32.GlobalLock.restype = ctypes.c_void_p
    _k32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    _k32.GlobalFree.argtypes = [wintypes.HGLOBAL]

    _CF_UNICODETEXT = 13
    _GMEM_MOVEABLE = 0x0002

    def _open():
        for _ in range(20):
            if _u32.OpenClipboard(None):
                return True
            time.sleep(0.03)
        return False

    def _set_bytes(fmt: int, data: bytes) -> None:
        h = _k32.GlobalAlloc(_GMEM_MOVEABLE, len(data))
        if not h:
            return
        p = _k32.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        _k32.GlobalUnlock(h)
        if not _u32.SetClipboardData(fmt, h):
            _k32.GlobalFree(h)


def copy(text: str) -> int:
    """Copies text and returns the clipboard sequence number (for a later check)."""
    if not _IS_WIN:
        tool = linux_tool()
        if tool:
            try:
                _linux_copy(tool, text)
            except (OSError, subprocess.SubprocessError):
                raise OSError("Copying to the clipboard failed (%s)." % tool)
            _linux["seq"] += 1
            _linux["hash"] = _sha(text)
            return _linux["seq"]
        _fallback["text"] = text
        _fallback["seq"] += 1
        return _fallback["seq"]
    if not _open():
        raise OSError("The clipboard is busy. Try again.")
    try:
        _u32.EmptyClipboard()
        _set_bytes(_CF_UNICODETEXT, (text + "\0").encode("utf-16-le"))
        zero = (0).to_bytes(4, "little")
        # Windows 10/11: do not keep in history (Win+V) and do not send to the cloud
        _set_bytes(_u32.RegisterClipboardFormatW("ExcludeClipboardContentFromMonitorProcessing"), zero)
        _set_bytes(_u32.RegisterClipboardFormatW("CanIncludeInClipboardHistory"), zero)
        _set_bytes(_u32.RegisterClipboardFormatW("CanUploadToCloudClipboard"), zero)
    finally:
        _u32.CloseClipboard()
    return _u32.GetClipboardSequenceNumber()


def sequence() -> int:
    if not _IS_WIN:
        return _linux["seq"] if linux_tool() else _fallback["seq"]
    return _u32.GetClipboardSequenceNumber()


def clear_if_unchanged(seq: int) -> bool:
    """Clear the clipboard only if nothing else was copied to it in the meantime."""
    if sequence() != seq:
        return False
    if not _IS_WIN:
        tool = linux_tool()
        if tool:
            # Linux has no sequence number: clear only if our value is still in the clipboard
            cur = _linux_read(tool)
            if cur is None or _linux["hash"] is None or _sha(cur) != _linux["hash"]:
                return False
            try:
                _linux_clear(tool)
            except (OSError, subprocess.SubprocessError):
                return False
            _linux["hash"] = None
            _linux["seq"] += 1
            return True
        _fallback["text"] = ""
        _fallback["seq"] += 1
        return True
    if not _open():
        return False
    try:
        _u32.EmptyClipboard()
    finally:
        _u32.CloseClipboard()
    return True


def peek_fallback() -> str:  # for tests only
    return _fallback["text"]
