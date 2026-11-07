import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../theme";
import { getUser } from "../api";
import RoadsideMeter from "../components/RoadsideMeter";
import SurfsUpMeter from "../components/SurfsUpMeter";
import { startMeterGps } from "../meterGps";

export default function DriverMeter() {
  const insets = useSafeAreaInsets();
  const [driverId, setDriverId] = useState<string | undefined>();
  const [legacyTrip, setLegacyTrip] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getUser().then((u) => setDriverId(u?.driverProfile?.id || u?.id));
    AsyncStorage.getItem("pb-active-trip")
      .then((trip) => setLegacyTrip(!!trip))
      .catch(() => setError("Could not check for an unfinished meter trip. Please restart the app and try again."));
  }, []);

  // Keep the phone's GPS warm and the screen awake whenever a driver has the app open,
  // so a meter starts with a lock already acquired and never waits for the first fix.
  useEffect(() => {
    const stopGps = startMeterGps(() => {}, () => {});
    let lock: any = null;
    const hold = async () => {
      try {
        const nav: any = typeof navigator !== "undefined" ? navigator : null;
        if (nav?.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen");
      } catch {}
    };
    hold();
    const onVis = () => { if (document.visibilityState === "visible") hold(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    return () => {
      stopGps();
      try { lock?.release?.(); } catch {}
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {error ? <Text style={{ color: colors.coral }}>{error}</Text>
          : legacyTrip === null ? <ActivityIndicator color={colors.ocean} />
          : legacyTrip ? (
            <>
              <Text style={{ color: colors.text, marginBottom: 12 }}>
                Finish your existing Roadside Meter trip before switching to Surfs Up Meter.
              </Text>
              <RoadsideMeter driverId={driverId} retiring onRetiredTripFinished={() => setLegacyTrip(false)} />
            </>
          ) : <SurfsUpMeter driverId={driverId} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.deep },
});
