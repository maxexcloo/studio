import { ActionIcon, Button, Group, Tooltip } from "@mantine/core";
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

/**
 * A video's play/pause and sound buttons, always as one pair: in the bottom corner over the media,
 * or `inline` where a bar or the card's text already holds controls.
 */
export function VideoControls({
  paused,
  onPlayPause,
  muted,
  onSound,
  inline = false,
}: {
  paused: boolean;
  onPlayPause: () => void;
  muted: boolean;
  onSound: () => void;
  inline?: boolean;
}) {
  const playLabel = paused ? "Play" : "Pause";
  const soundLabel = muted ? "Unmute" : "Mute";
  const Play = paused ? icons.resume : icons.pause;
  const Sound = muted ? icons.mute : icons.sound;
  const button = { variant: "default", radius: "xl", size: "lg" } as const;
  return (
    <Group
      gap="xs"
      wrap="nowrap"
      role="group"
      aria-label="Video Controls"
      {...(!inline && {
        pos: "absolute" as const,
        bottom: "var(--mantine-spacing-sm)",
        right: "calc(var(--mantine-spacing-sm) + env(safe-area-inset-right))",
        style: { zIndex: 1 },
      })}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Tooltip label={playLabel}>
        <ActionIcon
          {...button}
          aria-label={playLabel}
          onClick={(event) => {
            event.stopPropagation();
            onPlayPause();
          }}
        >
          <Play size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={soundLabel}>
        <ActionIcon
          {...button}
          aria-label={soundLabel}
          onClick={(event) => {
            event.stopPropagation();
            onSound();
          }}
        >
          <Sound size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
