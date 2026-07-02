import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xaviel.musichub',
  appName: 'Music Hub',
  webDir: 'dist/music-hub/browser',
  plugins: {
    // Native HTTP for window.fetch — bypasses CORS so the in-app
    // YouTube search/download works without any server.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
