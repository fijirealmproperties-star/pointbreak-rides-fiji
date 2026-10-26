import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, typography } from "./src/theme";
import {
  getUser,
  clearAuth,
  getToken,
  getRefreshToken,
  isTokenExpired,
  refreshAccessToken,
  setOnUnauthorized,
  User,
} from "./src/api";
import { disconnectSocket } from "./src/socket";
import { Screen } from "./src/navigation";
import LoginScreen from "./src/screens/LoginScreen";
import RiderHome from "./src/screens/RiderHome";
import RiderActiveRide from "./src/screens/RiderActiveRide";
import RiderTrips from "./src/screens/RiderTrips";
import DriverHome from "./src/screens/DriverHome";
import DriverActiveRide from "./src/screens/DriverActiveRide";
import DriverTrips from "./src/screens/DriverTrips";

type TabKey = "home" | "trips" | "profile";

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: "home", label: "Home", icon: "🏠" },
  { key: "trips", label: "Trips", icon: "📋" },
  { key: "profile", label: "Profile", icon: "👤" },
];

function TabBar({ active, onTab }: { active: TabKey | null; onTab: (t: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabbar, { paddingBottom: insets.bottom }]}>
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <TouchableOpacity key={t.key} style={styles.tab} onPress={() => onTab(t.key)}>
            <Text style={[styles.tabIcon, isActive && { transform: [{ translateY: -2 }] }]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t.label}</Text>
            {isActive ? <View style={styles.tabBar} /> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ProfileScreen({ user, onLogout }: { user: User; onLogout: () => void }) {
  const insets = useSafeAreaInsets();
  const roleLabel = user.role === "driver" ? "Driver" : "Rider";
  const dp = user.driverProfile;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.deep }}
      contentContainerStyle={[styles.profileContent, { paddingBottom: insets.bottom + 24 }]}
    >
      <View style={styles.profileHero}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{(user.name || user.phone || "P")[0].toUpperCase()}</Text>
        </View>
        <Text style={styles.profileName}>{user.name}</Text>
        <Text style={styles.profileRole}>{roleLabel}</Text>
        <View style={styles.profilePhonePill}>
          <Text style={styles.profilePhone}>{user.phone}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>About you</Text>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Role</Text>
          <Text style={styles.cardValue}>{roleLabel}</Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Member ID</Text>
          <Text style={styles.cardValue}>{user.id}</Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Phone</Text>
          <Text style={styles.cardValue}>{user.phone}</Text>
        </View>
      </View>

      {dp ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Driver profile</Text>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Vehicle</Text>
            <Text style={styles.cardValue}>{dp.vehicle_type || "—"} {dp.vehicle_model || ""}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Plate</Text>
            <Text style={styles.cardValue}>{dp.license_plate || "—"}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Rating</Text>
            <Text style={styles.cardValue}>★ {dp.rating != null ? Number(dp.rating).toFixed(1) : "—"}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Trips</Text>
            <Text style={styles.cardValue}>{dp.trips != null ? dp.trips : "—"}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Status</Text>
            <Text style={styles.cardValue}>{dp.status || "—"}</Text>
          </View>
        </View>
      ) : null}

      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
      <Text style={styles.surfTag}>
        🌊 Ride the wave · Pointbreak Rides Fiji · surf responsibly
      </Text>
    </ScrollView>
  );
}

