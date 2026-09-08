import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { YoutubeBrowser, PickedVideo } from '../native/youtube-browser.plugin';

export interface CapturedSong {
  file: File;
  title: string;
  artist: string;
  duration: number;
  coverUrl?: string;
}

/**
 * Adding a song by browsing YouTube, the way the phone can and a server
 * cannot.
 *
 * The division of labour matters: the WebView browses and captures, the
 * *native* side downloads. A googlevideo URL is bound to the client that was
 * given it — same connection, same user-agent, same cookies — so fetching it
 * from the Angular layer would drop all three and get a 403.
 */
@Injectable({ providedIn: 'root' })
export class YoutubeCaptureService {
  // Only inside the Android shell. A browser cannot read another site's
  // traffic, and should not be able to.
  readonly available = Capacitor.isNativePlatform();

  private _progress = signal<number | null>(null);
  progress = this._progress.asReadonly();

  async capture(startUrl?: string): Promise<CapturedSong | null> {
    if (!this.available) throw new Error('Adding from YouTube needs the Android app.');

    const picked: PickedVideo = await YoutubeBrowser.pick(startUrl ? { url: startUrl } : {});
    if (picked.cancelled || !picked.audioUrl) return null;

    const listener = await YoutubeBrowser.addListener('downloadProgress', p =>
      this._progress.set(p.percent)
    );
    this._progress.set(0);
    try {
      const { base64 } = await YoutubeBrowser.download({
        url: picked.audioUrl,
        userAgent: picked.userAgent,
      });
      const blob = base64ToBlob(base64, picked.mime || 'audio/mp4');
      const name = `${picked.videoId || 'youtube'}.m4a`;
      return {
        file: new File([blob], name, { type: blob.type }),
        title: (picked.title || '').trim() || 'Unknown title',
        artist: cleanArtist(picked.author),
        duration: picked.duration ?? 0,
        // YouTube's own thumbnail, which the artwork pipeline treats like any
        // other remote cover.
        coverUrl: picked.videoId
          ? `https://i.ytimg.com/vi/${picked.videoId}/hqdefault.jpg`
          : undefined,
      };
    } finally {
      this._progress.set(null);
      await listener.remove();
    }
  }
}

export const _test = { cleanArtist, base64ToBlob };

// Channel names carry a suffix that is noise once it is a song's artist.
function cleanArtist(author?: string): string {
  const name = (author || '').trim();
  if (!name) return 'Unknown artist';
  return name.replace(/\s*-\s*Topic$/i, '').trim() || 'Unknown artist';
}

// Done in chunks: a five-megabyte song is a seven-megabyte base64 string, and
// String.fromCharCode over the whole thing at once overflows the call stack.
function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const chunks: Uint8Array[] = [];
  const size = 32 * 1024;
  for (let offset = 0; offset < binary.length; offset += size) {
    const slice = binary.slice(offset, offset + size);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i);
    chunks.push(bytes);
  }
  return new Blob(chunks, { type });
}
