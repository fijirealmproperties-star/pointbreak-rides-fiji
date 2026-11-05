import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import { api } from "../api";
import { colors, typography } from "../theme";

// FCCC Fiji taxi interim rates.
const DAY_FLAGFALL = 2.0; // 6:00 AM to 9:00 PM
const NIGHT_FLAGFALL = 3.0; // 9:00 PM to 6:00 AM
const DISTANCE_RATE = 0.14; // per 100 m
const WAITING_RATE = 0.18; // per minute
const SPEED_THRESHOLD_MPS = 1.11; // about 4 km/h: below this the meter charges waiting time
const MAX_ACCURACY_M = 30;

const isNight = () => {
  const h = new Date().getHours();
  return h >= 21 || h < 6;
};

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const mmss = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

export default function SurfsUpMeter({ driverId }: { driverId?: string }) {
  const [running, setRunning] = useState(false);
  const [night, setNight] = useState(isNight);
  const [fare, setFare] = useState(isNight() ? NIGHT_FLAGFALL : DAY_FLAGFALL);
  const [distM, setDistM] = useState(0);
  const [waitSec, setWaitSec] = useState(0);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [lastTotal, setLastTotal] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const sub = useRef<Location.LocationSubscription | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wake = useRef<any>(null);
  const runningRef = useRef(false);
  const last = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const speedRef = useRef(0);
  const accRef = useRef<number | null>(null);
  const baseRef = useRef(DAY_FLAGFALL);
  const distRef = useRef(0);
  const waitRef = useRef(0);
  const startedAt = useRef(0);
  const tickAt = useRef(0);
  const tripId = useRef<number | null>(null);
  const startReq = useRef<Promise<number | null>>(Promise.resolve(null));
  const tariffRef = useRef("SURFS_UP_day");

  const fareNow = () => baseRef.current + (distRef.current / 100) * DISTANCE_RATE + (waitRef.current / 60) * WAITING_RATE;

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      sub.current?.remove();
      releaseWake();
    },
    []
  );

  async function holdWake() {
    try {
      const nav: any = typeof navigator !== "undefined" ? navigator : null;
      if (nav?.wakeLock) wake.current = await nav.wakeLock.request("screen");
    } catch {}
  }
  function releaseWake() {
    try { wake.current?.release?.(); } catch {}
    wake.current = null;
  }

  useEffect(() => {
    if (!running || typeof document === "undefined") return;
    const onVis = () => { if (document.visibilityState === "visible") holdWake(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [running]);

  function paint() {
    setFare(fareNow());
    setDistM(distRef.current);
    setWaitSec(Math.floor(waitRef.current));
    setSpeedKmh(speedRef.current * 3.6);
    setAccuracy(accRef.current);
  }

  function onFix(loc: Location.LocationObject) {
    const { latitude, longitude, accuracy: acc, speed } = loc.coords;
    accRef.current = acc ?? null;
    if (acc != null && acc > MAX_ACCURACY_M) return;
    const now = Date.now();
    const prev = last.current;
    last.current = { lat: latitude, lng: longitude, t: now };
    if (!runningRef.current || !prev) return;
    const dt = (now - prev.t) / 1000;
    if (dt <= 0 || dt > 30) return;
    const d = distanceM(prev.lat, prev.lng, latitude, longitude);
    const hasSpeed = speed != null && speed >= 0;
    const mps = hasSpeed ? (speed as number) : d / dt;
    if (mps > 56) return;
    speedRef.current = mps < SPEED_THRESHOLD_MPS ? 0 : mps;
    if (mps >= SPEED_THRESHOLD_MPS) {
      // Doppler speed is steadier than raw position jumps; fall back to displacement.
      const add = hasSpeed ? mps * dt : d > 1 && d < 150 ? d : 0;
      distRef.current += add;
    }
  }

  async function hire() {
    if (runningRef.current) return;
    const n = isNight();
    setNight(n);
    baseRef.current = n ? NIGHT_FLAGFALL : DAY_FLAGFALL;
    tariffRef.current = n ? "SURFS_UP_night" : "SURFS_UP_day";
    distRef.current = 0;
    waitRef.current = 0;
    speedRef.current = 0;
    last.current = null;
    tripId.current = null;
    setLastTotal(null);
    setNote("You are now offline. Switch Online on the Home tab when the trip is done.");
    runningRef.current = true;
    startedAt.current = Date.now();
    tickAt.current = Date.now();
    setRunning(true);
    paint();
    startReq.current = api("/drivers/roadside/start", { method: "POST", body: { tariff_type: tariffRef.current } })
      .then((r: any) => { tripId.current = r?.trip_id ?? null; return tripId.current; })
      .catch(() => null);
    holdWake();
    // Real elapsed time keeps waiting charges right even if timers are throttled.
    timer.current = setInterval(() => {
      const now = Date.now();
      const dt = Math.max(0, (now - tickAt.current) / 1000);
      tickAt.current = now;
      if (speedRef.current === 0) waitRef.current += dt;
      paint();
    }, 1000);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") throw new Error("denied");
      const s = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        onFix
      );
      if (runningRef.current) sub.current = s;
      else s.remove();
    } catch {
      Alert.alert("Location needed", "Allow location access so the meter can measure distance.");
    }
  }

  function endTrip() {
    if (!runningRef.current) return;
    runningRef.current = false;
    setRunning(false);
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    sub.current?.remove();
    sub.current = null;
    releaseWake();
    const total = Number(fareNow().toFixed(2));
    const body = {
      trip_id: tripId.current,
      tariff_type: tariffRef.current,
      total_fare: total,
      trip_duration_seconds: Math.round((Date.now() - startedAt.current) / 1000),
      trip_distance_km: Number((distRef.current / 1000).toFixed(2)),
    };
    setLastTotal(total);
    setNote(null);
    startReq.current.then(async (id) => {
      try { await api("/drivers/roadside", { method: "POST", body: { ...body, trip_id: body.trip_id ?? id } }); } catch {}
    });
  }

  function reset() {
    if (runningRef.current) return;
    const n = isNight();
    setNight(n);
    baseRef.current = n ? NIGHT_FLAGFALL : DAY_FLAGFALL;
    distRef.current = 0;
    waitRef.current = 0;
    speedRef.current = 0;
    accRef.current = null;
    setLastTotal(null);
    setNote(null);
    paint();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Surfs Up Meter</Text>
      <Text style={styles.tariff}>
        {night ? "Night Tariff ($3.00 Flagfall)" : "Day Tariff ($2.00 Flagfall)"}
      </Text>

      <View style={styles.fareBox}>
        <Text style={styles.cur}>FJD</Text>
        <Text style={styles.amount}>{fare.toFixed(2)}</Text>
      </View>

      <View style={styles.grid}>
        <Stat label="Distance" value={`${(distM / 1000).toFixed(2)} km`} />
        <Stat label="Waiting Time" value={mmss(waitSec)} />
        <Stat label="Speed" value={`${speedKmh.toFixed(1)} km/h`} />
        <Stat label="GPS Accuracy" value={accuracy != null ? `±${Math.round(accuracy)}m` : "--"} />
      </View>

      <TouchableOpacity style={[styles.btn, styles.start, running && styles.off]} disabled={running} onPress={hire}>
        <Text style={styles.btnText}>HIRE (Start Trip)</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.stop, !running && styles.off]} disabled={!running} onPress={endTrip}>
        <Text style={styles.btnText}>STOP (End Trip)</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.reset, running && styles.off]} disabled={running} onPress={reset}>
        <Text style={[styles.btnText, { color: "#fff" }]}>RESET</Text>
      </TouchableOpacity>

      {lastTotal !== null && !running ? (
        <View style={styles.totalCard}>
          <Text style={styles.label}>Total fare for the trip just ended</Text>
          <Text style={styles.totalVal}>FJ$ {lastTotal.toFixed(2)}</Text>
        </View>
      ) : null}
      {note ? <Text style={styles.saved}>{note}</Text> : null}
      <Text style={styles.status}>
        FJ$0.14 per 100 m (FJ$1.40/km) while moving, FJ$0.18 per minute waiting under 4 km/h. GPS fixes worse than 30 m are ignored. Keep the app open during a trip.
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.statVal}>{value}</Text>
    </View>
  );
}

