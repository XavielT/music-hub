# iOS boot crash — the bisect (resolved)

**Symptom.** A first-time visitor opening `https://music-hub-xaviel.vercel.app/`
in Safari on an iPhone got WebKit's *"A problem repeatedly occurred"* after a
few seconds — in a tab and as a freshly added home-screen app, on two different
phones. An already-signed-in install kept working.

**Resolved.** Root cause `e93fcea`; fixed in `2e14e1c`.

## How it was measured

The oracle turned out not to need a phone. Playwright's WebKit on Linux
reproduces the fault exactly, because the fault is not iOS-specific — iOS is
only the first platform whose memory ceiling is low enough to turn it into a
crash.

```
npm run build
npm run serve:dist                    # dist, with vercel.json's real headers
node tools/ios-smoke.mjs --browser webkit
```

What the probe watches is the RSS of WebKit's `WPEWebProcess`, sampled once a
second from the OS. A healthy boot is flat. The crash shows up as unbounded
growth: ~230 MB/s, at 150% CPU, never collecting. On a laptop that just eats
RAM (16 GB in the first minute); on an iPhone, where the WebContent process is
killed at a few hundred MB, it is dead in about four seconds — which is exactly
what Xaviel saw.

## The table

Every row is the same measurement: RSS growth of the WebContent process over
6 s on `/auth`, signed out, against a production build served with the
production headers.

| # | Build | What differs | Growth | Verdict |
|---|-------|--------------|--------|---------|
| — | static file | control, no app JS | 0.0 MB/s | clean |
| P0 | `f98af23` (main) | as deployed | 230.2 MB/s | **crashes** |
| P1 | `f98af23` | App does not inject `SyncService` or `UpdateService` | −0.0 MB/s | clean |
| P2 | `f98af23` | injects `UpdateService` only | −0.5 MB/s | clean |
| P3 | `f98af23` | injects `SyncService` only | 230.4 MB/s | **crashes** |
| P4 | `f98af23` | `SyncService` injected, constructor body emptied | −0.5 MB/s | clean |
| P5 | `f98af23` | constructor body restored to the auth `effect()` alone | 236.1 MB/s | **crashes** |
| P6 | `f98af23` + fix | `untracked()` in the effect, idempotent `deactivate()` | −0.1 MB/s | clean |

Then the same measurement walked back through history, to find where it
started:

| Commit | Subject | Growth | Verdict |
|--------|---------|--------|---------|
| `f98af23` | perf: load each dictionary as its own chunk | 230.2 MB/s | crashes |
| `ca1a61e` | chore: release 0.11.0 | 240.4 MB/s | crashes |
| `c500584` | chore: release 0.10.1 | 234.9 MB/s | crashes |
| `8d4b4a8` | feat: an admin panel for users, invites and the library's settings | 221.4 MB/s | crashes |
| `e93fcea` | **feat: read tags and cover art out of the files themselves** | 310.2 MB/s | **first bad** |
| `04ac7e1` | docs: never reuse a version number after deleting a release | −0.4 MB/s | clean |
| `fa99498` | build: release signing config for Android | −0.4 MB/s | clean |

## What it was

`SyncService` turns the account over from an `effect()` on `auth.user()`. An
effect re-runs when any signal it *read* changes, and it tracks reads made
anywhere it reaches — not only the one it meant to watch.

`LibraryService.deactivate()` read `_coverUrls` and then set it to a fresh
`{}`, which is never `Object.is`-equal to the last one. So the effect woke
itself, cleared again, woke itself again, for ever.

`fa3ddd4` put `closeAccount()` in that effect; `e93fcea` added the tracked read
inside it, completing the cycle. The two were seven commits apart, which is why
nothing looked suspicious in the recent history.

## Why the deploy looked guilty, and was not

Signed in, the cycle breaks after one extra pass — the second run hits
`user.id === this.lastSyncedUserId` and returns before reaching
`closeAccount()`. Signed out there is no such guard, so `closeAccount()` runs
on every pass.

Measured on the unfixed `f98af23`, same build, same browser:

| Session | Growth | Outcome |
|---------|--------|---------|
| signed out | 230.2 MB/s | dies |
| signed in (seeded session) | 3.0 MB/s | survives |

That is the whole of the mystery. Xaviel's installed PWA was signed in and
therefore never on the broken path; every fresh visitor was. The bug had been
shipping since `e93fcea` and simply had not been *looked at* from a signed-out
phone — the one state none of the people testing it were ever in.

## Regression cover

- `src/shared/services/sync-signed-out.spec.ts` — builds `SyncService` with no
  user and a library whose `deactivate()` has the old read-then-write shape,
  and asserts the effect runs once. Without the `untracked()` boundary it fails
  with `Expected 21 to be 1`.
- `src/shared/services/library.service.spec.ts` — `deactivate()` twice over
  leaves the signals' identities alone.
- `npm run smoke:ios` — WebKit and Chromium, `/`, `/auth`, `/?safe=1`,
  `/?debug=1`: no crash, no pageerror, no CSP refusal, and the main thread
  answers every second throughout.
