import { lazy, Suspense, useId, useState } from "react";
import { ActionIcon, getDefaultZIndex, Group, Modal, Text, Tooltip } from "@mantine/core";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";

const ZoomImage = lazy(() =>
  import("./ZoomImage").then((module) => ({ default: module.ZoomImage })),
);

export interface PreviewImage {
  src: string;
  thumbnailUrl?: string;
  alt: string;
}

/**
 * Images full screen, zoomable as in the viewer, for those with no gallery item to open there (a
 * card's uploads): `open(images, index)` shows them over any dialog, `opened` says while it shows
 * and `element` renders it.
 */
export function useImagePreview() {
  const [shown, setShown] = useState<{ images: PreviewImage[]; index: number } | null>(null);
  return {
    open: (images: PreviewImage[], index = 0) => setShown({ images, index }),
    opened: Boolean(shown),
    element: (
      <ImagePreview
        images={shown?.images || []}
        index={shown ? shown.index : null}
        onIndex={(index) => setShown((current) => current && { ...current, index })}
        onClose={() => setShown(null)}
      />
    ),
  };
}

/** Arrows, ← and → or a swipe move between the images; Escape, Close or a swipe down closes. */
function ImagePreview({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: PreviewImage[];
  /** The image shown, or null while closed. */
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const id = useId();
  const image = index === null ? undefined : images[index];
  const step = (by: number) => {
    if (index === null) return;
    const next = index + by;
    if (next >= 0 && next < images.length) onIndex(next);
  };
  return (
    <Modal
      id={id}
      opened={Boolean(image)}
      onClose={closeWhenTop(id, onClose)}
      fullScreen
      title={
        image && (
          <Text size="sm" fw={500}>
            {image.alt}
            {images.length > 1 && (
              <Text span c="dimmed" inherit>
                {` · ${index! + 1} of ${images.length}`}
              </Text>
            )}
          </Text>
        )
      }
      // Over the card dialog it opens from.
      zIndex={getDefaultZIndex("max")}
      styles={{
        content: { display: "flex", flexDirection: "column" },
        body: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: 0 },
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") step(-1);
        if (event.key === "ArrowRight") step(1);
      }}
    >
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
                { label: "Previous Image", by: -1, Icon: ArrowLeft },
                { label: "Next Image", by: 1, Icon: ArrowRight },
              ].map(({ label, by, Icon }) => (
                <Tooltip key={label} label={label}>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    radius="xl"
                    aria-label={label}
                    disabled={index! + by < 0 || index! + by >= images.length}
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
