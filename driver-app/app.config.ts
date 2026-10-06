import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'DeepTruck Driver', slug: 'deeptruck-driver', version: '0.1.0',
  scheme: 'deeptruck-driver', orientation: 'portrait', userInterfaceStyle: 'light',
  platforms: ['ios','android'],
  ios: { bundleIdentifier: 'io.deeptruck.driver', supportsTablet: true, infoPlist: {ITSAppUsesNonExemptEncryption:false} },
  android: { package: 'io.deeptruck.driver' },
  plugins: [
    ['expo-location', {
      locationWhenInUsePermission:'DeepTruck uses your location to share progress for loads you accept and start.',
      locationAlwaysAndWhenInUsePermission:'Allow background location so your active loads can be tracked with the screen locked. You can stop sharing at any time.',
      isIosBackgroundLocationEnabled:true, isAndroidBackgroundLocationEnabled:true, isAndroidForegroundServiceEnabled:true
    }],
    ['expo-secure-store',{configureAndroidBackup:true}], 'expo-sqlite'
  ]
};
export default config;
