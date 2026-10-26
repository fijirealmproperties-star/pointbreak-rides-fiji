import { io, Socket } from "socket.io-client";
import { getApiUrl, getValidToken, refreshAccessToken } from "./api";

let socket: Socket | null = null;

export function connectSocket(_token?: string): Socket {
  if (socket) {
    if (socket.connected) return socket;
    socket.disconnect();
    socket = null;
  }
  const url = getApiUrl();
  socket = io(url, {
    transports: ["websocket", "polling"],
    // Always hand the server a token that is fresh, including on reconnect.
    auth: (cb: (data: Record<string, unknown>) => void) => {
      getValidToken().then((t) => cb({ token: t || "" }));
    },
  });
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
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}