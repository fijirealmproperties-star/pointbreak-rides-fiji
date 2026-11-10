export type PluginListener = { remove(): Promise<void> };

export type PushPlugin = {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  addListener(event: string, callback: (value: { value?: string; error?: string }) => void): PluginListener | Promise<PluginListener>;
  register(): Promise<void>;
};

export type LocalNotificationsPlugin = {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(options: { notifications: { id: number; title: string; body: string; smallIcon: string }[] }): Promise<unknown>;
};

export type BackgroundGeolocationPlugin = {
  addWatcher(options: {
    backgroundTitle: string;
    backgroundMessage: string;
    requestPermissions: boolean;
    stale: boolean;
    distanceFilter: number;
  }, callback: (location: unknown, error: { code?: string } | null) => void): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
};

type NativePlugins = {
  PushNotifications: PushPlugin;
  LocalNotifications: LocalNotificationsPlugin;
  BackgroundGeolocation: BackgroundGeolocationPlugin;
};

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  Plugins?: Partial<NativePlugins>;
};

function bridge(): CapacitorBridge | undefined {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorBridge }).Capacitor;
}

export function isNativeApp(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

export function nativePlugin<K extends keyof NativePlugins>(name: K): NativePlugins[K] | null {
  const cap = bridge();
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins?.[name] ?? null;
}
