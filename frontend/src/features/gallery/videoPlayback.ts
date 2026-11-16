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

/** Keep sound as chosen; refused autoplay leaves the native Play control available. */
export function playVideo(media: HTMLVideoElement, refused: () => void) {
  const release = videoLifecycle(media);
  let closed = false;
  media.play().catch(() => {
    if (!closed) refused();
  });
  return () => {
    closed = true;
    release();
  };
}
