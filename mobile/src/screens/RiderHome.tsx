import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, typography, fmtFare, fmtKm, fmtDuration } from "../theme";
import { api, getToken, FareEstimate, Place, Ride, parsePath } from "../api";
import { haversine, requestCurrentLocation } from "../geo";
import { estimateLocally, estimateCacheKey, getCachedEstimate, setCachedEstimate } from "../fare";
import { connectSocket, getSocket } from "../socket";
import MapView, { MapMarker, MapPoint } from "../components/MapView";
import PlacePicker from "../components/PlacePicker";
import { loadPlaces, PLACES } from "../places";

type Props = {
  onOpenRide: (rideId: string) => void;
};

type RequestState = "idle" | "requesting" | "finding";

const SUVA = { lat: -18.1416, lng: 178.4419 };

// Street-level span used while the rider is dropping a pin (Leaflet zoom ~17).
const PIN_ZOOM_DEG = 0.003;

const SEED_DRIVERS: Array<{ lat: number; lng: number }> = [
  { lat: -18.135, lng: 178.429 },
  { lat: -18.145, lng: 178.45 },
  { lat: -18.138, lng: 178.4355 },
  { lat: -18.15, lng: 178.44 },
];

const SAVED_PLACES = [
  { id: "nadi-airport", icon: "✈", name: "Nadi Airport", sub: "Nadi, Viti Levu" },
  { id: "suva-city", icon: "📍", name: "Suva City Centre", sub: "Suva, Viti Levu" },
  { id: "sigatoka-beach", icon: "🏖", name: "Sigatoka Beach", sub: "Coral Coast" },
  { id: "denarau", icon: "⛵", name: "Denarau Marina", sub: "Nadi, Viti Levu" },
];

