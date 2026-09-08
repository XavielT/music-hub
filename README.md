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
- **Tags and cover art are read from the files themselves** — title, artist, album
  and embedded artwork, for MP3 (ID3v2), M4A/MP4 and FLAC.
- Playlists, artists and albums views, search, recently added.
- Spotify-like player: mini player + full screen player with seek, next/prev,
  **shuffle**, **repeat (queue / one)**, **volume** (desktop), and a **queue
  screen** you can reorder, remove from and jump around.
- **Resumes where you left off** — same song, same position, paused.
- **Shuffle** buttons on the songs list, each artist/album and every playlist.
- Lock-screen / notification controls via MediaSession.
- Add songs from a direct audio URL (streamed).
- **In-app updates**: the web app reloads onto a new build, the Android app
  installs the latest GitHub release itself. See *Updating the app* below.

## Dev
```bash
npm install
npm start          # web preview at localhost:4200
npm test           # unit tests, headless
```

`ng test` needs a Chrome to drive. If there is no system Chrome, point it at
the one Puppeteer already downloaded:

```bash
export CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1)
npx ng test --watch=false --browsers=ChromeHeadless
```

The suite is deliberately small — it covers the IndexedDB upgrade, which runs
against libraries nobody can get back if it goes wrong.

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

## Shared library: admins upload, everyone listens

The cloud library is **shared and has one 1 GB budget**, so only admins add to it.
Members read, stream and download everything in it, and can still add songs on
their own device — those simply stay local and are never uploaded.

Enforced in the database, not just the UI: `songs` and the `songs`/`covers` buckets
are readable by any signed-in member but writable only where `public.is_admin()`.
Playlists stay per-person, so everyone curates their own from the shared songs.

To make someone an admin:

```sql
update public.profiles set is_admin = true where id = '<their auth user id>';
```

### Shared playlists

Playlists start private. **Share** on a playlist's page opens it to everyone
signed in: they see it under *Shared with you* in the playlists tab, and they
can add songs to it and take songs out. Renaming, unsharing and deleting stay
with whoever made it.

That split is enforced by RLS, not by hiding buttons — `playlists` reads as
`owner_id = auth.uid() or is_shared` while update and delete stay owner-only,
and `playlist_songs` follows whatever its playlist allows. Verified against the
live policies by impersonating a second member: before sharing they cannot see
the playlist or add to it; after sharing they can add songs but renaming and
deleting are both refused.

Two people editing the same shared playlist **while offline** is last-writer-
wins: each device pushes the membership it has, whole. Online edits are
per-song and do not collide.

Names come from `profiles`, and the one shown is stored next to the playlist
rather than looked up, so a shared playlist is still credited when the app
opens with no connection.

### Compressing before upload

At 320 kbps a song is ~7 MB, so 1 GB is only ~140 songs. Re-encoding to AAC 160k
roughly halves that to ~3.6 MB (~280 songs):

```bash
./tools/compress-for-cloud.sh ~/Music/originals ~/Music/for-cloud
# then add the .m4a files through the app's ＋ tab
BITRATE=128k ./tools/compress-for-cloud.sh ...   # ~2.9 MB/song if you want more room
```

Needs `ffmpeg`. Originals are never modified — keep them as your masters. Tags and
embedded cover art are carried over, nested folders are preserved, and re-running
skips anything already converted.

**This is a re-encode, not lossless.** An MP3 is already lossy, so nothing can
shrink it without a second lossy pass — true lossless (FLAC) would make a 7 MB MP3
into roughly 25 MB. AAC 160k is transparent for phone and earbud listening and
plays natively everywhere, iOS included. Only convert from your best available
source; never re-run it on an already-converted file.

Storage is not the only free-tier limit — **egress is 5 GB/month**. Smaller files
help, and songs downloaded for offline stream once instead of on every play.

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

## Live sync

Devices used to find out about each other's changes at the next sign-in or on
the ⟳ button. Now Postgres tells them: `songs`, `playlists` and `playlist_songs`
are in the `supabase_realtime` publication, and every signed-in device holds one
channel subscribed to all three.

