import { type RefObject, useEffect, useState } from "react";

import type { MediaItem } from "../../types";
import { mediaSource, playbackUrl } from "../gallery/mediaSource";

/** A card's picture, or while `playing` its video, muted; `useInSync` plays a card's videos. */
export function DeckMedia({ item, playing = false }: { item: MediaItem; playing?: boolean }) {
  const source = mediaSource(item);
  const [failedVideo, setFailedVideo] = useState<string>();
  const [failedImage, setFailedImage] = useState<string>();
  const video = item.type === "video" ? playbackUrl(source.url) : undefined;
  if (video && playing && failedVideo !== video)
    return (
      <video
        src={video}
        poster={source.thumbnailUrl}
        aria-label={item.prompt || "Dream video"}
        muted
        playsInline
        preload="auto"
        onError={() => setFailedVideo(video)}
      />
    );
  const image = video ? source.thumbnailUrl : source.displayUrl;
  if (!image || failedImage === image) return null;
  return (
    <img
      src={image}
      alt={item.prompt || (item.type === "video" ? "Dream video" : "Dream image")}
      draggable={false}
      decoding="async"
      onError={() => setFailedImage(image)}
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
    const failed = new Set<HTMLVideoElement>();
    const playable = () =>
      videos.filter((video) => video.isConnected && !video.error && !failed.has(video));
    let started = false;
    const start = (active: HTMLVideoElement[]) => {
      started = true;
      for (const video of active) {
        video.currentTime = 0;
        video.play().catch(() => undefined);
      }
    };
    const advance = () => {
      if (document.hidden) return;
      const active = playable();
      if (
        active.length &&
        (started
          ? active.every((video) => video.ended)
          : active.every((video) => video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA))
      )
        start(active);
    };
    const error = (event: Event) => {
      failed.add(event.currentTarget as HTMLVideoElement);
      advance();
    };
    const visibility = () => {
      if (document.hidden) {
        videos.forEach((video) => video.pause());
        return;
      }
      if (started)
        for (const video of playable()) if (!video.ended) video.play().catch(() => undefined);
      advance();
    };
    for (const video of videos) {
      video.addEventListener("canplay", advance);
      video.addEventListener("ended", advance);
      video.addEventListener("error", error);
    }
    document.addEventListener("visibilitychange", visibility);
    advance();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      for (const video of videos) {
        video.removeEventListener("canplay", advance);
        video.removeEventListener("ended", advance);
        video.removeEventListener("error", error);
        video.pause();
      }
    };
  }, [root, playing]);
}
