import { Component, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { AuthService } from '../../../shared/services/auth.service';
import { LibraryService } from '../../../shared/services/library.service';
import { YoutubeService, YoutubeResult } from '../../../shared/services/youtube.service';
import { CompanionService } from '../../../shared/services/companion.service';
import { readTags } from '../../../shared/services/tags';
import {
  HIGH_BITRATE_BPS,
  bitrateOf,
  formatBitrate,
  formatBytes,
  savingFrom,
} from '../../../shared/services/storage-report';

interface PendingSong {
  file: File;
  title: string;
  artist: string;
  album: string;
  // Cover art lifted out of the file's own tags, kept aside until it is saved.
  picture?: Blob;
  duration?: number;
  taggedTitle: boolean; // the file said so, rather than the filename guessing
  // Title of a song already in the library that this looks like a second copy
  // of. A warning only — adding it anyway is allowed.
  duplicateOf?: string;
}

// YouTube search talks to YouTube's internal API directly. On the phone
// CapacitorHttp makes those requests natively (no CORS); a browser blocks
// them, so the section is offered read-only there instead of hanging.
const YT_BROWSER_HINT =
  'YouTube search only works in the installed Android app. Here in the browser, add songs from your device or a direct audio URL below.';

// Safety net: the YouTube client can hang instead of failing, and the UI must
// never sit on a spinner forever.
const YT_TIMEOUT_MS = 15000;

@Component({
  selector: 'app-add-music',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add-music.html',
  styleUrl: './add-music.scss',
})
export class AddMusicComponent implements OnDestroy {
  pending = signal<PendingSong[]>([]);

  // What these files would cost the shared 1 GB if uploaded as they are, and
  // what compressing first would save. Shown before the upload rather than in
  // a storage report afterwards, which is when it can still be acted on.
  heavyPending = computed(() =>
    this.pending()
      .map(item => {
        const song = { duration: item.duration ?? 0, sizeBytes: item.file.size } as never;
        return { item, bitrate: bitrateOf(song), saving: savingFrom(song) };
      })
      .filter(entry => entry.bitrate > HIGH_BITRATE_BPS && entry.saving > 0)
  );

  pendingSaving = computed(() => this.heavyPending().reduce((total, e) => total + e.saving, 0));

  bytes = formatBytes;
  bitrate = formatBitrate;
  saving = signal(false);
  reading = signal(false);
  savedMessage = signal('');

  // YouTube search / download
  ytQuery = '';
  ytResults = signal<YoutubeResult[]>([]);
  ytSearching = signal(false);
  ytDownloading = signal<string | null>(null);
  ytError = signal('');
  // False in the browser preview, true in the installed app.
  // Search works natively inside the Android shell, and through the companion
  // anywhere. Without either there is nothing to search with.
  ytAvailable = computed(() => Capacitor.isNativePlatform() || this.companion.configured());

  remoteUrl = '';
  remoteTitle = '';
  remoteArtist = '';
  remoteError = signal('');

  // Cloud upload is the point of having an account, so it defaults to on
  // whenever there is a connection.
  uploadToCloud = signal(navigator.onLine);

  constructor(
    public library: LibraryService,
    public auth: AuthService,
    private youtube: YoutubeService,
    public companion: CompanionService
  ) {}

  async ytSearch(): Promise<void> {
    const query = this.ytQuery.trim();
    if (!query || this.ytSearching()) return;
    if (!this.ytAvailable()) {
      this.ytError.set(YT_BROWSER_HINT);
      return;
    }
    this.ytError.set('');
    this.ytSearching.set(true);
    try {
      const videoId = this.youtube.parseVideoId(query);
      // A link resolves to that one video; anything else is a search. Both go
      // through the companion where there is one, since it works in a browser
      // and the in-app client only works inside the Android shell.
      if (videoId) {
        const lookup = this.companion.configured()
          ? this.companion.info(videoId)
          : this.youtube.getResult(videoId);
        this.ytResults.set([await this.withTimeout(lookup)]);
      } else {
        const search = this.companion.configured()
          ? this.companion.search(query)
          : this.youtube.search(query);
        this.ytResults.set(await this.withTimeout(search));
      }
      if (this.ytResults().length === 0) this.ytError.set('No results found.');
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      this.ytError.set(
        message === 'yt-timeout'
          ? 'YouTube did not answer in time. Try again, or add the song from your device below.'
          : this.companion.configured()
            ? message
            : 'YouTube search failed. It only works in the installed app, not in the browser preview.'
      );
    } finally {
      // Always clears the spinner, including on timeout.
      this.ytSearching.set(false);
    }
  }

  // Rejects with 'yt-timeout' when YouTube neither answers nor errors.
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('yt-timeout')), YT_TIMEOUT_MS);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  async ytDownload(result: YoutubeResult): Promise<void> {
    if (this.ytDownloading()) return;
    this.ytError.set('');
    this.ytDownloading.set(result.id);
    try {
      // The companion is the only thing that reliably gets audio out of
      // YouTube now, so it goes first wherever it is set up.
      const file = this.companion.configured()
        ? await this.companion.downloadAudio(result.id)
        : await this.youtube.downloadAudio(result.id);
      await this.library.addLocalSong(file, {
        title: result.title,
        artist: result.author,
        album: 'YouTube',
        coverUrl: result.thumbnail,
        duration: result.duration,
      });
      this.savedMessage.set(`"${result.title}" added to your library ✔`);
    } catch (err: any) {
      console.error('ytDownload error', err);
      const msg = String(err?.message ?? err);
      this.ytError.set(
        msg.includes('decipher') || msg.includes('clients failed')
          ? 'YouTube is blocking direct downloads from the app (bot protection). Set up the companion in Settings, or add songs from your device or a direct audio URL.'
          : `Download failed: ${msg}`
      );
    }
    this.ytDownloading.set(null);
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';

    // Show the filename guess straight away — reading tags off a dozen files
    // takes a moment, and an empty list in the meantime looks like nothing
    // happened.
    const guesses = files.map(file => ({ file, ...this.guessFromName(file) }));
    this.pending.update(list => [...list, ...guesses]);
    for (const guess of guesses) this.flagDuplicate(guess.file);

    this.reading.set(true);
    for (const guess of guesses) {
      const tags = await readTags(guess.file);
      if (!tags.title && !tags.artist && !tags.album && !tags.picture && !tags.duration) continue;
      // What the file says about itself beats a filename split on " - ".
      this.pending.update(list =>
        list.map(item =>
          item.file === guess.file
            ? {
                ...item,
                title: tags.title || item.title,
                artist: tags.artist || item.artist,
                album: tags.album || item.album,
                picture: tags.picture,
                duration: tags.duration,
                taggedTitle: !!tags.title,
              }
            : item
        )
      );
      this.flagDuplicate(guess.file);
    }
    this.reading.set(false);
  }

  // Flags a pending song that looks like one already in the library. Re-run
  // after tags land, since they usually correct the title the filename guessed.
  private flagDuplicate(file: File): void {
    this.pending.update(list =>
      list.map(item => {
        if (item.file !== file) return item;
        const match = this.library.findDuplicate(item.title, item.artist);
        return { ...item, duplicateOf: match ? `${match.title} — ${match.artist}` : undefined };
      })
    );
  }

  // "Artist - Title.mp3" is the best a filename can offer, and it is what the
  // untagged files fall back to.
  private guessFromName(file: File): Omit<PendingSong, 'file'> {
    const base = file.name.replace(/\.[^.]+$/, '');
    const parts = base.split(' - ');
    return {
      title: parts.length > 1 ? parts.slice(1).join(' - ').trim() : base,
      artist: parts.length > 1 ? parts[0].trim() : '',
      album: '',
      taggedTitle: false,
    };
  }

  // Object URLs for the artwork previews, one per file, released when the
  // file leaves the list or the page goes away.
  private previews = new Map<File, string>();

  previewFor(item: PendingSong): string | null {
    if (!item.picture) return null;
    let url = this.previews.get(item.file);
    if (!url) {
      url = URL.createObjectURL(item.picture);
      this.previews.set(item.file, url);
    }
    return url;
  }

  private releasePreview(file: File): void {
    const url = this.previews.get(file);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.previews.delete(file);
  }

  ngOnDestroy(): void {
    for (const url of this.previews.values()) URL.revokeObjectURL(url);
    this.previews.clear();
  }

  removePending(index: number): void {
    const item = this.pending()[index];
    if (item) this.releasePreview(item.file);
    this.pending.update(list => list.filter((_, i) => i !== index));
  }

  async saveAll(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    const items = this.pending();
    const toCloud = this.uploadToCloud() && navigator.onLine && this.auth.isAdmin();
    const added: string[] = [];
    for (const item of items) {
      const song = await this.library.addLocalSong(
        item.file,
        {
          title: item.title,
          artist: item.artist,
          album: item.album,
          picture: item.picture,
          // From the tags when they had it, which saves decoding the file
          // again just to measure it.
          duration: item.duration,
        },
        toCloud
      );
      added.push(song.id);
    }
    for (const item of items) this.releasePreview(item.file);
    this.pending.set([]);
    this.saving.set(false);

    // Look up artwork for whatever came in without any. Deliberately not
    // awaited: it is throttled to one request every few seconds, and the songs
    // are already in the library — the covers just appear as they arrive.
    void this.library.findMissingArtwork(added);

    // Report what actually happened, not what was intended: an upload can
    // fail and leave the song on this device only.
    const plural = items.length === 1 ? '' : 's';
    if (!toCloud) {
      this.savedMessage.set(`${items.length} song${plural} added to this device ✔`);
      return;
    }
    const uploaded = this.library
      .songs()
      .filter(s => added.includes(s.id) && s.syncState === 'synced').length;
    this.savedMessage.set(
      uploaded === items.length
        ? `${items.length} song${plural} added and uploaded to the cloud ✔`
        : `${items.length} song${plural} added to this device — ${items.length - uploaded} could not be uploaded, tap ↑ in your library to retry.`
    );
  }

  async addRemote(): Promise<void> {
    const url = this.remoteUrl.trim();
    this.remoteError.set('');
    if (!url) return;

    // A YouTube page link is not an audio file: it would be stored as a song
    // that can never play. Say so instead of failing later at playback.
    if (this.youtube.parseVideoId(url)) {
      this.remoteError.set(
        'That is a YouTube page link, not an audio file. YouTube downloads are blocked, so add the song as a file from your device instead.'
      );
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.remoteError.set('That does not look like a valid link.');
      return;
    }
    if (parsed.protocol !== 'https:') {
      // A plain http:// stream is blocked as mixed content on the deployed
      // HTTPS site and in the installed app, so it could never play.
      this.remoteError.set(
        'The link must be https:// — plain http links are blocked on the installed app.'
      );
      return;
    }

    await this.library.addRemoteSong(url, {
      title: this.remoteTitle.trim(),
      artist: this.remoteArtist.trim(),
      album: '',
    });
    this.remoteUrl = this.remoteTitle = this.remoteArtist = '';
    this.savedMessage.set('Song added from URL ✔');
  }
}
