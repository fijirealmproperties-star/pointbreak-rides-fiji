import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api";
import { nativeGpsAvailable } from "../nativeGps";
import { startMeterGps } from "../meterGps";
import { colors, typography } from "../theme";

const TRIP_KEY = "pb-active-trip";

// Fiji FCCC regulated rates.
const FIJI_TARIFFS = {
  VITI_LEVU: {
    day: { base: 2.0, perKm: 1.4, perMin: 0.18 },
    night: { base: 3.0, perKm: 1.4, perMin: 0.18 },
  },
  VANUA_LEVU_OUTER: {
    day: { base: 2.3, perKm: 1.4, perMin: 0.18 },
    night: { base: 3.3, perKm: 1.4, perMin: 0.18 },
  },
  NADI_AIRPORT: {
    allTimes: { base: 5.0, perKm: 2.1, perMin: 0.18 },
  },
  OTHER_AIRPORT: {
    allTimes: { base: 7.1, perKm: 1.4, perMin: 0.18 },
  },
} as const;
type Region = keyof typeof FIJI_TARIFFS;
type Period = "day" | "night";
type Rate = { base: number; perKm: number; perMin: number };

const REGIONS: Array<{ key: Region; label: string }> = [
  { key: "VITI_LEVU", label: "VITI LEVU" },
  { key: "VANUA_LEVU_OUTER", label: "VANUA LEVU / OUTER" },
  { key: "NADI_AIRPORT", label: "NADI AIRPORT" },
  { key: "OTHER_AIRPORT", label: "OTHER AIRPORT" },
];

function getRate(region: Region, period: Period): Rate {
  const t = FIJI_TARIFFS[region] as any;
  return t.allTimes || t[period];
}
const isAirport = (r: Region) => r === "NADI_AIRPORT" || r === "OTHER_AIRPORT";

// Below this speed the meter charges waiting time; above it, distance.
const WAIT_SPEED_KMH = 15;
const MAX_ACCURACY_M = 50;

