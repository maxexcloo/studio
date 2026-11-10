/** A file size in decimal units ("840 KB", "1.2 GB"); empty for nothing. */
export function formatBytes(value = 0) {
  if (!value) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1000)));
  const scaled = value / 1000 ** unit;
  return `${scaled >= 10 || !unit ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
}
