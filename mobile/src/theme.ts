export const colors = {
  ocean: "#0066CC",
  sky: "#33AADD",
  sand: "#F5E6C8",
  sunset: "#FF6B35",
  coral: "#FF4444",
  foam: "#FFFFFF",
  deep: "#0A1628",
  muted: "#8899AA",
  green: "#22CC66",
  amber: "#FFAA00",
  card: "#1A2B3D",
  border: "#2A3B4D",
  text: "#FFFFFF",
  textMuted: "#8899AA",
};

export const typography = {
  title: 26,
  heading: 20,
  subtitle: 16,
  body: 14,
  small: 12,
  tiny: 11,
  bold: "800" as const,
  semibold: "600" as const,
  medium: "500" as const,
};

export const fmtFare = (n: number | null | undefined) =>
  n == null ? "—" : `FJ$${Number(n).toFixed(2)}`;

export function fmtKm(km: number | null | undefined): string {
  if (km == null) return "—";
  return km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
}

export function fmtDuration(min: number | null | undefined): string {
  if (min == null) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function statusLabel(status: string): string {
  switch (status) {
    case "requested": return "Requested";
    case "searching": return "Searching";
    case "accepted": return "Driver found";
    case "arrived": return "Driver arrived";
    case "in_progress": return "On trip";
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "requested": return colors.sky;
    case "searching": return colors.sky;
    case "accepted": return colors.amber;
    case "arrived": return colors.green;
    case "in_progress": return colors.ocean;
    case "completed": return colors.green;
    case "cancelled": return colors.coral;
    default: return colors.muted;
  }
}