const mono = Platform.OS === "ios" ? "Courier" : "monospace";
const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: "#1e1e1e", borderRadius: 16 },
  title: { fontSize: 22, fontWeight: "bold", color: "#ffcc00", textAlign: "center", marginBottom: 12 },
  tariff: { textAlign: "center", fontSize: 13, fontWeight: "bold", backgroundColor: "#333", color: "#ffcc00", paddingVertical: 6, borderRadius: 20, marginBottom: 18, overflow: "hidden" },
  fareBox: { flexDirection: "row", justifyContent: "center", alignItems: "flex-start", marginBottom: 20 },
  cur: { fontSize: 24, color: "#ffcc00", marginTop: 6, marginRight: 6 },
  amount: { fontSize: 56, fontWeight: "bold", color: "#ffcc00", fontFamily: mono },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  stat: { width: "48%", backgroundColor: "#2a2a2a", padding: 12, borderRadius: 8, alignItems: "center", marginBottom: 12 },
  label: { fontSize: 11, color: "#aaa", textTransform: "uppercase", marginBottom: 4 },
  statVal: { fontSize: 18, fontWeight: "bold", color: "#fff", fontFamily: mono },
  btn: { padding: 16, borderRadius: 8, alignItems: "center", marginTop: 10 },
  start: { backgroundColor: "#03dac6" },
  stop: { backgroundColor: "#cf6679" },
  reset: { backgroundColor: "#444" },
  off: { opacity: 0.4 },
  btnText: { fontSize: 17, fontWeight: "bold", color: "#000" },
  totalCard: { backgroundColor: "#0f3d2a", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 14 },
  totalVal: { fontSize: 30, fontWeight: "bold", color: "#22CC66", marginTop: 4 },
  saved: { color: colors.green, textAlign: "center", marginTop: 12, fontSize: typography.small },
  status: { color: "#777", textAlign: "center", marginTop: 12, fontSize: 11 },
});
