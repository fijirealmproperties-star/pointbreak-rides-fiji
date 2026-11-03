import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import { api } from "../api";
import { colors, typography } from "../theme";

// Fiji FCCC regulated rates.
const FIJI_TARIFFS = {
  day: { base: 2.0, perKm: 1.4, perMin: 0.18 },
  night: { base: 3.0, perKm: 1.4, perMin: 0.18 },
  airport: { base: 5.0, perKm: 2.1, perMin: 0.18 },
} as const;
type Tariff = keyof typeof FIJI_TARIFFS;

// Below this speed the meter charges waiting time; above it, distance.
const WAIT_SPEED_KMH = 15;

function autoTariff(): Tariff {
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
  const [tariff, setTariff] = useState<Tariff>(autoTariff);
  const [isRunning, setIsRunning] = useState(false);
  const [fare, setFare] = useState<number>(FIJI_TARIFFS[autoTariff()].base);
  const [distance, setDistance] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);

  const sub = useRef<Location.LocationSubscription | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const last = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const speedRef = useRef(0);
  const fareRef = useRef<number>(FIJI_TARIFFS[autoTariff()].base);
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

  function pickTariff(mode: Tariff) {
    setTariff(mode);
    fareRef.current = FIJI_TARIFFS[mode].base;
    setFare(fareRef.current);
  }

  async function startMeter() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission needed", "Location access is required to run the meter.");
      return;
    }
    const rates = FIJI_TARIFFS[tariff];
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
          tariff_type: tariff,
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Roadside Meter</Text>

      <View style={[styles.row, isRunning && { opacity: 0.5 }]} pointerEvents={isRunning ? "none" : "auto"}>
        {(["day", "night", "airport"] as Tariff[]).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.tariffBtn, tariff === mode && styles.activeBtn]}
            onPress={() => pickTariff(mode)}
          >
            <Text style={[styles.btnText, tariff === mode && styles.activeText]}>{mode.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
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
        Rates: day FJ$2.00 / night FJ$3.00 start, FJ$1.40 per km, FJ$0.18 per minute waiting. Keep the app open while
        the meter runs.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: "#121212", borderRadius: 16 },
  title: { fontSize: 20, fontWeight: "bold", color: "#ffcc00", textAlign: "center", marginBottom: 15 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  tariffBtn: { flex: 1, padding: 12, backgroundColor: "#222", marginHorizontal: 4, borderRadius: 8, alignItems: "center" },
  activeBtn: { backgroundColor: "#332a00", borderColor: "#ffcc00", borderWidth: 1 },
  btnText: { color: "#aaa", fontWeight: "bold", fontSize: 12 },
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
