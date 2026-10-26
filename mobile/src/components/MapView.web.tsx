import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-leaflet";
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
  markerPinHtml,
  vehicleHtml,
  mapStateFromProps,
  MapState,
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

type LayerBundle = {
  markers: L.LayerGroup;
  routes: L.LayerGroup;
  vehicles: L.LayerGroup;
};

type MapRuntime = {
  map: L.Map;
  layers: LayerBundle;
  move(fn: () => void): void;
  lastCenter: { lat: number; lng: number } | null;
  lastToken: number | null;
  userMoved: boolean;
  routeSig: string | null;
  markerSig: string | null;
  vehicleMarker: L.Marker | null;
  vehicleAngle: number | null;
  needsFit: boolean;
  pinZoom: number | null;
};

let mapSeq = 0;

function initLeaflet(
  el: HTMLDivElement,
  clickRef?: { current?: (p: MapPoint) => void }
): MapRuntime {
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    scrollWheelZoom: true,
  });
  const rasterBasemap = () =>
    L.tileLayer(TILE_URL_TEMPLATE, {
      maxZoom: 19,
      attribution: TILE_ATTRIBUTION,
    }).addTo(map);

  if (USE_VECTOR_BASEMAP) {
    try {
      L.maplibreGL({ style: MAP_STYLE_URL }).addTo(map);
    } catch {
      // No WebGL (old browser, software rendering disabled) — use raster.
      rasterBasemap();
    }
  } else {
    rasterBasemap();
  }
  map.setView([-18.1416, 178.4419], 12);
  const layers: LayerBundle = {
    markers: L.layerGroup().addTo(map),
    routes: L.layerGroup().addTo(map),
    vehicles: L.layerGroup().addTo(map),
  };

  let programmatic = false;
  const rt: MapRuntime = {
    map,
    layers,
    lastCenter: null,
    lastToken: null,
    userMoved: false,
    routeSig: null,
    markerSig: null,
    vehicleMarker: null,
    vehicleAngle: null,
    needsFit: false,
    pinZoom: null,
    move(fn) {
      programmatic = true;
      fn();
    },
  };
  map.on("movestart", () => {
    if (!programmatic) rt.userMoved = true;
  });
  map.on("moveend", () => {
    programmatic = false;
  });
  map.on("click", (e: L.LeafletMouseEvent) => {
    if (clickRef && clickRef.current) {
      clickRef.current({
        lat: +e.latlng.lat.toFixed(6),
        lng: +e.latlng.lng.toFixed(6),
      });
    }
  });
  return rt;
}

