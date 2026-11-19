import { Button } from "@mantine/core";

import { icons } from "../../ui/icons";

export function VideoPlayButton({ play }: { play: () => void }) {
  return (
    <Button
      variant="default"
      radius="xl"
      pos="absolute"
      top="50%"
      left="50%"
      style={{ translate: "-50% -50%", zIndex: 1 }}
      leftSection={<icons.resume size={18} />}
      onClick={(event) => {
        event.stopPropagation();
        play();
      }}
    >
      Play
    </Button>
  );
}
