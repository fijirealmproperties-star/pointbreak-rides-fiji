import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, typography, fmtFare, fmtKm } from "../theme";
import { api, getToken, Ride } from "../api";
import { connectSocket, getSocket } from "../socket";
import { haversine, requestCurrentLocation, watchCurrentLocation } from "../geo";
import MapView from "../components/MapView";

type Props = {
  onOpenRide: (rideId: string) => void;
};

type OnlineState = "online" | "offline" | "busy";

type DriverStats = {
  total_trips: number;
  average_rating: number | null;
  total_earnings: number;
};

export default function DriverHome({ onOpenRide }: Props) {
  const insets = useSafeAreaInsets();
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestRide, setRequestRide] = useState<Ride | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("");
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [driverPosition, setDriverPosition] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locationError, setLocationError] = useState("");
  const [locatingLocation, setLocatingLocation] = useState(true);
  const [startingOnline, setStartingOnline] = useState(false);
  const requestRef = useRef<Ride | null>(null);
  const wentOnlineRef = useRef(false);

  const status: OnlineState = busy ? "busy" : online ? "online" : "offline";

  const locateMe = useCallback(async () => {
    setLocatingLocation(true);
    setLocationError("");
    try {
      const position = await requestCurrentLocation();
      setDriverPosition(position);
    } catch (e: any) {
      setDriverPosition(null);
      setLocationError(e.message || "Could not get your location.");
    } finally {
      setLocatingLocation(false);
    }
  }, []);

  useEffect(() => {
    void locateMe();
  }, [locateMe]);

  // On mount: connect socket, check busy/active ride, start request timer.
  useEffect(() => {
    let mounted = true;
    let socket: ReturnType<typeof connectSocket> | null = null;
    let onRequest: ((ev: any) => void) | null = null;
    let onStatus: ((ev: any) => void) | null = null;
    let onDriverState: ((ev: any) => void) | null = null;
    let bootTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const token = await getToken();
      socket = connectSocket(token || "");
      onRequest = (ev: any) => {
        if (!ev || !ev.ride) return;
        // The server only targets drivers it considers online, so trust it:
        // surface the offer (with Accept) and reflect that we're online.
        setOnline(true);
        requestRef.current = ev.ride;
        setRequestRide(ev.ride);
        setSecondsLeft(30);
      };
      onStatus = (ev: any) => {
        if (!ev || ev.ride_id !== requestRef.current?.id) return;
        if ((ev.status === "cancelled" || ev.status === "declined" || ev.status === "no_driver")) {
          requestRef.current = null;
          setRequestRide(null);
        }
        if (ev.accepted || ev.assigned) {
          requestRef.current = null;
          setRequestRide(null);
        }
      };
      socket.on("ride_request", onRequest);
      socket.on("ride_status", onStatus);
      // If the server says this driver already has a live ride, jump into it.
      const moved = async () => {
        try {
          const d = await api<{ status: string; active_ride_id?: string }>("/drivers/status");
          if (!mounted) return;
          if (d.active_ride_id) {
            setBusy(true);
            onOpenRide(d.active_ride_id);
          } else if (d.status === "online" && !wentOnlineRef.current) {
            await api("/drivers/status", { method: "POST", body: { online: false } });
            setOnline(false);
          }
        } catch {
          // backend offline — that's fine, we stay offline
        } finally {
          if (mounted) setLoading(false);
        }
      };
      if (socket.connected) {
        socket.emit("identify", { token });
      }
      // Register unconditionally — the socket may still be connecting at mount.
      onDriverState = (ev: any) => {
        if (!mounted || !ev) return;
        if (ev.active_ride_id) {
          setBusy(true);
          onOpenRide(ev.active_ride_id);
        } else if (ev.online && !wentOnlineRef.current) {
          api("/drivers/status", { method: "POST", body: { online: false } }).catch((e: any) => {
            if (mounted) setError(e.message || "Could not reset your online status.");
          });
        }
        setLoading(false);
      };
      socket.once("driver_state", onDriverState);
      bootTimer = setTimeout(() => {
        if (mounted) setLoading(false);
      }, 2500);
      moved();
      api<DriverStats>("/drivers/stats")
        .then((data) => {
          if (mounted) setStats(data);
        })
        .catch((e: any) => {
          if (mounted) setError(e.message || "Could not load driver stats.");
        });
    })();
    return () => {
      mounted = false;
      if (bootTimer) clearTimeout(bootTimer);
      if (socket && onRequest) socket.off("ride_request", onRequest);
      if (socket && onStatus) socket.off("ride_status", onStatus);
      if (socket && onDriverState) socket.off("driver_state", onDriverState);
    };
  }, []);

  // Auto-dismiss request after 30s.
  useEffect(() => {
    if (!requestRide) return;
    if (secondsLeft <= 0) {
      decline();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [requestRide, secondsLeft]);

  // Stream accurate GPS fixes while online so the map and ride matching use the
  // driver's real position instead of the old Suva placeholder.
  useEffect(() => {
    if (!online) return;
    let lastReported: { lat: number; lng: number; at: number } | null = null;
    return watchCurrentLocation(
      (position) => {
        setDriverPosition(position);
        setLocationError("");
        const now = Date.now();
        const movedKm = lastReported
          ? haversine(lastReported.lat, lastReported.lng, position.lat, position.lng)
          : Infinity;
        if (lastReported && movedKm < 0.01 && now - lastReported.at < 10000) return;

        lastReported = { lat: position.lat, lng: position.lng, at: now };
        api("/drivers/location", {
          method: "POST",
          body: { lat: position.lat, lng: position.lng },
        }).catch((e: any) => setLocationError(e.message || "Could not update your location."));
      },
      (e) => setLocationError(e.message),
    );
  }, [online]);

  // Pull-to-refresh (native) / Refresh button: re-sync online state, any
  // active ride, and our last reported position.
  async function onRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      const [d, nextStats] = await Promise.all([
        api<{ status: string; active_ride_id?: string | null }>("/drivers/status"),
        api<DriverStats>("/drivers/stats"),
      ]);
      setStats(nextStats);
      if (d.active_ride_id) {
        setBusy(true);
        onOpenRide(d.active_ride_id);
      } else if (d.status === "online") {
        const pos = await requestCurrentLocation().catch(() => null);
        if (pos) {
          setDriverPosition(pos);
          await api("/drivers/location", { method: "POST", body: { lat: pos.lat, lng: pos.lng } });
          setOnline(true);
        } else {
          await api("/drivers/status", { method: "POST", body: { online: false } });
          setOnline(false);
          setLocationError("Location access is needed to go online. Tap Go Online and allow location.");
        }
      } else {
        setBusy(false);
        setOnline(false);
      }
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (e: any) {
      setError(e.message || "Could not refresh.");
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleOnline() {
    setError("");
    setLocationError("");

    if (online) {
      try {
        await api("/drivers/status", { method: "POST", body: { online: false } });
        const socket = getSocket();
        if (socket) socket.emit("driver_status", { online: false });
        wentOnlineRef.current = false;
        setOnline(false);
      } catch (e: any) {
        setError(e.message || "Could not update status.");
      }
      return;
    }

    setStartingOnline(true);
    try {
      // Ask for permission and confirm a fresh, accurate fix before making the
      // driver available for matching.
      const position = await requestCurrentLocation();
      await api("/drivers/location", {
        method: "POST",
        body: { lat: position.lat, lng: position.lng },
      });
      setDriverPosition(position);
      await api("/drivers/status", { method: "POST", body: { online: true } });
      const socket = getSocket();
      if (socket) socket.emit("driver_status", { online: true });
      wentOnlineRef.current = true;
      setOnline(true);
    } catch (e: any) {
      setLocationError(e.message || "Allow location access to go online.");
    } finally {
      setStartingOnline(false);
    }
  }

  function decline() {
    const ride = requestRef.current;
    requestRef.current = null;
    setRequestRide(null);
    if (!ride) return;
    const socket = getSocket();
    if (socket) socket.emit("driver_decline", { ride_id: ride.id });
    try {
      api(`/rides/${ride.id}/cancel`, { method: "POST", body: { reason: "driver_declined" } });
    } catch {
      // ignore
    }
  }

  async function accept() {
    const ride = requestRef.current;
    if (!ride) return;
    requestRef.current = null;
    setRequestRide(null);
    setBusy(true);
    const socket = getSocket();
    if (socket) socket.emit("driver_accept", { ride_id: ride.id });
    try {
      await api(`/rides/${ride.id}/accept`, { method: "POST" });
    } catch {
      // server may not have the endpoint — socket already handles it
    }
    onOpenRide(ride.id);
  }

  const statusColorFor = (s: OnlineState) =>
    s === "online" ? colors.green : s === "busy" ? colors.amber : colors.muted;
  const statusLabelFor = (s: OnlineState) =>
    s === "online" ? "Online" : s === "busy" ? "Busy" : "Offline";

  const progress = (secondsLeft / 30) * 100;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🚕 Pointbreak Driver</Text>
          <Text style={styles.headerSub}>Fiji is the world</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={onRefresh}
            disabled={refreshing}
            activeOpacity={0.7}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.ocean} />
            ) : (
              <Text style={styles.refreshBtnText}>↻</Text>
            )}
          </TouchableOpacity>
          <View style={[styles.statusPill, { borderColor: statusColorFor(status) }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColorFor(status) }]} />
            <Text style={[styles.statusText, { color: statusColorFor(status) }]}>
              {statusLabelFor(status)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.mapWrap}>
        {driverPosition ? (
          <>
            <MapView
              style={{ flex: 1 }}
              center={driverPosition}
              zoom={0.015}
              markers={[
                { id: "me", lat: driverPosition.lat, lng: driverPosition.lng, color: status === "online" ? colors.green : colors.ocean, label: "You", icon: "🚗" },
              ]}
            />
            <View style={styles.mapAttribution}>
              <Text style={styles.mapAttributionText}>
                Your GPS location · ±{Math.round(driverPosition.accuracy)} m
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.locationPlaceholder}>
            <Text style={styles.locationPlaceholderTitle}>
              {locatingLocation
                ? "Getting your location…"
                : online
                ? "Waiting for your location"
                : "Your location is not set"}
            </Text>
            <Text style={styles.locationPlaceholderText}>
              {locationError || (online
                ? "Allow location access and enable GPS to show your position."
                : locatingLocation
                ? "Allow location access when your device asks."
                : "Your position stays private until you choose to go online.")}
            </Text>
            {!locatingLocation ? (
              <TouchableOpacity style={styles.locateBtn} onPress={locateMe} activeOpacity={0.75}>
                <Text style={styles.locateBtnText}>Try GPS again</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>

      {error || locationError ? <Text style={styles.error}>{error || locationError}</Text> : null}

      <ScrollView
        style={styles.controls}
        contentContainerStyle={[styles.controlsContent, { paddingBottom: Math.max(insets.bottom, 12) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.ocean}
            colors={[colors.ocean]}
          />
        }
      >
        {lastRefresh ? (
          <Text style={styles.refreshStamp}>Updated {lastRefresh}</Text>
        ) : null}
        {loading ? (
          <View style={{ alignItems: "center", paddingVertical: 10 }}>
            <ActivityIndicator size="small" color={colors.ocean} />
            <Text style={{ color: colors.textMuted, fontSize: typography.small, marginTop: 8 }}>
              Checking driver status…
            </Text>
          </View>
        ) : busy ? (
          <View style={styles.busyCard}>
            <Text style={styles.busyTitle}>You're on a ride 🚙</Text>
            <Text style={styles.busySub}>Continue to the active trip screen.</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[
                styles.onlineBtn,
                { backgroundColor: online ? colors.green : colors.card, borderColor: online ? colors.green : colors.border },
              ]}
              onPress={toggleOnline}
              disabled={startingOnline}
            >
              <View style={styles.onlineBtnInner}>
                {startingOnline ? (
                  <ActivityIndicator size="small" color={colors.ocean} />
                ) : (
                  <View style={[styles.onlineDot, { backgroundColor: online ? "#fff" : colors.textMuted }]} />
                )}
                <Text style={[styles.onlineBtnText, { color: online ? "#fff" : colors.textMuted }]}>
                  {startingOnline ? "Getting your location…" : online ? "Go Offline" : "Go Online"}
                </Text>
              </View>
              <Text style={[styles.onlineHint, { color: online ? "rgba(255,255,255,0.75)" : colors.textMuted }]}>
                {online
                  ? "Receiving ride requests"
                  : startingOnline
                  ? "Allow location access when prompted"
                  : "Tap to share your location and receive rides"}
              </Text>
            </TouchableOpacity>
            <View style={styles.infoRow}>
              <View style={styles.infoCard}>
                <Text style={styles.infoValue}>
                  {stats?.average_rating != null ? `${stats.average_rating.toFixed(1)}★` : "—"}
                </Text>
                <Text style={styles.infoLabel}>Rating</Text>
              </View>
              <View style={styles.infoCard}>
                <Text style={styles.infoValue}>{stats?.total_trips ?? "—"}</Text>
                <Text style={styles.infoLabel}>Trips</Text>
              </View>
              <View style={styles.infoCard}>
                <Text style={styles.infoValue}>
                  {stats ? fmtFare(stats.total_earnings) : "—"}
                </Text>
                <Text style={styles.infoLabel}>Earned</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={!!requestRide}
        transparent
        animationType="slide"
        onRequestClose={decline}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.requestCard, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={styles.requestHead}>
              <Text style={styles.requestTitle}>New ride request</Text>
              <View style={styles.timerWrap}>
                <View style={[styles.timerBar, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.timerText}>{secondsLeft}s to auto-decline</Text>
            </View>
            {requestRide ? (
              <>
                <View style={styles.requestRoute}>
                  <View style={styles.requestRow}>
                    <View style={[styles.reqDot, { borderColor: colors.green }]} />
                    <Text style={styles.reqPlace}>{requestRide.pickup_place}</Text>
                  </View>
                  <View style={styles.reqLine} />
                  <View style={styles.requestRow}>
                    <View style={[styles.reqDot, { borderColor: colors.coral }]} />
                    <Text style={styles.reqPlace}>{requestRide.dropoff_place}</Text>
                  </View>
                </View>
                <View style={styles.requestMeta}>
                  <Text style={styles.metaText}>
                    {fmtKm(requestRide.distance_km)} · ~{Math.round(requestRide.duration_min || 0)} min
                  </Text>
                  <Text style={styles.requestFare}>{fmtFare(requestRide.fare)}</Text>
                </View>
                <View style={styles.requestBtns}>
                  <TouchableOpacity style={[styles.requestBtn, styles.declineBtn]} onPress={decline}>
                    <Text style={styles.declineText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.requestBtn, styles.acceptBtn]} onPress={accept}>
                    <Text style={styles.acceptText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.deep },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTitle: { color: colors.sand, fontSize: typography.subtitle, fontWeight: "800" },
  headerSub: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 1 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.card,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: typography.tiny, fontWeight: "700" },
  mapWrap: { flex: 1 },
  locationPlaceholder: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: colors.deep,
  },
  locationPlaceholderTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
    textAlign: "center",
  },
  locationPlaceholderText: {
    color: colors.textMuted,
    fontSize: typography.small,
    textAlign: "center",
    marginTop: 8,
  },
  locateBtn: {
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locateBtnText: { color: colors.ocean, fontSize: typography.small, fontWeight: "700" },
  mapAttribution: {
    position: "absolute",
    left: 12,
    bottom: 12,
    backgroundColor: "rgba(10,22,40,0.75)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  mapAttributionText: { color: colors.textMuted, fontSize: typography.tiny },
  controls: {
    flexGrow: 0,
    backgroundColor: colors.deep,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  controlsContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  refreshBtnText: { color: colors.ocean, fontSize: 18, fontWeight: "800", lineHeight: 20 },
  refreshStamp: { color: colors.textMuted, fontSize: typography.tiny, textAlign: "right", marginBottom: 8 },
  onlineBtn: {
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
    borderWidth: 2,
  },
  onlineBtnInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  onlineDot: { width: 14, height: 14, borderRadius: 7 },
  onlineBtnText: { fontWeight: "800", fontSize: typography.heading },
  onlineHint: { fontSize: typography.small, marginTop: 6 },
  infoRow: { flexDirection: "row", gap: 10, marginTop: 14, marginBottom: 4 },
  infoCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  infoValue: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  infoLabel: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 3 },
  busyCard: { alignItems: "center", padding: 20 },
  busyTitle: { color: colors.text, fontSize: typography.heading, fontWeight: "800" },
  busySub: { color: colors.textMuted, fontSize: typography.small, marginTop: 6 },
  error: { color: colors.coral, fontSize: typography.small, paddingHorizontal: 16, paddingVertical: 6, textAlign: "center" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(4,10,20,0.65)",
    justifyContent: "flex-end",
  },
  requestCard: {
    backgroundColor: colors.deep,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    padding: 18,
  },
  requestHead: { marginBottom: 14 },
  requestTitle: { color: colors.text, fontSize: typography.heading, fontWeight: "800", marginBottom: 12 },
  timerWrap: { height: 5, borderRadius: 3, backgroundColor: colors.card, overflow: "hidden" },
  timerBar: { height: "100%", backgroundColor: colors.amber, borderRadius: 3 },
  timerText: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 6, textAlign: "right" },
  requestRoute: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
  },
  requestRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  reqDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, backgroundColor: colors.deep },
  reqPlace: { color: colors.text, fontSize: typography.body, fontWeight: "600", flex: 1 },
  reqLine: { marginLeft: 3.5, width: 2, height: 22, backgroundColor: colors.border },
  requestMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  metaText: { color: colors.textMuted, fontSize: typography.small },
  requestFare: { color: colors.ocean, fontSize: 24, fontWeight: "800" },
  requestBtns: { flexDirection: "row", gap: 12, marginTop: 16 },
  requestBtn: { flex: 1, alignItems: "center", padding: 16, borderRadius: 14 },
  declineBtn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.coral },
  declineText: { color: colors.coral, fontWeight: "800", fontSize: typography.subtitle },
  acceptBtn: { backgroundColor: colors.green },
  acceptText: { color: "#003311", fontWeight: "800", fontSize: typography.subtitle },
});