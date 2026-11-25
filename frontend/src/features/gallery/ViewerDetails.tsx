import { Drawer, FocusTrap, ScrollArea, Stack } from "@mantine/core";
import { type ReactNode, useId } from "react";

import type { MediaItem } from "../../types";
import { closeWhenTop } from "../../ui/popupClicks";
import { useLastWhileClosing } from "../../ui/useLastWhileClosing";
import { useSwipeClose } from "../../ui/useSwipeClose";
import { MediaDetails } from "./MediaDetails";
import { mediaTitle } from "./mediaLabels";
import { ViewerMetadata, ViewerTitle } from "./ViewerChrome";

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
  // The desktop panel stays mounted, so it loads an item's details only while it shows them.
  const shown = useLastWhileClosing(opened ? item : null);
  const details = (of: MediaItem) => (
    <>
      {children}
      <MediaDetails item={of} related={related} open={follow} />
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
        {/* Named by its title alone, not the time beside it. */}
        <Drawer.Content {...swipe} aria-label={title}>
          <FocusTrap.InitialFocus />
          <Drawer.Header>
            <Stack gap={4}>
              <ViewerTitle component="h2" item={item} title={title} />
              <ViewerMetadata item={item} full />
            </Stack>
            <Drawer.CloseButton aria-label="Close Details" />
          </Drawer.Header>
          <Drawer.Body>
            <Stack
              gap="lg"
              pt="md"
              pb="max(var(--mantine-spacing-md), env(safe-area-inset-bottom))"
            >
              {details(item)}
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
        <ScrollArea h="100%" overscrollBehavior="none">
          <Stack gap="lg" p="md" pt="lg">
            <Stack gap={4}>
              <ViewerTitle item={item} title={title} />
              <ViewerMetadata item={item} full />
            </Stack>
            {shown && details(shown)}
          </Stack>
        </ScrollArea>
      </aside>
    </div>
  );
}
