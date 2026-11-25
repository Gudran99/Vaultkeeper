"""
Windows Hello (fingerprint / face / PIN) for unlocking the vault.

How it works:
  * When enabled, the vault key is encrypted with Windows DPAPI (bound to your Windows account
    and this computer) with additional random "entropy". The master password is never stored.
  * On unlock, Vaultkeeper first asks for Windows Hello confirmation (UserConsentVerifier),
    and only then decrypts the key.
Protection level: at the Windows account level (other password managers use the same approach).
A vault file moved to another computer or another account still requires the master password.
"""

from __future__ import annotations

import asyncio
import sys
import threading
import time

IS_WIN = sys.platform == "win32"

try:  # module-level import so PyInstaller bundles it
    from winrt.windows.security.credentials.ui import (  # type: ignore
        UserConsentVerifier, UserConsentVerifierAvailability, UserConsentVerificationResult,
    )
    _WINRT_OK = True
except Exception:
    _WINRT_OK = False


class HelloError(Exception):
    pass


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _focus_hello_dialog(stop: threading.Event):
    """The Hello dialog sometimes opens BEHIND the app window - bring it to the front."""
    if not IS_WIN:
        return
    try:
        import ctypes
        user32 = ctypes.windll.user32
        for _ in range(80):
            if stop.is_set():
                return
            hwnd = user32.FindWindowW("Credential Dialog Xaml Host", None)
            if hwnd:
                user32.SetForegroundWindow(hwnd)
                return
            time.sleep(0.1)
    except Exception:
        pass


_AVAIL_MSG = {
    "DEVICE_NOT_PRESENT": "No fingerprint reader, camera, or configured PIN for Windows Hello.",
    "NOT_CONFIGURED_FOR_USER": "Windows Hello is not set up. Settings > Accounts > Sign-in options.",
    "DISABLED_BY_POLICY": "Windows Hello is disabled by computer policy (IT).",
    "DEVICE_BUSY": "Windows Hello is busy right now. Try again.",
}


def status() -> tuple[bool, str]:
    if not IS_WIN:
        return False, "Windows Hello is only available on Windows."
    if not _WINRT_OK:
        return False, "Windows Hello support is not installed (run napravi_exe.bat again)."
    try:
        a = _run(UserConsentVerifier.check_availability_async())
    except Exception as e:
        return False, "Windows Hello is not available: %s" % e
    if a == UserConsentVerifierAvailability.AVAILABLE:
        return True, ""
    name = getattr(a, "name", str(a))
    return False, _AVAIL_MSG.get(name, "Windows Hello is not available (%s)." % name)


def verify(message: str = "Unlock Vaultkeeper") -> None:
    """Shows the Windows Hello prompt. Raises HelloError if not confirmed."""
    ok, reason = status()
    if not ok:
        raise HelloError(reason)
    stop = threading.Event()
    threading.Thread(target=_focus_hello_dialog, args=(stop,), daemon=True).start()
    try:
        r = _run(UserConsentVerifier.request_verification_async(message))
    finally:
        stop.set()
    if r == UserConsentVerificationResult.VERIFIED:
        return
    if r == UserConsentVerificationResult.CANCELED:
        raise HelloError("Cancelled.")
    if r == UserConsentVerificationResult.RETRIES_EXHAUSTED:
        raise HelloError("Too many failed attempts. Unlock with the master password.")
    raise HelloError("Windows Hello verification failed (%s)." % getattr(r, "name", r))
