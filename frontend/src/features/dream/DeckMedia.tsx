import { type RefObject, useEffect, useState } from "react";

import type { MediaItem } from "../../types";
import { mediaSource, playbackUrl } from "../gallery/mediaSource";

/** A card's picture, or while `playing` its video, muted; `useInSync` plays a card's videos. */
export function DeckMedia({ item, playing = false }: { item: MediaItem; playing?: boolean }) {
  const source = mediaSource(item);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  if (item.type === "video" && playing)
    return (
      <video
        src={playbackUrl(source.url)}
        poster={source.thumbnailUrl}
        aria-label={item.prompt || "Dream video"}
        muted
        playsInline
        preload="auto"
        onError={() => setFailed(true)}
      />
    );
  return (
    <img
      src={item.type === "video" ? source.thumbnailUrl || source.url : source.displayUrl}
      alt={item.prompt || (item.type === "video" ? "Dream video" : "Dream image")}
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Plays the videos under `root` together while `playing`: they start once all can play, and each
 * waits at its end until the last ends, so they loop from the start in step. They pause while the
 * tab is hidden.
 */
export function useInSync(root: RefObject<HTMLElement | null>, playing: boolean) {
  useEffect(() => {
    const videos = [...(root.current?.querySelectorAll("video") ?? [])];
    if (!playing || !videos.length) return;
    let started = false;
    const start = () => {
      started = true;
      for (const video of videos) {
        video.currentTime = 0;
        video.play().catch(() => undefined);
      }
    };
    const ready = () => {
      if (
        !started &&
        videos.every((video) => video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)
      )
        start();
    };
    const ended = () => {
      if (videos.every((video) => video.ended)) start();
    };
    const visibility = () => {
      for (const video of videos)
        if (document.hidden) video.pause();
        else if (started && !video.ended) video.play().catch(() => undefined);
    };
    for (const video of videos) {
      video.addEventListener("canplay", ready);
      video.addEventListener("ended", ended);
    }
    document.addEventListener("visibilitychange", visibility);
    ready();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      for (const video of videos) {
        video.removeEventListener("canplay", ready);
        video.removeEventListener("ended", ended);
        video.pause();
      }
    };
  }, [root, playing]);
}
