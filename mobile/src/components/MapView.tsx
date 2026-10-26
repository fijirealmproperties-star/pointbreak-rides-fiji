import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { colors } from "../theme";
import {
  MapMarker,
  MapPoint,
  MapVehicle,
  MAP_STYLE_URL,
  USE_VECTOR_BASEMAP,
  TILE_URL_TEMPLATE,
  TILE_ATTRIBUTION,
  ROUTE_COLOR,
  ROUTE_CASING,
  ROUTE_SHADOW,
  toLeafletZoom,
  markerPinHtml,
  vehicleHtml,
  mapStateFromProps,
} from "./mapShared";

export type { MapMarker, MapPoint, MapVehicle };
export { project, toLeafletZoom } from "./mapShared";

type Props = {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  route?: MapPoint[];
  vehicle?: MapVehicle;
  vehicleAngle?: number;
  style?: ViewStyle;
  onMapClick?: (p: MapPoint) => void;
  recenterToken?: number;
};

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
${
  USE_VECTOR_BASEMAP
    ? `<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" />
<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js"></script>`
    : ""
}
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #08131F; }
  #map { height: 100%; width: 100%; background: #08131F; }
  .leaflet-container { background: #08131F; font-family: system-ui, sans-serif; }
  .leaflet-control-attribution { font-size: 9px !important; background: rgba(8,19,31,0.6) !important; color: rgba(255,255,255,0.5) !important; }
  .leaflet-control-attribution a { color: rgba(255,255,255,0.6) !important; }
  .pb-pin { position: relative; display: flex; flex-direction: column; align-items: center; }
  .pb-dot { width: 16px; height: 16px; border-radius: 8px; background: var(--c); border: 2px solid #0A1628; box-shadow: 0 1px 3px rgba(0,0,0,0.55); }
  .pb-tip { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 8px solid #0A1628; }
  .pb-label { margin-top: 2px; background: #0A1628; color: #F7F9FC; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 6px; border: 1px solid #2A3B4D; white-space: nowrap; text-shadow: none; }
  .pb-veh { width: 32px; height: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .pb-tri { width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 14px solid var(--c); filter: drop-shadow(0 0 2px rgba(0,0,0,0.5)); }
  .pb-core { margin-top: -8px; width: 10px; height: 10px; border-radius: 5px; background: #0A1628; border: 2px solid var(--c); }
</style>
</head>
<body>
<div id="map"></div>
<script>
var map = null;
var markerLayer = null;
var routeLayer = null;
var vehicleLayer = null;
var programmatic = false;
var userMoved = false;
var lastCenter = null;
var lastToken = null;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function initMap() {
  map = L.map("map", {
    zoomControl: false,
    attributionControl: true,
    scrollWheelZoom: false,
    doubleClickZoom: true,
  });
  if (${USE_VECTOR_BASEMAP ? "true" : "false"}) {
    try {
      L.maplibreGL({ style: ${JSON.stringify(MAP_STYLE_URL)} }).addTo(map);
    } catch (e) {
      // No WebGL on this device — fall back to the raster template.
      L.tileLayer(${JSON.stringify(TILE_URL_TEMPLATE)}, {
        maxZoom: 19,
        attribution: ${JSON.stringify(TILE_ATTRIBUTION)},
      }).addTo(map);
    }
  } else {
    L.tileLayer(${JSON.stringify(TILE_URL_TEMPLATE)}, {
      maxZoom: 19,
      attribution: ${JSON.stringify(TILE_ATTRIBUTION)},
    }).addTo(map);
  }
  map.setView([-18.1416, 178.4419], 12);
  markerLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  vehicleLayer = L.layerGroup().addTo(map);

  map.on("movestart", function () { if (!programmatic) userMoved = true; });
  map.on("moveend", function () { programmatic = false; });
  map.on("click", function (e) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ t: "map_click", lat: e.latlng.lat, lng: e.latlng.lng }));
    }
  });
}

function applyState(s) {
  if (!map) return;
  markerLayer.clearLayers();
  routeLayer.clearLayers();
  vehicleLayer.clearLayers();
  document.getElementById("map").style.cursor = s.pinMode ? "crosshair" : "";

  var bounds = null;
  if (s.route && s.route.length >= 2) {
    var pts = s.route.map(function (p) { return [p.lat, p.lng]; });
    L.polyline(pts, { color: "${ROUTE_SHADOW}", weight: 14, opacity: 0.5, lineJoin: "round", lineCap: "round" }).addTo(routeLayer);
    L.polyline(pts, { color: "${ROUTE_CASING}", weight: 10, opacity: 1, lineJoin: "round", lineCap: "round" }).addTo(routeLayer);
    L.polyline(pts, { color: "${ROUTE_COLOR}", weight: 6, opacity: 1, lineJoin: "round", lineCap: "round" }).addTo(routeLayer);
    bounds = L.latLngBounds(pts);
    if (s.vehicle) bounds.extend([s.vehicle.lat, s.vehicle.lng]);
  }

  (s.markers || []).forEach(function (m) {
    var c = m.color || "#0066CC";
    var html = '<div class="pb-pin" style="--c:' + c + '">' +
      '<div class="pb-dot"></div><div class="pb-tip"></div>' +
      (m.label ? '<div class="pb-label">' + esc(m.label) + '</div>' : "") +
      '</div>';
    L.marker([m.lat, m.lng], {
      icon: L.divIcon({ className: "", html: html, iconSize: [28, 40], iconAnchor: [14, 30] }),
      interactive: false,
    }).addTo(markerLayer);
  });

  if (s.vehicle) {
    var c = s.vehicle.color || "#FF6B35";
    var ang = (s.vehicle.angle || s.vehicleAngle || 0) % 360;
    var vhtml = '<div class="pb-veh" style="--c:' + c + ';transform:rotate(' + ang + 'deg)">' +
      '<div class="pb-tri"></div><div class="pb-core"></div></div>';
    L.marker([s.vehicle.lat, s.vehicle.lng], {
      icon: L.divIcon({ className: "", html: vhtml, iconSize: [32, 40], iconAnchor: [16, 20] }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(vehicleLayer);
  }

  if (bounds) {
    programmatic = true;
    map.fitBounds(bounds, { padding: [36, 36] });
  } else if (s.center) {
    var tokenChanged = lastToken !== s.recenterToken;
    var centerChanged = !lastCenter ||
      Math.abs(lastCenter.lat - s.center.lat) > 0.001 ||
      Math.abs(lastCenter.lng - s.center.lng) > 0.001;
    if (tokenChanged || centerChanged || !userMoved) {
      programmatic = true;
      map.setView([s.center.lat, s.center.lng], s.zoom, { animate: false });
      lastCenter = { lat: s.center.lat, lng: s.center.lng };
    }
    lastToken = s.recenterToken;
  }
}

initMap();
window.__pb_setState = applyState;
if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
  window.ReactNativeWebView.postMessage("ready");
}
</script>
</body>
</html>`;

export default function MapView({
  center,
  zoom = 0.04,
  markers = [],
  route,
  vehicle,
  vehicleAngle,
  style,
  onMapClick,
  recenterToken,
}: Props) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  const payload = useMemo(
    () => mapStateFromProps({ center, zoom, markers, route, vehicle, vehicleAngle, pinMode: !!onMapClick, recenterToken }),
    [center, zoom, markers, route, vehicle, vehicleAngle, !!onMapClick, recenterToken]
  );

  useEffect(() => {
    if (!ready || !webRef.current) return;
    webRef.current.injectJavaScript(
      "window.__pb_setState(" + JSON.stringify(payload) + "); true;"
    );
  }, [payload, ready]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html: HTML }}
        style={styles.web}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onLoadEnd={() => setReady(true)}
        onMessage={(e: WebViewMessageEvent) => {
          const raw = e.nativeEvent.data;
          if (raw === "ready") {
            setReady(true);
            return;
          }
          if (raw && raw.charAt(0) === "{" && clickRef.current) {
            try {
              const m = JSON.parse(raw);
              if (m && m.t === "map_click" && typeof m.lat === "number" && typeof m.lng === "number") {
                clickRef.current({ lat: +m.lat.toFixed(6), lng: +m.lng.toFixed(6) });
              }
            } catch {
              // ignore non-payload messages
            }
          }
        }}
        onError={() => setReady(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.deep,
    width: "100%",
  },
  web: {
    flex: 1,
    backgroundColor: colors.deep,
  },
});