import { toRad } from "../geo";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  color?: string;
  label?: string;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface MapVehicle {
  lat: number;
  lng: number;
  angle?: number;
  color?: string;
}

// Basemap. The default is OpenFreeMap's public vector style: free, no API key,
// no quota, commercial use allowed with attribution — see
// https://openfreemap.org. No SLA, though: self-host a style if that matters.
// It is served as vector tiles over MapLibre GL, rendered inside Leaflet (see
// MapView).
//
// Self-hosting instead? Build a Fiji-only style (Planetiler or Planetiler-based
// PMTiles exported with `pmtiles`/a static style JSON) and point
// EXPO_PUBLIC_MAP_STYLE_URL at it — no code changes needed.
//
// Prefer a plain raster provider? Set EXPO_PUBLIC_MAP_STYLE_URL=raster and the
// app falls back to the XYZ template below. The template must contain {z}/{x}/{y}.
export const MAP_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL === undefined
    ? "https://tiles.openfreemap.org/styles/liberty"
    : process.env.EXPO_PUBLIC_MAP_STYLE_URL;
export const USE_VECTOR_BASEMAP = !!MAP_STYLE_URL && MAP_STYLE_URL !== "raster";

export const TILE_URL_TEMPLATE =
  process.env.EXPO_PUBLIC_TILE_URL_TEMPLATE || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION =
  process.env.EXPO_PUBLIC_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const ROUTE_COLOR = "#4285F4";
export const ROUTE_CASING = "#FFFFFF";
export const ROUTE_SHADOW = "rgba(0,0,0,0.25)";

export function project(
  lat: number,
  lng: number,
  center: { lat: number; lng: number },
  zoom: number,
  width: number,
  height: number
): { x: number; y: number } {
  const pxPerDegLng = width / zoom;
  const pxPerDegLat = pxPerDegLng / Math.max(0.15, Math.cos(toRad(center.lat)));
  return {
    x: width / 2 + (lng - center.lng) * pxPerDegLng,
    y: height / 2 - (lat - center.lat) * pxPerDegLat,
  };
}

// Map the app's "degree span" zoom to a Leaflet integer zoom level. The cap
// (18) leaves room for street-level detail when a rider is dropping a pin.
export function toLeafletZoom(deg: number): number {
  const z = Math.log2(360 / Math.max(0.002, deg));
  return Math.min(18, Math.max(5, Math.round(z)));
}

const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC_MAP[c] || c);
}

export const markerPinHtml = (color: string, label?: string) =>
  '<div class="pb-pin" style="--c:' +
  color +
  '">' +
  '<div class="pb-dot"></div><div class="pb-tip"></div>' +
  (label ? '<div class="pb-label">' + escapeHtml(label) + "</div>" : "") +
  "</div>";

export const vehicleHtml = (color: string, angle: number) =>
  '<div class="pb-veh" style="--c:' +
  color +
  ";transform:rotate(" +
  (angle % 360) +
  'deg)">' +
  '<div class="pb-tri"></div><div class="pb-core"></div></div>';

export function mapStateFromProps(props: {
  center: { lat: number; lng: number };
  zoom: number;
  markers?: MapMarker[];
  route?: MapPoint[];
  vehicle?: MapVehicle;
  vehicleAngle?: number;
  pinMode?: boolean;
  recenterToken?: number;
}) {
  return {
    center: { lat: props.center.lat, lng: props.center.lng },
    zoom: toLeafletZoom(props.zoom),
    pinMode: !!props.pinMode,
    recenterToken: props.recenterToken || 0,
    markers: (props.markers || []).map((m) => ({
      id: m.id,
      lat: m.lat,
      lng: m.lng,
      color: m.color,
      label: m.label,
    })),
    route: props.route ? props.route.map((p) => ({ lat: p.lat, lng: p.lng })) : undefined,
    vehicle: props.vehicle
      ? {
          lat: props.vehicle.lat,
          lng: props.vehicle.lng,
          angle: props.vehicle.angle ?? props.vehicleAngle,
          color: props.vehicle.color,
        }
      : undefined,
    vehicleAngle: props.vehicleAngle,
  };
}

export type MapState = ReturnType<typeof mapStateFromProps>;