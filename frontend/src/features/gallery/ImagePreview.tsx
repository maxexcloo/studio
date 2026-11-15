import {
  ActionIcon,
  Group,
  Modal,
  ScrollArea,
  Text,
  Tooltip,
  UnstyledButton,
  getDefaultZIndex,
} from "@mantine/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Suspense, lazy, useEffect, useId, useState } from "react";

import { promptWords } from "../../../../shared/titles";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";

const ZoomImage = lazy(() =>
  import("./ZoomImage").then((module) => ({ default: module.ZoomImage })),
);

export interface PreviewImage {
  src: string;
  thumbnailUrl?: string;
  alt: string;
  title?: string;
}

/**
 * Images full screen, zoomable as in the viewer, for those with no gallery item to open there (a
 * card's uploads): `open(images, index)` shows them over any dialog, `opened` says while it shows
 * and `element` renders it.
 */
export function useImagePreview() {
  // The last images stay while the preview fades out.
  const [shown, setShown] = useState<{ images: PreviewImage[]; index: number; opened: boolean }>({
    images: [],
    index: 0,
    opened: false,
  });
  return {
    open: (images: PreviewImage[], index = 0) => setShown({ images, index, opened: true }),
    opened: shown.opened,
    element: (
      <ImagePreview
        images={shown.images}
        index={shown.index}
        opened={shown.opened}
        onIndex={(index) => setShown((current) => ({ ...current, index }))}
        onClose={() => setShown((current) => ({ ...current, opened: false }))}
      />
    ),
  };
}

/** Arrows, ← and → or a swipe move between the images; Escape, Close or a swipe down closes. */
function ImagePreview({
  images,
  index,
  opened,
  onIndex,
  onClose,
}: {
  images: PreviewImage[];
  index: number;
  opened: boolean;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const id = useId();
  const image = images[index];
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [image?.src, opened]);
  const title = image && (image.title || promptWords(image.alt) || "Image");
  const Chevron = expanded ? ChevronUp : ChevronDown;
  const step = (by: number) => {
    const next = index + by;
    if (next >= 0 && next < images.length) onIndex(next);
  };
  return (
    <Modal
      id={id}
      opened={opened && Boolean(image)}
      onClose={closeWhenTop(id, onClose)}
      fullScreen
      title={
        image && (
          <Tooltip label={expanded ? "Hide Description" : "Show Description"}>
            <UnstyledButton
              w="100%"
              aria-expanded={expanded}
              aria-controls={`${id}-description`}
              onClick={() => setExpanded((value) => !value)}
              style={{ display: "flex", alignItems: "center", gap: "var(--mantine-spacing-xs)" }}
            >
              <Text component="span" size="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
                {title}
                {images.length > 1 && ` · ${index + 1} of ${images.length}`}
              </Text>
              <Chevron size={16} aria-hidden style={{ flexShrink: 0 }} />
            </UnstyledButton>
          </Tooltip>
        )
      }
      // Over the card dialog it opens from.
      zIndex={getDefaultZIndex("max")}
      styles={{
        content: { display: "flex", flexDirection: "column" },
        header: { flexShrink: 0 },
        title: { flex: 1, minWidth: 0 },
        close: { flexShrink: 0 },
        body: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: 0 },
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") step(-1);
        if (event.key === "ArrowRight") step(1);
      }}
    >
      {expanded && (
        <ScrollArea.Autosize
          id={`${id}-description`}
          mah="25vh"
          px="md"
          pb="sm"
          style={{ flexShrink: 0 }}
        >
          <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {image?.alt}
          </Text>
        </ScrollArea.Autosize>
      )}
      {image && (
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <Suspense fallback={<LoadingState label="Loading Image" fill />}>
            <ZoomImage
              key={image.src}
              src={image.src}
              alt={image.alt}
              placeholder={image.thumbnailUrl}
              swipe={(direction) => {
                if (direction === "left") step(1);
                if (direction === "right") step(-1);
                if (direction === "down") onClose();
              }}
            />
          </Suspense>
          {images.length > 1 && (
            <Group
              justify="space-between"
              px="md"
              style={{ position: "absolute", inset: "50% 0 auto", pointerEvents: "none" }}
            >
              {[
                { label: "Previous Image", by: -1, Icon: icons.previous },
                { label: "Next Image", by: 1, Icon: icons.next },
              ].map(({ label, by, Icon }) => (
                <Tooltip key={label} label={label}>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    aria-label={label}
                    disabled={index + by < 0 || index + by >= images.length}
                    style={{ pointerEvents: "auto" }}
                    onClick={() => step(by)}
                  >
                    <Icon size={18} />
                  </ActionIcon>
                </Tooltip>
              ))}
            </Group>
          )}
        </div>
      )}
    </Modal>
  );
}