function Root() {
  const [user, setUser] = useState<User | null>(null);
  const [booted, setBooted] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "login" });

  useEffect(() => {
    (async () => {
      let u = await getUser();
      if (u) {
        const token = await getToken();
        if (token && isTokenExpired(token)) {
          const refresh = await getRefreshToken();
          if (refresh) {
            await refreshAccessToken();
          } else {
            // Stale session with no way to refresh — start clean at login.
            await clearAuth();
            u = null;
          }
        }
      }
      setUser(u);
      setScreen(u ? (u.role === "driver" ? { name: "driver-home" } : { name: "rider-home" }) : { name: "login" });
      setBooted(true);
    })();
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      clearAuth().finally(() => {
        disconnectSocket();
        setUser(null);
        setScreen({ name: "login" });
      });
    });
    return () => setOnUnauthorized(null);
  }, []);

  function goTab(tab: TabKey) {
    if (!user) return;
    if (tab === "home") {
      const next: Screen = user.role === "driver" ? { name: "driver-home" } : { name: "rider-home" };
      setScreen(next);
    } else if (tab === "trips") {
      const next: Screen = user.role === "driver" ? { name: "driver-trips" } : { name: "rider-trips" };
      setScreen(next);
    } else {
      setScreen({ name: "profile" });
    }
  }

  async function logout() {
    await clearAuth();
    disconnectSocket();
    setUser(null);
    setScreen({ name: "login" });
  }

  if (!booted) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={styles.bootTitle}>🏄 Pointbreak Rides</Text>
        <Text style={{ color: colors.textMuted, fontSize: typography.small, marginTop: 8 }}>
          Catching the swell…
        </Text>
      </View>
    );
  }

  const isRider = user?.role === "rider";

  // Which tab is highlighted (null while on a full-screen active ride).
  let activeTab: TabKey | null = null;
  if (screen.name === "rider-home" || screen.name === "driver-home") activeTab = "home";
  else if (screen.name === "rider-trips" || screen.name === "driver-trips") activeTab = "trips";
  else if (screen.name === "profile") activeTab = "profile";

  const showTab =
    user !== null &&
    activeTab !== null;

  return (
    <View style={styles.screen}>
      <StatusBar
        barStyle={screen.name === "login" ? "light-content" : "light-content"}
        backgroundColor={colors.deep}
      />
      {!user || screen.name === "login" ? (
        <LoginScreen
          onLogin={(u) => {
            setUser(u);
            setScreen(u.role === "driver" ? { name: "driver-home" } : { name: "rider-home" });
          }}
        />
      ) : screen.name === "rider-home" ? (
        <RiderHome onOpenRide={(rideId) => setScreen({ name: "rider-active-ride", rideId })} />
      ) : screen.name === "rider-active-ride" ? (
        <RiderActiveRide
          rideId={screen.rideId}
          onClose={() => (isRider ? setScreen({ name: "rider-home" }) : setScreen({ name: "driver-home" }))}
        />
      ) : screen.name === "rider-trips" ? (
        <RiderTrips onOpenRide={(rideId) => setScreen({ name: "rider-active-ride", rideId })} />
      ) : screen.name === "driver-home" ? (
        <DriverHome onOpenRide={(rideId) => setScreen({ name: "driver-active-ride", rideId })} />
      ) : screen.name === "driver-active-ride" ? (
        <DriverActiveRide
          rideId={screen.rideId}
          onDone={() => (isRider ? setScreen({ name: "rider-home" }) : setScreen({ name: "driver-home" }))}
        />
      ) : screen.name === "driver-trips" ? (
        <DriverTrips />
      ) : screen.name === "profile" && user ? (
        <ProfileScreen user={user} onLogout={logout} />
      ) : null}
      {showTab && <TabBar active={activeTab} onTab={goTab} />}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.deep },
  bootTitle: { color: colors.sand, fontSize: typography.heading, fontWeight: "800" },
  tabbar: {
    flexDirection: "row",
    backgroundColor: colors.deep,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: { flex: 1, alignItems: "center", paddingTop: 10, gap: 3 },
  tabIcon: { fontSize: 20 },
  tabLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  tabLabelActive: { color: colors.ocean, fontWeight: "800" },
  tabBar: { width: 26, height: 3, borderRadius: 2, backgroundColor: colors.ocean, marginTop: 2 },
  profileContent: { padding: 20 },
  profileHero: { alignItems: "center", paddingVertical: 24 },
  profileAvatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.ocean,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.sky,
  },
  profileAvatarText: { color: "#fff", fontSize: 36, fontWeight: "800" },
  profileName: { color: colors.text, fontSize: typography.heading, fontWeight: "800", marginTop: 12 },
  profileRole: { color: colors.sky, fontSize: typography.small, fontWeight: "700", marginTop: 2, textTransform: "uppercase", letterSpacing: 1 },
  profilePhonePill: {
    marginTop: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  profilePhone: { color: colors.text, fontSize: typography.small },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { color: colors.text, fontSize: typography.body, fontWeight: "800", marginBottom: 8 },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  cardLabel: { color: colors.textMuted, fontSize: typography.small },
  cardValue: { color: colors.text, fontSize: typography.small, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  logoutBtn: {
    marginTop: 6,
    backgroundColor: "#241018",
    borderWidth: 1,
    borderColor: colors.coral,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  logoutText: { color: colors.coral, fontWeight: "800", fontSize: typography.subtitle },
  surfTag: { color: colors.textMuted, fontSize: typography.tiny, textAlign: "center", marginTop: 20 },
});