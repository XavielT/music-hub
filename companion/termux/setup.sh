#!/data/data/com.termux/files/usr/bin/bash
# One-time setup for the Music Hub companion inside Termux.
#
#   curl -sL https://raw.githubusercontent.com/XavielT/music-hub/main/companion/termux/setup.sh | bash
#
# Installs Python and yt-dlp, generates a token, writes a `musichub` command,
# and prints the address and token to paste into the app.
set -euo pipefail

BIN="$PREFIX/bin"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
APP_DIR="$HOME_DIR/.musichub"
TOKEN_FILE="$APP_DIR/token"
SERVER="$APP_DIR/companion.py"
RAW="https://raw.githubusercontent.com/XavielT/music-hub/main/companion/termux/companion.py"

echo "==> Installing what the companion needs"
# ffmpeg is optional: YouTube serves m4a directly for almost everything, and
# it is only used for the rare video with no AAC audio. It is also the slowest
# thing to install, so it is offered rather than assumed.
pkg update -y >/dev/null 2>&1 || true
pkg install -y python >/dev/null

echo "==> Installing yt-dlp"
pip install --quiet --upgrade pip
pip install --quiet --upgrade yt-dlp

mkdir -p "$APP_DIR"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "==> Generating a token"
  python -c "import secrets; print(secrets.token_hex(24))" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

echo "==> Fetching the companion"
if [ -f "$(dirname "$0")/companion.py" ]; then
  cp "$(dirname "$0")/companion.py" "$SERVER"
else
  curl -sfL "$RAW" -o "$SERVER"
fi

cat > "$BIN/musichub" <<'LAUNCHER'
#!/data/data/com.termux/files/usr/bin/bash
# Starts the Music Hub companion. Ctrl-C stops it.
APP_DIR="$HOME/.musichub"
export MUSIC_HUB_TOKEN="$(cat "$APP_DIR/token")"
export PORT="${PORT:-8099}"
# Keeps the phone from suspending the process the moment the screen goes off,
# which would otherwise stop a download halfway.
termux-wake-lock 2>/dev/null || true
trap 'termux-wake-unlock 2>/dev/null || true' EXIT
exec python "$APP_DIR/companion.py"
LAUNCHER
chmod +x "$BIN/musichub"

TOKEN="$(cat "$TOKEN_FILE")"
cat <<BANNER

  ────────────────────────────────────────────────────────────
   Done. Start it any time by typing:  musichub

   Then in Music Hub → Settings → YouTube companion:

     Address   http://127.0.0.1:8099
     Token     $TOKEN

   The address and token never change, so this is a one-off.
  ────────────────────────────────────────────────────────────

  Optional: install the Termux:Boot app and run
      mkdir -p ~/.termux/boot
      printf '#!/data/data/com.termux/files/usr/bin/sh\\nmusichub\\n' > ~/.termux/boot/musichub
      chmod +x ~/.termux/boot/musichub
  and it will start itself when the phone boots.

BANNER