**An event is treated as a signal, not as data.** `RealtimeService` never
applies a payload — it debounces changes for 750 ms and then asks `SyncService`
to reconcile, which is the merge that already knows to keep an offline edit, to
keep a download, and to leave a song that only exists on this device alone. A
second merge path written against single-row events would be a second place for
all of that to go wrong, and the pull it replaces is three small selects against
a library capped at 1 GB.

That choice also settles the awkward part of Realtime's security model. RLS
decides who sees an INSERT or an UPDATE, but a DELETE carries only the primary
key, so Realtime cannot evaluate a policy against it and sends it to everyone.
As data that would be a leak; as a signal it is a sync that returns the same
rows as before.

The debounce earns its keep on a bulk upload: adding an album is two writes per
song, and they collapse into one reconciliation instead of forty. A change that
lands *during* a sync is not lost either — that sync may have read its rows
before the change existed, so another pass is queued behind it.

Reconnects are handled in three places, because a phone gives you all three:
the channel retries with a backoff when the join fails, `visibilitychange`
re-checks it when the app comes back to the foreground, and a re-join always
pulls once, since anything that changed while the socket was down was never
announced. Settings shows what the channel is doing under the storage bar.

**Rewriting a playlist is one call now** (audit B5). Pushing a playlist that was
edited offline used to be a delete followed by an insert from the client, so a
connection dropped between them left the playlist empty in the cloud — and the
next sync handed that empty list to every device. It goes through the
`replace_playlist_songs` function instead, whose body is a single transaction.
It is `security invoker`, so RLS still decides: the caller has to own the
playlist for either half to be allowed.

## The player

The queue is held in the order it will actually play, so what the queue screen
shows and what every index in `PlayerService` refers to are the same list. The
order *before* shuffling is kept alongside it, which is what makes turning
shuffle off restore the original sequence exactly — reconciled both ways, so
songs queued while shuffled survive the toggle and songs removed while shuffled
do not come back.

`play(song, queue)` is unchanged, and every existing caller still works.

**Unplayable songs are stepped over, not stopped on** (audit B4). A cloud song
with no local copy and no connection used to end playback with a toast; now the
queue moves to the next song that can play. Bounded by the queue length, so an
entirely unplayable queue ends rather than spinning — and says so once, not once
per song.

**Resume** is stored in IndexedDB (`player` store, database version 3): the
queue's song ids, the index, the position, and the shuffle/repeat state, written
on every song change and at most every five seconds during playback. It is
restored after `LibraryService.activate()` — ids that no longer exist are
dropped rather than restoring a broken queue — and always **paused**. Browsers
block autoplay without a gesture, and starting music by itself when an app opens
is rude where they don't.

Shuffle, repeat and volume live in `localStorage` rather than the database:
they are a listening habit rather than session state, and they are wanted before
any database is open.

The volume slider is hidden inside Capacitor, where the hardware buttons rule,
and on iOS Safari, which ignores assignments to `HTMLMediaElement.volume` — a
slider there is a dead control.

## Settings

The gear in the top right of every signed-in page opens `/settings`, which holds
everything about the app and the account so the library can be about music: the
account and its admin badge, a password change (an emailed link — there is no
new-password form to get wrong here), sign out, cloud storage and sync, the
cover-art lookup, and updates.

**Appearance** recolours the app from a single accent. Everything visual keys
off `--Hub`, so a theme is that value plus three derived ones: a translucent
version, a deeper shade, and `--on-Hub` — the colour of text drawn *on* the
accent, which has to flip to white for a dark pick or every button reads black
on black. That last one is chosen by comparing contrast ratios rather than a
luminance threshold: at a threshold of 0.42 four of the eight presets would have
taken white text at 3.1:1 where black gives them 6.6:1.

`ThemeService` paints those on `document.documentElement` and is constructed by
an app initializer — nothing else would construct it until the settings page was
opened, so the app would start in the default colour every launch and only
correct itself once you went looking.

**Clear downloads** drops the local audio of every song that can be fetched
again, which is only songs that are `synced` and have a `storage_path`. Metadata,
playlists and cover art all stay, so the library looks unchanged and the songs
simply stream until they are downloaded again. Local-only songs are counted
separately and never touched: their local audio *is* the song.

Two more things are worth knowing:

