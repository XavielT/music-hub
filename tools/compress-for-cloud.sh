#!/usr/bin/env bash
# Re-encode audio to AAC ~160k m4a before uploading it to the Music Hub cloud.
#
# Why: the cloud library is a shared 1 GB. A typical 320 kbps MP3 is ~7 MB, so
# the quota is ~140 songs. At AAC 160k the same song is ~3.6 MB, so it is ~280.
#
# This is a re-encode, not lossless — an MP3 is already lossy and nothing can
# shrink it without another lossy pass. AAC 160k is transparent to almost all
# listeners on phones and earbuds, and plays natively everywhere including iOS.
# Your originals are never modified: keep them as the master copies.
#
#   ./tools/compress-for-cloud.sh ~/Music/originals ~/Music/for-cloud
#
# Re-running skips anything already converted, so it is safe on a growing
# folder. Tags and embedded cover art are carried over.
set -euo pipefail

BITRATE="${BITRATE:-160k}"
SRC="${1:-}"
DEST="${2:-}"

if [ -z "$SRC" ] || [ -z "$DEST" ]; then
  echo "usage: $0 <source-dir> <dest-dir>   (BITRATE=160k by default)" >&2
  exit 2
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not installed. Install it with:" >&2
  echo "  sudo apt install ffmpeg" >&2
  exit 1
fi
[ -d "$SRC" ] || { echo "no such directory: $SRC" >&2; exit 1; }
mkdir -p "$DEST"

human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "${1}B"; }

converted=0; skipped=0; failed=0; bytes_in=0; bytes_out=0

# -print0/-d '' so spaces and quotes in filenames are handled correctly.
while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  out="$DEST/${rel%.*}.m4a"
  mkdir -p "$(dirname "$out")"

  if [ -f "$out" ] && [ "$out" -nt "$file" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  in_size=$(stat -c%s "$file")
  # -map 0:a    the audio
  # -map 0:v?   embedded cover art if there is any ('?' = optional)
  # -c:v copy   never re-encode the artwork
  # +faststart  moov atom up front, so the browser can start playing sooner
  if ffmpeg -nostdin -v error -y -i "$file" \
      -map 0:a -map "0:v?" \
      -c:a aac -b:a "$BITRATE" \
      -c:v copy -disposition:v attached_pic \
      -map_metadata 0 -movflags +faststart \
      "$out" 2>/dev/null; then
    out_size=$(stat -c%s "$out")
    bytes_in=$((bytes_in + in_size)); bytes_out=$((bytes_out + out_size))
    converted=$((converted + 1))
    printf '  %-58s %8s -> %8s\n' "$(basename "$out")" "$(human "$in_size")" "$(human "$out_size")"
  else
    failed=$((failed + 1))
    echo "  FAILED: $rel" >&2
    rm -f "$out"
  fi
done < <(find "$SRC" -type f \
  \( -iname '*.mp3' -o -iname '*.m4a' -o -iname '*.aac' -o -iname '*.flac' \
     -o -iname '*.wav' -o -iname '*.ogg' -o -iname '*.opus' -o -iname '*.wma' \) -print0)

echo
echo "converted $converted, skipped $skipped (already done), failed $failed"
if [ "$bytes_in" -gt 0 ]; then
  echo "size: $(human "$bytes_in") -> $(human "$bytes_out")  (saved $(( 100 - bytes_out * 100 / bytes_in ))%)"
  echo "upload the .m4a files in $DEST via the app's ＋ tab."
fi