export default function RiderHome({ onOpenRide }: Props) {
  const insets = useSafeAreaInsets();
  const [places, setPlaces] = useState<Place[]>([]);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [estimate, setEstimate] = useState<FareEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [driveMarkers, setDriveMarkers] = useState<MapMarker[]>([]);
  const [reqState, setReqState] = useState<RequestState>("idle");
  const [rideId, setRideId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [recenterToken, setRecenterToken] = useState(0);
  const [pickerOpen, setPickerOpen] = useState<"pickup" | "dropoff" | null>(null);
  const [pinMode, setPinMode] = useState<"pickup" | "dropoff" | null>(null);
  const [resolvingPin, setResolvingPin] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("");
  const cleanupRef = useRef<(() => void) | null>(null);

  async function locateMe(auto: boolean) {
    setLocating(true);
    try {
      const p = await requestCurrentLocation();
      setPickup({
        id: "current-location",
        name: "My current location",
        short_name: "Current Location",
        type: "city",
        lat: p.lat,
        lng: p.lng,
        region: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`,
      });
      setRecenterToken((t) => t + 1);
      if (!auto) setError("");
    } catch (e: any) {
      if (!auto) setError(e?.message || "Could not get your location.");
    } finally {
      setLocating(false);
    }
  }

  // --- Manual pin drop ------------------------------------------------------
  // The rider can point at an exact spot on the streets map instead of picking
  // from the saved list. The dropped pin then feeds the normal road estimate.

  function startPinMode(target: "pickup" | "dropoff") {
    setPickerOpen(null);
    setPinMode(target);
    setRecenterToken((t) => t + 1);
  }

  function cancelPinMode() {
    setPinMode(null);
    setRecenterToken((t) => t + 1);
  }

  async function handleMapClick(p: MapPoint) {
    const target = pinMode;
    if (!target || resolvingPin) return;
    setResolvingPin(true);

    let name = "Dropped pin";
    let region = "";
    try {
      const r = await api<{ label?: string; region?: string }>("/geo/reverse", {
        method: "POST",
        body: { lat: p.lat, lng: p.lng },
      });
      name = (r && r.label) || name;
      region = (r && r.region) || "";
    } catch {
      // offline or rate-limited — the raw coordinates still route fine
    }

    const place: Place = {
      id: `pin-${p.lat.toFixed(5)},${p.lng.toFixed(5)}`,
      name,
      short_name: name,
      type: "pin",
      lat: p.lat,
      lng: p.lng,
      region: region || "Pinned location",
    };

    // Stay at street level until the address resolves, then hand back to the sheet.
    if (target === "pickup") setPickup(place);
    else setDropoff(place);
    setPinMode(null);
    setResolvingPin(false);
    setRecenterToken((t) => t + 1);
  }

  // Pull-to-refresh (native) / Refresh pill (web): reload places, ask the server
  // for the current driver snapshot, and re-price the trip without the cache.
  async function onRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      const fresh = await loadPlaces();
      setPlaces(fresh);

      const socket = getSocket() || connectSocket();
      if (!socket.connected) socket.connect();
      socket.emit("rider_online");

      if (pickup && dropoff) {
        try {
          const e = await api<FareEstimate>("/rides/estimate", {
            method: "POST",
            body: {
              pickup_lat: pickup.lat,
              pickup_lng: pickup.lng,
              dropoff_lat: dropoff.lat,
              dropoff_lng: dropoff.lng,
            },
          });
          setCachedEstimate(estimateCacheKey(pickup, dropoff), e);
          setEstimate(e);
        } catch {
          // keep the previous estimate if the server is unreachable
        }
      }
      setLastRefresh(new Date().toLocaleTimeString());
    } catch {
      setError("Could not refresh. Check your connection.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadPlaces().then(setPlaces);
    setPickup({
      id: "current-location",
      name: "Current Location",
      short_name: "Suva City Centre",
      type: "city",
      lat: SUVA.lat,
      lng: SUVA.lng,
      region: "Suva",
    });
    locateMe(true);
    setDriveMarkers(
      SEED_DRIVERS.map((d, i) => ({
        id: `seed-${i}`,
        lat: d.lat,
        lng: d.lng,
        color: colors.sky,
        label: "Driver",
      }))
    );
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);

  useEffect(() => {
    if (!dropoff || !pickup) {
      setEstimate(null);
      setEstimating(false);
      return;
    }

    setEstimate(estimateLocally(pickup, dropoff));
    setEstimating(true);

    const key = estimateCacheKey(pickup, dropoff);
    const cached = getCachedEstimate(key);
    if (cached) {
      setEstimate(cached);
      setEstimating(false);
      return;
    }

    const ctrl = new AbortController();
    api<FareEstimate>("/rides/estimate", {
      method: "POST",
      body: {
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
      },
      signal: ctrl.signal,
    })
      .then((e) => {
        setCachedEstimate(key, e);
        setEstimate(e);
        setEstimating(false);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setEstimating(false);
      });

    return () => {
      ctrl.abort();
    };
  }, [pickup, dropoff]);

  // Show live driver positions (the server pushes updates as drivers move,
  // not just when one goes on/offline).
  useEffect(() => {
    let mounted = true;
    const onDrivers = (ev: any) => {
      if (!mounted || !ev || !Array.isArray(ev.drivers)) return;
      setDriveMarkers(
        ev.drivers
          .filter((d: any) => Number.isFinite(d.lat) && Number.isFinite(d.lng))
          .map((d: any, i: number) => ({
            id: d.id || `live-${i}`,
            lat: d.lat,
            lng: d.lng,
            color: colors.sky,
            label: d.name ? d.name.split(" ")[0] : "Driver",
          }))
      );
    };
    const socket = getSocket() || connectSocket();
    socket.on("drivers_nearby", onDrivers);
    const announce = () => {
      if (mounted && socket.connected) socket.emit("rider_online");
    };
    if (socket.connected) announce();
    else socket.on("connect", announce);
    return () => {
      mounted = false;
      socket.off("drivers_nearby", onDrivers);
      socket.off("connect", announce);
    };
  }, []);

  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = driveMarkers.map((m) => ({ ...m }));
    if (pickup) out.push({ id: "pickup", lat: pickup.lat, lng: pickup.lng, color: "#000000", label: "" });
    if (dropoff) out.push({ id: "dropoff", lat: dropoff.lat, lng: dropoff.lng, color: "#00C853", label: "" });
    return out;
  }, [driveMarkers, pickup, dropoff]);

  const route = useMemo(() => {
    if (estimate) {
      const p = parsePath(estimate.path);
      if (p.length >= 2) return p;
    }
    return undefined;
  }, [estimate]);

  function listenForRide(id: string) {
    const startedAt = Date.now();
    // Never leave the rider on "Finding your driver" indefinitely — if nothing
    // matches in time, give up cleanly and free the ride.
    const failSearch = () => {
      cleanup();
      setReqState("idle");
      setRideId(null);
      setError("No driver found nearby. Try again in a moment.");
      api(`/rides/${id}/cancel`, { method: "POST" }).catch(() => {});
    };

    const poll = setInterval(async () => {
      if (cleanupRef.current === null || getSocket() === null) return;
      if (Date.now() - startedAt > 45000) return failSearch();
      try {
        const ride = await api<Ride>(`/rides/${id}`);
        const status = ride.status;
        if (status === "accepted" || status === "arrived" || status === "in_progress") {
          cleanup();
          onOpenRide(id);
        } else if (status === "cancelled" || status === "no_driver") {
          failSearch();
        }
      } catch {}
    }, 4000);

    const cleanup = () => {
      clearInterval(poll);
      const s = getSocket();
      if (s) s.off("ride_status", onStatus);
      cleanupRef.current = null;
    };
    function onStatus(ev: any) {
      if (!ev || ev.ride_id !== id) return;
      const status = ev.status || ev.from_status || "";
      if (status === "accepted" || status === "arrived" || status === "in_progress") {
        cleanup();
        onOpenRide(id);
      } else if (status === "cancelled" || status === "no_driver" || status === "declined") {
        cleanup();
        setReqState("idle");
        setRideId(null);
        setError("No driver available right now. Try again.");
      }
    }
    cleanupRef.current = cleanup;
    const socket = getSocket();
    if (!socket) return;
    socket.on("ride_status", onStatus);
  }

  async function submitRequest() {
    if (!pickup || !dropoff || reqState !== "idle") return;
    setError("");
    setReqState("requesting");
    try {
      const token = await getToken();
      const socket = connectSocket(token || "");
      if (socket.connected) socket.emit("rider_online");
      const ride = await api<Ride>("/rides", {
        method: "POST",
        body: {
          pickup_place_id: pickup.id === "current-location" ? undefined : pickup.id,
          dropoff_place_id: dropoff.id,
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          pickup_name: pickup.name,
          dropoff_lat: dropoff.lat,
          dropoff_lng: dropoff.lng,
          dropoff_name: dropoff.name,
        },
      });
      setRideId(ride.id);
      setReqState("finding");
      listenForRide(ride.id);
    } catch (e: any) {
      setError(e.message || "Could not request a ride.");
      setReqState("idle");
    }
  }

  async function cancelRequest() {
    if (cleanupRef.current) cleanupRef.current();
    setReqState("idle");
    setRideId(null);
    if (rideId) {
      try {
        await api(`/rides/${rideId}/cancel`, { method: "POST" });
      } catch {}
    }
  }

  const mapCenter =
    pickup && dropoff
      ? { lat: (pickup.lat + dropoff.lat) / 2, lng: (pickup.lng + dropoff.lng) / 2 }
      : pickup
      ? { lat: pickup.lat, lng: pickup.lng }
      : SUVA;

  const zoom =
    pickup && dropoff
      ? Math.max(0.02, Math.abs(pickup.lat - dropoff.lat) + Math.abs(pickup.lng - dropoff.lng)) * 2.2 + 0.01
      : 0.04;

  const showRideOptions = !!dropoff;

  return (
    <View style={styles.screen}>
      <MapView
        center={mapCenter}
        zoom={pinMode ? PIN_ZOOM_DEG : zoom}
        markers={markers}
        route={route}
        recenterToken={recenterToken}
        onMapClick={pinMode ? handleMapClick : undefined}
        style={StyleSheet.absoluteFill}
      />

      {pinMode ? (
        <View style={[styles.pinBanner, { top: insets.top + 8 }]}>
          <View style={styles.pinBannerTextWrap}>
            {resolvingPin ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.pinBannerIcon}>📌</Text>
            )}
            <Text style={styles.pinBannerText}>
              {resolvingPin
                ? "Looking up that address…"
                : `Tap the map to set your ${pinMode === "pickup" ? "pickup" : "drop-off"}`}
            </Text>
          </View>
          <TouchableOpacity onPress={cancelPinMode} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.pinCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {reqState === "finding" || reqState === "requesting" ? (
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.grabber} />
          <View style={styles.findingWrap}>
            <ActivityIndicator size="large" color="#000" />
            <Text style={styles.findingTitle}>Finding your driver</Text>
            <Text style={styles.findingSub}>Matching you with the nearest available driver</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={cancelRequest}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.grabber} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.ocean}
                colors={[colors.ocean]}
              />
            }
          >
            <View style={styles.sheetTopRow}>
              <Text style={styles.sheetTopHint}>
                {refreshing
                  ? "Refreshing…"
                  : lastRefresh
                  ? `Updated ${lastRefresh}`
                  : "Swipe down to refresh"}
              </Text>
              <TouchableOpacity
                style={styles.refreshPill}
                onPress={onRefresh}
                disabled={refreshing}
                activeOpacity={0.7}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.refreshPillText}>↻ Refresh</Text>
                )}
              </TouchableOpacity>
            </View>
            {!showRideOptions ? (
              <>
                <TouchableOpacity style={styles.whereBar} activeOpacity={0.7} onPress={() => setPickerOpen("dropoff")}>
                  <Text style={styles.whereBarIcon}>🔍</Text>
                  <Text style={styles.whereBarText}>Where to?</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.wherePinBtn} activeOpacity={0.7} onPress={() => startPinMode("dropoff")}>
                  <Text style={styles.wherePinIcon}>📍</Text>
                  <Text style={styles.wherePinText}>Drop a pin on the map instead</Text>
                </TouchableOpacity>

                <Text style={styles.sectionLabel}>Saved places</Text>
                <View style={styles.savedList}>
                  {SAVED_PLACES.map((sp) => {
                    const p = places.find((pl) => pl.id === sp.id);
                    const seed = PLACES.find((pl) => pl.id === sp.id);
                    return (
                      <TouchableOpacity
                        key={sp.id}
                        style={styles.savedRow}
                        activeOpacity={0.6}
                        onPress={() => {
                          setDropoff(
                            p ||
                              seed || {
                                id: sp.id,
                                name: sp.name,
                                short_name: sp.name,
                                type: "city",
                                lat: SUVA.lat,
                                lng: SUVA.lng,
                                region: "Suva",
                              }
                          );
                        }}
                      >
                        <View style={styles.savedIconWrap}>
                          <Text style={styles.savedIcon}>{sp.icon}</Text>
                        </View>
                        <View style={styles.savedText}>
                          <Text style={styles.savedName}>{sp.name}</Text>
                          <Text style={styles.savedSub}>{sp.sub}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}
              </>
            ) : (
              <>
                <View style={styles.routeInputs}>
                  <View style={styles.routeDotCol}>
                    <View style={styles.routeDotBlack} />
                    <View style={styles.routeLine} />
                    <View style={styles.routeDotGreen} />
                  </View>
                  <View style={styles.routeInputsCol}>
                    <TouchableOpacity
                      style={styles.routeInput}
                      activeOpacity={0.7}
                      onPress={() => setPickerOpen("pickup")}
                    >
                      <Text style={styles.routeInputText} numberOfLines={1}>
                        {pickup?.name || "Set pickup"}
                      </Text>
                      {locating ? <ActivityIndicator size="small" color="#999" /> : null}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.routeInput, styles.routeInputLast]}
                      activeOpacity={0.7}
                      onPress={() => setPickerOpen("dropoff")}
                    >
                      <Text style={[styles.routeInputText, styles.routeInputDest]} numberOfLines={1}>
                        {dropoff?.name || "Where to?"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.pinChips}>
                  <TouchableOpacity style={styles.pinChip} activeOpacity={0.7} onPress={() => startPinMode("pickup")}>
                    <Text style={styles.pinChipText}>📌 Pin pickup</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.pinChip} activeOpacity={0.7} onPress={() => startPinMode("dropoff")}>
                    <Text style={styles.pinChipText}>📍 Pin drop-off</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.sectionLabel}>Choose a ride</Text>

                <View style={styles.rideCard}>
                  <View style={styles.rideIconWrap}>
                    <Text style={styles.rideIcon}>🏄</Text>
                  </View>
                  <View style={styles.rideInfo}>
                    <Text style={styles.rideName}>Pointbreak Go</Text>
                    <Text style={styles.rideEta}>
                      {estimate ? `${fmtDuration(estimate.duration_min)} · ${fmtKm(estimate.distance_km)}` : "Calculating…"}
                    </Text>
                  </View>
                  <Text style={styles.rideFare}>{estimate ? fmtFare(estimate.fare) : "—"}</Text>
                </View>

                {estimate?.routed ? (
                  <Text style={styles.roadBadge}>Road distance & time</Text>
                ) : estimating ? (
                  <View style={styles.roadBadgeRow}>
                    <ActivityIndicator size="small" color="#999" />
                    <Text style={styles.roadBadge}>Confirming on roads…</Text>
                  </View>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.requestBtn, !estimate && styles.requestBtnDisabled]}
                  disabled={!estimate}
                  onPress={submitRequest}
                >
                  <Text style={styles.requestBtnText}>Request Pointbreak Go</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.changeDestBtn} onPress={() => setDropoff(null)}>
                  <Text style={styles.changeDestText}>Change destination</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      )}

      <PlacePicker
        places={places}
        label="Pickup"
        open={pickerOpen === "pickup"}
        onClose={() => setPickerOpen(null)}
        onSelect={setPickup}
      />
      <PlacePicker
        places={places}
        label="Dropoff"
        open={pickerOpen === "dropoff"}
        onClose={() => setPickerOpen(null)}
        onSelect={(p) => setDropoff(p)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
  },

  /* ---- Uber-style white bottom sheet ---- */
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: "62%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 16,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#DDD",
    alignSelf: "center",
    marginBottom: 14,
  },
  whereBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F3F3",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    marginBottom: 18,
  },
  whereBarIcon: {
    fontSize: 15,
  },
  whereBarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#999",
  },

  sheetTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    marginBottom: 10,
  },
  sheetTopHint: { fontSize: 11, color: "#AAA", flex: 1 },
  refreshPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F3F3",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 84,
  },
  refreshPillText: { fontSize: 12, fontWeight: "700", color: "#333" },

  /* ---- Pin-drop controls ---- */
  wherePinBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F3F3",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 18,
  },
  wherePinIcon: { fontSize: 14 },
  wherePinText: { fontSize: 14, fontWeight: "600", color: "#555" },
  pinChips: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  pinChip: {
    flex: 1,
    backgroundColor: "#F3F3F3",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  pinChipText: { fontSize: 13, fontWeight: "600", color: "#333" },
  pinBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  pinBannerTextWrap: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  pinBannerIcon: { fontSize: 15 },
  pinBannerText: { fontSize: 14, fontWeight: "600", color: "#000", flex: 1 },
  pinCancel: { fontSize: 14, fontWeight: "700", color: "#D32F2F" },

  /* ---- Saved places list ---- */
  savedList: {
    gap: 2,
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#EEE",
  },
  savedIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3F3F3",
    alignItems: "center",
    justifyContent: "center",
  },
  savedIcon: {
    fontSize: 18,
  },
  savedText: {
    flex: 1,
  },
  savedName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#000",
  },
  savedSub: {
    fontSize: 12,
    color: "#888",
    marginTop: 1,
  },

  /* ---- Route inputs (pickup / dropoff) ---- */
  routeInputs: {
    flexDirection: "row",
    marginBottom: 20,
    gap: 12,
  },
  routeDotCol: {
    alignItems: "center",
    paddingTop: 16,
    width: 14,
  },
  routeDotBlack: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#000",
  },
  routeLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#DDD",
    marginVertical: 4,
  },
  routeDotGreen: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: "#00C853",
  },
  routeInputsCol: {
    flex: 1,
    gap: 8,
  },
  routeInput: {
    backgroundColor: "#F3F3F3",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  routeInputLast: {
    marginBottom: 0,
  },
  routeInputText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#000",
    flex: 1,
  },
  routeInputDest: {
    color: "#666",
  },

  /* ---- Section label ---- */
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 10,
  },

  /* ---- Ride option card ---- */
  rideCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F6F6F6",
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 2,
    borderColor: "#000",
  },
  rideIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  rideIcon: {
    fontSize: 24,
  },
  rideInfo: {
    flex: 1,
  },
  rideName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
  },
  rideEta: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  rideFare: {
    fontSize: 16,
    fontWeight: "800",
    color: "#000",
  },

  /* ---- Road badge ---- */
  roadBadge: {
    fontSize: 11,
    color: "#888",
    textAlign: "center",
    marginTop: 8,
    fontWeight: "600",
  },
  roadBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
  },

  /* ---- Request button (black, Uber-style) ---- */
  requestBtn: {
    marginTop: 16,
    backgroundColor: "#000",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  requestBtnDisabled: {
    opacity: 0.4,
  },
  requestBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  changeDestBtn: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  changeDestText: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },

  /* ---- Finding driver ---- */
  findingWrap: {
    alignItems: "center",
    paddingVertical: 24,
  },
  findingTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#000",
    marginTop: 16,
  },
  findingSub: {
    fontSize: 14,
    color: "#888",
    marginTop: 6,
    textAlign: "center",
  },
  cancelBtn: {
    marginTop: 24,
    backgroundColor: "#F3F3F3",
    borderRadius: 10,
    paddingHorizontal: 40,
    paddingVertical: 14,
  },
  cancelBtnText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "700",
  },

  error: {
    color: "#D32F2F",
    fontSize: 13,
    marginTop: 10,
    textAlign: "center",
  },
});
