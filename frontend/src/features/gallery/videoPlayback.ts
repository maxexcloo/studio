/** Pause hidden videos and release the player when its surface closes. */
export function videoLifecycle(media: HTMLVideoElement) {
  const pause = () => {
    if (document.hidden) media.pause();
  };
  document.addEventListener("visibilitychange", pause);
  return () => {
    document.removeEventListener("visibilitychange", pause);
    media.pause();
    media.removeAttribute("src");
    media.load();
  };
}

/** Try the chosen sound first, then play silently if the browser needs a gesture for audio. */
export function playVideo(
  media: HTMLVideoElement,
  refused: () => void,
  silent: (value: boolean) => void,
) {
  let closed = false;
  void media.play().catch(async (error: unknown) => {
    if (closed) return;
    if (media.muted || (error as { name?: string })?.name !== "NotAllowedError") {
      refused();
      return;
    }
    if (document.hidden) return;
    silent(true);
    media.muted = true;
    try {
      await media.play();
    } catch {
      if (closed) return;
      silent(false);
      media.muted = false;
      refused();
    }
  });
  return () => {
    closed = true;
  };
}
