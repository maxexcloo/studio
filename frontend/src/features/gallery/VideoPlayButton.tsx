import { Button } from "@mantine/core";
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
