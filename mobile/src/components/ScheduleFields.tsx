import React from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";

type Props = {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  onChange: (date: string, time: string) => void;
};

// Browsers get native date/time pickers; native builds fall back to typed fields.
export default function ScheduleFields({ date, time, onChange }: Props) {
  if (Platform.OS === "web") {
    const inputStyle: any = {
      flex: 1,
      padding: 12,
      fontSize: 16,
      borderRadius: 10,
      border: "1px solid #DDD",
      background: "#F3F3F3",
      color: "#000",
      minWidth: 0,
    };
    return (
      <View style={styles.row}>
        {React.createElement("input", {
          type: "date",
          value: date,
          style: inputStyle,
          onChange: (e: any) => onChange(e.target.value, time),
        })}
        {React.createElement("input", {
          type: "time",
          value: time,
          style: inputStyle,
          onChange: (e: any) => onChange(date, e.target.value),
        })}
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        value={date}
        placeholder="YYYY-MM-DD"
        onChangeText={(t) => onChange(t, time)}
      />
      <TextInput
        style={styles.input}
        value={time}
        placeholder="HH:MM"
        onChangeText={(t) => onChange(date, t)}
      />
    </View>
  );
}

export function toLocalDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function toLocalTimeStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function parseSchedule(date: string, time: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  return Number.isFinite(d.getTime()) ? d : null;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginBottom: 10 },
  input: {
    flex: 1,
    backgroundColor: "#F3F3F3",
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: "#000",
  },
});
