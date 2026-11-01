import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, typography, fmtFare, fmtKm, fmtDuration } from "../theme";
import { Ride } from "../api";

export default function TaxiMeter({ ride }: { ride: Ride }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const metered = typeof ride.meter_distance_km === "number";
  const distanceKm = metered ? (ride.meter_distance_km as number) : ride.distance_km;
  const fare = typeof ride.meter_fare === "number" ? (ride.meter_fare as number) : ride.fare;
  const speed = Math.round(ride.speed_kmh || 0);
  const stopped = typeof ride.stopped_recv_at === "number" && (ride.speed_kmh || 0) < 10;
  const stoppedSec = stopped
    ? (ride.stopped_sec || 0) + Math.floor((now - (ride.stopped_recv_at as number)) / 1000)
    : 0;
  const mm = String(Math.floor(stoppedSec / 60)).padStart(2, "0");
  const ss = String(stoppedSec % 60).padStart(2, "0");
  return (
    <View style={styles.meter}>
      <Text style={styles.meterLabel}>● TAXI METER · LIVE</Text>
      <Text style={styles.meterFare}>{fmtFare(fare)}</Text>
      <View style={styles.meterRow}>
        <View style={styles.meterCell}>
          <Text style={styles.meterCellValue}>{speed} km/h</Text>
          <Text style={styles.meterCellLabel}>Speed</Text>
        </View>
        <View style={styles.meterCell}>
          <Text style={[styles.meterCellValue, stopped && stoppedSec > 0 ? { color: colors.coral } : null]}>
            {mm}:{ss}
          </Text>
          <Text style={styles.meterCellLabel}>{stopped && stoppedSec > 0 ? "Stopped (waiting)" : "Stopped timer"}</Text>
        </View>
      </View>
      <View style={styles.meterRow}>
        <View style={styles.meterCell}>
          <Text style={styles.meterCellValue}>{fmtKm(distanceKm)}</Text>
          <Text style={styles.meterCellLabel}>Travelled</Text>
        </View>
        <View style={styles.meterCell}>
          <Text style={styles.meterCellValue}>{fmtKm(ride.distance_km)}</Text>
          <Text style={styles.meterCellLabel}>Trip est.</Text>
        </View>
        <View style={styles.meterCell}>
          <Text style={styles.meterCellValue}>{fmtDuration(ride.duration_min)}</Text>
          <Text style={styles.meterCellLabel}>Est. time</Text>
        </View>
      </View>
      <Text style={styles.tariff}>
        Flag fall FJ$2 day · FJ$3 night · FJ$5 airport · FJ$0.14 / 100 m · FJ$0.18 / min waiting
        {typeof ride.meter_wait_min === "number" ? ` (waited ${fmtDuration(ride.meter_wait_min)})` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  meter: {
    alignSelf: "stretch",
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: colors.ocean,
    padding: 16,
    alignItems: "center",
  },
  meterLabel: { color: colors.green, fontSize: typography.tiny, fontWeight: "800", letterSpacing: 1 },
  meterFare: { color: colors.ocean, fontSize: 46, fontWeight: "900", marginTop: 2 },
  meterRow: { flexDirection: "row", alignSelf: "stretch", marginTop: 12, gap: 8 },
  meterCell: { flex: 1, alignItems: "center" },
  tariff: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 12, textAlign: "center" },
  meterCellValue: { color: colors.text, fontSize: typography.subtitle, fontWeight: "800" },
  meterCellLabel: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4 },
});
