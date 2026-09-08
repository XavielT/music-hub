import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface PickedVideo {
  cancelled: boolean;
  // The signed googlevideo URL the page itself fetched. Short-lived and bound
  // to the device that captured it, which is why the native side downloads it.
  audioUrl?: string;
  mime?: string;
  userAgent?: string;
  // Which YouTube client issued the URL; the download has to match it.
  client?: string;
  // Where the page wrote the audio it downloaded.
  path?: string;
  videoId?: string;
  title?: string;
  author?: string;
  duration?: number;
}

export interface YoutubeDownloadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Android-only. Opens YouTube in a real WebView and captures the audio stream
 * the page requests while playing.
 *
 * Everything that tried to talk to YouTube's API from inside this app failed —
 * and the reason was never the phone's connection, which YouTube is perfectly
 * happy with. It was pretending to be a client. This does not pretend: it is
 * the mobile site, in a browser, driven by the person using it.
 */
export interface YoutubeBrowserPlugin {
  pick(options?: { url?: string }): Promise<PickedVideo>;
  readCapture(options: { path: string }): Promise<{ base64: string; bytes: number }>;
  addListener(
    event: 'downloadProgress',
    listener: (progress: YoutubeDownloadProgress) => void
  ): Promise<PluginListenerHandle>;
}

export const YoutubeBrowser = registerPlugin<YoutubeBrowserPlugin>('YoutubeBrowser');
