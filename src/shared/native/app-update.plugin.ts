import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface AppInfo {
  versionName: string;
  versionCode: number;
  packageName: string;
}

export interface DownloadProgress {
  loaded: number;
  total: number; // 0 when the server sends no Content-Length
  percent: number; // -1 when the total is unknown
}

// Android-only. Downloads a release APK and hands it to the system package
// installer — the app cannot install anything itself, it only opens the
// installer with the file, and Android does the rest (including refusing an
// APK signed with a different key).
export interface AppUpdatePlugin {
  getInfo(): Promise<AppInfo>;
  // Whether this app may ask the system to install a package. Android 8+
  // makes it a per-app setting the user has to turn on once.
  canInstall(): Promise<{ granted: boolean }>;
  openInstallSettings(): Promise<{ granted: boolean }>;
  download(options: { url: string }): Promise<{ path: string }>;
  install(options?: { path?: string }): Promise<void>;
  addListener(
    event: 'downloadProgress',
    listener: (progress: DownloadProgress) => void
  ): Promise<PluginListenerHandle>;
}

export const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');
