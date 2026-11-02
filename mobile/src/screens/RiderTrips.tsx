import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, typography, fmtFare, fmtDate, fmtTime, statusLabel, statusColor } from "../theme";
import { api, Ride } from "../api";
import { confirmAsync } from "../confirm";

export default function RiderTrips({ onOpenRide }: { onOpenRide: (rideId: string) => void }) {
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const d = await api<{ rides: Ride[] }>("/rides");
      setTrips(d.rides || []);
      setError("");
    } catch (e: any) {
      setError(e.message || "Could not load trips.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancelScheduled(item: Ride) {
    const ok = await confirmAsync("Cancel booking", "Cancel this booked ride? There is no charge.", "Cancel booking", "Keep");
    if (!ok) return;
    try {
      await api(`/rides/${item.id}/cancel`, { method: "POST" });
      load(true);
    } catch (e: any) {
      setError(e.message || "Could not cancel.");
    }
  }

  function renderTrip({ item }: { item: Ride }) {
    const sc = statusColor(item.status);
    const scheduled = item.status === "scheduled" && item.scheduled_at;
    const when = scheduled ? new Date(String(item.scheduled_at).replace(" ", "T") + "Z") : null;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          if (item.status === "accepted" || item.status === "in_progress" || item.status === "requested" || item.status === "arrived") {
            onOpenRide(item.id);
          }
        }}
        activeOpacity={item.status === "completed" ? 1 : 0.7}
      >
        <View style={styles.cardHead}>
          <Text style={styles.date}>
            {when
              ? `📅 ${when.toLocaleString()}`
              : `${fmtDate(item.requested_at)} · ${fmtTime(item.requested_at)}`}
          </Text>
          <View style={[styles.badge, { borderColor: sc }]}>
            <Text style={[styles.badgeText, { color: sc }]}>{statusLabel(item.status)}</Text>
          </View>
        </View>
        <View style={styles.routeRow}>
          <View style={styles.routeCol}>
            <View style={[styles.stopDot, { borderColor: colors.green }]} />
            <Text style={styles.routePlace}>{item.pickup_place}</Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeCol}>
            <View style={[styles.stopDot, { borderColor: colors.coral }]} />
            <Text style={styles.routePlace}>{item.dropoff_place}</Text>
          </View>
        </View>
        <View style={styles.cardFoot}>
          <Text style={styles.footLeft}>{item.driver_name ? `Driver: ${item.driver_name}` : `${item.distance_km?.toFixed(1) ?? "—"} km · ${Math.round(item.duration_min ?? 0)} min`}</Text>
          <Text style={styles.fare}>{fmtFare(item.fare)}</Text>
        </View>
        {item.status === "cancelled" && item.cancel_fee && item.cancel_fee > 0 ? (
          <Text style={styles.feeNote}>Cancellation fee: {fmtFare(item.cancel_fee)}</Text>
        ) : null}
        {scheduled ? (
          <TouchableOpacity style={styles.cancelBooking} onPress={() => cancelScheduled(item)}>
            <Text style={styles.cancelBookingText}>Cancel booking</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.ocean} />
        <Text style={{ color: colors.textMuted, marginTop: 12 }}>Loading trips…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <FlatList
        data={trips}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.ocean}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Your trips</Text>
            <Text style={styles.sub}>{trips.length} ride{trips.length !== 1 ? "s" : ""} on record</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🏄</Text>
            <Text style={styles.emptyTitle}>No trips yet</Text>
            <Text style={styles.emptySub}>
              {error || "Request a ride and it will show up here."}
            </Text>
          </View>
        }
        renderItem={renderTrip}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.deep },
  header: { marginBottom: 14 },
  title: { color: colors.text, fontSize: typography.heading, fontWeight: "800" },
  sub: { color: colors.textMuted, fontSize: typography.small, marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { color: colors.textMuted, fontSize: typography.small },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: typography.tiny, fontWeight: "700" },
  routeRow: { marginTop: 12, flexDirection: "row" },
  routeCol: { flexDirection: "row", alignItems: "center", flex: 1, gap: 8, minWidth: 0 },
  stopDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, backgroundColor: colors.deep },
  routePlace: { color: colors.text, fontSize: typography.body, fontWeight: "600", flexShrink: 1 },
  routeLine: { width: 24, borderTopWidth: 2, borderTopColor: colors.border, marginHorizontal: 8, alignSelf: "center" },
  cardFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footLeft: { color: colors.textMuted, fontSize: typography.small, flex: 1 },
  fare: { color: colors.ocean, fontSize: typography.subtitle, fontWeight: "800" },
  feeNote: { color: colors.coral, fontSize: typography.small, marginTop: 8 },
  cancelBooking: { marginTop: 10, borderWidth: 1, borderColor: colors.coral, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  cancelBookingText: { color: colors.coral, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { color: colors.text, fontSize: typography.heading, fontWeight: "700", marginTop: 12 },
  emptySub: { color: colors.textMuted, fontSize: typography.small, marginTop: 6, textAlign: "center" },
});