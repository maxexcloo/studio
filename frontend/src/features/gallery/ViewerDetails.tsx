import { Drawer, FocusTrap, ScrollArea, Stack, Text } from "@mantine/core";
import { type ReactNode, type RefObject, useId, useLayoutEffect, useState } from "react";

import type { MediaItem } from "../../types";
import { closeWhenTop } from "../../ui/popupClicks";
import { MediaDetails, MediaDetailsMetadata } from "./MediaDetails";
import { mediaTitle } from "./mediaLabels";

import classes from "./MediaViewer.module.css";

export function ViewerDetails({
  item,
  title = mediaTitle(item),
  related,
  follow,
  opened,
  phone,
  close,
  bottomBar,
  children,
}: {
  item: MediaItem;
  title?: string;
  related?: MediaItem[];
  follow?: (item: MediaItem) => void;
  opened: boolean;
  phone: boolean;
  close: () => void;
  bottomBar?: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}) {
  const id = useId();
  const [barOffset, setBarOffset] = useState(0);
  useLayoutEffect(() => {
    const bar = bottomBar?.current;
    if (!phone || !opened || !bar) return;
    const measure = () =>
      setBarOffset(Math.max(0, window.innerHeight - bar.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [bottomBar, phone, opened]);
  const details = (
    <>
      {children}
      <MediaDetails item={item} related={related} open={follow} />
    </>
  );
  if (phone)
    return (
      <Drawer
        id={id}
        opened={opened}
        onClose={closeWhenTop(id, close)}
        position="bottom"
        size="80%"
        radius="lg"
        title={title}
        closeButtonProps={{ "aria-label": "Close Details" }}
        styles={{
          header: { position: "static", paddingBottom: 0 },
          inner: { bottom: barOffset },
          overlay: { bottom: barOffset },
        }}
      >
        <FocusTrap.InitialFocus />
        <Stack gap="lg" pb="max(var(--mantine-spacing-md), env(safe-area-inset-bottom))">
          <MediaDetailsMetadata item={item} />
          {details}
        </Stack>
      </Drawer>
    );
  return (
    <div className={classes.asideTrack} data-open={opened || undefined}>
      <aside
        className={classes.aside}
        data-chrome
        aria-label="Generation Details"
        onClick={(event) => event.stopPropagation()}
      >
        <ScrollArea h="100%" type="hover" offsetScrollbars>
          <Stack gap="lg" p="md" pt="lg">
            <Stack gap={2} miw={0}>
              <Text fw={600} lineClamp={2}>
                {title}
              </Text>
              <MediaDetailsMetadata item={item} />
            </Stack>
            {details}
          </Stack>
        </ScrollArea>
      </aside>
    </div>
  );
}
