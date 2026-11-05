import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * The single public-origin constant for the Expo runtime (DESIGN §3.6). Code reads it from
 * `Constants.expoConfig.extra.publicOrigin`; EXPO_PUBLIC_VERIFY_BASE_URL overrides it for local stacks.
 */
const PUBLIC_ORIGIN = process.env.EXPO_PUBLIC_VERIFY_BASE_URL || "https://stamper.media";
const BUNDLE_ID = "media.stamper.app";
const linkHost = new URL(PUBLIC_ORIGIN).host;
const appAttestEnv =
  process.env.APPLE_APP_ATTEST_ENV === "development" ? "development" : "production";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Stamper",
  slug: "stamper",
  scheme: "stamper",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    associatedDomains: [`applinks:${linkHost}`],
    entitlements: { "com.apple.developer.devicecheck.appattest-environment": appAttestEnv },
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: BUNDLE_ID,
    // location is opt-in per capture and foreground only (DESIGN §11.3)
    permissions: [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
    ],
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: linkHost, pathPrefix: "/v/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "react-native-quick-crypto",
    [
      "expo-camera",
      {
        cameraPermission: "Stamper uses the camera to take the photos and videos it stamps.",
        microphonePermission: "Stamper records sound with your videos.",
        recordAudioAndroid: true,
      },
    ],
    [
      "expo-location",
      {
        // NSLocationWhenInUseUsageDescription only: no background location, no motion
        locationWhenInUsePermission:
          "Only when you turn on Record location, Stamper reads your position once for that capture. The public page shows only the area, about 1 km across; the exact position stays private.",
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    publicOrigin: PUBLIC_ORIGIN,
    cloudProjectNumber: process.env.EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER ?? "",
    eas: { projectId: process.env.EAS_PROJECT_ID ?? "" },
  },
});
