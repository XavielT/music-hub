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

## Bot protection: measured, not guessed

Tested on 2026-09-08 across four datacenter addresses — Render, and three
GitHub Actions runners — with the POT provider confirmed running and Node
confirmed as the JS runtime:

| | From a home connection | From a datacenter |
|---|---|---|
| `/health` | ✅ | ✅ |
| `/search` | ✅ | ✅ |
| `/info`, `/download` | ✅ | ❌ "Sign in to confirm you're not a bot" |

Search survives because it never touches the player; extraction does, and that
is what gets refused. **A proof-of-origin token is not sufficient on its own** —
the provider's own README says as much, and this is what that looks like in
practice.

So a hosted companion needs cookies. There is no free, always-on, no-account
way around this: YouTube is specifically preventing it.

### Cookies on Render

1. Sign in to YouTube in a browser — **use a throwaway Google account.** These
   cookies are that account's session, and Google does suspend accounts it
   decides are automating. Do not use the account your email is on.
2. Export `cookies.txt` for youtube.com with a Netscape-format cookie
   extension.
3. Render → the service → **Environment → Secret Files → Add file**, name it
   `cookies.txt`, paste the contents. `YTDLP_COOKIES_FILE` already points at
   `/etc/secrets/cookies.txt`.
4. The service reports it: *Settings → YouTube companion → Save and test* says
   "with cookies" when they are loaded.

They expire — weeks, sometimes months — and the symptom is the bot check
returning. Re-export and replace the file. That is the maintenance cost of
always-on, and it is the honest price.

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

## Where to actually run it

**Render works for everything except the thing it is for.** Deployed there the
service is healthy, CORS is right, auth is right — and every download comes
back "Sign in to confirm you're not a bot", because the request leaves from a
datacenter address. Tried on 2026-09-08; that is not a bug to fix, it is what
the address is.

So the download runs at home:

```bash
./tools/companion-local.sh
```

It sets up the Python environment on first run, starts the service on
`127.0.0.1:8099`, opens a **Cloudflare quick tunnel**, and prints the HTTPS
address and token to paste into *Settings → YouTube companion*. Ctrl-C stops
both halves.

A tunnel rather than a LAN address because the app is served over HTTPS and a
browser refuses to call `http://192.168.x.x` from an HTTPS page — mixed content,
no setting changes it. A *quick* tunnel because a named one needs a domain on
Cloudflare's nameservers, and xautohubrd.com is on Google's.

Two consequences worth knowing:

- **The address changes every run.** Quick tunnels are anonymous and the price
  of no account is no stable name. The token does not change — it is kept in
  `companion/.token` (gitignored) — so it is one field to re-paste, not two.
  `connect-src` allows `https://*.trycloudflare.com` so the CSP does not need
  editing each time.
- **It only works while your machine is on**, which for adding a few songs now
  and then is the honest shape of the thing.

Verified end to end through the tunnel on 2026-09-08: health, search, and a
download that came back the same 2.5 MB / 158 s / 129 kbps m4a as a direct run,
in about 7 seconds.

## The live one

Deployed to Render's free tier on 2026-09-08 as **music-hub-companion**, from
the Blueprint at the repo root:

- `https://music-hub-companion.onrender.com`
- Public-repo deploy rather than a connected GitHub account, so Render was never
  granted access to the repo. The trade is no auto-deploy: after changing
  anything in `companion/`, hit **Manual Deploy** in the dashboard.
- `MUSIC_HUB_TOKEN` was generated by Render — reveal it under the service's
  **Environment** tab.
- Its host is in `connect-src` in `vercel.json`, without which the browser
  blocks it silently.

## Verified

Against a real YouTube video from a residential IP, 2026-09-08:
`/health` and both endpoints answer, a missing or wrong token gets 401, a
malformed id gets 422, a track over the cap gets 413, and the temporary
directory is gone after the response. The downloaded file was a 2.5 MB m4a,
158 s at 129 kbps AAC, matching the source. Nothing here has been run on a
free-tier container yet — see the bot-protection note for why that is the
uncertain part.
