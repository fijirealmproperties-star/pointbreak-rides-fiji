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
import { requestCurrentLocation } from "../geo";
import MapView from "../components/MapView";

type Props = {
  onOpenRide: (rideId: string) => void;
};

const SUVA = { lat: -18.1416, lng: 178.4419 };

type OnlineState = "online" | "offline" | "busy";

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
  const requestRef = useRef<Ride | null>(null);

  const status: OnlineState = busy ? "busy" : online ? "online" : "offline";

  // On mount: connect socket, check busy/active ride, start request timer.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const token = await getToken();
      const socket = connectSocket(token || "");
      const onRequest = (ev: any) => {
        if (!ev || !ev.ride) return;
        // The server only targets drivers it considers online, so trust it:
        // surface the offer (with Accept) and reflect that we're online.
        setOnline(true);
        requestRef.current = ev.ride;
        setRequestRide(ev.ride);
        setSecondsLeft(30);
      };
      const onStatus = (ev: any) => {
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
          } else if (d.status === "online") {
            setOnline(true);
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
      socket.once("driver_state", (ev: any) => {
        if (!mounted || !ev) return;
        if (ev.active_ride_id) {
          setBusy(true);
          onOpenRide(ev.active_ride_id);
        } else if (ev.online) setOnline(true);
        setLoading(false);
      });
      const bootTimer = setTimeout(() => {
        if (mounted) setLoading(false);
      }, 2500);
      moved();
      return () => {
        mounted = false;
        clearTimeout(bootTimer);
        socket.off("ride_request", onRequest);
        socket.off("ride_status", onStatus);
      };
    })();
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

  // Keep the backend's idea of our position fresh while online, so the rider's
  // request reaches the genuinely nearest driver.
  useEffect(() => {
    if (!online) return;
    reportLocation();
    const t = setInterval(() => reportLocation(), 30000);
    return () => clearInterval(t);
  }, [online]);

  async function reportLocation() {
    try {
      const p = await requestCurrentLocation();
      await api("/drivers/location", { method: "POST", body: { lat: p.lat, lng: p.lng } });
    } catch {
      // Location is optional — matching falls back to the driver's last known spot.
    }
  }

  // Pull-to-refresh (native) / Refresh button: re-sync online state, any
  // active ride, and our last reported position.
  async function onRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      const p = requestCurrentLocation().catch(() => null);
      const d = await api<{ status: string; active_ride_id?: string | null }>("/drivers/status");
      if (d.active_ride_id) {
        setBusy(true);
        onOpenRide(d.active_ride_id);
      } else {
        setBusy(false);
        setOnline(d.status === "online");
      }
      const pos = await p;
      if (pos) {
        await api("/drivers/location", { method: "POST", body: { lat: pos.lat, lng: pos.lng } });
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
    const next = !online;
    setOnline(next);
    const socket = getSocket();
    if (socket) socket.emit("driver_status", { online: next });
    try {
      await api("/drivers/status", { method: "POST", body: { online: next } });
      if (next) reportLocation();
    } catch (e: any) {
      setError(e.message || "Could not update status.");
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
          <Text style={styles.headerTitle}>🏄 Pointbreak Driver</Text>
          <Text style={styles.headerSub}>Suva · Viti Levu</Text>
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
        <MapView
          style={{ flex: 1 }}
          center={SUVA}
          zoom={0.04}
          markers={[
            { id: "me", lat: SUVA.lat, lng: SUVA.lng, color: status === "online" ? colors.green : colors.ocean, label: "You" },
          ]}
        />
        <View style={styles.mapAttribution}>
          <Text style={styles.mapAttributionText}>Trip pricing surf is up · FJ$ base + km</Text>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

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
            >
              <View style={styles.onlineBtnInner}>
                <View style={[styles.onlineDot, { backgroundColor: online ? "#fff" : colors.textMuted }]} />
                <Text style={[styles.onlineBtnText, { color: online ? "#fff" : colors.textMuted }]}>
                  {online ? "Go Offline" : "Go Online"}
                </Text>
              </View>
              <Text style={[styles.onlineHint, { color: online ? "rgba(255,255,255,0.75)" : colors.textMuted }]}>
                {online ? "Receiving ride requests" : "Tap to start receiving rides"}
              </Text>
            </TouchableOpacity>
            <View style={styles.infoRow}>
              <View style={styles.infoCard}>
                <Text style={styles.infoValue}>2.5★</Text>
                <Text style={styles.infoLabel}>Rating</Text>
              </View>
              <View style={styles.infoCard}>
                <Text style={styles.infoValue}>12</Text>
                <Text style={styles.infoLabel}>Trips</Text>
              </View>
              <View style={styles.infoCard}>
                <Text style={styles.infoValue}>FJ$0.00</Text>
                <Text style={styles.infoLabel}>Today</Text>
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