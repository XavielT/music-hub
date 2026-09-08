"""
Music Hub's yt-dlp companion.

YouTube blocks the audio download from inside the app itself — the WEB client
no longer returns playable URLs, and the mobile clients that do are behind bot
protection the phone trips almost immediately. This service does the fetching
somewhere yt-dlp can be kept up to date, and hands the app a plain audio file.

It is deliberately small and deliberately closed: one bearer token, an origin
allow list, a duration cap, and no way to ask it for anything but audio. An
open yt-dlp endpoint on the internet is somebody else's download farm within
the day.
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from yt_dlp import YoutubeDL

# --- configuration, all from the environment so the host is swappable ---

# Fail closed. A service with no token is an open proxy, and this one shells
# out to a downloader — it must refuse to start rather than run unprotected.
TOKEN = os.environ.get("MUSIC_HUB_TOKEN", "").strip()

# Comma-separated. The Capacitor shell's origin is https://localhost.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:4200,https://localhost",
    ).split(",")
    if origin.strip()
]

# Nothing here should be pulling down a three-hour upload; the app is for
# songs, and the cap is what stops one bad id filling the container's disk.
MAX_DURATION_SECONDS = int(os.environ.get("MAX_DURATION_SECONDS", "1800"))

# Optional. A cookies.txt exported from a signed-in browser is the usual way
# past "Sign in to confirm you're not a bot" from a datacenter IP. It carries
# real account credentials, so it is a mount/secret, never baked into an image.
COOKIES_FILE = os.environ.get("YTDLP_COOKIES_FILE", "").strip()

VIDEO_ID = re.compile(r"^[\w-]{11}$")

app = FastAPI(title="Music Hub companion", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def authorise(authorization: str = Header(default="")) -> None:
    if not TOKEN:
        # Refusing every request is the right failure for a misconfigured
        # deploy: the alternative is quietly serving the whole internet.
        raise HTTPException(503, "MUSIC_HUB_TOKEN is not set on the server.")
    expected = f"Bearer {TOKEN}"
    # Length-independent comparison is overkill for a personal service, but
    # it costs one import and removes the question.
    if not authorization or not _equal(authorization, expected):
        raise HTTPException(401, "Bad or missing token.")


def _equal(a: str, b: str) -> bool:
    from hmac import compare_digest

    return compare_digest(a.encode(), b.encode())


def _ydl_options(extra: dict) -> dict:
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        # YouTube extraction needs a JavaScript runtime now, and yt-dlp enables
        # only Deno by default. This image already has Node for the POT
        # provider, so point it there — without this the extractor degrades
        # ("No title found in player responses") and the request comes back as
        # a bot check, which sends you looking for the wrong problem entirely.
        "js_runtimes": {"node": {}},
        # Deliberately no player_client pin. The clients that used to be the
        # good ones (android, ios) are the ones that cannot carry a
        # proof-of-origin token, so pinning them here defeated the provider
        # this image exists to run. yt-dlp's own default order already prefers
        # what works, and it changes faster than this file will.
        **extra,
    }
    if COOKIES_FILE and Path(COOKIES_FILE).is_file():
        options["cookiefile"] = COOKIES_FILE
    return options


@app.get("/health")
def health() -> JSONResponse:
    from yt_dlp.version import __version__ as ytdlp_version

    return JSONResponse(
        {
            "ok": True,
            "ytdlp": ytdlp_version,
            "configured": bool(TOKEN),
            "cookies": bool(COOKIES_FILE and Path(COOKIES_FILE).is_file()),
        }
    )


@app.get("/search", dependencies=[Depends(authorise)])
def search(q: str = Query(min_length=1, max_length=200), limit: int = 15) -> JSONResponse:
    """Search, so the browser gets it too.

    The app can already search from inside the Android shell, where native
    HTTP sidesteps CORS. In a browser it cannot, so the same button is dead
    there — this makes it work in both.
    """
    limit = max(1, min(limit, 25))
    with YoutubeDL(_ydl_options({"skip_download": True, "extract_flat": True})) as ydl:
        try:
            found = ydl.extract_info(f"ytsearch{limit}:{q}", download=False)
        except Exception as err:  # noqa: BLE001 — yt-dlp raises a wide range
            raise HTTPException(502, f"Search failed: {err}") from err

    entries = found.get("entries") or []
    return JSONResponse(
        [
            {
                "id": entry.get("id"),
                "title": entry.get("title") or entry.get("id"),
                "author": entry.get("uploader") or entry.get("channel") or "Unknown artist",
                "duration": int(entry.get("duration") or 0),
                "thumbnail": (entry.get("thumbnails") or [{}])[0].get("url"),
            }
            for entry in entries
            if entry.get("id")
        ]
    )


@app.get("/info", dependencies=[Depends(authorise)])
def info(id: str = Query(min_length=11, max_length=11)) -> JSONResponse:
    """One video's details, for when someone pasted a link rather than searched.

    Without this the client had to fall back to *searching* for the id, which
    finds whatever YouTube thinks an eleven-character string means — usually
    nothing, occasionally the wrong song. A pasted link should resolve to that
    exact video.
    """
    if not VIDEO_ID.match(id):
        raise HTTPException(400, "Not a video id.")

    with YoutubeDL(_ydl_options({"skip_download": True})) as ydl:
        try:
            found = ydl.extract_info(id, download=False)
        except Exception as err:  # noqa: BLE001
            raise HTTPException(*_youtube_error(err)) from err

    return JSONResponse(
        {
            "id": found.get("id", id),
            "title": found.get("title") or id,
            "author": found.get("uploader") or found.get("channel") or "Unknown artist",
            "duration": int(found.get("duration") or 0),
            "thumbnail": (found.get("thumbnails") or [{}])[-1].get("url"),
        }
    )


@app.get("/download", dependencies=[Depends(authorise)])
def download(id: str = Query(min_length=11, max_length=11)) -> FileResponse:
    """Fetch one video's audio and hand back an m4a.

    Written to a temp directory and streamed out, then deleted — holding it in
    memory would put a 10 MB spike per request on a container sized for almost
    nothing.
    """
    if not VIDEO_ID.match(id):
        raise HTTPException(400, "Not a video id.")

    workspace = tempfile.mkdtemp(prefix="musichub-")
    options = _ydl_options(
        {
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "outtmpl": str(Path(workspace) / "%(id)s.%(ext)s"),
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "m4a", "preferredquality": "160"}
            ],
        }
    )

    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(id, download=False)
            duration = int(info.get("duration") or 0)
            if duration > MAX_DURATION_SECONDS:
                raise HTTPException(
                    413, f"That is {duration // 60} minutes long; the limit is {MAX_DURATION_SECONDS // 60}."
                )
            ydl.download([id])
    except HTTPException:
        _cleanup(workspace)
        raise
    except Exception as err:  # noqa: BLE001
        _cleanup(workspace)
        raise HTTPException(*_youtube_error(err)) from err

    produced = sorted(Path(workspace).glob(f"{id}.*"))
    if not produced:
        _cleanup(workspace)
        raise HTTPException(502, "yt-dlp produced no file.")

    audio = produced[0]
    return FileResponse(
        audio,
        media_type="audio/mp4",
        filename=f"{id}.m4a",
        background=BackgroundTask(_cleanup, workspace),
    )


def _youtube_error(err: Exception) -> tuple[int, str]:
    """One place that decides how a yt-dlp failure reads.

    The bot check is worth naming rather than passing through as a generic
    502: it is the reason this service exists, the reason it still fails from
    a datacenter address, and the thing whose fix is documented.
    """
    message = str(err)
    if "Sign in to confirm" in message or "not a bot" in message.lower():
        return (
            429,
            "YouTube asked this server to prove it is not a bot. Datacenter addresses get "
            "this — the fix is cookies from a signed-in account (see the README) or running "
            "the service from a home connection.",
        )
    if "Video unavailable" in message or "Private video" in message:
        return (404, "That video is unavailable — private, deleted, or region-locked.")
    return (502, f"YouTube request failed: {message}")


def _cleanup(workspace: str) -> None:
    from shutil import rmtree

    rmtree(workspace, ignore_errors=True)