function applyState(rt: MapRuntime, s: MapState) {
  const { map, layers } = rt;
  map.getContainer().style.cursor = s.pinMode ? "crosshair" : "";

  const routePts = s.route && s.route.length >= 2 ? s.route : null;

  // Route geometry only changes occasionally — rebuild only when it does.
  const routeSig = routePts
    ? `${routePts.length}:${routePts[0].lat},${routePts[0].lng}:${routePts[routePts.length - 1].lat},${routePts[routePts.length - 1].lng}`
    : "none";
  if (routeSig !== rt.routeSig) {
    layers.routes.clearLayers();
    if (routePts) {
      const pts = routePts.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(pts, { color: ROUTE_SHADOW, weight: 14, opacity: 0.5, lineJoin: "round", lineCap: "round" }).addTo(layers.routes);
      L.polyline(pts, { color: ROUTE_CASING, weight: 10, opacity: 1, lineJoin: "round", lineCap: "round" }).addTo(layers.routes);
      L.polyline(pts, { color: ROUTE_COLOR, weight: 6, opacity: 1, lineJoin: "round", lineCap: "round" }).addTo(layers.routes);
    }
    rt.routeSig = routeSig;
    rt.needsFit = true;
  }

  // Static markers — rebuild only when the set changes.
  const markerSig = (s.markers || [])
    .map((m) => `${m.id}:${m.lat},${m.lng}:${m.color}:${m.label || ""}`)
    .join("|");
  if (markerSig !== rt.markerSig) {
    layers.markers.clearLayers();
    (s.markers || []).forEach((m) => {
      const color = m.color || "#0066CC";
      L.marker([m.lat, m.lng], {
        icon: L.divIcon({
          className: "",
          html: markerPinHtml(color, m.label),
          iconSize: [28, 40],
          iconAnchor: [14, 30],
        }),
        interactive: false,
      }).addTo(layers.markers);
    });
    rt.markerSig = markerSig;
  }

  // Vehicle — reuse a single marker and just move/rotate it each update.
  if (s.vehicle) {
    const ang = (s.vehicle.angle || s.vehicleAngle || 0) % 360;
    if (!rt.vehicleMarker) {
      const color = s.vehicle.color || "#FF6B35";
      rt.vehicleMarker = L.marker([s.vehicle.lat, s.vehicle.lng], {
        icon: L.divIcon({
          className: "",
          html: vehicleHtml(color, ang),
          iconSize: [32, 40],
          iconAnchor: [16, 20],
        }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(layers.vehicles);
      rt.vehicleAngle = ang;
    } else {
      rt.vehicleMarker.setLatLng([s.vehicle.lat, s.vehicle.lng]);
      if (ang !== rt.vehicleAngle) {
        const el = rt.vehicleMarker.getElement();
        const inner = el && (el.querySelector(".pb-veh") as HTMLElement | null);
        if (inner) inner.style.transform = `rotate(${ang}deg)`;
        rt.vehicleAngle = ang;
      }
    }
  } else if (rt.vehicleMarker) {
    layers.vehicles.removeLayer(rt.vehicleMarker);
    rt.vehicleMarker = null;
    rt.vehicleAngle = null;
  }

  const fitToRoute = () => {
    if (!routePts) return;
    const pts = routePts.map((p) => [p.lat, p.lng] as [number, number]);
    const bounds = L.latLngBounds(pts);
    if (s.vehicle) bounds.extend([s.vehicle.lat, s.vehicle.lng]);
    rt.move(() => map.fitBounds(bounds, { padding: [36, 36] }));
  };

  // Pin-dropping needs a street-level view of wherever the rider is looking.
  // Only change zoom — never fight their pan — and suppress any pending fit.
  if (!s.pinMode) rt.pinZoom = null;
  if (s.pinMode) {
    if (rt.pinZoom !== s.zoom) {
      rt.move(() => map.setZoom(s.zoom, { animate: false }));
      rt.pinZoom = s.zoom;
    }
    rt.needsFit = false;
    const c = map.getCenter();
    rt.lastCenter = { lat: c.lat, lng: c.lng };
    rt.lastToken = s.recenterToken;
  } else if (rt.needsFit && routePts) {
    fitToRoute();
    rt.needsFit = false;
    rt.lastCenter = { ...s.center };
    rt.lastToken = s.recenterToken;
  } else if (s.center) {
    const tokenChanged = rt.lastToken !== s.recenterToken;
    if (tokenChanged && routePts) {
      fitToRoute();
      rt.lastCenter = { ...s.center };
    } else if (!routePts) {
      const centerChanged =
        !rt.lastCenter ||
        Math.abs(rt.lastCenter.lat - s.center.lat) > 0.001 ||
        Math.abs(rt.lastCenter.lng - s.center.lng) > 0.001;
      if (tokenChanged || centerChanged || !rt.userMoved) {
        const c = s.center;
        rt.move(() => map.setView([c.lat, c.lng], s.zoom, { animate: false }));
        rt.lastCenter = { lat: c.lat, lng: c.lng };
      }
    }
    rt.lastToken = s.recenterToken;
  }
}

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
  const [domId] = useState(() => `pb-map-${++mapSeq}`);
  const bundleRef = useRef<MapRuntime | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const [_, force] = useState(0);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;

    // Try immediately: by the time effects run the container is already laid
    // out. Fall back to animation frames only if it still has no size (e.g. it
    // mounts inside a hidden tab, where rAF may be throttled).
    const start = (): boolean => {
      if (cancelled) return true;
      const el = document.getElementById(domId) as HTMLDivElement | null;
      if (!el || el.clientWidth === 0) return false;
      try {
        bundleRef.current = initLeaflet(el, clickRef);
        force((n) => n + 1);
      } catch (err) {
        // WebGL unavailable / style failed to load — keep the app usable.
        console.error("Map initialisation failed", err);
      }
      return true;
    };

    if (!start()) {
      const tick = () => {
        if (!start()) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (bundleRef.current) {
        bundleRef.current.map.remove();
        bundleRef.current = null;
      }
    };
  }, [domId]);

  const payload = useMemo(
    () => mapStateFromProps({ center, zoom, markers, route, vehicle, vehicleAngle, pinMode: !!onMapClick, recenterToken }),
    [center, zoom, markers, route, vehicle, vehicleAngle, !!onMapClick, recenterToken]
  );

  useEffect(() => {
    if (bundleRef.current) applyState(bundleRef.current, payload);
  }, [payload, bundleRef.current]);

  return <View nativeID={domId} style={[styles.container, style]} />;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.deep,
    width: "100%",
    flex: 1,
  },
});
