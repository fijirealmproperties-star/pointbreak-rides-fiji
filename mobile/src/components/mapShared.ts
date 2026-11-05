import { toRad } from "../geo";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  color?: string;
  label?: string;
  icon?: string;
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

const EMOJI_STYLE =
  "font-size:28px;line-height:32px;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6))";
const LABEL_STYLE =
  "margin-top:2px;background:#0A1628;color:#F7F9FC;font-size:10px;font-weight:600;padding:2px 6px;border-radius:6px;border:1px solid #2A3B4D;white-space:nowrap";

export const SURF_CAR_HTML =
  '<div style="position:relative;width:34px;height:34px;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6))"><div style="position:absolute;left:0;right:0;bottom:-2px;font-size:26px;line-height:28px;text-align:center">🚗</div><div style="position:absolute;left:0;right:0;top:-10px;font-size:20px;line-height:22px;text-align:center">🏄</div></div>';

export const markerPinHtml = (color: string, label?: string, icon?: string) =>
  icon
    ? '<div style="display:flex;flex-direction:column;align-items:center">' +
      (icon === "🚗" ? SURF_CAR_HTML : '<div style="' + EMOJI_STYLE + '">' + escapeHtml(icon) + '</div>') +
      (label ? '<div style="' + LABEL_STYLE + '">' + escapeHtml(label) + "</div>" : "") +
      "</div>"
    : '<div class="pb-pin" style="--c:' +
      color +
      '">' +
      '<div class="pb-dot"></div><div class="pb-tip"></div>' +
      (label ? '<div class="pb-label">' + escapeHtml(label) + "</div>" : "") +
      "</div>";

// Car icon for the moving driver; emoji cars don't rotate meaningfully, so the angle is ignored.
export const vehicleHtml = (_color: string, _angle: number) =>
  '<div class="pb-car" style="width:36px;height:44px;display:flex;align-items:center;justify-content:center">' +
  SURF_CAR_HTML +
  '</div>';

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
      icon: m.icon,
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