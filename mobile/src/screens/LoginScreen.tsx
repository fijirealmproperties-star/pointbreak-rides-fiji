import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { colors, typography } from "../theme";
import { api, setAuth, clearAuth, setKeepSignedIn, User } from "../api";
import { isDriverApp, setDriverMode, DEMO_RIDER, DEMO_DRIVER, DEMO_ENABLED } from "../appMode";

type Doc = { type: string; mime: string; data: string; name: string };
const DOC_LABELS: Record<string, string> = { national_id: "National ID", tin: "TIN ID", voters_card: "Voter's card" };

function pickFile(camera: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement("input");
    el.type = "file";
    el.accept = camera ? "image/*" : "image/*,application/pdf";
    if (camera) el.setAttribute("capture", "environment");
    el.onchange = () => resolve((el.files && el.files[0]) || null);
    el.click();
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
}

// Shrinks photos so uploads stay small and fast on mobile data.
async function toDocument(file: File, type: string): Promise<Doc> {
  if (file.type === "application/pdf") {
    if (file.size > 3 * 1024 * 1024) throw new Error("PDF is too large (max 3 MB)");
    return { type, mime: file.type, data: await readAsDataUrl(file), name: file.name };
  }
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo or a PDF");
  const url = URL.createObjectURL(file);
  try {
    const img: HTMLImageElement = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not open that image"));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { type, mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.8), name: file.name || "photo.jpg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Props = {
  onLogin: (user: User) => void;
};

export default function LoginScreen({ onLogin }: Props) {
  const [driverApp, setDriverAppState] = useState(isDriverApp());
  const demo = DEMO_ENABLED;
  const [mode, setMode] = useState<"login" | "register" | "verify" | "forgot" | "reset">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState("");
  const [phone, setPhone] = useState(demo && driverApp ? DEMO_DRIVER.phone : "");
  const [password, setPassword] = useState(demo && driverApp ? DEMO_DRIVER.password : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [keep, setKeep] = useState(true);
  const [docType, setDocType] = useState("national_id");
  const [docs, setDocs] = useState<Doc[]>([]);

  async function addDoc(camera: boolean) {
    setError("");
    try {
      const f = await pickFile(camera);
      if (!f) return;
      if (docs.length >= 3) throw new Error("You can upload up to 3 documents");
      const d = await toDocument(f, docType);
      setDocs((x) => [...x, d]);
    } catch (e: any) {
      setError(e.message || "Could not add document");
    }
  }

  function chooseRole(nextDriver: boolean) {
    setDriverAppState(nextDriver);
    setDriverMode(nextDriver);
    setError("");
    setInfo("");
    setMode("login");
    if (demo) {
      setPhone(nextDriver ? DEMO_DRIVER.phone : DEMO_RIDER.phone);
      setPassword(nextDriver ? DEMO_DRIVER.password : DEMO_RIDER.password);
    }
  }

  function goMode(m: typeof mode) {
    setMode(m);
    setError("");
    setInfo("");
    setCode("");
  }

  async function finishLogin(d: { accessToken: string; refreshToken?: string; user: User }) {
    if (driverApp && d.user.role !== "driver") {
      await clearAuth();
      setError("That is a rider account. Choose Rider above, or sign in with a driver account.");
      return;
    }
    await setAuth(d.accessToken, d.user, d.refreshToken);
    await setKeepSignedIn(keep);
    onLogin(d.user);
  }

  async function submit(override?: { phone: string; password: string }) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      type Session = { accessToken: string; refreshToken?: string; user: User };
      if (mode === "forgot") {
        await api("/auth/forgot-password", { method: "POST", body: { phone, email } });
        setMode("reset");
        setPassword("");
        setInfo("If that phone number and email match, we sent a 6-digit code to your email.");
        return;
      }
      if (mode === "reset") {
        await api("/auth/reset-password", { method: "POST", body: { phone, email, code, password } });
        setMode("login");
        setCode("");
        setInfo("Password changed. Sign in with your new password.");
        return;
      }
      if (mode === "verify") {
        await finishLogin(await api<Session>("/auth/verify-email", { method: "POST", body: { phone, code } }));
        return;
      }
      if (mode === "register" && !override) {
        if (Platform.OS === "web" && docs.length === 0) {
          setError("Please add a photo of your ID, TIN ID or voter's card.");
          return;
        }
        const r = await api<{ needsVerification?: boolean }>("/auth/register", {
          method: "POST",
          body: { name, phone, email, password, documents: docs.map(({ type, mime, data }) => ({ type, mime, data })) },
        });
        if (r.needsVerification) {
          setMode("verify");
          setCode("");
          setInfo("We sent a 6-digit code to your email. Enter it to finish signing up.");
        }
        return;
      }
      await finishLogin(
        await api<Session>("/auth/login", {
          method: "POST",
          body: { phone: (override || { phone }).phone, password: (override || { password }).password },
        })
      );
    } catch (e: any) {
      if (e.code === "EMAIL_NOT_VERIFIED") {
        setMode("verify");
        setCode("");
        setInfo(e.message);
        return;
      }
      setError(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    try {
      await api("/auth/resend-code", { method: "POST", body: { phone } });
      setInfo("A new code was sent.");
    } catch (e: any) {
      setError(e.message || "Could not resend code");
    }
  }

  function demoLogin(creds: { phone: string; password: string }) {
    setMode("login");
    setPhone(creds.phone);
    setPassword(creds.password);
    submit(creds);
  }

  function openDriverApp() {
    if (Platform.OS !== "web") return;
    const loc: any = (globalThis as any).location;
    if (!loc) return;
    const proto = loc.protocol || "http:";
    const host = loc.hostname || "localhost";
    const url = `${proto}//${host}:8083/?app=driver`;
    const open = (globalThis as any).open;
    if (typeof open === "function") open(url, "_blank");
    else loc.href = url;
  }

  // Already running as an installed PWA / native app? Then there is nothing to
  // install. On the web in a normal tab we offer the /download install page.
  function isInstalledApp(): boolean {
    if (Platform.OS !== "web") return true;
    const w: any = typeof window === "undefined" ? null : window;
    if (!w) return true;
    if (w.navigator && w.navigator.standalone) return true; // iOS home screen
    try {
      return !!(w.matchMedia && w.matchMedia("(display-mode: standalone)").matches);
    } catch {
      return false;
    }
  }

  function openInstallPage() {
    const loc: any = (globalThis as any).location;
    if (loc) loc.href = "/download";
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.deep }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.safe}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.logo}>{driverApp ? "🚕" : "🏄"}</Text>
          <Text style={styles.logoWave}>~ · ~ · ~</Text>
          <Text style={styles.title}>{driverApp ? "Pointbreak Driver" : "Pointbreak Fiji Rides"}</Text>
          <Text style={styles.tagline}>
            {driverApp ? "Driver app · Fiji is the world" : "Fiji rides at your fingertips"}
          </Text>
          <Text style={styles.subTagline}>
            {driverApp ? "Go online and accept rides." : "Book a ride anywhere across Fiji."}
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.roleRow}>
            <TouchableOpacity
              style={[styles.roleChip, !driverApp && styles.roleChipActive]}
              onPress={() => chooseRole(false)}
            >
              <Text style={styles.roleIcon}>🏄</Text>
              <Text style={[styles.roleText, !driverApp && styles.roleTextActive]}>Rider</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleChip, driverApp && styles.roleChipActive]}
              onPress={() => chooseRole(true)}
            >
              <Text style={styles.roleIcon}>🚕</Text>
              <Text style={[styles.roleText, driverApp && styles.roleTextActive]}>Driver</Text>
            </TouchableOpacity>
          </View>

          {driverApp ? (
            <View style={styles.driverBadge}>
              <Text style={styles.driverBadgeText}>DRIVER APP</Text>
            </View>
          ) : mode === "login" || mode === "register" ? (
            <View style={styles.tabs}>
              <TouchableOpacity
                style={[styles.tab, mode === "login" && styles.tabActive]}
                onPress={() => goMode("login")}
              >
                <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Login</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, mode === "register" && styles.tabActive]}
                onPress={() => goMode("register")}
              >
                <Text style={[styles.tabText, mode === "register" && styles.tabTextActive]}>Register</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {mode === "register" && !driverApp ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Full name"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
              />
              <Text style={styles.roleLabel}>Rider account</Text>
            </>
          ) : null}

          {mode === "verify" ? <Text style={styles.roleLabel}>Verify your email</Text> : null}
          {mode === "forgot" ? <Text style={styles.roleLabel}>Forgot password</Text> : null}
          {mode === "reset" ? <Text style={styles.roleLabel}>Set a new password</Text> : null}

          {mode === "login" || mode === "register" || mode === "forgot" ? (
            <TextInput
              style={styles.input}
              placeholder="Phone (e.g. +679…)"
              placeholderTextColor={colors.textMuted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoComplete="username"
              textContentType="username"
              importantForAutofill="yes"
            />
          ) : null}
          {mode === "register" || mode === "forgot" ? (
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          {mode === "verify" || mode === "reset" ? (
            <TextInput
              style={styles.input}
              placeholder="6-digit code from your email"
              placeholderTextColor={colors.textMuted}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
            />
          ) : null}
          {mode === "login" || mode === "register" || mode === "reset" ? (
            <View style={{ position: "relative", justifyContent: "center" }}>
              <TextInput
                style={[styles.input, Platform.OS === "web" ? null : { paddingRight: 52 }]}
                placeholder={mode === "reset" ? "New password (min 8 characters)" : "Password"}
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                textContentType={mode === "login" ? "password" : "newPassword"}
                importantForAutofill="yes"
              />
              {Platform.OS === "web" ? null : <TouchableOpacity
                onPress={() => setShowPw((v) => !v)}
                accessibilityLabel={showPw ? "Hide password" : "Show password"}
                style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 48, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ fontSize: 20 }}>{showPw ? "🙈" : "👁️"}</Text>
              </TouchableOpacity>}
            </View>
          ) : null}
          {mode === "register" && !driverApp && Platform.OS === "web" ? (
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.roleLabel}>ID verification (sent securely to admin)</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8 }}>
                {Object.keys(DOC_LABELS).map((k) => (
                  <TouchableOpacity
                    key={k}
                    onPress={() => setDocType(k)}
                    style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.textMuted, marginRight: 6, marginBottom: 6, backgroundColor: docType === k ? colors.ocean : "transparent" }}
                  >
                    <Text style={{ color: docType === k ? "#fff" : colors.textMuted, fontWeight: "700" }}>{DOC_LABELS[k]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: "row" }}>
                <TouchableOpacity style={[styles.btn, { flex: 1, marginRight: 6 }]} onPress={() => addDoc(true)}>
                  <Text style={styles.btnText}>📷 Take photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={() => addDoc(false)}>
                  <Text style={styles.btnText}>📁 Upload file</Text>
                </TouchableOpacity>
              </View>
              {docs.map((d, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                  <Text style={{ color: colors.text, flex: 1 }}>✅ {DOC_LABELS[d.type]} · {d.name}</Text>
                  <TouchableOpacity onPress={() => setDocs((x) => x.filter((_, j) => j !== i))}>
                    <Text style={{ color: colors.coral, fontWeight: "800" }}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
          {mode === "login" ? (
            <TouchableOpacity
              onPress={() => setKeep((v) => !v)}
              accessibilityRole="checkbox"
              style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}
            >
              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.textMuted, alignItems: "center", justifyContent: "center", backgroundColor: keep ? colors.green : "transparent", marginRight: 10 }}>
                {keep ? <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>✓</Text> : null}
              </View>
              <Text style={{ color: colors.textMuted }}>Keep me logged in</Text>
            </TouchableOpacity>
          ) : null}

          {info ? <Text style={styles.info}>{info}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={styles.btn} onPress={() => submit()} disabled={busy}>
            <Text style={styles.btnText}>
              {busy
                ? "Please wait…"
                : mode === "login"
                ? driverApp ? "Sign in as driver" : "Login"
                : mode === "register"
                ? "Create account"
                : mode === "verify"
                ? "Verify & sign in"
                : mode === "forgot"
                ? "Send reset code"
                : "Reset password"}
            </Text>
          </TouchableOpacity>

          {mode === "login" ? (
            <TouchableOpacity style={styles.driverLink} onPress={() => goMode("forgot")}>
              <Text style={styles.driverLinkText}>Forgot password?</Text>
            </TouchableOpacity>
          ) : null}
          {mode === "verify" ? (
            <TouchableOpacity style={styles.driverLink} onPress={resendCode}>
              <Text style={styles.driverLinkText}>Resend code</Text>
            </TouchableOpacity>
          ) : null}
          {mode === "verify" || mode === "forgot" || mode === "reset" ? (
            <TouchableOpacity style={styles.driverLink} onPress={() => goMode("login")}>
              <Text style={styles.driverLinkText}>Back to login</Text>
            </TouchableOpacity>
          ) : null}

          {demo && Platform.OS === "web" && !driverApp ? (
            <TouchableOpacity style={styles.driverLink} onPress={openDriverApp}>
              <Text style={styles.driverLinkText}>🚕 Open driver app (for testing)</Text>
            </TouchableOpacity>
          ) : null}

          {Platform.OS === "web" && !isInstalledApp() && !driverApp ? (
            <TouchableOpacity style={styles.driverLink} onPress={openInstallPage}>
              <Text style={styles.driverLinkText}>📲 Get the app — install on your phone</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.swellFooter}>
            <Text style={styles.swellText}>~ The swell is up — where to? ~</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: { flexGrow: 1, padding: 24, justifyContent: "center", paddingBottom: 40 },
  hero: { alignItems: "center", marginBottom: 28 },
  logo: { fontSize: 56 },
  logoWave: { color: colors.ocean, fontSize: 14, letterSpacing: 3, marginTop: -4, marginBottom: 6 },
  title: {
    color: colors.sand,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 0.5,
    textShadowColor: "#0066CC",
    textShadowRadius: 12,
  },
  tagline: { color: colors.text, fontSize: typography.subtitle, fontWeight: "600", marginTop: 6 },
  subTagline: { color: colors.textMuted, fontSize: typography.small, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.border },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.deep,
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 9 },
  tabActive: { backgroundColor: colors.ocean },
  tabText: { color: colors.textMuted, fontWeight: "700" },
  tabTextActive: { color: colors.text },
  driverBadge: {
    alignSelf: "center",
    backgroundColor: "rgba(0,102,204,0.15)",
    borderWidth: 1,
    borderColor: colors.ocean,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    marginBottom: 16,
  },
  driverBadgeText: { color: colors.sky, fontWeight: "800", fontSize: typography.tiny, letterSpacing: 2 },
  roleLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  roleRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  roleChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.deep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
  },
  roleChipActive: { borderColor: colors.ocean, backgroundColor: "rgba(0,102,204,0.15)" },
  roleIcon: { fontSize: 18 },
  roleText: { color: colors.textMuted, fontWeight: "600" },
  roleTextActive: { color: colors.text },
  input: {
    backgroundColor: colors.deep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.text,
    fontSize: typography.body,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: colors.ocean,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 4,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  demoBtn: {
    marginTop: 10,
    borderRadius: 12,
    padding: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.deep,
  },
  demoBtnText: { color: colors.sky, fontWeight: "700", fontSize: typography.small },
  driverLink: { marginTop: 14, alignItems: "center", paddingVertical: 8 },
  driverLinkText: { color: colors.sky, fontWeight: "700", fontSize: typography.small, textDecorationLine: "underline" },
  error: { color: colors.coral, marginBottom: 10, fontSize: typography.small },
  info: { color: colors.sky, marginBottom: 10, fontSize: typography.small },
  demo: { color: colors.textMuted, fontSize: typography.tiny, marginTop: 16, textAlign: "center", lineHeight: 16 },
  swellFooter: { alignItems: "center", marginTop: 18 },
  swellText: { color: colors.sky, fontSize: typography.small, opacity: 0.8 },
});