- **The recovery link's origin differs by platform.** Inside the Capacitor
  WebView `location.origin` is `https://localhost`, which is not somewhere an
  emailed link can go, so the native app points recovery links at
  `environment.siteUrl` instead. The web keeps using its own origin, so
  localhost still works in development.
- **Android revokes "install unknown apps".** It is granted per app and taken
  back again for apps Android decides are unused, so an update that installed
  itself last month can stop being able to. Settings reads the permission fresh
  every time it opens and offers to fix it, rather than the user only finding
  out in the middle of an update.

## Updating the app

Both builds update themselves from inside the app — there is a **Music Hub
&lt;version&gt;** line with a **Check for updates** button at the bottom of the
library page, and a banner appears on its own when something newer shows up.

- **Web / installed PWA**: the service worker downloads a new build in the
  background, so the button only has to activate it and reload. One click.
- **Android**: there is no store to do this, so the app asks the GitHub
  releases API whether a tag newer than its own `versionName` exists,
  downloads the `music-hub.apk` attached to it and opens the system package
  installer. Android 8+ asks once for permission to *install unknown apps*
  (the app sends you straight to that settings screen), then it is: **Update →
  Install**. Android refuses any APK not signed with the same key as the
  installed one, so the release keystore below is what makes this work at all.

The check runs at launch and never blocks anything — no network, no update, no
complaint. The releases API allows 60 unauthenticated calls per hour per IP,
which one check per launch stays well inside.

### Cutting a release

The updater compares the running version against the latest release tag, so
`package.json`, `src/version.ts` and the Android `versionName`/`versionCode`
have to agree. One script keeps them in step:

```bash
./tools/set-version.sh 0.3.0        # bumps all three, versionCode +1
git commit -am "chore: release 0.3.0" && git tag v0.3.0 && git push --tags
npm run build && npx cap sync android
(cd android && ./gradlew assembleRelease)
```

Then draft the GitHub release for `v0.3.0` and attach the APK **renamed to
`music-hub.apk`** — that exact filename is what the updater looks for, and it
is also what the portfolio's `releases/latest/download/music-hub.apk` button
points at. The release body becomes the notes shown in the app, so write it
for the people who will read it there.

Android will not install an APK whose `versionCode` is not higher than the
installed one, which is why the script bumps it rather than leaving it to
memory. A release with no `music-hub.apk` attached makes the app say so,
rather than silently doing nothing.

**Never reuse a version number, even one whose release was deleted.** Deleting
a GitHub release does not reach the phones that already installed it, and they
still hold that `versionCode` — a rebuilt "same" version would carry the same
number and Android would refuse it, with nothing in the UI explaining why. Skip
the number and move on: `main` staying ahead of the newest tag is the harmless
half of this, and `set-version.sh` keeps counting up from wherever it is.

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
Capacitor 8 needs **exactly JDK 21** here, and `ANDROID_HOME` must point at the
Android SDK:

```bash
sudo apt install openjdk-21-jdk-headless
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"
```

Both neighbours fail, in opposite directions:

- **JDK 17** (the system default) → `invalid source release: 21` compiling
  `capacitor-android`, which targets 21.
