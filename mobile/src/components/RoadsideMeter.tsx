import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import { api } from "../api";
import { colors, typography } from "../theme";

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

  const sub = useRef<Location.LocationSubscription | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const last = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const speedRef = useRef(0);
  const fareRef = useRef<number>(getRate("VITI_LEVU", autoPeriod()).base);
  const distRef = useRef(0);
  const secRef = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (sub.current) sub.current.remove();
    },
    []
  );

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
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission needed", "Location access is required to run the meter.");
      return;
    }
    const rates = getRate(region, period);
    setSaved(null);
    fareRef.current = rates.base;
    distRef.current = 0;
    secRef.current = 0;
    speedRef.current = 0;
    last.current = null;
    setFare(rates.base);
    setDistance(0);
    setSeconds(0);
    setIsRunning(true);

    timer.current = setInterval(() => {
      secRef.current += 1;
      setSeconds(secRef.current);
      if (speedRef.current <= WAIT_SPEED_KMH) addFare(rates.perMin / 60);
    }, 1000);

    sub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 },
      (loc) => {
        const { latitude, longitude, speed } = loc.coords;
        const now = Date.now();
        const prev = last.current;
        if (prev) {
          const dKm = haversineKm(prev.lat, prev.lng, latitude, longitude);
          const dt = (now - prev.t) / 1000;
          // Browsers often report no speed, so derive it from movement.
          const kmh = speed != null && speed >= 0 ? speed * 3.6 : dt > 0 ? (dKm / dt) * 3600 : 0;
          speedRef.current = kmh;
          if (dKm > 0.002) {
            distRef.current += dKm;
            setDistance(distRef.current);
            if (kmh > WAIT_SPEED_KMH) addFare(dKm * rates.perKm);
          }
        }
        last.current = { lat: latitude, lng: longitude, t: now };
      }
    );
  }

  async function stopMeter() {
    setIsRunning(false);
    if (timer.current) clearInterval(timer.current);
    if (sub.current) sub.current.remove();
    timer.current = null;
    sub.current = null;
    try {
      await api("/drivers/roadside", {
        method: "POST",
        body: JSON.stringify({
          driver_id: driverId || "ROADSIDE_DRIVER",
          tariff_type: isAirport(region) ? region : `${region}_${period}`,
          total_fare: Number(fareRef.current.toFixed(2)),
          trip_duration_seconds: secRef.current,
          trip_distance_km: Number(distRef.current.toFixed(2)),
        }),
      });
      setSaved(`Trip of FJ$ ${fareRef.current.toFixed(2)} saved to admin.`);
    } catch {
      setSaved("Could not send this trip to admin — check your connection.");
    }
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
      </View>

      <TouchableOpacity
        style={[styles.actionButton, isRunning ? styles.stopBg : styles.startBg]}
        onPress={isRunning ? stopMeter : startMeter}
      >
        <Text style={styles.actionText}>{isRunning ? "END TRIP" : "START TRIP"}</Text>
      </TouchableOpacity>

      {saved ? <Text style={styles.saved}>{saved}</Text> : null}
      <Text style={styles.note}>
        Starts at FJ${rateNow.base.toFixed(2)}, then FJ${rateNow.perKm.toFixed(2)} per km and FJ$0.18 per minute waiting. Keep the app open while the meter runs.
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
  saved: { color: colors.green, textAlign: "center", marginTop: 12, fontSize: typography.small },
  note: { color: "#666", textAlign: "center", marginTop: 12, fontSize: 11 },
});
