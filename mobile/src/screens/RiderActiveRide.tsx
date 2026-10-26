import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, typography, fmtFare, fmtKm, fmtDuration, statusColor } from "../theme";
import { api, getToken, Ride, parsePath } from "../api";
import { connectSocket, getSocket } from "../socket";
import MapView, { MapMarker } from "../components/MapView";
import TaxiMeter from "../components/TaxiMeter";
import { bearing, haversine } from "../geo";

type Props = {
  rideId: string;
  onClose: () => void;
};

function PulseDot({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color, opacity: anim }} />
      <View style={{ position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onChange(n)} hitSlop={8}>
          <Text style={{ fontSize: 40, color: n <= value ? colors.amber : colors.border }}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function CodeCard({ code, highlight }: { code: string; highlight?: boolean }) {
  return (
    <View style={[styles.codeCard, highlight && styles.codeCardHighlight]}>
      <Text style={styles.codeCardLabel}>Share this code with your driver</Text>
      <Text style={styles.codeCardValue}>{code}</Text>
      <Text style={styles.codeCardHint}>Your driver enters it to start the trip</Text>
    </View>
  );
}

export default function RiderActiveRide({ rideId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const d = await api<Ride>(`/rides/${rideId}`);
      if (mountedRef.current) {
        setRide(d);
        setError("");
      }
    } catch (e: any) {
      if (mountedRef.current) setError(e.message || "Could not load ride.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    setLoading(true);
    refresh();
    (async () => {
      const token = await getToken();
      const socket = getSocket() || connectSocket(token || "");
      const onStatus = (ev: any) => {
        if (!ev || ev.ride_id !== rideId) return;
        if (!mountedRef.current) return;
        if (ev.ride && ev.ride.status) setRide(ev.ride);
        else if (ev.status) setRide((r) => (r ? { ...r, status: ev.status } : r));
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
      };
      socket.on("ride_status", onStatus);
      socket.on("ride_location_update", onLoc);
      socket.emit("ride_subscribe", { ride_id: rideId });
      return () => {
        socket.off("ride_status", onStatus);
        socket.off("ride_location_update", onLoc);
      };
    })();
  }, [rideId, refresh]);

  const status = ride?.status || "requested";
  const path = useMemo(() => parsePath(ride?.path_json), [ride?.path_json]);

  const route = useMemo(() => {
    if (path.length >= 2) {
      return path;
    }
    if (!ride) return undefined;
    return [
      { lat: ride.pickup_lat, lng: ride.pickup_lng },
      {
        lat: ride.pickup_lat + (ride.dropoff_lat - ride.pickup_lat) * 0.4,
        lng: ride.pickup_lng + (ride.dropoff_lng - ride.pickup_lng) * 0.4,
      },
      {
        lat: ride.pickup_lat + (ride.dropoff_lat - ride.pickup_lat) * 0.75,
        lng: ride.pickup_lng + (ride.dropoff_lng - ride.pickup_lng) * 0.75,
      },
      { lat: ride.dropoff_lat, lng: ride.dropoff_lng },
    ];
  }, [path, ride]);

  const markers: MapMarker[] = useMemo(() => {
    if (!ride) return [];
    const out: MapMarker[] = [
      { id: "pickup", lat: ride.pickup_lat, lng: ride.pickup_lng, color: colors.green, label: "Pickup" },
      { id: "dropoff", lat: ride.dropoff_lat, lng: ride.dropoff_lng, color: colors.coral, label: "Dropoff" },
    ];
    return out;
  }, [ride]);

  const driverLat = ride?.driver_lat;
  const driverLng = ride?.driver_lng;
  const vehicleAngle = useMemo(() => {
    if (driverLat == null || driverLng == null || !ride) return 0;
    return bearing(driverLat, driverLng, ride.dropoff_lat, ride.dropoff_lng);
  }, [driverLat, driverLng, ride]);

  const mapCenter = useMemo(() => {
    if (driverLat != null && driverLng != null && ride) {
      const dx = (ride.dropoff_lat - driverLat) / 2 || 0;
      const dy = (ride.dropoff_lng - driverLng) / 2 || 0;
      return { lat: driverLat + dx, lng: driverLng + dy };
    }
    if (!ride) return { lat: -18.1416, lng: 178.4419 };
    return {
      lat: (ride.pickup_lat + ride.dropoff_lat) / 2,
      lng: (ride.pickup_lng + ride.dropoff_lng) / 2,
    };
  }, [driverLat, driverLng, ride]);

  const driverDistKm =
    driverLat != null && driverLng != null && status === "accepted" && ride
      ? haversine(driverLat, driverLng, ride.pickup_lat, ride.pickup_lng)
      : null;

  async function cancelRide() {
    setCancelBusy(true);
    try {
      await api(`/rides/${rideId}/cancel`, { method: "POST" });
      const s = getSocket();
      if (s) s.emit("rider_cancel", { ride_id: rideId });
      setRide((r) => (r ? { ...r, status: "cancelled" } : r));
    } catch (e: any) {
      setError(e.message || "Could not cancel.");
    } finally {
      setCancelBusy(false);
    }
  }

  async function submitRating() {
    if (!rating) return;
    setRateBusy(true);
    try {
      await api(`/rides/${rideId}/rate`, { method: "POST", body: { rating } });
      setRated(true);
    } catch (e: any) {
      setError(e.message || "Could not submit rating.");
    } finally {
      setRateBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.ocean} />
        <Text style={styles.loadingText}>Loading your ride…</Text>
      </View>
    );
  }

  if (!ride) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Text style={styles.errorText}>{error || "Ride not found."}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
          <Text style={styles.primaryBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sc = statusColor(status);

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <MapView
        style={{ flex: 1 }}
        center={mapCenter}
        zoom={0.04}
        markers={markers}
        route={route}
        vehicle={
          driverLat != null && driverLng != null
            ? { lat: driverLat, lng: driverLng, angle: vehicleAngle, color: colors.sunset }
            : undefined
        }
      />
      <View style={styles.mapAttribution}>
        <Text style={styles.mapAttributionText}>Ride {ride.id.slice(0, 6).toUpperCase()}</Text>
      </View>

      <View style={styles.card}>
        {status === "requested" || status === "searching" ? (
          <View style={styles.statusBlock}>
            <PulseDot color={colors.sky} />
            <Text style={[styles.statusTitle, { color: colors.sky }]}>Looking for a driver…</Text>
            <Text style={styles.statusSub}>
              A driver near {ride.pickup_place} will pick this up shortly.
            </Text>
          </View>
        ) : status === "accepted" ? (
          <View style={styles.statusBlock}>
            <PulseDot color={colors.amber} />
            <Text style={[styles.statusTitle, { color: colors.amber }]}>Driver heading to pickup</Text>
            <Text style={styles.statusSub}>
              {ride.driver_name || "Your driver"} · {ride.vehicle_type || "—"} · {ride.license_plate || ""}
            </Text>
            {driverDistKm != null ? (
              <Text style={styles.eta}>
                Arriving in ~{fmtDuration(driverDistKm / 40 * 60)} · {driverDistKm.toFixed(1)} km away
              </Text>
            ) : null}
            {ride.pickup_code ? <CodeCard code={ride.pickup_code} /> : null}
          </View>
        ) : status === "arrived" ? (
          <View style={styles.statusBlock}>
            <PulseDot color={colors.green} />
            <Text style={[styles.statusTitle, { color: colors.green }]}>Driver has arrived!</Text>
            <Text style={styles.statusSub}>
              Your {ride.vehicle_type || "driver"} is waiting at {ride.pickup_place}. Hop in.
            </Text>
            <View style={styles.driverInfo}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(ride.driver_name || "D")[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{ride.driver_name || "Your driver"}</Text>
                <Text style={styles.driverDetail}>
                  {ride.vehicle_model || ride.vehicle_type || "Ride"} · {ride.license_plate || ""}
                </Text>
              </View>
              <Text style={styles.driverRating}>★ {ride.driver_rating != null ? Number(ride.driver_rating).toFixed(1) : "—"}</Text>
            </View>
            {ride.pickup_code ? <CodeCard code={ride.pickup_code} highlight /> : null}
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 14 }]}>
              <Text style={styles.primaryBtnText}>Call driver: {ride.driver_phone || "—"}</Text>
            </TouchableOpacity>
          </View>
        ) : status === "in_progress" ? (
          <View style={styles.statusBlock}>
            <PulseDot color={colors.ocean} />
            <Text style={[styles.statusTitle, { color: colors.sky }]}>
              On the way to {ride.dropoff_place}
            </Text>
            <Text style={styles.statusSub}>
              {ride.driver_name || "Your driver"} · {ride.vehicle_model || "—"}
            </Text>
            <TaxiMeter ride={ride} />
          </View>
        ) : status === "completed" ? (
          <View style={styles.statusBlock}>
            <Text style={styles.receiptLabel}>Trip fare</Text>
            <Text style={styles.receiptFare}>
              {fmtFare(ride.final_fare != null ? ride.final_fare : ride.fare)}
            </Text>
            <Text style={styles.receiptDetail}>
              {fmtKm(ride.final_distance_km != null ? ride.final_distance_km : ride.distance_km)} ·{" "}
              {fmtDuration(ride.final_duration_min != null ? ride.final_duration_min : ride.duration_min)} ·{" "}
              {ride.pickup_place} → {ride.dropoff_place}
            </Text>
            <Text style={styles.ratingTitle}>
              {rated ? "Mahalo! You rated the ride." : `How was your ride with ${ride.driver_name || "the driver"}?`}
            </Text>
            <Stars value={rating} onChange={(n) => setRating(n)} />
            {rated ? (
              <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16 }]} onPress={onClose}>
                <Text style={styles.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.statusSub}>Tap a star to rate your {ride.vehicle_type || "ride"}, then confirm.</Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 14 }, !rating && styles.primaryBtnDisabled]}
                  disabled={!rating || rateBusy}
                  onPress={submitRating}
                >
                  <Text style={styles.primaryBtnText}>{rateBusy ? "Submitting…" : "Submit rating"}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <View style={styles.statusBlock}>
            <Text style={[styles.statusTitle, { color: colors.coral }]}>Ride cancelled</Text>
            <Text style={styles.statusSub}>Your ride request was cancelled. Hang loose and try again.</Text>
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 14 }]} onPress={onClose}>
              <Text style={styles.primaryBtnText}>Back to home</Text>
            </TouchableOpacity>
          </View>
        )}

        {(status === "requested" || status === "accepted") ? (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={cancelRide}
            disabled={cancelBusy}
          >
            <Text style={styles.cancelBtnText}>{cancelBusy ? "Cancelling…" : "Cancel ride"}</Text>
          </TouchableOpacity>
        ) : null}
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
    paddingBottom: 14,
  },
  statusBlock: { alignItems: "center", paddingVertical: 4 },
  statusTitle: { fontSize: typography.heading, fontWeight: "800", marginTop: 8, textAlign: "center" },
  statusSub: { color: colors.textMuted, fontSize: typography.small, marginTop: 6, textAlign: "center", lineHeight: 18 },
  eta: { color: colors.amber, fontSize: typography.body, fontWeight: "700", marginTop: 8 },
  driverInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.deep,
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
    alignSelf: "stretch",
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.ocean,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  driverName: { color: colors.text, fontSize: typography.subtitle, fontWeight: "700" },
  driverDetail: { color: colors.textMuted, fontSize: typography.small, marginTop: 2 },
  driverRating: { color: colors.amber, fontSize: typography.subtitle, fontWeight: "800" },
  tripMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignSelf: "stretch",
    marginTop: 16,
    backgroundColor: colors.deep,
    borderRadius: 14,
    padding: 14,
  },
  tripMetaLabel: { color: colors.textMuted, fontSize: typography.tiny, textTransform: "uppercase", letterSpacing: 0.4 },
  tripMetaValue: { color: colors.text, fontSize: typography.subtitle, fontWeight: "800", marginTop: 4 },
  codeCard: {
    alignSelf: "stretch",
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.deep,
    paddingVertical: 14,
    alignItems: "center",
  },
  codeCardHighlight: { borderColor: colors.green, backgroundColor: "rgba(34,197,94,0.10)" },
  codeCardLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  codeCardValue: { color: colors.text, fontSize: 40, fontWeight: "900", letterSpacing: 10, marginVertical: 4 },
  codeCardHint: { color: colors.textMuted, fontSize: typography.tiny },
  receiptLabel: { color: colors.textMuted, fontSize: typography.small, textTransform: "uppercase", letterSpacing: 0.6 },
  receiptFare: { color: colors.ocean, fontSize: 44, fontWeight: "900", marginTop: 2 },
  receiptDetail: { color: colors.textMuted, fontSize: typography.small, marginTop: 4, marginBottom: 16, textAlign: "center" },
  ratingTitle: { color: colors.text, fontSize: typography.subtitle, fontWeight: "700", textAlign: "center", marginBottom: 16 },
  primaryBtn: { backgroundColor: colors.ocean, borderRadius: 14, padding: 15, alignItems: "center", alignSelf: "stretch" },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: typography.subtitle },
  cancelBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.coral,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  cancelBtnText: { color: colors.coral, fontWeight: "700" },
});