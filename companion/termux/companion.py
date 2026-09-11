#!/usr/bin/env python3
"""
Music Hub companion, Termux edition.

Same endpoints as the Docker companion, deliberately: the app cannot tell them
apart, so pointing Settings at http://127.0.0.1:8099 is the whole integration.

What is different is the dependency list, and that is the point. The hosted
version runs FastAPI and uvicorn; on a phone, `uvicorn[standard]` wants to
compile uvloop and httptools, which is a bad evening. This is the standard
library plus yt-dlp, which is pure Python and installs anywhere.

The other difference matters more: this runs on the phone, so YouTube sees a
normal mobile connection rather than a datacenter, and none of the bot-check
machinery the hosted version needs applies here.

Beyond answering the app, it can also work on its own. Once linked (POST
/link, which the app does for you), a background thread signs in to Supabase
as a dedicated worker account and fulfils the requests members leave in the
queue — downloading, uploading and filing each song — whether or not Music Hub
is open on this phone. That is the difference between "downloads work when
Xaviel opens the app" and "downloads work".
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
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

STATE_DIR = Path(os.environ.get("MUSIC_HUB_STATE", Path.home() / ".musichub"))
WORKER_FILE = STATE_DIR / "worker.json"

VIDEO_ID = re.compile(r"^[\w-]{11}$")
HAS_FFMPEG = shutil.which("ffmpeg") is not None

# Supabase free tier gives 1 GB of Storage. The app checks this before
# uploading and so does the worker: running head-first into the wall fails with
# a raw storage error that says nothing useful.
STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024

# How often to ask for work when the queue was empty. Realtime would be
# faster, but it is a websocket and this file has no dependencies beyond
# yt-dlp; twenty seconds is well inside "I asked and it appeared".
IDLE_POLL_SECONDS = 20
# After a failure that is probably the network, not the request.
ERROR_BACKOFF_SECONDS = 60
# Refresh the access token this long before it expires.
TOKEN_MARGIN_SECONDS = 300


def ydl_options(extra: dict) -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        # Without this the progress bar writes a few hundred lines per song,
        # which in Termux is a scrolling wall in the notification shade.
        "noprogress": True,
        # Node is not a given on a phone, so no JS runtime is configured. yt-dlp
        # copes from a residential address; it is the datacenter case that
        # needs the whole apparatus.
        **extra,
    }


def download_audio(workspace: str, video_id: str) -> tuple[Path, dict]:
    """Fetch one video's audio into `workspace`. Returns the file and its info."""
    options = ydl_options({
        # m4a straight from YouTube where it exists, so ffmpeg is only needed
        # for the odd video that has no AAC audio at all.
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
    return produced[0], info


def describe(info: dict, video_id: str) -> dict:
    thumbnails = info.get("thumbnails") or [{}]
    return {
        "id": info.get("id", video_id),
        "title": info.get("title") or video_id,
        "author": info.get("uploader") or info.get("channel") or "Unknown artist",
        "duration": int(info.get("duration") or 0),
        "thumbnail": thumbnails[-1].get("url"),
    }


# --- Supabase over the standard library -------------------------------------


class SupabaseError(Exception):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"HTTP {status}: {body[:300]}")
        self.status = status
        self.body = body


def http_json(method: str, url: str, headers: dict, payload=None, raw: bytes | None = None):
    body = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            text = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        raise SupabaseError(err.code, err.read().decode("utf-8", "replace")) from None
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


class Worker(threading.Thread):
    """
    Fulfils queued download requests without the app being open.

    Signs in as its own machine account rather than borrowing the app's
    session: Supabase rotates refresh tokens, so two clients sharing one
    session sign each other out within the hour.

    Everything it does is something an admin could do from the app, and it
    holds no more authority than that — the same RLS policies apply to it.
    """

    def __init__(self) -> None:
        super().__init__(daemon=True, name="musichub-worker")
        self.config: dict | None = self.load()
        self.access_token: str | None = None
        self.user_id: str | None = None
        self.expires_at = 0.0
        self.last_error: str | None = None
        self.last_activity: str | None = None
        self.completed = 0
        self.failed = 0
        self.wake = threading.Event()
        self.lock = threading.Lock()

    # --- configuration ---

    def load(self) -> dict | None:
        try:
            return json.loads(WORKER_FILE.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def configure(self, config: dict) -> None:
        for key in ("supabase_url", "anon_key", "email", "password"):
            if not str(config.get(key, "")).strip():
                raise Refused(400, f"'{key}' is required to link the worker.")
        clean = {
            "supabase_url": config["supabase_url"].rstrip("/"),
            "anon_key": config["anon_key"],
            "email": config["email"],
            "password": config["password"],
        }
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        WORKER_FILE.write_text(json.dumps(clean))
        # The password is a credential for an account that can write to the
        # shared library. Nothing else on the phone needs to read it.
        WORKER_FILE.chmod(0o600)
        with self.lock:
            self.config = clean
            self.access_token = None
            self.expires_at = 0.0
            self.last_error = None
        self.wake.set()

    def forget(self) -> None:
        WORKER_FILE.unlink(missing_ok=True)
        with self.lock:
            self.config = None
            self.access_token = None
            self.last_error = None

    def status(self) -> dict:
        with self.lock:
            return {
                "linked": self.config is not None,
                "signed_in": bool(self.access_token) and time.time() < self.expires_at,
                "account": (self.config or {}).get("email"),
                "completed": self.completed,
                "failed": self.failed,
                "last_activity": self.last_activity,
                "last_error": self.last_error,
            }

    # --- auth ---

    def rest_headers(self) -> dict:
        assert self.config is not None
        return {
            "apikey": self.config["anon_key"],
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def sign_in(self) -> None:
        assert self.config is not None
        base = self.config["supabase_url"]
        session = http_json(
            "POST",
            f"{base}/auth/v1/token?grant_type=password",
            {"apikey": self.config["anon_key"], "Content-Type": "application/json"},
            {"email": self.config["email"], "password": self.config["password"]},
        )
        self.access_token = session["access_token"]
        self.user_id = session["user"]["id"]
        self.expires_at = time.time() + int(session.get("expires_in", 3600))

    def ensure_session(self) -> None:
        # Signing in again with the password is simpler than refreshing and has
        # the same cost here: the account exists only for this process, so
        # there is no other client whose session could be disturbed.
        if not self.access_token or time.time() > self.expires_at - TOKEN_MARGIN_SECONDS:
            self.sign_in()

    # --- the loop ---

    def run(self) -> None:
        while True:
            if self.config is None:
                self.wake.wait(timeout=IDLE_POLL_SECONDS)
                self.wake.clear()
                continue
            try:
                self.ensure_session()
                request = self.claim()
                if request is None:
                    self.note(None)
                    self.wake.wait(timeout=IDLE_POLL_SECONDS)
                    self.wake.clear()
                    continue
                self.fulfil(request)
            except Exception as err:  # noqa: BLE001 — a worker thread must not die
                self.note(f"{type(err).__name__}: {err}")
                print(f"[worker] {err}", flush=True)
                traceback.print_exc()
                with self.lock:
                    self.access_token = None
                self.wake.wait(timeout=ERROR_BACKOFF_SECONDS)
                self.wake.clear()

    def note(self, error: str | None) -> None:
        with self.lock:
            self.last_error = error
            self.last_activity = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def api(self, method: str, path: str, payload=None, extra: dict | None = None):
        assert self.config is not None
        headers = self.rest_headers()
        if extra:
            headers.update(extra)
        return http_json(method, f"{self.config['supabase_url']}{path}", headers, payload)

    def claim(self) -> dict | None:
        row = self.api("POST", "/rest/v1/rpc/claim_download_request", {})
        # A function returning a composite type hands back a row of nulls, not
        # null, when it finds nothing.
        return row if isinstance(row, dict) and row.get("id") else None

    def fulfil(self, request: dict) -> None:
        video_id = request["video_id"]
        print(f"[worker] fetching {video_id}", flush=True)
        workspace = tempfile.mkdtemp(prefix="musichub-worker-")
        try:
            audio, info = download_audio(workspace, video_id)
            found = describe(info, video_id)
            title = (request.get("title") or "").strip() or found["title"]
            artist = (request.get("artist") or "").strip() or found["author"]
            thumbnail = request.get("thumbnail") or found["thumbnail"]
            duration = int(request.get("duration") or 0) or found["duration"]
            data = audio.read_bytes()

            used = int(self.api("POST", "/rest/v1/rpc/library_bytes", {}) or 0)
            if used + len(data) > STORAGE_QUOTA_BYTES:
                raise Refused(507, "The shared library is full — its 1 GB limit is reached.")

            song_id = self.upload(data, title, artist, thumbnail, duration)
            self.api(
                "PATCH",
                f"/rest/v1/download_requests?id=eq.{urllib.parse.quote(request['id'])}",
                {"status": "done", "song_id": song_id, "title": title, "artist": artist},
            )
            with self.lock:
                self.completed += 1
            self.note(None)
            print(f"[worker] added {title}", flush=True)
        except Exception as err:  # noqa: BLE001
            detail = err.detail if isinstance(err, Refused) else f"{type(err).__name__}: {err}"
            print(f"[worker] {video_id} failed: {detail}", flush=True)
            with self.lock:
                self.failed += 1
            # Reported on the request rather than only logged: the person who
            # asked for it is watching this row, not this terminal.
            try:
                self.api(
                    "PATCH",
                    f"/rest/v1/download_requests?id=eq.{urllib.parse.quote(request['id'])}",
                    {"status": "failed", "error": str(detail)[:300]},
                )
            except Exception:  # noqa: BLE001
                # The stale-claim reclaim in the database covers this.
                pass
            self.note(str(detail))
        finally:
            shutil.rmtree(workspace, ignore_errors=True)

    def upload(self, data: bytes, title: str, artist: str, thumbnail, duration: int) -> str:
        """Put the audio in the bucket and file the song. Returns the song id."""
        assert self.config is not None
        import uuid

        song_id = str(uuid.uuid4())
        # Insert policies file everything under the uploader's own id, so it
        # stays obvious who added what.
        path = f"{self.user_id}/{song_id}.m4a"

        http_json(
            "POST",
            f"{self.config['supabase_url']}/storage/v1/object/{urllib.parse.quote(f'songs/{path}')}",
            {
                "apikey": self.config["anon_key"],
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "audio/mp4",
            },
            raw=data,
        )

        try:
            self.api("POST", "/rest/v1/songs", {
                "id": song_id,
                "owner_id": self.user_id,
                "title": title,
                "artist": artist,
                "album": "YouTube",
                "duration": duration,
                "storage_path": path,
                "cover_url": thumbnail,
                "size_bytes": len(data),
            })
        except Exception:
            # An audio object with no song row is invisible and still counts
            # against the 1 GB, so it does not get to stay.
            try:
                http_json(
                    "DELETE",
                    f"{self.config['supabase_url']}/storage/v1/object/{urllib.parse.quote(f'songs/{path}')}",
                    {"apikey": self.config["anon_key"], "Authorization": f"Bearer {self.access_token}"},
                )
            except Exception:  # noqa: BLE001
                pass
            raise
        return song_id


WORKER = Worker()


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
                "worker": WORKER.status(),
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

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path).path.rstrip("/") or "/"
        if not self.authorised():
            return
        try:
            if route == "/link":
                WORKER.configure(self.read_json())
                # Sign in before answering, so a wrong password is an error the
                # app can show rather than something discovered minutes later.
                WORKER.ensure_session()
                WORKER.wake.set()
                self.send_json(200, {"ok": True, "worker": WORKER.status()})
            elif route == "/unlink":
                WORKER.forget()
                self.send_json(200, {"ok": True, "worker": WORKER.status()})
            else:
                self.send_json(404, {"detail": "No such endpoint."})
        except Refused as refused:
            self.send_json(refused.status, {"detail": refused.detail})
        except SupabaseError as err:
            WORKER.forget()
            self.send_json(
                400,
                {"detail": "Supabase refused the worker account: " + err.body[:200]},
            )
        except Exception as err:  # noqa: BLE001
            self.send_json(500, {"detail": f"{type(err).__name__}: {err}"})

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length or length > 64_000:
            raise Refused(400, "Expected a small JSON body.")
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            raise Refused(400, "That was not JSON.") from None

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
        self.send_json(200, describe(found, video_id))

    def handle_download(self, query) -> None:
        video_id = self.video_id(query)
        workspace = tempfile.mkdtemp(prefix="musichub-")
        try:
            audio, _info = download_audio(workspace, video_id)
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
    WORKER.start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Music Hub companion listening on http://{HOST}:{PORT}")
    print("Point Settings → YouTube companion at that address.")
    if WORKER.config:
        print(f"Unattended worker linked as {WORKER.config['email']}.")
    else:
        print("Not working unattended yet — turn that on in Settings once connected.")
    print("Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
