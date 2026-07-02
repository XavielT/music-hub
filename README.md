# Music Hub 🎧

Personal Spotify-style music app. Angular 19 + Capacitor (Android / iOS). All music lives on the device (IndexedDB) — no subscription, no server needed.

## Features
- Local music library: add audio files from the device, they're stored inside the app and work offline.
- Playlists, artists and albums views, search, recently added.
- Spotify-like player: mini player + full screen player with seek, next/prev and queue.
- Add songs from a direct audio URL (streamed).

## Dev
```bash
npm install
npm start          # web preview at localhost:4200
```

## Build the Android app
```bash
npm run build
npx cap sync android
npx cap open android   # opens Android Studio → Run on device
```
Or build an APK directly: in Android Studio → Build → Build APK, or `cd android && gradlew assembleDebug`.

## iOS
Requires a Mac with Xcode: `npx cap add ios && npx cap open ios`.

## Roadmap / TODOs
- **Supabase sync (free tier)**: upload songs to Supabase Storage + a `songs`/`playlists` table so family members share one library. Integration points are marked with `TODO` in `src/shared/services/library.service.ts`.
- **Import from YouTube**: needs a small companion server (e.g. yt-dlp behind a tiny API) since audio extraction can't run inside the app. Note: downloading copyrighted music from YouTube is against YouTube's terms — use for your own/royalty-free content.
- Real cover art (ID3 tag parsing), background audio plugin, media session controls.
