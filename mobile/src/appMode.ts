import { Platform } from "react-native";
import { DEMO_ENABLED } from "./config";

export const DEMO_RIDER = { phone: "+6797770001", password: "rider123" };
export const DEMO_DRIVER = { phone: "+6799001001", password: "driver123" };

// The web build can force driver branding with `?app=driver` (handy for running
// rider and driver side by side). On native, the login screen has a role toggle.
function detectWebDriverMode(): boolean {
  if (Platform.OS !== "web") return false;
  try {
    const search = (globalThis as any)?.location?.search || "";
    const hash = (globalThis as any)?.location?.hash || "";
    return /[?&#](app|role)=driver\b/.test(search + hash);
  } catch {
    return false;
  }
}

let driverMode = detectWebDriverMode();

export function isDriverApp(): boolean {
  return driverMode;
}

export function setDriverMode(on: boolean) {
  driverMode = on;
}

// Demo affordances (prefilled logins, "use demo account" buttons) are shown
// unless a build sets EXPO_PUBLIC_DEMO=false (see eas.json production profile).
export { DEMO_ENABLED };
