#!/usr/bin/env bash
# Vaultkeeper - Linux installer. No sudo needed: everything goes into your user folder.
#   bash linux/install.sh       install or update (your data is not touched)
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APP="$DATA/vaultkeeper-app"
BIN="$HOME/.local/bin"
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# suggested command for installing system packages: $1 Debian/Ubuntu, $2 Fedora, $3 Arch, $4 openSUSE
pkg_hint() {
  if command -v apt-get >/dev/null 2>&1; then echo "sudo apt install $1"
  elif command -v dnf >/dev/null 2>&1; then echo "sudo dnf install $2"
  elif command -v pacman >/dev/null 2>&1; then echo "sudo pacman -S $3"
  elif command -v zypper >/dev/null 2>&1; then echo "sudo zypper install $4"
  else echo "(install: $1)"; fi
}

# ------------------------------------------------------------------ 1. Python
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3.13 python3.12 python3 python3.14 python3.11 python3.10; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
      PY="$c"; break
    fi
  done
fi
[ -n "$PY" ] || die "Python 3.10 or newer is required: $(pkg_hint python3 python3 python python3)"
if ! "$PY" -c 'import venv, ensurepip' 2>/dev/null; then
  die "The Python virtual-environment module (venv) is missing: $(pkg_hint python3-venv python3 python python3)"
fi
say "Python: $("$PY" --version 2>&1)"

# ------------------------------------------------------------------ 1b. remove the old "Trezor" install (data is not touched)
OLD_CFG="${XDG_CONFIG_HOME:-$HOME/.config}"
if [ -d "$DATA/trezor-app" ] || [ -e "$HOME/.local/bin/trezor" ]; then
  say "Removing the old Trezor install (your vault data stays where it is)"
  rm -rf "$DATA/trezor-app"
  rm -f "$HOME/.local/bin/trezor" "$DATA/applications/trezor.desktop" \
        "$DATA/icons/hicolor/256x256/apps/trezor.png" "$OLD_CFG/autostart/trezor.desktop"
fi

# ------------------------------------------------------------------ 2. files
say "Copying Vaultkeeper to $APP"
mkdir -p "$APP"
for item in app.py api.py bridge.py instance.py vault_core.py winclip.py winhello.py winsys.py \
            ui extension tools vaultkeeper.png requirements-linux.txt README.md; do
  [ -e "$SRC/$item" ] || die "Missing from the package: $item"
  rm -rf "${APP:?}/$item"
  cp -r "$SRC/$item" "$APP/"
done

# ------------------------------------------------------------------ 3. environment and packages
if [ ! -x "$APP/.venv/bin/python" ]; then
  say "Creating the environment (first time only)..."
  "$PY" -m venv "$APP/.venv"
fi
if [ "${VAULTKEEPER_SKIP_PIP:-0}" != "1" ]; then
  say "Installing packages (the first time can take a while, Qt is about 150 MB)..."
  "$APP/.venv/bin/python" -m pip install --quiet --upgrade pip
  "$APP/.venv/bin/python" -m pip install --upgrade -r "$APP/requirements-linux.txt"
fi

# ------------------------------------------------------------------ 4. the "vaultkeeper" command
mkdir -p "$BIN"
cat > "$BIN/vaultkeeper" <<LAUNCH
#!/usr/bin/env bash
# Vaultkeeper (installed from: $SRC)
export PYWEBVIEW_GUI="\${PYWEBVIEW_GUI:-qt}"
# Ubuntu 24.04+ (AppArmor) does not allow the Chromium sandbox for apps installed outside packages,
# so the window would not open. The window only shows the local Vaultkeeper interface (no internet).
if [ "\$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] || [ "\${VAULTKEEPER_NO_SANDBOX:-0}" = "1" ]; then
  export QTWEBENGINE_DISABLE_SANDBOX=1
fi
exec "$APP/.venv/bin/python" "$APP/app.py" "\$@"
LAUNCH
chmod +x "$BIN/vaultkeeper"

# ------------------------------------------------------------------ 5. applications menu and icon
mkdir -p "$ICONS/256x256/apps" "$APPS"
cp "$APP/vaultkeeper.png" "$ICONS/256x256/apps/vaultkeeper.png"
cat > "$APPS/vaultkeeper.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Vaultkeeper
GenericName=Password manager
Comment=Passwords and 2FA codes, local and encrypted
Exec=$BIN/vaultkeeper
Icon=vaultkeeper
Terminal=false
Categories=Utility;Security;
Keywords=password;2fa;totp;vault;
StartupWMClass=Vaultkeeper
Actions=quick;

[Desktop Action quick]
Name=Quick search
Exec=$BIN/vaultkeeper --quick
DESK
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$APPS" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true

# ------------------------------------------------------------------ 6. checks
MISSING=0
if [ "${VAULTKEEPER_SKIP_PIP:-0}" != "1" ]; then
  if ! "$APP/.venv/bin/python" -c "import webview, cryptography, qtpy; from PyQt6 import QtWebEngineWidgets" 2>"$APP/install-check.log"; then
    warn "Qt (the app window) could not be loaded. Details: $APP/install-check.log"
    MISSING=1
  fi
fi
if command -v ldconfig >/dev/null 2>&1 && ! ldconfig -p 2>/dev/null | grep -q libxcb-cursor.so.0; then
  warn "A library for Qt windows is missing:  $(pkg_hint libxcb-cursor0 xcb-util-cursor xcb-util-cursor libxcb-cursor0)"
  MISSING=1
fi
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  command -v wl-copy >/dev/null 2>&1 || { warn "To copy passwords, install:  $(pkg_hint wl-clipboard wl-clipboard wl-clipboard wl-clipboard)"; MISSING=1; }
elif ! command -v xclip >/dev/null 2>&1 && ! command -v xsel >/dev/null 2>&1; then
  warn "To copy passwords, install:  $(pkg_hint xclip xclip xclip xclip)"
  MISSING=1
fi
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) warn "$BIN is not in your PATH. Vaultkeeper is still in the applications menu; for the 'vaultkeeper' command, log out and back in." ;;
esac

echo
say "Done! Vaultkeeper is in the applications menu, and from a terminal: vaultkeeper"
echo "    Quick search: set a system shortcut (e.g. Ctrl+Shift+Space) that runs:"
echo "        $BIN/vaultkeeper --quick"
echo "    Data:  ${XDG_DATA_HOME:-$HOME/.local/share}/Vaultkeeper/vaultkeeper.vault"
[ "$MISSING" = "0" ] || echo "    Install the packages marked [!] above, then start Vaultkeeper."
