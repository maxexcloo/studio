import { ActionIcon, Button, Tooltip } from "@mantine/core";
import type { ComponentProps } from "react";

import { icons } from "../../ui/icons";

export function VideoPlayButton({
  play,
  ...swipe
}: {
  play: () => void;
} & Pick<
  ComponentProps<"button">,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>) {
  return (
    <Button
      variant="default"
      radius="xl"
      pos="absolute"
      top="50%"
      left="50%"
      style={{ translate: "-50% -50%", touchAction: "none", zIndex: 1 }}
      leftSection={<icons.resume size={18} />}
      onClick={(event) => {
        event.stopPropagation();
        play();
      }}
      {...swipe}
    >
      Play
    </Button>
  );
}

export function VideoSoundButton({ muted, toggle }: { muted: boolean; toggle: () => void }) {
  const label = muted ? "Unmute" : "Mute";
  const Sound = muted ? icons.mute : icons.sound;
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="default"
        radius="xl"
        size="lg"
        pos="absolute"
        bottom="sm"
        left="calc(var(--mantine-spacing-sm) + env(safe-area-inset-left))"
        style={{ zIndex: 1 }}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <Sound size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
