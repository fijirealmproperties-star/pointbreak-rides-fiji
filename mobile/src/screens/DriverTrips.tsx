import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, typography, fmtFare, fmtDate, fmtTime, statusLabel, statusColor } from "../theme";
import { api, Ride } from "../api";

type Stats = {
  total_trips: number;
  completed_trips: number;
  average_rating: number | null;
  total_earnings: number;
  cancelled_trips: number;
};

type MeterTrip = {
  id: number;
  tariff_type: string;
  total_fare: number;
  trip_distance_km: number | null;
  trip_duration_seconds: number | null;
  created_at: string;
};

const meterName = (t: string) => (t.startsWith("SURFS_UP") ? "Surfs Up Meter" : "Roadside Meter");

type Row = { key: string; ride?: Ride; meter?: MeterTrip; ts: string };

export default function DriverTrips() {
  const insets = useSafeAreaInsets();
  const [rides, setRides] = useState<Ride[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [meterTrips, setMeterTrips] = useState<MeterTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [d, s, m] = await Promise.all([
        api<{ rides: Ride[] }>("/drivers/rides"),
        api<Stats>("/drivers/stats").catch(() => null),
        api<{ trips: MeterTrip[] }>("/drivers/roadside-trips").catch(() => ({ trips: [] as MeterTrip[] })),
      ]);
      setMeterTrips(m.trips || []);
      setRides(d.rides || []);
      if (s) setStats(s);
      setError("");
    } catch (e: any) {
      setError(e.message || "Could not load earnings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const completed = rides.filter((r) => r.status === "completed");
  const earnings = completed.reduce((sum, r) => sum + (r.fare || 0), 0);
  const avgRating =
    completed.length > 0
      ? completed.reduce((sum, r) => sum + (r.rating || 0), 0) / completed.filter((r) => r.rating).length
      : 0;

  const meterEarned = meterTrips.reduce((sum, t) => sum + (t.total_fare || 0), 0);
  const statTrips = (stats?.total_trips ?? rides.length) + meterTrips.length;
  const statEarnings = (stats?.total_earnings ?? earnings) + meterEarned;
  const statRating =
    stats?.average_rating != null
      ? stats.average_rating
      : completed.filter((r) => r.rating).length > 0
      ? completed.filter((r) => r.rating).reduce((sum, r) => sum + (r.rating || 0), 0) /
        completed.filter((r) => r.rating).length
      : 0;

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.ocean} />
        <Text style={{ color: colors.textMuted, marginTop: 12 }}>Loading earnings…</Text>
      </View>
    );
  }

  const rows: Row[] = [
    ...(completed.length > 0 ? completed : rides).map((r) => ({ key: "r" + r.id, ride: r, ts: r.requested_at })),
    ...meterTrips.map((t) => ({ key: "m" + t.id, meter: t, ts: t.created_at })),
  ].sort((a, b) => new Date(b.ts.replace(" ", "T") + (b.ts.includes("Z") || b.ts.includes("T") ? "" : "Z")).getTime() - new Date(a.ts.replace(" ", "T") + (a.ts.includes("Z") || a.ts.includes("T") ? "" : "Z")).getTime());

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.ocean} />
        }
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Earnings</Text>
            <Text style={styles.sub}>
              {stats ? "From the backend" : error ? "Showing local totals" : "Your ride history"}
            </Text>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{statTrips}</Text>
                <Text style={styles.statLabel}>Trips</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: colors.amber }]}>
                  {statRating ? statRating.toFixed(1) : "—"}
                </Text>
                <Text style={styles.statLabel}>Rating</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: colors.green }]}>{fmtFare(statEarnings)}</Text>
                <Text style={styles.statLabel}>Earned</Text>
              </View>
            </View>
            <View style={styles.listHead}>
              <Text style={styles.listTitle}>Ride history</Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🚙</Text>
            <Text style={styles.emptyTitle}>No rides yet</Text>
            <Text style={styles.emptySub}>
              {error || "Go online and accept a ride — completed trips appear here."}
            </Text>
          </View>
        }
        renderItem={({ item: row }) => {
          if (row.meter) {
            const t = row.meter;
            const when = t.created_at.includes("T") ? t.created_at : t.created_at.replace(" ", "T") + "Z";
            const mins = Math.round((t.trip_duration_seconds || 0) / 60);
            return (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.date}>{fmtDate(when)} ? {fmtTime(when)}</Text>
                  <View style={[styles.badge, { borderColor: colors.ocean }]}>
                    <Text style={[styles.badgeText, { color: colors.ocean }]}>{meterName(t.tariff_type)}</Text>
                  </View>
                </View>
                <Text style={styles.places}>?? Meter trip</Text>
                <View style={styles.cardFoot}>
                  <Text style={styles.footLeft}>{(t.trip_distance_km ?? 0).toFixed(2)} km ? {mins} min</Text>
                  <Text style={styles.fare}>{fmtFare(t.total_fare)}</Text>
                </View>
              </View>
            );
          }
          const item = row.ride as Ride;
          const sc = statusColor(item.status);
          return (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.date}>{fmtDate(item.requested_at)} · {fmtTime(item.requested_at)}</Text>
                <View style={[styles.badge, { borderColor: sc }]}>
                  <Text style={[styles.badgeText, { color: sc }]}>{statusLabel(item.status)}</Text>
                </View>
              </View>
              <Text style={styles.places}>
                {item.pickup_place} → {item.dropoff_place}
              </Text>
              <View style={styles.cardFoot}>
                <Text style={styles.footLeft}>
                  {item.distance_km?.toFixed(1) ?? "—"} km · {Math.round(item.duration_min ?? 0)} min
                  {item.rating ? ` · ★ ${item.rating}` : ""}
                </Text>
                <Text style={styles.fare}>{fmtFare(item.fare)}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.deep },
  title: { color: colors.text, fontSize: typography.heading, fontWeight: "800" },
  sub: { color: colors.textMuted, fontSize: typography.small, marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 10, marginTop: 14, marginBottom: 18 },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
  },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.textMuted, fontSize: typography.tiny, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
  listHead: { marginBottom: 10 },
  listTitle: { color: colors.text, fontSize: typography.subtitle, fontWeight: "700" },
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
  places: { color: colors.text, fontSize: typography.body, fontWeight: "600", marginTop: 10 },
  cardFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footLeft: { color: colors.textMuted, fontSize: typography.small, flex: 1 },
  fare: { color: colors.green, fontSize: typography.subtitle, fontWeight: "800" },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { color: colors.text, fontSize: typography.heading, fontWeight: "700", marginTop: 12 },
  emptySub: { color: colors.textMuted, fontSize: typography.small, marginTop: 6, textAlign: "center" },
});