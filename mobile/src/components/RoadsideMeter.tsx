import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api";
import { TripTracker, GpsState } from "../gpsFilter";
import { nativeGpsAvailable, startNativeWatch } from "../nativeGps";
import { colors, typography } from "../theme";

const TRIP_KEY = "pb-active-trip";
const PENDING_KEY = "pb-pending-trips";

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
const WAIT_SPEED_KMH = 6;

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
  const [seconds, setSeconds] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [lastTotal, setLastTotal] = useState<number | null>(null);

  const sub = useRef<Location.LocationSubscription | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const last = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const speedRef = useRef(0);
  const fareRef = useRef<number>(getRate("VITI_LEVU", autoPeriod()).base);
  const distRef = useRef(0);
  const secRef = useRef(0);
  const tripId = useRef<number | null>(null);
  const wakeLock = useRef<any>(null);
  const runningRef = useRef(false);
  const tracker = useRef(new TripTracker());
  const lastRestart = useRef(0);
  const [gps, setGps] = useState<GpsState>("searching");
  const startReq = useRef<Promise<number | null>>(Promise.resolve(null));
  const regionRef = useRef<Region>("VITI_LEVU");
  const periodRef = useRef<Period>(autoPeriod());
  const lastTick = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (sub.current) sub.current.remove();
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

  function addFare(amount: number) {
    fareRef.current += amount;
    setFare(fareRef.current);
  }

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
      Alert.alert("Location needed", "Allow location access so the meter can measure distance.");
    }
  }
  async function runLoop(rates: Rate) {
    runningRef.current = true;
    holdWake();
    const tr = tracker.current;
    tr.reset();
    setGps("searching");
    lastTick.current = Date.now();

    const charge = (km: number) => {
      if (km <= 0) return;
      distRef.current += km;
      setDistance(distRef.current);
      addFare(km * rates.perKm);
    };

    // Use real elapsed time so throttled timers don't under-count the trip.
    timer.current = setInterval(() => {
      if (!runningRef.current) return;
      const now = Date.now();
      const dt = Math.max(0, (now - lastTick.current) / 1000);
      lastTick.current = now;
      secRef.current += dt;
      setSeconds(Math.floor(secRef.current));
      // Weak signal: keep estimating distance from the last good speed.
      const est = tr.tick(now);
      if (est > 0) {
        distRef.current += est;
        setDistance(distRef.current);
        addFare(est * rates.perKm);
      }
      if (tr.speedKmh <= WAIT_SPEED_KMH) addFare((rates.perMin / 60) * dt);
      setGps(tr.state);
      // Some phones silently stall the GPS in weak areas: restart it.
      if (tr.silentFor(now) > 12000 && now - lastRestart.current > 12000) {
        lastRestart.current = now;
        startWatch(charge);
      }
      persist();
    }, 1000);

    await startWatch(charge);
  }

  async function startWatch(charge: (km: number) => void) {
    const tr = tracker.current;
    const old = sub.current;
    sub.current = null;
    try { old?.remove(); } catch {}
    if (nativeGpsAvailable()) {
      try {
        const stop = await startNativeWatch(
          (f) => {
            if (!runningRef.current) return;
            charge(tr.ingest({ lat: f.latitude, lng: f.longitude, accuracy: f.accuracy, speed: f.speed, t: f.time || Date.now() }));
            setGps(tr.state);
          },
          () => {}
        );
        if (runningRef.current) sub.current = { remove: stop } as any;
        else stop();
        return;
      } catch {
        // fall through to the browser GPS
      }
    }
    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (loc) => {
        if (!runningRef.current) return;
        const c = loc.coords;
        charge(
          tr.ingest({
            lat: c.latitude,
            lng: c.longitude,
            accuracy: c.accuracy,
            speed: c.speed,
            t: loc.timestamp || Date.now(),
          })
        );
        setGps(tr.state);
      }
    );
    if (runningRef.current) sub.current = subscription;
    else subscription.remove();
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
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
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
    if (sub.current) sub.current.remove();
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
      const body2 = { ...snapshot, trip_id: snapshot.trip_id ?? id, tariff_type: tariff };
      try { await api("/drivers/roadside", { method: "POST", body: body2 }); }
      catch { await queueTrip(body2); }
    });
  }
  // Trips finished without a signal are kept on the phone and sent when data returns.
  async function queueTrip(b: any) {
    try {
      const list = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) || "[]");
      list.push(b);
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
    } catch {}
  }
  async function flushTrips() {
    try {
      const list = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) || "[]");
      if (!list.length) return;
      const left: any[] = [];
      for (const b of list) {
        try { await api("/drivers/roadside", { method: "POST", body: b }); } catch { left.push(b); }
      }
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(left));
    } catch {}
  }
  useEffect(() => {
    flushTrips();
    const iv = setInterval(flushTrips, 30000);
    const on = () => flushTrips();
    (globalThis as any).addEventListener?.("online", on);
    return () => { clearInterval(iv); (globalThis as any).removeEventListener?.("online", on); };
  }, []);
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
        Starts at FJ${rateNow.base.toFixed(2)}, then FJ${rateNow.perKm.toFixed(2)} per km and FJ$0.18 per minute while stopped or crawling. The screen stays awake and GPS keeps running while the meter runs. Your car is hidden from riders. Do not close the app during a trip.
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
  gpsLine: { textAlign: "center", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  gpsGood: { color: "#22CC66" },
  gpsWeak: { color: "#E8A820" },
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
