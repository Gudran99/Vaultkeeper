#!/usr/bin/env bash
# Removes the Vaultkeeper program. Your vault (passwords) and backup copies are NOT deleted.
set -euo pipefail
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
rm -rf "$DATA/vaultkeeper-app"
rm -f "$HOME/.local/bin/vaultkeeper" "$DATA/applications/vaultkeeper.desktop" "$DATA/icons/hicolor/256x256/apps/vaultkeeper.png"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/vaultkeeper.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$DATA/applications" 2>/dev/null || true
echo "Vaultkeeper has been removed."
echo "Your data is kept in:  $DATA/Vaultkeeper   (backup: ${XDG_STATE_HOME:-$HOME/.local/state}/Vaultkeeper Backup)"
