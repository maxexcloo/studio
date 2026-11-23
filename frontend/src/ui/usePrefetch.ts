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

/** Loads only the metadata of videos about to play; one that drops out stops loading. */
export function usePrefetchVideoMetadata(urls: string[]) {
  const held = useRef(new Map<string, HTMLVideoElement>());
  const key = urls.join("\n");
  useEffect(() => {
    const keep = new Map<string, HTMLVideoElement>();
    for (const url of urls) {
      let video = held.current.get(url);
      if (!video) {
        video = document.createElement("video");
        video.muted = true;
        video.preload = "metadata";
        video.src = url;
      }
      keep.set(url, video);
    }
    for (const [url, video] of held.current)
      if (!keep.has(url)) {
        video.removeAttribute("src");
        video.load();
      }
    held.current = keep;
  }, [key]);
  useEffect(
    () => () => {
      for (const video of held.current.values()) {
        video.removeAttribute("src");
        video.load();
      }
    },
    [],
  );
}
