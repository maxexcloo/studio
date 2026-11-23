import { ActionIcon, Tooltip } from "@mantine/core";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { mediaSource, playbackUrl } from "../gallery/mediaSource";
import { useVideoSound } from "../gallery/useVideoSound";
import { videoLifecycle } from "../gallery/videoPlayback";
import { covers, useBoxShape } from "./mediaFit";

import zoomClasses from "../gallery/MediaZoom.module.css";
import classes from "./DreamPage.module.css";

const attachVideo = (media: HTMLVideoElement | null) => {
  if (media) return videoLifecycle(media);
};

/** A blurred, dimmed copy of media shown whole, so no flat bars frame it. */
export function MediaBackdrop({ src }: { src?: string }) {
  if (!src) return null;
  return <img className={classes.backdrop} src={src} alt="" aria-hidden draggable={false} />;
}

/**
 * A card's picture, or while `playing` its video. It fills
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
          ref={attachVideo}
          src={video}
          poster={source.thumbnailUrl}
          aria-label={item.prompt || "Dream video"}
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
 * Starts the videos under `root` together once their metadata is ready, without waiting for
 * browsers to preload frames. Each waits for the last to end so they loop together. They pause while the
 * tab is hidden.
 */
export function useDreamPlayback(
  root: RefObject<HTMLElement | null>,
  playing: boolean,
  itemId?: string,
  audioSide?: string,
) {
  const { muted, setMuted } = useVideoSound();
  const audibleVideo = useRef<HTMLVideoElement | undefined>(undefined);
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  const [retry, setRetry] = useState<{ itemId?: string; play: () => void }>();
  useLayoutEffect(() => {
    if (!playing) return;
    const videos = [...(root.current?.querySelectorAll("video") ?? [])];
    const audible =
      audioSide === undefined
        ? videos[0]
        : videos.find(
            (video) => video.closest<HTMLElement>("[data-side]")?.dataset.side === audioSide,
          );
    for (const video of videos) if (video !== audible) video.muted = true;
    audibleVideo.current = audible;
    if (audible) audible.muted = muted || autoplayMuted;
  }, [root, playing, itemId, audioSide, muted, autoplayMuted]);
  useEffect(() => {
    const videos = [...(root.current?.querySelectorAll("video") ?? [])];
    setRetry(undefined);
    if (!playing || !videos.length) return;
    const failed = new Set<HTMLVideoElement>();
    const playable = () =>
      videos.filter((video) => video.isConnected && !video.error && !failed.has(video));
    let started = false;
    let blocked = false;
    let starting = false;
    let attempt = 0;
    function showPlay() {
      blocked = true;
      for (const video of videos) video.pause();
      setRetry({ itemId, play: () => start(playable(), !started) });
    }
    function start(active: HTMLVideoElement[], restart: boolean) {
      if (document.hidden || starting || !active.length) return;
      starting = true;
      const current = ++attempt;
      const starts = active.map((video) => {
        if (restart) video.currentTime = 0;
        return video.play();
      });
      void Promise.all(starts).then(
        () => {
          if (current !== attempt) return;
          starting = false;
          started = true;
          blocked = false;
          setRetry(undefined);
        },
        (error) => {
          if (current !== attempt) return;
          starting = false;
          if (document.hidden) return;
          if (error?.name === "NotAllowedError" && active.some((video) => !video.muted)) {
            for (const video of active) video.muted = true;
            setAutoplayMuted(true);
            start(active, restart);
            return;
          }
          showPlay();
        },
      );
    }
    const advance = () => {
      if (document.hidden || blocked || starting) return;
      const active = playable();
      if (
        active.length &&
        (started
          ? active.every((video) => video.ended)
          : active.every((video) => video.readyState >= HTMLMediaElement.HAVE_METADATA))
      )
        start(active, true);
    };
    const error = (event: Event) => {
      failed.add(event.currentTarget as HTMLVideoElement);
      advance();
    };
    const pause = (event: Event) => {
      const video = event.currentTarget as HTMLVideoElement;
      if (
        started &&
        !blocked &&
        !document.hidden &&
        video.isConnected &&
        !video.ended &&
        !video.error
      ) {
        ++attempt;
        starting = false;
        showPlay();
      }
    };
    const visibility = () => {
      if (document.hidden) {
        ++attempt;
        starting = false;
        videos.forEach((video) => video.pause());
        return;
      }
      if (!blocked && started)
        start(
          playable().filter((video) => !video.ended),
          false,
        );
      advance();
    };
    for (const video of videos) {
      video.addEventListener("loadedmetadata", advance);
      video.addEventListener("ended", advance);
      video.addEventListener("error", error);
      video.addEventListener("pause", pause);
    }
    document.addEventListener("visibilitychange", visibility);
    advance();
    return () => {
      ++attempt;
      document.removeEventListener("visibilitychange", visibility);
      for (const video of videos) {
        video.removeEventListener("loadedmetadata", advance);
        video.removeEventListener("ended", advance);
        video.removeEventListener("error", error);
        video.removeEventListener("pause", pause);
        video.pause();
      }
    };
  }, [root, playing, itemId]);
  const silent = muted || autoplayMuted;
  const label = silent ? "Unmute" : "Mute";
  const toggle = (corner: boolean) => (
    <Tooltip label={label}>
      <ActionIcon
        variant={corner ? "subtle" : "default"}
        color={corner ? "gray" : undefined}
        size={corner ? "sm" : undefined}
        aria-label={label}
        onClick={() => {
          if (autoplayMuted) {
            if (audibleVideo.current) audibleVideo.current.muted = false;
            setAutoplayMuted(false);
          }
          setMuted(!silent);
        }}
      >
        {silent ? <icons.mute size={corner ? 14 : 16} /> : <icons.sound size={corner ? 14 : 16} />}
      </ActionIcon>
    </Tooltip>
  );
  return {
    play: playing && retry?.itemId === itemId ? retry?.play : undefined,
    sound: playing && toggle(false),
    /** The toggle at the media's bottom-right corner, where images keep their zoom. */
    cornerSound: playing && <div className={zoomClasses.controls}>{toggle(true)}</div>,
  };
}
