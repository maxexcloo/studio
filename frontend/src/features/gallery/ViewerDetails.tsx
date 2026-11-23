import { Drawer, FocusTrap, ScrollArea, Stack, Text } from "@mantine/core";
import { type ReactNode, useId } from "react";

import type { MediaItem } from "../../types";
import { closeWhenTop } from "../../ui/popupClicks";
import { useSwipeClose } from "../../ui/useSwipeClose";
import { MediaDetails } from "./MediaDetails";
import { mediaTitle } from "./mediaLabels";
import { ViewerMetadata } from "./ViewerChrome";

import classes from "./MediaViewer.module.css";

export function ViewerDetails({
  item,
  title = mediaTitle(item),
  related,
  follow,
  opened,
  hidden,
  phone,
  close,
  zIndex,
  children,
}: {
  item: MediaItem;
  title?: string;
  related?: MediaItem[];
  follow?: (item: MediaItem) => void;
  opened: boolean;
  hidden?: boolean;
  phone: boolean;
  close: () => void;
  zIndex?: number;
  children?: ReactNode;
}) {
  const id = useId();
  const closeSheet = closeWhenTop(id, close);
  const swipe = useSwipeClose("down", closeSheet);
  const details = (
    <>
      {children}
      <MediaDetails item={item} related={related} open={follow} />
    </>
  );
  if (phone)
    return (
      <Drawer.Root
        id={id}
        opened={opened}
        onClose={closeSheet}
        position="bottom"
        zIndex={zIndex}
        size="80%"
        radius="lg"
        styles={{
          inner: { overflow: "clip" },
          overlay: { pointerEvents: opened ? undefined : "none" },
          content: {
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            pointerEvents: opened ? undefined : "none",
          },
          header: { position: "static", alignItems: "flex-start", touchAction: "none" },
          body: { overflowY: "auto", overscrollBehavior: "none" },
        }}
      >
        <Drawer.Overlay />
        <Drawer.Content {...swipe}>
          <FocusTrap.InitialFocus />
          <Drawer.Header>
            <Stack gap={2} miw={0}>
              <Drawer.Title>
                <Text span fw={600} lh={1.2} lineClamp={2}>
                  {title}
                </Text>
              </Drawer.Title>
              <ViewerMetadata item={item} />
            </Stack>
            <Drawer.CloseButton aria-label="Close Details" />
          </Drawer.Header>
          <Drawer.Body>
            <Stack gap="lg" pb="max(var(--mantine-spacing-md), env(safe-area-inset-bottom))">
              {details}
            </Stack>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    );
  return (
    <div
      className={classes.asideTrack}
      data-open={(opened && !hidden) || undefined}
      inert={hidden}
      style={hidden ? { visibility: "hidden" } : undefined}
    >
      <aside
        className={classes.aside}
        data-chrome
        aria-label="Generation Details"
        onClick={(event) => event.stopPropagation()}
      >
        <ScrollArea h="100%" type="hover" offsetScrollbars overscrollBehavior="none">
          <Stack gap="lg" p="md" pt="lg">
            <Stack gap={2} miw={0}>
              <Text fw={600} lineClamp={2} lh={1.2}>
                {title}
              </Text>
              <ViewerMetadata item={item} />
            </Stack>
            {opened && details}
          </Stack>
        </ScrollArea>
      </aside>
    </div>
  );
}
