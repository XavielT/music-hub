# Music Hub companion

A small yt-dlp service. The app talks to it to search YouTube and to fetch a
song's audio; everything else stays in the app.

It exists because YouTube stopped serving playable audio URLs to the clients a
browser or a WebView can pretend to be. Search still works inside the Android
shell (native HTTP, no CORS) and not in a browser; the download works in
neither. Both work through this.

> Downloading copyrighted music from YouTube is against YouTube's terms. Use
> this for your own uploads, Creative Commons and public-domain material.

## What it is

Three endpoints, one bearer token:

| | |
|---|---|
| `GET /health` | version and whether it is configured — no token needed |
| `GET /search?q=` | up to 25 results |
| `GET /download?id=` | one video's audio, as an m4a |

It refuses to serve anything without `MUSIC_HUB_TOKEN` set. That is deliberate:
an open yt-dlp endpoint on a public address becomes somebody else's download
farm within a day.

## Run it locally

```bash
cd companion
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
MUSIC_HUB_TOKEN=$(openssl rand -hex 32) .venv/bin/uvicorn app:app --port 8080
```

Needs `ffmpeg` on the path (the Docker image installs it).

## Deploy it

Any host that builds a Dockerfile. **`render.yaml` at the repo root** describes
this service for Render's free tier — it has to live at the root because that is
the only place Render looks for a Blueprint, even though everything it points at
is in here. Fly, Koyeb and Railway take the same image and differ only in where
you type the environment variables.

On Render: *New → Blueprint*, pick the `music-hub` repo, apply. It builds
`companion/Dockerfile`, generates `MUSIC_HUB_TOKEN` for you (reveal it in the
service's Environment tab), and health-checks `/health`.

| Variable | |
|---|---|
| `MUSIC_HUB_TOKEN` | **required.** The blueprint has Render generate one; by hand, `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | comma-separated. Include the deployed app, `http://localhost:4200`, and `https://localhost` for the Android shell |
| `MAX_DURATION_SECONDS` | default 1800 |
| `YTDLP_COOKIES_FILE` | optional, see below |

Then in the app: **Settings → YouTube companion**, paste the address and the
token, and press *Save and test*. Admin only, and it stays on that device — the
token is never synced through the shared library.

**Two things that will bite on a free tier:**

- **The CSP.** `connect-src` in the repo's `vercel.json` is pinned to Supabase,
  so the deployed web app will block the companion until its host is added
  there. The failure is silent in the UI and obvious in the console.
- **Cold starts.** A free container sleeps. The first search after a quiet spell
  can take 30–60 seconds or time out; the second is fine.

## Bot protection, which is the real problem

YouTube treats datacenter IPs as guilty. A request from a free-tier container
often gets *"Sign in to confirm you're not a bot"* — sometimes immediately, and
the service turns that into a 429 saying so rather than a confusing 502.

In descending order of how well they work:

1. **Run it at home.** A residential IP is what YouTube does not block. The same
   container on a desktop, reachable through a free Cloudflare Tunnel, works
   where a cloud host does not.
2. **Give it cookies.** Export `cookies.txt` from a signed-in browser, mount it
   and set `YTDLP_COOKIES_FILE`. This is the usual answer for a datacenter IP
   and it works — but it is real credentials for a real YouTube account, so use
   a throwaway one, treat it as a secret, and expect it to need replacing.
3. **Keep yt-dlp current.** Half of all "it broke" is a version behind YouTube.
   `requirements.txt` pins it on purpose; bump it when downloads start failing.

## Verified

Against a real YouTube video from a residential IP, 2026-09-08:
`/health` and both endpoints answer, a missing or wrong token gets 401, a
malformed id gets 422, a track over the cap gets 413, and the temporary
directory is gone after the response. The downloaded file was a 2.5 MB m4a,
158 s at 129 kbps AAC, matching the source. Nothing here has been run on a
free-tier container yet — see the bot-protection note for why that is the
uncertain part.
