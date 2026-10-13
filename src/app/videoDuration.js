export function durationSeconds(frames, fps) {
  return `${Number((Number(frames) / Math.max(1, Number(fps))).toFixed(1))} Seconds`;
}

export function validVideoFrames(profile, frames) {
  if (!profile?.capabilities?.frames) return frames;
  const range = profile.constraints?.frames || {};
  const step = Math.max(1, Number(range.step || 1));
  const offset = Number(range.offset || 0);
  const min = Number(range.min ?? 1);
  const max = Number(range.max ?? 1000);
  const value = Number.isFinite(Number(frames)) ? Number(frames) : Number(range.default || profile.defaults?.frames || min);
  const bounded = Math.max(min, Math.min(max, value));
  return Math.max(min, Math.min(max, Math.round((bounded - offset) / step) * step + offset));
}

/** Match the backend's frame grid, including models whose grid starts away from zero. */
export function durationOptions(profile, frames, fps) {
  if (!profile?.capabilities?.frames) return [];
  const range = profile.constraints?.frames || {};
  const step = Math.max(1, Number(range.step || 1));
  const min = Number(range.min ?? 1);
  const max = Number(range.max ?? 1000);
  const snap = (value) => validVideoFrames(profile, value);
  const h3 = String(profile.family || '').replaceAll('-', '_') === 'minimax_h3';
  const candidates = h3 ? [124, 192, 243, 362] : [1, 2, 3, 5, 8, 10, 15, 20, 30, 60].map((seconds) => seconds * fps);
  const values = candidates.filter((value) => value >= min - step / 2 && value <= max + step / 2).map(snap);
  // Reused settings may have a valid duration between the usual presets.
  if (Number(frames) >= min && Number(frames) <= max) values.push(snap(Number(frames)));
  if (!values.length) values.push(snap(Number(range.default || profile.defaults?.frames || min)));
  return [...new Set(values)].sort((a, b) => a - b).map((value) => ({ value: String(value), label: durationSeconds(value, fps) }));
}
