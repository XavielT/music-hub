# Music Hub 🎧

Personal Spotify-style music app. Angular 19 + Capacitor (Android) + an installable
PWA for iPhone and desktop. Your own audio files, synced across devices through
Supabase, and still fully playable offline.

## Features
- **Cloud library**: songs and playlists live in Supabase (Postgres + Storage) and
  follow you to every device you sign in on.
- **Offline first**: IndexedDB keeps metadata and any song you download, so the app
  opens and plays with no network at all.
- Per-song sync state at a glance — `↑` only on this device, `⬇` in the cloud,
  `●` downloaded for offline, `☁` streams from a link.
- Local music library: add audio files from the device (mp3, m4a, mp4, wav, ogg, flac).
- Playlists, artists and albums views, search, recently added.
- Spotify-like player: mini player + full screen player with seek, next/prev and queue.
- Lock-screen / notification controls via MediaSession.
- Add songs from a direct audio URL (streamed).

## Dev
```bash
npm install
npm start          # web preview at localhost:4200
```

The Supabase URL and **anon** key live in `src/environments/`. They are public-safe
(Row Level Security protects the data) and are committed on purpose. The
`service_role` key must never appear in this repo.

## Deploy to Vercel

`vercel.json` already sets the build command, output directory, the SPA fallback and
the cache headers the service worker needs, so the dashboard defaults can be left
alone.

**First deploy (once):**
1. https://vercel.com → **Add New → Project** → import `XavielT/music-hub`.
2. Framework preset: **Other** (`vercel.json` provides everything).
3. **Deploy**. Note the URL, e.g. `music-hub-xaviel.vercel.app`.
4. In Supabase → **Authentication → URL Configuration**, set **Site URL** to that URL
   and add the deploy URL under **Redirect URLs**.

   A globstar entry such as `https://<your-vercel-url>/**` already covers every
   path, including `/auth/reset` — in Supabase's allow list `**` matches any
   sequence of characters, with `.` and `/` as the separators. Supabase still
   recommends listing the exact path in production, so the live config has both:

   ```
   https://music-hub-xaviel.vercel.app/**
   https://music-hub-xaviel.vercel.app/auth/reset
   http://localhost:4200/**
   http://localhost:4200/auth/reset
   ```

   If neither a globstar nor the exact path is listed, the link in the reset email
   silently falls back to the Site URL and the new-password form is never reached.

After that, **every push to `main` deploys automatically**. Or from the CLI:

```bash
npx vercel --prod
```

### Security headers
`vercel.json` also sends `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options`, `Permissions-Policy` and a CSP. Two things the CSP depends on:

- **`style-src` needs `'unsafe-inline'`** — Angular injects component styles as
  `<style>` elements at runtime. Scripts do *not* need it.
- **`inlineCritical` is off** in `angular.json` (production `optimization.styles`).
  With it on, the build emits `<link rel="stylesheet" media="print"
  onload="this.media='all'">` in `index.html`; that inline handler needs
  `script-src 'unsafe-inline'`, and without it the stylesheet stays `media="print"`
  and **the app renders unstyled**. Do not re-enable it without also revisiting the
  CSP. The styles bundle is under 1 kB, so loading it normally costs nothing.

`connect-src` is pinned to the x-core Supabase project, so a new backend host has to
be added there too.

### Why the cache headers matter
Angular hashes `chunk-*`, `main-*`, `polyfills-*` and `styles-*`, so those are served
`immutable` for a year. `index.html`, `ngsw.json` and `ngsw-worker.js` are explicitly
`no-cache` — if those were cached, the service worker could never see a new version
and the app would be frozen on an old build.

## Password reset

"Forgot password?" on `/auth` emails a link that lands on `/auth/reset`. The auth
client uses `flowType: 'implicit'` so the link carries the session in its URL
fragment and works in **any** browser. That matters on phones: under the stronger
PKCE flow the reset is only redeemable in the browser that requested it, so asking
from the installed PWA and opening the link in the mail app's browser fails.

The trade-off is that an implicit link is not bound to a browser, so a leaked one is
usable until it expires or is consumed. **To get PKCE-grade security back**, set up
custom SMTP (Supabase locks email templates behind it), then change the *Reset
password* template link to:

