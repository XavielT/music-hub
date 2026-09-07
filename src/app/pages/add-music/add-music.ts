import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { AuthService } from '../../../shared/services/auth.service';
import { LibraryService } from '../../../shared/services/library.service';
import { YoutubeService, YoutubeResult } from '../../../shared/services/youtube.service';

interface PendingSong {
  file: File;
  title: string;
  artist: string;
  album: string;
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
export class AddMusicComponent {
  pending = signal<PendingSong[]>([]);
  saving = signal(false);
  savedMessage = signal('');

  // YouTube search / download
  ytQuery = '';
  ytResults = signal<YoutubeResult[]>([]);
  ytSearching = signal(false);
  ytDownloading = signal<string | null>(null);
  ytError = signal('');
  // False in the browser preview, true in the installed app.
  readonly ytAvailable = Capacitor.isNativePlatform();

  remoteUrl = '';
  remoteTitle = '';
  remoteArtist = '';
  remoteError = signal('');

  // Cloud upload is the point of having an account, so it defaults to on
  // whenever there is a connection.
  uploadToCloud = signal(navigator.onLine);

  constructor(
    private library: LibraryService,
    public auth: AuthService,
    private youtube: YoutubeService
  ) {}

  async ytSearch(): Promise<void> {
    const query = this.ytQuery.trim();
    if (!query || this.ytSearching()) return;
    if (!this.ytAvailable) {
      this.ytError.set(YT_BROWSER_HINT);
      return;
    }
    this.ytError.set('');
    this.ytSearching.set(true);
    try {
      const videoId = this.youtube.parseVideoId(query);
      if (videoId) this.ytResults.set([await this.withTimeout(this.youtube.getResult(videoId))]);
      else this.ytResults.set(await this.withTimeout(this.youtube.search(query)));
      if (this.ytResults().length === 0) this.ytError.set('No results found.');
    } catch (err) {
      this.ytError.set(
        (err as Error)?.message === 'yt-timeout'
          ? 'YouTube did not answer in time. Try again, or add the song from your device below.'
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
      const file = await this.youtube.downloadAudio(result.id);
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
          ? 'YouTube is currently blocking direct downloads (bot protection). Search still works — for now add songs from your device or a direct audio URL.'
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

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const parsed = files.map(file => {
      // Try to parse "Artist - Title.mp3" from the file name
      const base = file.name.replace(/\.[^.]+$/, '');
      const parts = base.split(' - ');
      return {
        file,
        title: parts.length > 1 ? parts.slice(1).join(' - ').trim() : base,
        artist: parts.length > 1 ? parts[0].trim() : '',
        album: '',
      };
    });
    this.pending.update(list => [...list, ...parsed]);
    input.value = '';
  }

  removePending(index: number): void {
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
        { title: item.title, artist: item.artist, album: item.album },
        toCloud
      );
      added.push(song.id);
    }
    this.pending.set([]);
    this.saving.set(false);

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
