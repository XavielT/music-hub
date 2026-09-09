#!/usr/bin/env python3
"""
Music Hub companion, Termux edition.

Same three endpoints as the Docker companion, deliberately: the app cannot
tell them apart, so pointing Settings at http://127.0.0.1:8099 is the whole
integration.

What is different is the dependency list, and that is the point. The hosted
version runs FastAPI and uvicorn; on a phone, `uvicorn[standard]` wants to
compile uvloop and httptools, which is a bad evening. This is the standard
library plus yt-dlp, which is pure Python and installs anywhere.

The other difference matters more: this runs on the phone, so YouTube sees a
normal mobile connection rather than a datacenter, and none of the bot-check
machinery the hosted version needs applies here.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from hmac import compare_digest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from yt_dlp import YoutubeDL

TOKEN = os.environ.get("MUSIC_HUB_TOKEN", "").strip()
PORT = int(os.environ.get("PORT", "8099"))
# Loopback only. The phone is on whatever wifi it is on, and this service has
# no business being reachable from the rest of that network.
HOST = os.environ.get("HOST", "127.0.0.1")
MAX_DURATION_SECONDS = int(os.environ.get("MAX_DURATION_SECONDS", "1800"))

VIDEO_ID = re.compile(r"^[\w-]{11}$")
HAS_FFMPEG = shutil.which("ffmpeg") is not None


def ydl_options(extra: dict) -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        # Node is not a given on a phone, so no JS runtime is configured. yt-dlp
        # copes from a residential address; it is the datacenter case that
        # needs the whole apparatus.
        **extra,
    }


class Handler(BaseHTTPRequestHandler):
    # The default logger writes a line per request to stderr, which in Termux
    # means a scrolling wall in the notification shade.
    def log_message(self, fmt, *args):  # noqa: A002
        pass

    def send_json(self, status: int, payload) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorised(self) -> bool:
        if not TOKEN:
            self.send_json(503, {"detail": "MUSIC_HUB_TOKEN is not set."})
            return False
        given = self.headers.get("Authorization", "")
        if not compare_digest(given.encode(), f"Bearer {TOKEN}".encode()):
            self.send_json(401, {"detail": "Bad or missing token."})
            return False
        return True

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler's naming
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        route = parsed.path.rstrip("/") or "/"

        if route == "/health":
            self.send_json(200, {
                "ok": True,
                "ytdlp": __import__("yt_dlp.version", fromlist=["__version__"]).__version__,
                "configured": bool(TOKEN),
                "cookies": False,
                "where": "termux",
                "ffmpeg": HAS_FFMPEG,
            })
            return

        if not self.authorised():
            return

        try:
            if route == "/search":
                self.handle_search(query)
            elif route == "/info":
                self.handle_info(query)
            elif route == "/download":
                self.handle_download(query)
            else:
                self.send_json(404, {"detail": "No such endpoint."})
        except Refused as refused:
            self.send_json(refused.status, {"detail": refused.detail})
        except Exception as err:  # noqa: BLE001
            self.send_json(502, {"detail": f"YouTube request failed: {err}"})

    def handle_search(self, query) -> None:
        q = (query.get("q") or [""])[0]
        if not q:
            raise Refused(400, "Nothing to search for.")
        limit = max(1, min(int((query.get("limit") or ["15"])[0]), 25))
        with YoutubeDL(ydl_options({"skip_download": True, "extract_flat": True})) as ydl:
            found = ydl.extract_info(f"ytsearch{limit}:{q}", download=False)
        self.send_json(200, [
            {
                "id": e.get("id"),
                "title": e.get("title") or e.get("id"),
                "author": e.get("uploader") or e.get("channel") or "Unknown artist",
                "duration": int(e.get("duration") or 0),
                "thumbnail": (e.get("thumbnails") or [{}])[0].get("url"),
            }
            for e in (found.get("entries") or []) if e.get("id")
        ])

    def handle_info(self, query) -> None:
        video_id = self.video_id(query)
        with YoutubeDL(ydl_options({"skip_download": True})) as ydl:
            found = ydl.extract_info(video_id, download=False)
        self.send_json(200, {
            "id": found.get("id", video_id),
            "title": found.get("title") or video_id,
            "author": found.get("uploader") or found.get("channel") or "Unknown artist",
            "duration": int(found.get("duration") or 0),
            "thumbnail": (found.get("thumbnails") or [{}])[-1].get("url"),
        })

    def handle_download(self, query) -> None:
        video_id = self.video_id(query)
        workspace = tempfile.mkdtemp(prefix="musichub-")
        try:
            # m4a straight from YouTube where it exists, so ffmpeg is only
            # needed for the odd video that has no AAC audio at all.
            options = ydl_options({
                "format": "bestaudio[ext=m4a]/bestaudio",
                "outtmpl": str(Path(workspace) / "%(id)s.%(ext)s"),
            })
            if HAS_FFMPEG:
                options["postprocessors"] = [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "m4a",
                    "preferredquality": "160",
                }]

            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(video_id, download=False)
                duration = int(info.get("duration") or 0)
                if duration > MAX_DURATION_SECONDS:
                    raise Refused(
                        413,
                        f"That is {duration // 60} minutes long; "
                        f"the limit is {MAX_DURATION_SECONDS // 60}.",
                    )
                ydl.download([video_id])

            produced = sorted(Path(workspace).glob(f"{video_id}.*"))
            if not produced:
                raise Refused(502, "yt-dlp produced no file.")
            audio = produced[0]
            data = audio.read_bytes()

            self.send_response(200)
            self.send_header("Content-Type", "audio/mp4")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f'attachment; filename="{audio.name}"')
            self.end_headers()
            self.wfile.write(data)
        finally:
            shutil.rmtree(workspace, ignore_errors=True)

    def video_id(self, query) -> str:
        given = (query.get("id") or [""])[0]
        if not VIDEO_ID.match(given):
            raise Refused(400, "Not a video id.")
        return given


class Refused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def main() -> None:
    if not TOKEN:
        print("MUSIC_HUB_TOKEN is not set — every request will be refused.")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Music Hub companion listening on http://{HOST}:{PORT}")
    print("Point Settings → YouTube companion at that address.")
    print("Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
