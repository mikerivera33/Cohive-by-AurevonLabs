import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aurevonlabs.cohive',
  appName: 'Cohive',
  webDir: 'dist',
  ios: {
    // The app paints its own dark navy chrome edge to edge.
    contentInset: 'never',
    backgroundColor: '#0A0F1C',
  },
  android: {
    backgroundColor: '#0A0F1C',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0A0F1C',
      overlaysWebView: true,
    },
  },
};

export default config;
