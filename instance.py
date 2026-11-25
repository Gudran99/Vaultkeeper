"""
Only one running instance of Vaultkeeper + command-line commands.

  vaultkeeper            -> if Vaultkeeper is already running, bring its window to the front
  vaultkeeper --quick    -> open quick search in the already running Vaultkeeper
                       (on Linux this is bound to a shortcut in the system settings)

Windows: named mutex (see winsys.another_instance_running).
Linux/Mac: Unix socket in the user's private folder ($XDG_RUNTIME_DIR), permissions 0600.
Only the "show" and "quick" commands are accepted - nothing that reveals data.
"""

from __future__ import annotations

import os
import socket
import sys
import tempfile
import threading

import winsys

COMMANDS = ("show", "quick")


def socket_path() -> str:
    base = os.environ.get("XDG_RUNTIME_DIR")
    if not base or not os.path.isdir(base):
        base = tempfile.gettempdir()
    uid = os.getuid() if hasattr(os, "getuid") else 0
    return os.path.join(base, "vaultkeeper-%d.sock" % uid)


class Instance:
    def __init__(self):
        self._srv: socket.socket | None = None
        self._handler = None
        self._pending: list[str] = []
        self._lock = threading.Lock()

    # ---- main function
    def acquire(self, command: str = "show") -> bool:
        """True = this instance is the main one. False = Vaultkeeper is already running and the command was forwarded to it."""
        if winsys.IS_WIN:
            return not winsys.another_instance_running()
        path = socket_path()
        if self._send(path, command):
            return False
        try:
            os.unlink(path)  # leftover after a crash of the previous run
        except FileNotFoundError:
            pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        old = os.umask(0o177)
        try:
            srv.bind(path)
        finally:
            os.umask(old)
        os.chmod(path, 0o600)
        srv.listen(4)
        self._srv = srv
        threading.Thread(target=self._serve, daemon=True).start()
        return True

    @staticmethod
    def _send(path: str, command: str) -> bool:
        c = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        c.settimeout(1.5)
        try:
            c.connect(path)
            c.sendall(command.encode("ascii") + b"\n")
            return True
        except OSError:
            return False
        finally:
            c.close()

    def _serve(self):
        while self._srv is not None:
            try:
                conn, _ = self._srv.accept()
            except OSError:
                return
            try:
                conn.settimeout(2)
                cmd = conn.recv(64).decode("ascii", "ignore").strip()
            except OSError:
                cmd = ""
            finally:
                conn.close()
            if cmd in COMMANDS:
                self._dispatch(cmd)

    def _dispatch(self, cmd: str):
        with self._lock:
            handler = self._handler
            if handler is None:
                self._pending.append(cmd)
                return
        try:
            handler(cmd)
        except Exception:
            pass

    def set_handler(self, handler):
        with self._lock:
            self._handler = handler
            pending, self._pending = self._pending, []
        for cmd in pending:
            try:
                handler(cmd)
            except Exception:
                pass

    def close(self):
        srv, self._srv = self._srv, None
        if srv is not None:
            try:
                srv.close()
                os.unlink(socket_path())
            except OSError:
                pass


def command_from_argv(argv: list[str] | None = None) -> str:
    argv = sys.argv if argv is None else argv
    return "quick" if "--quick" in argv else "show"
