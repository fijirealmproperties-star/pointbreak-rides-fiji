// Dynamic Expo config — the single source of truth for app metadata.
// Env-dependent values come from the EAS build profile or a local .env:
//   EXPO_PUBLIC_API_URL  (required for store and download builds) HTTPS origin
//   EXPO_PUBLIC_DEMO     "false" hides demo accounts/buttons in store builds
const IS_PROD =
  process.env.EAS_BUILD_PROFILE === "production" ||
  process.env.EAS_BUILD_PROFILE === "download" ||
  process.env.APP_VARIANT === "production";

const apiUrl = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/+$/, "");

if (IS_PROD && !apiUrl) {
  throw new Error(
    "EXPO_PUBLIC_API_URL must be an HTTPS origin for production builds (e.g. https://api.pointbreakrides.com)."
  );
}

// The downloadable APK is built from the "download" profile in eas.json, which
// ships a placeholder so a build can't silently point at localhost. Replace it
// with your deployment origin (or set it via `eas env:create`).
if (apiUrl.includes("CHANGE-ME")) {
  throw new Error(
    "Set a real EXPO_PUBLIC_API_URL in eas.json (build.download.env) or with " +
      "`eas env:create --name EXPO_PUBLIC_API_URL --value https://your-domain` before building."
  );
}

module.exports = {
  expo: {
    name: "Pointbreak Rides Fiji",
    slug: "pointbreak-rides-fiji",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    scheme: "pointbreak-rides-fiji",
    platforms: ["android", "ios", "web"],
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0A1628",
    },
    plugins: [
      [
        "expo-build-properties",
        {
          android: { usesCleartextTraffic: !IS_PROD },
          ios: { deploymentTarget: "16.4" },
        },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          imageWidth: 180,
          resizeMode: "contain",
          backgroundColor: "#0A1628",
        },
      ],
    ],
    android: {
      package: "com.pointbreak.rides.fiji",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0A1628",
      },
      permissions: [
        "INTERNET",
        "ACCESS_NETWORK_STATE",
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
      ],
    },
    ios: {
      bundleIdentifier: "com.pointbreak.rides.fiji",
      supportsTablet: false,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "Pointbreak uses your location to set your pickup and show nearby drivers.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "Drivers share their location while online so riders can be matched and follow the trip.",
      },
    },
    web: {
      favicon: "./assets/favicon.png",
      bundler: "metro",
    },
    extra: {
      ...(apiUrl ? { apiUrl } : {}),
      eas: { projectId: "7cd97e01-446e-4d4c-9358-ad3e13153e64" },
    },
  },
};
