import { profileImageSize } from "../shared/resolution.ts";

/** Each kind's default model for everyone; its side is where that kind runs (Settings › Where Work Runs). */
export const mediaDefaultProfileKeys = {
  image: "STUDIO_DEFAULT_IMAGE_PROFILE",
  video: "STUDIO_DEFAULT_VIDEO_PROFILE",
};
export const defaultTextProfileKey = "STUDIO_DEFAULT_TEXT_PROFILE";
/** Where text work runs: the side of the default text profile, Cloud unless it is local. */
export const defaultTextSide = (environment = process.env) =>
  environment[defaultTextProfileKey]?.startsWith("local/") ? "local" : "cloud";

/** Fit a reference's proportions to the canvas budget and both dimension limits together. */
export function referenceImageSize(profile, reference, { pixels, resize = true } = {}) {
  const width = Number(reference?.width);
  const height = Number(reference?.height);
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
  const defaults = profileImageSize(profile);
  const budget = Number(pixels) > 0 ? Number(pixels) : defaults.width * defaults.height;
  const ranges = ["width", "height"].map((key) => {
    const range = profile?.constraints?.[key] || {};
    const step = Number(range.step) || 8;
    return {
      min: Math.ceil((range.min ?? 64) / step) * step,
      max: Math.floor((range.max ?? 4096) / step) * step,
      step,
    };
  });
  if (ranges.some((range) => range.min > range.max)) return null;
  const [w, h] = ranges;
  const minScale = Math.max(w.min / width, h.min / height);
  const maxScale = Math.min(w.max / width, h.max / height);
  let scale = resize ? Math.min(1, Math.sqrt(budget / (width * height))) : 1;
  // Some fixed or unusually narrow ranges cannot represent the source ratio.
  scale =
    minScale <= maxScale
      ? Math.max(minScale, Math.min(maxScale, scale))
      : Math.min(maxScale, scale);
  const snap = (value, range) =>
    Math.max(range.min, Math.min(range.max, Math.round(value / range.step) * range.step));
  return { width: snap(width * scale, w), height: snap(height * scale, h) };
}

const orientations = {
  landscape: "landscape",
  wide: "landscape",
  horizontal: "landscape",
  portrait: "portrait",
  tall: "portrait",
  vertical: "portrait",
  square: "square",
};
/**
 * The width and height for an aspect ("landscape", "portrait", "square" or a ratio such as 16:9):
 * the profile's own preset for the aspect, which the run's resolution then scales. Without an
 * aspect, take the same configured canvas as the composer.
 */
export function profileAspectSize(profile, { aspect } = {}) {
  if (!aspect) return profileImageSize(profile);
  const defaults = profile.defaults || {};
  const presets = (profile.aspectPresets || []).filter((item) => item.w > 0 && item.h > 0);
  let width = Number(defaults.width) || 1024;
  let height = Number(defaults.height) || width;
  const key = String(aspect).trim().toLowerCase().slice(0, 20);
  const named = presets.find((item) => item.label.toLowerCase() === key);
  if (named) return { width: named.w, height: named.h };
  const orientation = orientations[key];
  const ratio = /^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/.exec(key);
  if (!orientation && !(ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0))
    throw new Error(
      `Choose aspect from ${[...presets.map((item) => item.label), "landscape", "portrait", "square"].join(", ")}.`,
    );
  const shape = (w, h) => (w > h ? "landscape" : w < h ? "portrait" : "square");
  const wanted = orientation ? null : Number(ratio[1]) / Number(ratio[2]);
  // The profile's own preset when one fits, in its own order; otherwise the ratio at its default pixel count.
  const preset = orientation
    ? presets.find((item) => shape(item.w, item.h) === orientation)
    : presets.find((item) => Math.abs(Math.log(item.w / item.h) - Math.log(wanted)) < 0.02);
  if (preset) ({ w: width, h: height } = preset);
  else {
    const [rw, rh] = orientation
      ? { landscape: [16, 9], portrait: [9, 16], square: [1, 1] }[orientation]
      : [wanted, 1];
    const fitted = referenceImageSize(profile, { width: rw * 1000, height: rh * 1000 });
    if (fitted) ({ width, height } = fitted);
  }
  return { width, height };
}
