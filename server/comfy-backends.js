import { AsyncLocalStorage } from "node:async_hooks";
import { families } from "./family-catalog.js";

// Per-operation context, never a mutable global URL: image and video jobs overlap.
const backendScope = new AsyncLocalStorage();
export const currentComfyBackend = () => backendScope.getStore() || "primary";
export const withComfyBackend = (backend, operation) => backendScope.run(backend === "video" ? "video" : "primary", operation);
export const configuredBackends = () => process.env.COMFY_VIDEO_URL ? ["primary", "video"] : ["primary"];

export function backendUrl(primaryUrl) {
  if (currentComfyBackend() !== "video") return primaryUrl;
  const value = process.env.COMFY_VIDEO_URL;
  if (!value) throw new Error("The video's ComfyUI backend is no longer configured.");
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("COMFY_VIDEO_URL must be a plain HTTP(S) backend address.");
  }
  return value.replace(/\/+$/, "");
}

export const isLocalVideoProfile = (profile) => profile?.kind === "video" && profile.family !== "grok";

export function mergeBackendModels(primary, video) {
  const profiles = [
    ...(primary.profiles || []).filter((profile) => !isLocalVideoProfile(profile)),
    ...(video.profiles || []).filter(isLocalVideoProfile)
  ];
  const images = profiles.filter((profile) => profile.kind === "image");
  const videos = profiles.filter((profile) => profile.kind === "video");
  const videoFile = (file) => families[file.family]?.kind === "video";
  const modelFiles = [
    ...(primary.modelFiles || []).filter((file) => !videoFile(file)),
    ...(video.modelFiles || []).filter(videoFile)
  ];
  const selected = (profiles, preferred) => profiles.find((profile) => profile.id === preferred && profile.ready !== false)?.id || profiles.find((profile) => profile.ready !== false)?.id || profiles[0]?.id || "";
  const result = {
    ...(primary.profiles?.length ? primary : video), modelFiles, profiles,
    unsupportedModels: modelFiles.filter((file) => !file.supported).map((file) => file.name),
    imageModels: images.map((profile) => ({ label: profile.label, value: profile.id })),
    videoModels: videos.map((profile) => ({ label: profile.label, value: profile.id })),
    defaults: { imageModel: selected(images, primary.defaults?.imageModel), videoModel: selected(videos, primary.defaults?.videoModel || video.defaults?.videoModel) },
    capabilities: { image: images.length > 0, video: videos.length > 0, startImage: profiles.some((profile) => profile.capabilities?.startImage) }
  };
  for (const key of ["clipTypes", "loras", "samplers", "schedulers", "textEncoders", "vaes", "weightDtypes"]) {
    result[key] = [...new Set([...(primary[key] || []), ...(video[key] || [])])];
  }
  return result;
}
