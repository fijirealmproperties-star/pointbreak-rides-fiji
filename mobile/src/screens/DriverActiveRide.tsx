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
import { bearing, haversine, interpolatePoint } from "../geo";
import MapView, { MapMarker, MapPoint } from "../components/MapView";
import TaxiMeter from "../components/TaxiMeter";

type Props = {
  rideId: string;
  onDone: () => void;
};

const SIM_SPEED_KMH = 42;
const SIM_TICK_MS = 1000;
const SIM_TARGET_SECONDS = 10;

function pathLengthMeters(path: MapPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += haversine(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng) * 1000;
  }
  return total;
}

function positionAlongPath(
  path: MapPoint[],
  distMeters: number
): { lat: number; lng: number } {
  let remaining = distMeters;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segKm = haversine(a.lat, a.lng, b.lat, b.lng);
    if (segKm === 0) continue;
    const segM = segKm * 1000;
    if (remaining <= segM) {
      return interpolatePoint(a.lat, a.lng, b.lat, b.lng, Math.max(0, remaining / segM));
    }
    remaining -= segM;
  }
  return path[path.length - 1];
}

export default function DriverActiveRide({ rideId, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selfPos, setSelfPos] = useState<{ lat: number; lng: number } | null>(null);
  const [simming, setSimming] = useState(false);
  const [simDone, setSimDone] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const mountedRef = useRef(true);
  const simRef = useRef<{
    timer: ReturnType<typeof setInterval> | null;
    traveled: number;
    target: MapPoint;
    speedMps: number;
    startStatus: string;
  }>({
    timer: null,
    traveled: 0,
    target: { lat: 0, lng: 0 },
    speedMps: (SIM_SPEED_KMH / 3600) * 1000,
    startStatus: "accepted",
  });

  const stopSim = useCallback(() => {
    if (simRef.current.timer) {
      clearInterval(simRef.current.timer);
      simRef.current.timer = null;
    }
    setSimming(false);
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
        if (ev.status === "completed" || ev.status === "cancelled") stopSim();
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
  }, [rideId, stopSim]);

  // cleanup simulation on unmount
  useEffect(() => () => stopSim(), [stopSim]);

  const load = useCallback(async () => {
    try {
      const d = await api<Ride>(`/rides/${rideId}`);
      setRide(d);
      setError("");
      if (typeof d.driver_lat === "number" && typeof d.driver_lng === "number") {
        setSelfPos({ lat: d.driver_lat, lng: d.driver_lng });
      }
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
    if (path.length >= 2) return path;
    if (pLat == null || pLng == null || dLat == null || dLng == null) return [];
    return [
      { lat: pLat, lng: pLng },
      { lat: pLat + (dLat - pLat) * 0.25, lng: pLng + (dLng - pLng) * 0.25 },
      { lat: pLat + (dLat - pLat) * 0.6, lng: pLng + (dLng - pLng) * 0.6 },
      { lat: dLat, lng: dLng },
    ];
  }, [path, pLat, pLng, dLat, dLng]);

  const markers: MapMarker[] = useMemo(() => {
    if (pLat == null || pLng == null || dLat == null || dLng == null) return [];
    return [
      { id: "pickup", lat: pLat, lng: pLng, color: colors.green, label: "Pickup" },
      { id: "dropoff", lat: dLat, lng: dLng, color: colors.coral, label: "Dropoff" },
    ];
  }, [pLat, pLng, dLat, dLng]);

  const self = selfPos || (ride && ride.driver_lat != null && ride.driver_lng != null
    ? { lat: ride.driver_lat, lng: ride.driver_lng }
    : null);

  const target: MapPoint | null = ride
    ? status === "in_progress"
      ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng }
      : { lat: ride.pickup_lat, lng: ride.pickup_lng }
    : null;

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
    if (next === "completed") stopSim();
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

  function startSimulation() {
    if (!ride || !target) return;
    if (simRef.current.timer) return;
    const pts = route.length >= 2 ? route : [
      { lat: ride.pickup_lat, lng: ride.pickup_lng },
      { lat: ride.dropoff_lat, lng: ride.dropoff_lng },
    ];
    const base = self || { lat: pts[0].lat, lng: pts[0].lng };
    simRef.current.traveled = 0;
    simRef.current.target = target;
    simRef.current.startStatus = status;
    const simPath = [base, ...pts, target];
    // Cover the whole path in a predictable ~10s so long approaches don't crawl.
    const totalM = pathLengthMeters(simPath);
    const naturalMps = (SIM_SPEED_KMH / 3600) * 1000;
    simRef.current.speedMps = Math.max(naturalMps, totalM / SIM_TARGET_SECONDS);
    setSimming(true);
    setSimDone(false);
    const socket = getSocket();
    const tick = () => {
      if (!mountedRef.current) {
        stopSim();
        return;
      }
      simRef.current.traveled += simRef.current.speedMps;
      const pos = positionAlongPath(simPath, simRef.current.traveled);
      setSelfPos(pos);
      setRide((r) => (r ? { ...r, driver_lat: pos.lat, driver_lng: pos.lng } : r));
      if (socket) socket.emit("driver_location", { ride_id: rideId, lat: pos.lat, lng: pos.lng });
      try {
        api("/drivers/location", { method: "POST", body: { lat: pos.lat, lng: pos.lng } });
      } catch {
        // backend may not persist location — live socket is enough
      }
      const distToTarget = haversine(pos.lat, pos.lng, target.lat, target.lng);
      if (distToTarget < 0.05) {
        stopSim();
        setSimDone(true);
        // Reached the pickup while heading there — advance so the code prompt appears.
        if (simRef.current.startStatus === "accepted") {
          transition("arrived");
        }
      }
    };
    simRef.current.timer = setInterval(tick, SIM_TICK_MS);
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
        vehicle={self ? { lat: self.lat, lng: self.lng, angle: selfAngle, color: colors.ocean } : undefined}
      />
      <View style={styles.mapAttribution}>
        <Text style={styles.mapAttributionText}>You · {fmtKm(ride.distance_km)} trip</Text>
      </View>

      <View style={styles.card}>
        {status === "completed" ? (
          <View style={styles.completeBlock}>
            <Text style={styles.completeEmoji}>🌊</Text>
            <Text style={styles.completeTitle}>Trip complete!</Text>
            <Text style={styles.completeSub}>
              {ride.pickup_place} → {ride.dropoff_place}
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
            <Text style={styles.completeSub}>The rider cancelled this trip.</Text>
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

              <TouchableOpacity
                style={[styles.simBtn, simming && styles.simBtnActive, simDone && styles.simBtnDone]}
                onPress={startSimulation}
                disabled={simming}
              >
                <Text style={styles.simBtnText}>
                  {simming ? "Simulating… driving live" : simDone ? "Simulation reached target" : "Simulate Driving"}
                </Text>
                {simming ? <ActivityIndicator size="small" color="#fff" /> : null}
              </TouchableOpacity>
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