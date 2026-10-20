import { suspendVideoPreviews } from './videoPreviewScheduler';

/*
 * Media pauses when it's covered or closed (docs/guides/UI-PATTERNS.md). While
 * anything covers it (a phone sheet or picker, the phone's Details), the
 * viewer's video pauses and grid previews stop; when the last cover goes, the
 * viewer resumes only if it was playing, and the previews resume as usual.
 */

let covers = 0;
let resumeViewer: HTMLVideoElement[] = [];
let releasePreviews: (() => void) | null = null;

/** Whether something covers the media now: autoplay waits until it doesn't. */
export const mediaCovered = () => covers > 0;

export function coverMedia() {
  covers += 1;
  if (covers === 1) {
    resumeViewer = [...document.querySelectorAll<HTMLVideoElement>('[data-video-viewer] video')].filter((video) => !video.paused);
    resumeViewer.forEach((video) => video.pause());
    releasePreviews = suspendVideoPreviews();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    covers = Math.max(0, covers - 1);
    if (covers) return;
    releasePreviews?.();
    releasePreviews = null;
    for (const video of resumeViewer) if (video.isConnected && !document.hidden) void video.play().catch(() => { /* The play button is there. */ });
    resumeViewer = [];
  };
}

/** Stops a closing video for good: no background playback or ghost audio. */
export function stopVideo(video: HTMLVideoElement | null | undefined) {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.querySelectorAll('source').forEach((source) => source.remove());
  try { video.load(); } catch { /* Already gone. */ }
}
