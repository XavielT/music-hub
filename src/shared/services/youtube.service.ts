import { Injectable } from '@angular/core';
import type { Innertube } from 'youtubei.js';

export interface YoutubeResult {
  id: string;
  title: string;
  author: string;
  duration: number;
  thumbnail?: string;
}

// In-app YouTube client. Works on the phone thanks to CapacitorHttp
// (native requests, no CORS) — in the browser preview it will fail.
@Injectable({ providedIn: 'root' })
export class YoutubeService {
  private yt: Promise<Innertube> | null = null;

  private client(): Promise<Innertube> {
    if (!this.yt) {
      this.yt = import('youtubei.js').then(m => m.Innertube.create({ retrieve_player: true }));
    }
    return this.yt;
  }

  parseVideoId(text: string): string | null {
    const match = text.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
  }

  async search(query: string): Promise<YoutubeResult[]> {
    const yt = await this.client();
    const res = await yt.search(query, { type: 'video' });
    return (res.videos ?? [])
      .filter((v: any) => v.type === 'Video')
      .slice(0, 15)
      .map((v: any) => ({
        id: v.video_id ?? v.id,
        title: v.title?.text ?? String(v.title ?? ''),
        author: v.author?.name ?? 'Unknown artist',
        duration: v.duration?.seconds ?? 0,
        thumbnail: v.thumbnails?.[0]?.url,
      }));
  }

  async getResult(videoId: string): Promise<YoutubeResult> {
    const yt = await this.client();
    const info = await yt.getBasicInfo(videoId);
    return {
      id: videoId,
      title: info.basic_info.title ?? videoId,
      author: info.basic_info.author ?? 'Unknown artist',
      duration: info.basic_info.duration ?? 0,
      thumbnail: info.basic_info.thumbnail?.[0]?.url,
    };
  }

  async downloadAudio(videoId: string): Promise<File> {
    const yt = await this.client();
    // YouTube's WEB client no longer returns playable URLs (PoToken /
    // signature protection). The internal mobile/TV clients still return
    // direct audio URLs, so we try them in order until one gives a URL.
    const clients: any[] = ['ANDROID', 'IOS', 'MWEB', 'TV_EMBEDDED', 'WEB'];
    let lastErr: unknown = null;
    for (const client of clients) {
      try {
        const info = await yt.getBasicInfo(videoId, client);
        const format = info.chooseFormat({ type: 'audio', quality: 'best' });
        let url: string | undefined = format.url;
        if (!url && format.decipher) url = await format.decipher(yt.session.player);
        if (!url) throw new Error('no url');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return this.toFile([await res.blob()], videoId);
      } catch (err) {
        lastErr = err;
        console.warn(`download via ${client} client failed`, err);
      }
    }
    throw new Error(`All clients failed (${(lastErr as Error)?.message ?? lastErr})`);
  }

  private toFile(chunks: BlobPart[], videoId: string): File {
    const blob = new Blob(chunks, { type: 'audio/mp4' });
    if (blob.size < 10_000) throw new Error('Downloaded audio is empty');
    return new File([blob], `${videoId}.m4a`, { type: 'audio/mp4' });
  }
}
