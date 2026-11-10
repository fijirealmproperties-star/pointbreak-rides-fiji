import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, typography, fmtFare, fmtKm, fmtDuration, fmtWaitTimer } from "../theme";
import { Ride } from "../api";

export default function TaxiMeter({ ride }: { ride: Ride }) {
  const metered = typeof ride.meter_distance_km === "number";
  const distanceKm = metered ? (ride.meter_distance_km as number) : ride.distance_km;
  const fare = typeof ride.meter_fare === "number" ? (ride.meter_fare as number) : ride.fare;
  return (
    <View style={styles.meter}>
      <Text style={styles.meterLabel}>● TAXI METER · LIVE</Text>
      <Text style={styles.meterFare}>{fmtFare(fare)}</Text>
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
      <View style={styles.waiting}>
        <Text style={styles.waitingLabel}>WAITING TIME</Text>
        <Text style={styles.waitingTime}>{fmtWaitTimer(ride.meter_wait_min)}</Text>
        <Text style={styles.waitingNote}>Minutes:seconds · updates with the meter</Text>
      </View>
      <Text style={styles.tariff}>
        Flag fall FJ$2 day · FJ$3 night · FJ$0.14 / 100 m · FJ$0.18 / min waiting
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
  waiting: { alignItems: "center", marginTop: 16 },
  waitingLabel: { color: colors.textMuted, fontSize: typography.tiny, fontWeight: "800", letterSpacing: 0.4 },
  waitingTime: { color: colors.text, fontSize: typography.heading, fontWeight: "800", marginTop: 3 },
  waitingNote: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 3 },
  tariff: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 12, textAlign: "center" },
  meterCellValue: { color: colors.text, fontSize: typography.subtitle, fontWeight: "800" },
  meterCellLabel: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4 },
});
