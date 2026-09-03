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
   and add `http://localhost:4200` under Additional Redirect URLs for local dev.

After that, **every push to `main` deploys automatically**. Or from the CLI:

```bash
npx vercel --prod
```

### Why the cache headers matter
Angular hashes `chunk-*`, `main-*`, `polyfills-*` and `styles-*`, so those are served
`immutable` for a year. `index.html`, `ngsw.json` and `ngsw-worker.js` are explicitly
`no-cache` — if those were cached, the service worker could never see a new version
and the app would be frozen on an old build.

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

> Debug APKs are signed with the local debug keystore. If you rebuild on a different
> machine the signature changes and Android refuses to upgrade an existing install —
> generate a proper release keystore before sharing builds widely.

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
