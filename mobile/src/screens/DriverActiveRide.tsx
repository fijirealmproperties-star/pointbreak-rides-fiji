import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, typography, fmtFare, fmtKm, fmtDuration } from "../theme";
import { api, getToken, Ride, parsePath } from "../api";
import { connectSocket, getSocket } from "../socket";
import { isDriverApp } from "../appMode";
import { bearing, haversine, watchCurrentLocation } from "../geo";
import MapView, { MapMarker, MapPoint } from "../components/MapView";
import TaxiMeter from "../components/TaxiMeter";

type Props = {
  rideId: string;
  onDone: () => void;
};

const REROUTE_MOVE_M = 60;
const REROUTE_MIN_GAP_MS = 6000;
const OFF_ROUTE_M = 35;

// Distance (m) from a point to the nearest segment of the route.
function distanceToRouteM(path: MapPoint[], lat: number, lng: number): number {
  if (path.length < 2) return Infinity;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = (path[i].lng - lng) * kx;
    const ay = (path[i].lat - lat) * ky;
    const bx = (path[i + 1].lng - lng) * kx;
    const by = (path[i + 1].lat - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

export default function DriverActiveRide({ rideId, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selfPos, setSelfPos] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [locationError, setLocationError] = useState("");
  const [liveRoute, setLiveRoute] = useState<MapPoint[] | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const mountedRef = useRef(true);
  const rerouteRef = useRef<{ lat: number; lng: number; at: number; busy: boolean; status: string } | null>(null);
  const liveRouteRef = useRef<MapPoint[] | null>(null);
  liveRouteRef.current = liveRoute;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const token = await getToken();
      const socket = getSocket() || connectSocket(token || "");
      const onStatus = (ev: any) => {
        if (!ev || ev.ride_id !== rideId) return;
        if (ev.ride && ev.ride.status) setRide(ev.ride);
        else if (ev.status) setRide((r) => (r ? { ...r, status: ev.status } : r));
      };
      const onLoc = (ev: any) => {
        if (!ev || ev.ride_id !== rideId) return;
        setRide((r) => {
          if (!r) return r;
          const next: Ride = { ...r };
          if (typeof ev.driver_lat === "number" && typeof ev.driver_lng === "number") {
            next.driver_lat = ev.driver_lat;
            next.driver_lng = ev.driver_lng;
          }
          if (typeof ev.meter_distance_km === "number") next.meter_distance_km = ev.meter_distance_km;
          if (typeof ev.meter_fare === "number") next.meter_fare = ev.meter_fare;
          if (typeof ev.meter_wait_min === "number") next.meter_wait_min = ev.meter_wait_min;
          if (typeof ev.speed_kmh === "number") {
            next.speed_kmh = ev.speed_kmh;
            next.stopped_sec = typeof ev.stopped_sec === "number" ? ev.stopped_sec : 0;
            next.stopped_recv_at = Date.now();
          }
          return next;
        });
        if (typeof ev.driver_lat === "number" && typeof ev.driver_lng === "number") {
          setSelfPos({ lat: ev.driver_lat, lng: ev.driver_lng });
        }
      };
      socket.on("ride_status", onStatus);
      socket.on("ride_location_update", onLoc);
      socket.emit("ride_subscribe", { ride_id: rideId });
      return () => {
        mounted = false;
        socket.off("ride_status", onStatus);
        socket.off("ride_location_update", onLoc);
      };
    })();
  }, [rideId]);


  const load = useCallback(async () => {
    try {
      const d = await api<Ride>(`/rides/${rideId}`);
      setRide(d);
      setError("");
    } catch (e: any) {
      setError(e.message || "Could not load ride.");
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    load();
  }, [load]);

  const status = ride?.status || "accepted";
  const path = useMemo(() => parsePath(ride?.path_json), [ride?.path_json]);
  const pLat = ride?.pickup_lat;
  const pLng = ride?.pickup_lng;
  const dLat = ride?.dropoff_lat;
  const dLng = ride?.dropoff_lng;
  const route: MapPoint[] = useMemo(() => {
    if (liveRoute && liveRoute.length >= 2 && status !== "arrived") return liveRoute;
    if (path.length >= 2) return path;
    if (pLat == null || pLng == null || dLat == null || dLng == null) return [];
    return [
      { lat: pLat, lng: pLng },
      { lat: pLat + (dLat - pLat) * 0.25, lng: pLng + (dLng - pLng) * 0.25 },
      { lat: pLat + (dLat - pLat) * 0.6, lng: pLng + (dLng - pLng) * 0.6 },
      { lat: dLat, lng: dLng },
    ];
  }, [path, pLat, pLng, dLat, dLng, liveRoute, status]);

  const markers: MapMarker[] = useMemo(() => {
    if (pLat == null || pLng == null || dLat == null || dLng == null) return [];
    return [
      { id: "pickup", lat: pLat, lng: pLng, color: colors.green, label: "Pickup" },
      { id: "dropoff", lat: dLat, lng: dLng, color: colors.coral, label: "Dropoff" },
    ];
  }, [pLat, pLng, dLat, dLng]);

  const self = selfPos;

  const target: MapPoint | null = ride
    ? status === "in_progress"
      ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng }
      : { lat: ride.pickup_lat, lng: ride.pickup_lng }
    : null;

  useEffect(() => {
    if (!ride || !["accepted", "arrived", "in_progress"].includes(status)) return;

    // Fetch a fresh road route from the current position; called when the driver
    // has moved far enough (about one block) or strayed off the planned path.
    const maybeReroute = (lat: number, lng: number) => {
      const st = rerouteRef.current;
      const now = Date.now();
      if (st && st.busy) return;
      if (status === "arrived") return;
      const statusChanged = !st || st.status !== status;
      const moved = st ? haversine(st.lat, st.lng, lat, lng) * 1000 : Infinity;
      const live = liveRouteRef.current;
      const off = live && live.length >= 2 ? distanceToRouteM(live, lat, lng) > OFF_ROUTE_M : false;
      if (!statusChanged && !(moved >= REROUTE_MOVE_M || off)) return;
      if (st && !statusChanged && now - st.at < REROUTE_MIN_GAP_MS) return;
      rerouteRef.current = { lat, lng, at: now, busy: true, status };
      api<{ routed: boolean; path?: MapPoint[] }>(`/rides/${rideId}/reroute`, {
        method: "POST",
        body: { lat, lng },
      })
        .then((r) => {
          if (mountedRef.current && r && r.routed && Array.isArray(r.path) && r.path.length >= 2) {
            setLiveRoute(r.path);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (rerouteRef.current) rerouteRef.current.busy = false;
        });
    };

    let lastSent: { lat: number; lng: number; at: number } | null = null;
    return watchCurrentLocation(
      (position) => {
        setSelfPos({ lat: position.lat, lng: position.lng });
        setGpsAccuracy(position.accuracy);
        setLocationError("");
        setRide((current) =>
          current ? { ...current, driver_lat: position.lat, driver_lng: position.lng } : current
        );
        if (position.accuracy == null || position.accuracy < 100) maybeReroute(position.lat, position.lng);

        const now = Date.now();
        const movedKm = lastSent
          ? haversine(lastSent.lat, lastSent.lng, position.lat, position.lng)
          : Infinity;
        if (lastSent && movedKm < 0.005 && now - lastSent.at < 5000) return;
        lastSent = { lat: position.lat, lng: position.lng, at: now };

        getSocket()?.emit("driver_location", {
          ride_id: rideId,
          lat: position.lat,
          lng: position.lng,
          accuracy: position.accuracy,
          speed: position.speed,
        });
        api("/drivers/location", {
          method: "POST",
          body: { lat: position.lat, lng: position.lng },
        }).catch((e: any) => setLocationError(e.message || "Could not update your location."));
      },
      (e) => setLocationError(e.message),
    );
  }, [rideId, !!ride, status]);

  const selfAngle = useMemo(() => {
    if (!self || !target) return 0;
    return bearing(self.lat, self.lng, target.lat, target.lng);
  }, [self, target]);

  const mapCenter = useMemo(() => {
    if (self && target && ride) {
      return {
        lat: (self.lat + (status === "in_progress" ? ride.dropoff_lat : ride.pickup_lat)) / 2,
        lng: (self.lng + (status === "in_progress" ? ride.dropoff_lng : ride.pickup_lng)) / 2,
      };
    }
    if (ride) {
      return { lat: (ride.pickup_lat + ride.dropoff_lat) / 2, lng: (ride.pickup_lng + ride.dropoff_lng) / 2 };
    }
    return { lat: -18.1416, lng: 178.4419 };
  }, [self, target, status, ride]);

  const mapZoom = useMemo(() => {
    if (ride) {
      const span =
        Math.abs(ride.pickup_lat - ride.dropoff_lat) + Math.abs(ride.pickup_lng - ride.dropoff_lng);
      return Math.max(0.015, span) * 2;
    }
    return 0.04;
  }, [ride]);

  async function transition(next: string, opts: { code?: string } = {}): Promise<boolean> {
    setBusy(true);
    setCodeError("");
    try {
      await api(`/rides/${rideId}/status`, {
        method: "POST",
        body: { status: next, code: opts.code },
      });
    } catch (e: any) {
      setBusy(false);
      if (next === "in_progress") {
        setCodeError(e.message || "Could not start trip.");
        return false;
      }
    }
    const socket = getSocket();
    if (socket) {
      if (next === "arrived") socket.emit("driver_arrived", { ride_id: rideId });
      else if (next === "in_progress") socket.emit("driver_start_trip", { ride_id: rideId, code: opts.code });
      else if (next === "completed") socket.emit("driver_complete_trip", { ride_id: rideId });
    }
    setRide((r) => (r ? { ...r, status: next } : r));
    setCode("");
    setBusy(false);
    return true;
  }

  async function revealCode() {
    setRevealing(true);
    setCodeError("");
    try {
      const d = await api<{ pickup_code?: string }>(`/rides/${rideId}/pickup-code`);
      if (d && d.pickup_code) setCode(d.pickup_code);
      else setCodeError("Code unavailable");
    } catch (e: any) {
      setCodeError(e.message || "Could not fetch code");
    } finally {
      setRevealing(false);
    }
  }

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.ocean} />
        <Text style={styles.loadingText}>Loading ride details…</Text>
      </View>
    );
  }

  if (!ride) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Text style={styles.errorText}>{error || "Ride not found."}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onDone}>
          <Text style={styles.primaryBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <MapView
        style={{ flex: 1 }}
        center={mapCenter}
        zoom={mapZoom}
        markers={markers}
        route={route}
        vehicle={self ? { lat: self.lat, lng: self.lng, angle: selfAngle, color: colors.ocean, icon: ride.vehicle_icon || undefined } : undefined}
      />
      <View style={styles.mapAttribution}>
        <Text style={styles.mapAttributionText}>
          {gpsAccuracy !== null
            ? `Live GPS · ±${Math.round(gpsAccuracy)} m`
            : locationError || "Waiting for accurate GPS…"}
          {" · "}{fmtKm(ride.distance_km)} trip
        </Text>
      </View>

      <View style={styles.card}>
        {status === "completed" ? (
          <View style={styles.completeBlock}>
            <Text style={styles.completeEmoji}>🌊</Text>
            <Text style={styles.completeTitle}>Trip complete!</Text>
            <Text style={styles.completeSub}>
              {ride.pickup_place} → {ride.dropoff_place} · 👥 {ride.passengers || 1}
            </Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{fmtFare(ride.fare)}</Text>
                <Text style={styles.summaryLabel}>Fare</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{fmtKm(ride.distance_km)}</Text>
                <Text style={styles.summaryLabel}>Distance</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{fmtDuration(ride.duration_min)}</Text>
                <Text style={styles.summaryLabel}>Duration</Text>
              </View>
            </View>
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16 }]} onPress={onDone}>
              <Text style={styles.primaryBtnText}>Done — back to work</Text>
            </TouchableOpacity>
          </View>
        ) : status === "requested" ? (
          <View style={styles.completeBlock}>
            <Text style={[styles.completeTitle, { color: colors.amber }]}>Offer expired</Text>
            <Text style={styles.completeSub}>This ride request is no longer active.</Text>
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16 }]} onPress={onDone}>
              <Text style={styles.primaryBtnText}>Back to home</Text>
            </TouchableOpacity>
          </View>
        ) : status === "cancelled" ? (
          <View style={styles.completeBlock}>
            <Text style={[styles.completeTitle, { color: colors.coral }]}>Ride cancelled</Text>
            <Text style={styles.completeSub}>
              {ride.cancel_fee && ride.cancel_fee > 0
                ? `The rider cancelled. You earn a ${fmtFare(ride.cancel_fee)} cancellation compensation.`
                : "The rider cancelled this trip."}
            </Text>
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16 }]} onPress={onDone}>
              <Text style={styles.primaryBtnText}>Back to home</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.modeHead}>
              <View>
                <Text style={styles.modeTitle}>
                  {status === "accepted" && "Head to pickup"}
                  {status === "arrived" && "Waiting for rider"}
                  {status === "in_progress" && `On trip to ${ride.dropoff_place}`}
                </Text>
                <Text style={styles.modeSub}>
                  {status === "accepted" && `${ride.vehicle_model || ride.vehicle_type || "Your ride"} to ${ride.pickup_place}`}
                  {status === "arrived" && "Ask the rider for their 4-digit pickup code"}
                  {status === "in_progress" && `${ride.rider_id ? "Rider on board" : "Rider on board"} · ${fmtKm(ride.distance_km)} · ${fmtDuration(ride.duration_min)}`}
                </Text>
              </View>
              <Animated.View
                style={[
                  styles.livePill,
                  {
                    borderColor: status === "arrived" ? colors.amber : colors.ocean,
                    transform: [{ scale: pulse }],
                  },
                ]}
              >
                <Text style={[styles.liveText, { color: status === "arrived" ? colors.amber : colors.ocean }]}>
                  LIVE
                </Text>
              </Animated.View>
            </View>

            <View style={styles.riderRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(ride.rider_id || "R")[0].toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.riderName}>Rider</Text>
                <Text style={styles.riderSub}>Pickup: {ride.pickup_place}</Text>
              </View>
              <Text style={styles.fare}>{fmtFare(ride.fare)}</Text>
            </View>

            {status === "in_progress" ? <TaxiMeter ride={ride} /> : null}

            <View style={styles.actions}>
              {status === "accepted" ? (
                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.green }]} onPress={() => transition("arrived")}>
                  <Text style={styles.primaryBtnText}>Arrived at Pickup</Text>
                </TouchableOpacity>
              ) : null}
              {status === "arrived" ? (
                <View style={styles.codeBox}>
                  <Text style={styles.codeLabel}>Enter rider&apos;s pickup code to start</Text>
                  <TextInput
                    style={styles.codeInput}
                    value={code}
                    onChangeText={(t) => {
                      setCode(t.replace(/[^0-9]/g, "").slice(0, 4));
                      if (codeError) setCodeError("");
                    }}
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholder="••••"
                    placeholderTextColor={colors.textMuted}
                  />
                  {codeError ? <Text style={styles.codeError}>{codeError}</Text> : null}
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: colors.ocean }, (code.length !== 4 || busy) && styles.btnDisabled]}
                    disabled={code.length !== 4 || busy}
                    onPress={() => transition("in_progress", { code })}
                  >
                    <Text style={styles.primaryBtnText}>{busy ? "Verifying…" : "Start Trip"}</Text>
                  </TouchableOpacity>
                  {isDriverApp() ? (
                    <TouchableOpacity onPress={revealCode} disabled={revealing}>
                      <Text style={styles.demoLink}>
                        {revealing ? "Fetching rider's code…" : "Demo: reveal rider's code"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              {status === "in_progress" ? (
                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.green }]} onPress={() => transition("completed")}>
                  <Text style={styles.primaryBtnText}>Complete Trip</Text>
                </TouchableOpacity>
              ) : null}

              {status === "accepted" || status === "arrived" || status === "in_progress" ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, styles.stopBtn, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={() => transition("completed")}
                >
                  <Text style={styles.stopBtnText}>Stop ride</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.deep },
  loadingText: { color: colors.textMuted, marginTop: 12 },
  errorText: { color: colors.coral, fontSize: typography.body, marginBottom: 16, textAlign: "center" },
  mapAttribution: {
    position: "absolute",
    left: 12,
    top: 48,
    backgroundColor: "rgba(10,22,40,0.75)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  mapAttributionText: { color: colors.textMuted, fontSize: typography.tiny },
  card: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    padding: 18,
  },
  modeHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  modeTitle: { color: colors.text, fontSize: typography.subtitle, fontWeight: "800", flexShrink: 1 },
  modeSub: { color: colors.textMuted, fontSize: typography.small, marginTop: 3 },
  livePill: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.deep,
  },
  liveText: { fontSize: typography.tiny, fontWeight: "800", letterSpacing: 1 },
  riderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    backgroundColor: colors.deep,
    borderRadius: 14,
    padding: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sunset,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  riderName: { color: colors.text, fontSize: typography.body, fontWeight: "700" },
  riderSub: { color: colors.textMuted, fontSize: typography.small, marginTop: 2 },
  fare: { color: colors.ocean, fontSize: typography.heading, fontWeight: "800" },
  actions: { gap: 10, marginTop: 14 },
  primaryBtn: { borderRadius: 14, padding: 15, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: typography.subtitle },
  btnDisabled: { opacity: 0.45 },
  stopBtn: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.coral,
  },
  stopBtnText: { color: colors.coral, fontWeight: "800", fontSize: typography.subtitle },
  codeBox: { gap: 10 },
  codeLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700", textAlign: "center" },
  codeInput: {
    backgroundColor: colors.deep,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    textAlign: "center",
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 14,
  },
  codeError: { color: colors.coral, fontSize: typography.small, fontWeight: "700", textAlign: "center" },
  demoLink: { color: colors.ocean, fontSize: typography.small, fontWeight: "700", textAlign: "center", textDecorationLine: "underline" },
  simBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    padding: 14,
    backgroundColor: colors.sunset,
    borderWidth: 1,
    borderColor: colors.sunset,
  },
  simBtnActive: { opacity: 0.75 },
  simBtnDone: { backgroundColor: colors.card, borderColor: colors.green },
  simBtnText: { color: "#fff", fontWeight: "800", fontSize: typography.subtitle },
  completeBlock: { alignItems: "center", paddingVertical: 6 },
  completeEmoji: { fontSize: 46 },
  completeTitle: { color: colors.text, fontSize: typography.heading, fontWeight: "800", marginTop: 8 },
  completeSub: { color: colors.textMuted, fontSize: typography.small, marginTop: 4 },
  summaryRow: { flexDirection: "row", gap: 10, marginTop: 18, alignSelf: "stretch" },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.deep,
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
  },
  summaryValue: { color: colors.text, fontSize: typography.subtitle, fontWeight: "800" },
  summaryLabel: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.4 },
});