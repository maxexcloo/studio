import { useEffect, useRef } from "react";

/**
 * The URLs to keep after `wanted` changes: the wanted ones first, in order, then the most recently
 * wanted of the rest, `cap` in all.
 */
export function retained(held: string[], wanted: string[], cap: number) {
  const keep = [...new Set(wanted)].slice(0, cap);
  for (const url of held) {
    if (keep.length >= cap) break;
    if (!keep.includes(url)) keep.push(url);
  }
  return keep;
}

/**
 * Downloads and decodes images before they show, in order, keeping up to `cap` of them decoded.
 * One that drops out stops loading.
 */
export function usePrefetchImages(urls: string[], cap: number) {
  const held = useRef(new Map<string, HTMLImageElement>());
  const key = urls.join("\n");
  useEffect(() => {
    const keep = new Map<string, HTMLImageElement>();
    for (const url of retained([...held.current.keys()], urls, cap)) {
      let image = held.current.get(url);
      if (!image) {
        image = new window.Image();
        image.decoding = "async";
        image.fetchPriority = "low";
        image.src = url;
        void image.decode().catch(() => {});
      }
      keep.set(url, image);
    }
    for (const [url, image] of held.current) if (!keep.has(url)) image.src = "";
    held.current = keep;
  }, [key, cap]);
}

type Connection = { effectiveType?: string; saveData?: boolean };

/** Whether the connection asks to save data or is too slow to download videos ahead. */
export function savingData(connection?: Connection) {
  return !!connection?.saveData || /2g/.test(connection?.effectiveType || "");
}

const release = (video: HTMLVideoElement) => {
  video.removeAttribute("src");
  video.load();
};

/**
 * Downloads videos before they show so they start at once, in order, holding up to `cap` of them;
 * one that drops out stops loading. Skipped when the connection is saving data or slow.
 */
export function usePrefetchVideos(urls: string[], cap: number) {
  const held = useRef(new Map<string, HTMLVideoElement>());
  const key = urls.join("\n");
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const keep = new Map<string, HTMLVideoElement>();
    for (const url of savingData(connection) ? [] : retained([...held.current.keys()], urls, cap)) {
      let video = held.current.get(url);
      if (!video) {
        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = url;
      }
      keep.set(url, video);
    }
    for (const [url, video] of held.current) if (!keep.has(url)) release(video);
    held.current = keep;
  }, [key, cap]);
  useEffect(() => () => held.current.forEach(release), []);
}