function autoPeriod(): Period {
  const h = new Date().getHours();
  return h >= 22 || h < 5 ? "night" : "day";
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const formatTime = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

export default function RoadsideMeter({ driverId }: { driverId?: string }) {
  const [region, setRegion] = useState<Region>("VITI_LEVU");
  const [period, setPeriod] = useState<Period>(autoPeriod);
  const [isRunning, setIsRunning] = useState(false);
  const [fare, setFare] = useState<number>(getRate("VITI_LEVU", autoPeriod()).base);
  const [distance, setDistance] = useState(0);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [gpsAcc, setGpsAcc] = useState<number | null>(null);
  const accRef = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [lastTotal, setLastTotal] = useState<number | null>(null);

  const sub = useRef<(() => void) | null>(null);
  const lastFixAt = useRef(0);
  const rawAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const last = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const speedRef = useRef(0);
  const fareRef = useRef<number>(getRate("VITI_LEVU", autoPeriod()).base);
  const distRef = useRef(0);
  const secRef = useRef(0);
  const tripId = useRef<number | null>(null);
  const wakeLock = useRef<any>(null);
  const runningRef = useRef(false);
  const startReq = useRef<Promise<number | null>>(Promise.resolve(null));
  const regionRef = useRef<Region>("VITI_LEVU");
  const periodRef = useRef<Period>(autoPeriod());
  const lastTick = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      sub.current?.();
      releaseWake();
    },
    []
  );

  async function holdWake() {
    try {
      const nav: any = typeof navigator !== "undefined" ? navigator : null;
      if (nav?.wakeLock) wakeLock.current = await nav.wakeLock.request("screen");
    } catch {}
  }

  function releaseWake() {
    try { wakeLock.current?.release?.(); } catch {}
    wakeLock.current = null;
  }

  // The screen lock is dropped when the page is hidden; take it again on return.
  useEffect(() => {
    if (!isRunning || typeof document === "undefined") return;
    const onVis = () => { if (document.visibilityState === "visible") holdWake(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isRunning]);

  // Only refs change on each GPS fix or tick; the screen redraws once a second.
  function addFare(amount: number) {
    fareRef.current += amount;
  }
  const tickCount = useRef(0);

  function pick(nextRegion: Region, nextPeriod: Period) {
    setRegion(nextRegion);
    setPeriod(nextPeriod);
    fareRef.current = getRate(nextRegion, nextPeriod).base;
    setFare(fareRef.current);
  }

  async function startMeter() {
    if (runningRef.current) return;
    regionRef.current = region;
    periodRef.current = period;
    const rates = getRate(region, period);
    const tariffKey = isAirport(region) ? region : `${region}_${period}`;
    fareRef.current = rates.base;
    distRef.current = 0;
    secRef.current = 0;
    speedRef.current = 0;
    last.current = null;
    tripId.current = null;
    setFare(rates.base);
    setDistance(0);
    setSeconds(0);
    setLastTotal(null);
    setSaved("You are now offline. Switch Online on the Home tab when the trip is done.");
    setIsRunning(true);
    // The meter starts instantly; the server is told in the background.
    startReq.current = api("/drivers/roadside/start", { method: "POST", body: { tariff_type: tariffKey } })
      .then((r: any) => { tripId.current = r?.trip_id ?? null; return tripId.current; })
      .catch(() => null);
    try {
      await runLoop(rates);
    } catch {
      setSaved("Location needed: allow location access in the browser or phone settings so the meter can measure distance.");
    }
  }
  async function runLoop(rates: Rate) {
    runningRef.current = true;
    holdWake();
    lastTick.current = Date.now();
    // Use real elapsed time so throttled timers don't under-count the trip.
    timer.current = setInterval(() => {
      if (!runningRef.current) return;
      const now = Date.now();
      const dt = Math.max(0, (now - lastTick.current) / 1000);
      lastTick.current = now;
      secRef.current += dt;
      // No usable fix lately (tunnel, weak GPS): treat as stopped so waiting time keeps counting.
      if (lastFixAt.current && now - lastFixAt.current > 6000) speedRef.current = 0;
      if (speedRef.current <= WAIT_SPEED_KMH) addFare((rates.perMin / 60) * dt);
      setSeconds(Math.floor(secRef.current));
      setFare(fareRef.current);
      setDistance(distRef.current);
      setSpeedKmh(speedRef.current);
      setGpsAcc(rawAt.current && now - rawAt.current < 6000 ? accRef.current : null);
      if (++tickCount.current % 5 === 0) persist();
    }, 1000);

    const onFix = (f: { latitude: number; longitude: number; accuracy: number | null; speed: number | null; time?: number | null }) => {
      if (!runningRef.current) return;
      const { latitude, longitude, speed } = f;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const now = Date.now();
      const stamp = f.time && Math.abs(now - f.time) < 60000 ? f.time : now;
      if (now - stamp > 10000) return;
      const acc = f.accuracy;
      accRef.current = acc ?? null;
      rawAt.current = now;
      if (acc == null || acc <= 0 || acc > MAX_ACCURACY_M) return;
      lastFixAt.current = now;
      const prev = last.current;
      if (prev && stamp <= prev.t) return;
      last.current = { lat: latitude, lng: longitude, t: stamp };
      if (!prev) return;
      const dt = (stamp - prev.t) / 1000;
      const dKm = haversineKm(prev.lat, prev.lng, latitude, longitude);
      const hasSpeed = speed != null && speed >= 0;
      // Prefer the chip's Doppler speed: it is not affected by GPS jitter.
      const kmh = hasSpeed ? (speed as number) * 3.6 : dt > 0 ? (dKm / dt) * 3600 : 0;
      if (kmh >= 200 || dt <= 0 || dt >= 30) return;
      speedRef.current = kmh;
      let add = 0;
      if (hasSpeed) {
        if ((speed as number) > 0.8) add = ((speed as number) * dt) / 1000;
      } else if (dKm > Math.max(0.004, (acc / 1000) * 0.8)) add = dKm;
      else last.current = prev;
      if (add > 0) {
        distRef.current += add;
        addFare(add * rates.perKm);
      }
    };
    lastFixAt.current = 0;
    rawAt.current = 0;
    const stopGps = startMeterGps(
      (f) => onFix({ latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy, speed: f.speed, time: f.time }),
      () => setSaved("Location needed: allow location access (Always) so the meter keeps measuring.")
    );
    if (runningRef.current) sub.current = stopGps;
    else stopGps();
  }

  function persist() {
    if (!runningRef.current) return;
    AsyncStorage.setItem(
      TRIP_KEY,
      JSON.stringify({
        tripId: tripId.current, region: regionRef.current, period: periodRef.current,
        fare: fareRef.current, dist: distRef.current, sec: secRef.current, at: Date.now(),
      })
    ).catch(() => {});
  }

  // Bring a running trip back after the page reloads or the screen remounts.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(TRIP_KEY);
        if (!raw || timer.current || runningRef.current) return;
        const s = JSON.parse(raw);
        if (!s || Date.now() - s.at > 6 * 3600 * 1000) { await AsyncStorage.removeItem(TRIP_KEY); return; }
        if (!nativeGpsAvailable()) {
          const perm = await Location.requestForegroundPermissionsAsync();
          if (perm.status !== "granted") return;
        }
        tripId.current = s.tripId ?? null;
        regionRef.current = s.region; periodRef.current = s.period;
        setRegion(s.region); setPeriod(s.period);
        const rates = getRate(s.region, s.period);
        fareRef.current = s.fare;
        distRef.current = s.dist;
        secRef.current = s.sec + (Date.now() - s.at) / 1000;
        speedRef.current = 0;
        last.current = null;
        setFare(s.fare); setDistance(s.dist); setSeconds(Math.floor(secRef.current));
        setSaved("You are now offline. Switch Online on the Home tab when the trip is done.");
        setIsRunning(true);
        await runLoop(rates);
      } catch {}
    })();
  }, []);
  async function stopMeter() {
    runningRef.current = false;
    setIsRunning(false);
    if (timer.current) clearInterval(timer.current);
    sub.current?.();
    releaseWake();
    timer.current = null;
    sub.current = null;
    AsyncStorage.removeItem(TRIP_KEY).catch(() => {});
    const total = Number(fareRef.current.toFixed(2));
    const body = {
      trip_id: tripId.current,
      tariff_type: isAirport(region) ? region : `${region}_${period}`,
      total_fare: total,
      trip_duration_seconds: Math.round(secRef.current),
      trip_distance_km: Number(distRef.current.toFixed(2)),
    };
    const tariff = body.tariff_type;
    const snapshot = { ...body };
    tripId.current = null;
    setLastTotal(total);
    setSaved(null);
    // Back to the starting rate for the next trip.
    const base = getRate(region, period).base;
    fareRef.current = base;
    distRef.current = 0;
    secRef.current = 0;
    setFare(base);
    setDistance(0);
    setSeconds(0);
    // Saving happens in the background so End Trip responds instantly.
    startReq.current.then(async (id) => {
      try { await api("/drivers/roadside", { method: "POST", body: { ...snapshot, trip_id: snapshot.trip_id ?? id, tariff_type: tariff } }); } catch {}
    });
  }
  const rateNow = getRate(region, period);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Roadside Meter</Text>

      <View style={[isRunning && { opacity: 0.5 }]} pointerEvents={isRunning ? "none" : "auto"}>
        <View style={styles.row}>
          {REGIONS.slice(0, 2).map((x) => (
            <TouchableOpacity key={x.key} style={[styles.tariffBtn, region === x.key && styles.activeBtn]} onPress={() => pick(x.key, period)}>
              <Text style={[styles.btnText, region === x.key && styles.activeText]}>{x.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.row}>
          {REGIONS.slice(2).map((x) => (
            <TouchableOpacity key={x.key} style={[styles.tariffBtn, region === x.key && styles.activeBtn]} onPress={() => pick(x.key, period)}>
              <Text style={[styles.btnText, region === x.key && styles.activeText]}>{x.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!isAirport(region) ? (
          <View style={styles.row}>
            {(["day", "night"] as Period[]).map((p) => (
              <TouchableOpacity key={p} style={[styles.tariffBtn, period === p && styles.activeBtn]} onPress={() => pick(region, p)}>
                <Text style={[styles.btnText, period === p && styles.activeText]}>{p === "day" ? "☀️ DAY" : "🌙 NIGHT"}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.displayCard}>
        <Text style={styles.currency}>FJ$ {fare.toFixed(2)}</Text>
        <Text style={styles.label}>Running total</Text>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{distance.toFixed(2)}</Text>
          <Text style={styles.label}>Distance (km)</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{formatTime(seconds)}</Text>
          <Text style={styles.label}>Time</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{speedKmh.toFixed(0)}</Text>
          <Text style={styles.label}>{gpsAcc != null ? `km/h · GPS ±${Math.round(gpsAcc)}m${gpsAcc > MAX_ACCURACY_M ? " (too weak)" : ""}` : isRunning ? "km/h · searching GPS…" : "km/h"}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.actionButton, isRunning ? styles.stopBg : styles.startBg]}
        onPress={isRunning ? stopMeter : startMeter}
      >
        <Text style={styles.actionText}>{isRunning ? "END TRIP" : "START TRIP"}</Text>
      </TouchableOpacity>

      {lastTotal !== null && !isRunning ? (
        <View style={styles.totalCard}>
          <Text style={styles.label}>Total fare for the trip just ended</Text>
          <Text style={styles.totalVal}>FJ$ {lastTotal.toFixed(2)}</Text>
        </View>
      ) : null}
      {saved ? <Text style={styles.saved}>{saved}</Text> : null}
      <Text style={styles.note}>
        Starts at FJ${rateNow.base.toFixed(2)}, then FJ${rateNow.perKm.toFixed(2)} per km and FJ$0.18 per minute waiting. The screen stays awake and GPS keeps running while the meter runs. Your car is hidden from riders. Do not close the app during a trip.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: "#121212", borderRadius: 16 },
  title: { fontSize: 20, fontWeight: "bold", color: "#ffcc00", textAlign: "center", marginBottom: 15 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  tariffBtn: { flex: 1, padding: 12, backgroundColor: "#222", marginHorizontal: 4, borderRadius: 8, alignItems: "center" },
  activeBtn: { backgroundColor: "#332a00", borderColor: "#ffcc00", borderWidth: 1 },
  btnText: { color: "#aaa", fontWeight: "bold", fontSize: 11, textAlign: "center" },
  activeText: { color: "#ffcc00" },
  displayCard: { backgroundColor: "#1e1e1e", padding: 25, borderRadius: 12, alignItems: "center", marginBottom: 15 },
  currency: {
    fontSize: 38,
    fontWeight: "bold",
    color: "#fff",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  label: { fontSize: 11, color: "#888", textTransform: "uppercase", marginTop: 4 },
  statsContainer: { flexDirection: "row", backgroundColor: "#181818", padding: 15, borderRadius: 10, marginBottom: 20 },
  statBox: { flex: 1, alignItems: "center" },
  statVal: { fontSize: 18, fontWeight: "bold", color: "#fff" },
  actionButton: { padding: 16, borderRadius: 12, alignItems: "center" },
  startBg: { backgroundColor: "#03dac6" },
  stopBg: { backgroundColor: "#cf6679" },
  actionText: { fontSize: 16, fontWeight: "bold", color: "#fff" },
  totalCard: { backgroundColor: "#0f3d2a", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 14 },
  totalVal: { fontSize: 30, fontWeight: "bold", color: "#22CC66", marginTop: 4 },
  saved: { color: colors.green, textAlign: "center", marginTop: 12, fontSize: typography.small },
  note: { color: "#666", textAlign: "center", marginTop: 12, fontSize: 11 },
});
