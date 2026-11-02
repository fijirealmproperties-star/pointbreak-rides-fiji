import { io, Socket } from "socket.io-client";
import { getApiUrl, getValidToken, refreshAccessToken } from "./api";

let socket: Socket | null = null;

let wakeLock: any = null;

// Keeps the screen awake while the app is open, and reconnects after the phone was locked.
async function holdAwake() {
  const nav: any = typeof navigator === "undefined" ? null : navigator;
  if (!nav || !nav.wakeLock || wakeLock || !socket) return;
  try {
    wakeLock = await nav.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

function releaseAwake() {
  if (wakeLock) {
    try { wakeLock.release(); } catch {}
    wakeLock = null;
  }
}

let visibilityHooked = false;
function hookVisibility() {
  if (visibilityHooked || typeof document === "undefined") return;
  visibilityHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !socket) return;
    if (!socket.connected) socket.connect();
    holdAwake();
  });
}

export function connectSocket(_token?: string): Socket {
  if (socket) {
    if (socket.connected) return socket;
    socket.disconnect();
    socket = null;
  }
  const url = getApiUrl();
  socket = io(url, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    // Always hand the server a token that is fresh, including on reconnect.
    auth: (cb: (data: Record<string, unknown>) => void) => {
      getValidToken().then((t) => cb({ token: t || "" }));
    },
  });
  hookVisibility();
  holdAwake();
  socket.on("connect", () => {
    getValidToken().then((t) => {
      if (socket && socket.connected) socket.emit("identify", { token: t || "" });
    });
  });
  socket.on("identified", (ev: any) => {
    if (ev && ev.ok === false) {
      refreshAccessToken().then((t) => {
        if (t && socket && socket.connected) socket.emit("identify", { token: t });
      });
    }
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  releaseAwake();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}