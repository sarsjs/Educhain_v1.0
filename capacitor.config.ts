import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.educhain.app',
  appName: 'EduChain',
  webDir: 'out',
  server: {
    // The Android/iOS wrapper must load the current EduChain App Hosting site.
    // The previous URL pointed to the legacy Contacto Estudiantil deployment.
    url: 'https://educhain-v1--contacto-estudiantil.us-east4.hosted.app',
    cleartext: false
  }
};

export default config;
