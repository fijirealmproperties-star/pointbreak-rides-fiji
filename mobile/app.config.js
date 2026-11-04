// Dynamic Expo config — the single source of truth for app metadata.
// Env-dependent values come from the EAS build profile or a local .env:
//   EXPO_PUBLIC_API_URL  (required for production and download builds) HTTPS origin
//   EXPO_PUBLIC_DEMO     "false" hides demo accounts/buttons in store builds
const IS_PROD =
  process.env.EAS_BUILD_PROFILE === "production" ||
  process.env.EAS_BUILD_PROFILE === "download" ||
  process.env.APP_VARIANT === "production";
const IS_PREVIEW_BUILD = process.env.EAS_BUILD_PROFILE === "preview";

const apiUrl = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/+$/, "");

if (IS_PROD || IS_PREVIEW_BUILD) {
  let validApiOrigin = false;
  try {
    const parsed = new URL(apiUrl);
    validApiOrigin =
      (IS_PROD ? parsed.protocol === "https:" : ["http:", "https:"].includes(parsed.protocol)) &&
      parsed.origin === apiUrl &&
      !apiUrl.includes("CHANGE-ME");
  } catch {
    validApiOrigin = false;
  }
  if (!validApiOrigin) {
    throw new Error(
      IS_PROD
        ? "Set EXPO_PUBLIC_API_URL to your deployed HTTPS API origin before building (for example, https://rides.example.com)."
        : "Set EXPO_PUBLIC_API_URL to a reachable API origin before building a preview app."
    );
  }
}

module.exports = {
  expo: {
    name: "Pointbreak Fiji Rides",
    slug: "pointbreakfijirides",
    version: "2.3.0",
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
