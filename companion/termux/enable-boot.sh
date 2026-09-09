#!/data/data/com.termux/files/usr/bin/bash
# Makes the companion start when the phone boots.
#
#   curl -sLo b.sh https://raw.githubusercontent.com/XavielT/music-hub/main/companion/termux/enable-boot.sh
#   bash b.sh
#
# Needs the Termux:Boot app installed first, from the same F-Droid repo as
# Termux itself — add-ons only work when they are signed with the same key.
set -euo pipefail

HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
BOOT_DIR="$HOME_DIR/.termux/boot"
SCRIPT="$BOOT_DIR/musichub"

if ! command -v musichub >/dev/null 2>&1; then
  echo "The companion is not set up yet — run setup.sh first." >&2
  exit 1
fi

mkdir -p "$BOOT_DIR"

cat > "$SCRIPT" <<'BOOTSCRIPT'
#!/data/data/com.termux/files/usr/bin/sh
# Started by Termux:Boot. termux-wake-lock keeps Android from suspending the
# process; without it the companion is killed within minutes of the screen
# going off, and the app reports that it cannot be reached.
termux-wake-lock
exec musichub
BOOTSCRIPT

chmod +x "$SCRIPT"

cat <<BANNER

  ────────────────────────────────────────────────────────────
   Boot script written to ~/.termux/boot/musichub

   Two things Android needs from you, once:

   1. Open the Termux:Boot app once, so it is allowed to run at
      boot. It shows a blank screen — that is all it does.

   2. On Xiaomi/MIUI, allow autostart for BOTH Termux:Boot and Termux:
      Security -> Permissions -> Autostart, then search "Termux".
      Termux:Boot only starts a Termux session, so both need it.

   Then reboot and the companion will already be running.
  ────────────────────────────────────────────────────────────

BANNER
