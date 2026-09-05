import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aurevonlabs.cohive',
  appName: 'Cohive',
  webDir: 'dist',
  ios: {
    // The app paints its own dark navy chrome edge to edge.
    contentInset: 'never',
    backgroundColor: '#060B18',
  },
  android: {
    backgroundColor: '#060B18',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#060B18',
      overlaysWebView: true,
    },
  },
};

export default config;
