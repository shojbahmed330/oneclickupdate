/**
 * Capacitor config for the SmartApp platform itself (if you want to ship the
 * dev tool as a native app via `npx cap add android && npx cap sync && cd android && ./gradlew assembleRelease`).
 *
 * The user-generated apps DO NOT use this file — they get one auto-injected
 * by the build-files edge function based on their app_builds row.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.b235d7f8472b44a8a0bf41d02a4728bc',
  appName: 'smartapp24',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    url: 'https://b235d7f8-472b-44a8-a0bf-41d02a4728bc.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
};

export default config;
