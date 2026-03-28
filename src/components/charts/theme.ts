export const CHART_COLORS = {
  green: "#00ff88",
  greenDim: "#007a40",
  greenGhost: "rgba(0,255,136,0.15)",
  red: "#ff3366",
  redDim: "rgba(255,51,102,0.15)",
  amber: "#ffaa00",
  cyan: "#00f0ff",
  blue: "#00aaff",
  pink: "#ff4488",
  text: "#e0e0e8",
  textMuted: "#888899",
  grid: "rgba(0,240,255,0.06)",
  background: "#0a0a0f",
  tooltip: "#12121a",
  border: "rgba(0,240,255,0.12)",
};

// Gradient colors for confidence distribution buckets (35-44, 45-54, 55-64, 65+)
export const CONF_DIST_COLORS = ["#ff8c00", "#ffd700", "#00cc66", "#00ff88"];

// Gradient colors for calibration buckets by position
export const CAL_BUCKET_COLORS: Record<string, string> = {
  "<35": "#ff4444",
  "35-45": "#ff8c00",
  "45-55": "#ffd700",
  "55-65": "#00cc66",
  "65-75": "#00ff88",
  "75+": "#00ffcc",
};