```
{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery
```

`/auth/reset` already prefers that shape and exchanges it with `verifyOtp`, so no
code change is needed — after which `flowType` can go back to `'pkce'`.

Note the free tier allows only **2 auth emails per hour**; a 429 during testing is
that limit, not a bug.

## Invite-only sign-ups

Registration is open in the UI but the database rejects unknown emails: a
`before insert on auth.users` trigger checks `public.allowed_emails`. To let a family
member in, add their address (lowercase) via the Supabase SQL editor:

```sql
insert into public.allowed_emails (email, note)
values ('someone@example.com', 'sister')
on conflict (email) do nothing;
```

`allowed_emails` has RLS on with **no policies** and no grants to `anon`/
`authenticated` on purpose — only the `security definer` trigger reads it, so the
list cannot be enumerated through the API. A blocked sign-up shows
"Sign-ups are invite-only. Ask Xaviel to add your email, then register."

## Install as an app

- **iPhone/iPad**: open the deployed URL in **Safari** → Share → **Add to Home Screen**.
  (Safari only; Chrome on iOS cannot install PWAs.) Note iOS gives PWAs a limited
  IndexedDB budget and may evict it if storage runs low, so treat downloaded songs
  there as a convenience rather than a guarantee.
- **Desktop Chrome/Edge**: an **Install** button appears in the library page, or use
  the install icon in the address bar.
- **Android**: install the APK below for the best experience (no storage limits, and
  the in-app YouTube search works there).

## Build the Android app
```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```
Capacitor 8 requires **JDK 21** (`sudo apt install openjdk-21-jdk`), and
`ANDROID_HOME` must point at the Android SDK.

To publish it for others: GitHub → the `music-hub` repo → **Releases** → *Draft a new
release* → tag e.g. `v0.1.0` → attach the APK renamed to `music-hub.apk` → publish.
The portfolio's download button points at
`releases/latest/download/music-hub.apk`, so future releases update it automatically.

## Signed release builds

Debug APKs use the machine-local debug keystore, so a build from a different
machine cannot upgrade an existing install — Android rejects the signature change.
A release keystore fixes that permanently: keep the same key and every future
build upgrades cleanly.

**One-time setup.** Generate the key (choose your own password; keep it safe — losing
it means never being able to update the app again):

```bash
mkdir -p ~/keystores
keytool -genkeypair -v \
  -keystore ~/keystores/music-hub-release.jks \
  -alias music-hub -keyalg RSA -keysize 4096 -validity 10000
```

Then add these to **`~/.gradle/gradle.properties`** — outside this repo, so the
password is never committed and never shows up in a build log:

```properties
MUSICHUB_STORE_FILE=/home/<you>/keystores/music-hub-release.jks
MUSICHUB_STORE_PASSWORD=<the password you chose>
MUSICHUB_KEY_ALIAS=music-hub
MUSICHUB_KEY_PASSWORD=<the same password, unless you set a separate key password>
```

**Build a signed release:**
```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
# APK at android/app/build/outputs/apk/release/app-release.apk
```

`assembleRelease` fails with an explicit message if those properties are missing,
rather than quietly producing an unsigned APK. `*.jks`, `*.keystore` and
`keystore.properties` are gitignored in both the repo root and `android/`.

**Back the keystore up somewhere you will not lose it** (password manager, encrypted
drive). It is not recoverable, and without it you cannot ship an update that existing
installs will accept.

## iOS
A native iOS build requires a Mac with Xcode (`npx cap add ios && npx cap open ios`).
The PWA above is the supported route without one.

## Roadmap / TODOs
- Shared/family library (the schema already separates `owner_id` so it is additive).
- Cover art from ID3 tags on upload.
- **Import from YouTube**: search works inside the Android app (native HTTP bypasses
  CORS), but YouTube blocks the audio download itself via bot protection, so this
  needs a companion server (e.g. yt-dlp behind a small API). Note that downloading
  copyrighted music from YouTube is against YouTube's terms — use it for your own or
  royalty-free content.
