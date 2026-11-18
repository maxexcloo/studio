import { type RefObject, useEffect, useState } from "react";

import type { MediaItem } from "../../types";
import { mediaSource, playbackUrl } from "../gallery/mediaSource";
import { covers, useBoxShape } from "./mediaFit";

import classes from "./DreamPage.module.css";

/** A blurred, dimmed copy of media shown whole, so no flat bars frame it. */
export function MediaBackdrop({ src }: { src?: string }) {
  if (!src) return null;
  return <img className={classes.backdrop} src={src} alt="" aria-hidden draggable={false} />;
}

/**
 * A card's picture, or while `playing` its video, muted; `useInSync` plays a card's videos. It fills
 * its box where little is cropped (`covers`), and otherwise shows whole over its `MediaBackdrop`;
 * the choice follows the recorded size alone, so it holds while the media loads.
 */
export function DeckMedia({ item, playing = false }: { item: MediaItem; playing?: boolean }) {
  const source = mediaSource(item);
  const { ref, box } = useBoxShape<HTMLDivElement>();
  const [failedVideo, setFailedVideo] = useState<string>();
  const [failedImage, setFailedImage] = useState<string>();
  const cover = !!source.width && !!source.height && covers(source.width / source.height, box);
  const video = item.type === "video" ? playbackUrl(source.url) : undefined;
  const image = video ? source.thumbnailUrl : source.displayUrl;
  const still = image && failedImage !== image ? image : undefined;
  return (
    <div ref={ref} className={classes.fit} data-cover={cover || undefined}>
      {!cover && <MediaBackdrop src={still} />}
      {video && playing && failedVideo !== video ? (
        <video
          src={video}
          poster={source.thumbnailUrl}
          aria-label={item.prompt || "Dream video"}
          muted
          playsInline
          preload="auto"
          onError={() => setFailedVideo(video)}
        />
      ) : (
        still && (
          <img
            src={still}
            alt={item.prompt || (item.type === "video" ? "Dream video" : "Dream image")}
            draggable={false}
            decoding="async"
            onError={() => setFailedImage(still)}
          />
        )
      )}
    </div>
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