- **Android Studio's bundled JBR** is JDK **25** → `Unsupported class file major
  version 69`. Gradle 8.14 cannot *run* on 25. This one is a trap: it appears to
  work while a Gradle daemon started by Android Studio is still warm, then fails
  on the next cold build. Don't use it.

If a build fails right after changing JDKs, run `./gradlew --stop` first — a stale
daemon on the old JVM will otherwise be reused.

To publish it for others, follow *Cutting a release* above: it covers the version
bump the in-app updater depends on as well as the GitHub release itself.

## Signed release builds

Debug APKs use the machine-local debug keystore, so a build from a different
machine cannot upgrade an existing install — Android rejects the signature change.
A release keystore fixes that permanently: keep the same key and every future
build upgrades cleanly.

> ⚠️ **Switching a phone from a debug build to a release build wipes the app's
> data.** The signatures differ, so Android refuses the upgrade and the old app has
> to be uninstalled first — which takes IndexedDB with it: downloaded audio, and any
> song still marked *local-only* that was never uploaded. Before that one-time
> switch, open the library and upload everything pending (the ↑ action), so the
> cloud holds it all and the new install just syncs it back down. After the switch
> it never happens again, as long as the same keystore is used.

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
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64   # same JDK 21 rule as above
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

## Cover art and tags

Adding a file from the device reads what it already knows about itself — title,
artist, album, duration and the embedded picture — instead of guessing from the
filename. Parsing is `music-metadata`, imported dynamically: it costs **0.1 kB
of transfer on the initial bundle** and splits itself per format, so opening the
add page pulls only the parser for the file at hand. That covers everything the
file picker accepts, Ogg/Opus and WAV included. Anything it cannot read falls
back to splitting the filename on `" - "`, exactly as before — a parse failure
is logged and never blocks adding the song.

Cover art is scaled to **512 px on its longest edge and re-encoded as JPEG**
before it is stored. Embedded art is routinely 1500×1500 and over a megabyte,
which is a real cost held on the device, uploaded to a shared 1 GB bucket and
fetched again on every other device. A cover that would not get smaller is left
as it is.

Artwork is kept out of the song record — a record is read on every library load,
and a few hundred kB of image in each one would make that crawl. It lives in an
IndexedDB `covers` store keyed by song id (database version 2), and, for cloud
songs, in the `covers` bucket with the same policies as `songs`: members read,
admins write to their own folder. `songs.cover_path` says where.

Covers are pulled down lazily, when a song is actually on screen, rather than
all at once during sync — a library of 200 songs would otherwise mean 200
requests before anything renders. Downloading a song for offline takes its
artwork along with it.

### When the file has no artwork

Most of this library came off YouTube, where the audio carries no picture at
all. For those, Music Hub asks the **iTunes Search API** — free, no key, and it
sends `access-control-allow-origin: *`, so it works on the web as well as in the
app. Artwork is stored exactly like an embedded cover, and a song already in the
shared library gets its new cover uploaded so everyone else sees it too.

Newly added songs are looked up automatically in the background. For songs that
were already there, the library page offers **Find artwork** — opt-in, because
it is one request per song to an outside service.

**The matching is deliberately strict, and refusing is the safe answer.** iTunes
returns something for every query, so taking the first hit is how a library ends
up decorated with the wrong albums — and a wrong cover looks deliberate in a way
a letter tile does not. So:

- the query drops uploader noise (`(Video Oficial)`, `[Official Video]`) and the
  artist prefix that rips repeat in the title
- results are scored, preferring an exact title and artist — its first hit for
  "Blinding Lights" is a remix, not the song
- with no artist to confirm against, only a long, distinctive, exactly-matching
  title is accepted: somebody else's `Track01` is not this song's cover

Apple asks for roughly 20 calls a minute, so requests are spaced three seconds
apart. A whole library is minutes, not seconds — that is deliberate. Every song
is marked as looked-up whether or not anything was found, so a second run only
covers what is new.

`connect-src` in `vercel.json` had to grow to allow `itunes.apple.com` and
`*.mzstatic.com` (the artwork host).

### Fixing what a file got wrong

**Edit info** (in a song's ⋮ menu) corrects title, artist and album, and can
replace the cover with any image — scaled the same way tag artwork is. It saves
locally first, because the library on this device is what the user is looking
at, then pushes to the cloud. An edit made offline is marked `dirty` and pushed
on the next sync; until then `applyRow` keeps the local values, so a sync cannot
silently undo what was just typed.

Only an admin can edit a song in the shared library — the row is theirs under
RLS — so the action is offered for local songs to everyone and for shared songs
to admins, rather than failing against a policy.

Adding a file whose title and artist already exist in the library shows a
**duplicate hint** before saving. Case, accents and punctuation are ignored; the
audio is not hashed. It is a warning, not a gate — adding it anyway is allowed.

## Roadmap / TODOs
- **Import from YouTube**: search works inside the Android app (native HTTP bypasses
  CORS), but YouTube blocks the audio download itself via bot protection, so this
  needs a companion server (e.g. yt-dlp behind a small API). Note that downloading
  copyrighted music from YouTube is against YouTube's terms — use it for your own or
  royalty-free content.
