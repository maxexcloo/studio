import type { SyntheticEvent } from "react";

import { useRemembered } from "../auth/useRemembered";

/** User-opened players share the account's explicit mute choice, with sound on by default. */
export function useVideoSound() {
  const [muted, setMuted] = useRemembered("video-muted", false);
  return {
    muted,
    onVolumeChange: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (event.currentTarget.muted !== muted) setMuted(event.currentTarget.muted);
    },
  };
}
