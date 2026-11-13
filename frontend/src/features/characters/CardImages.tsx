import { useId, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  FileButton,
  FocusTrap,
  getDefaultZIndex,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { post } from "../../api";
import type { ReferenceAsset } from "../../types";
import { icons } from "../../ui/icons";
import type { Action } from "../../ui/ActionBar";
import { closeWhenTop } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import type { CardKind } from "../../../../shared/characters";
import { assistantQuery } from "../generation/PromptAssistant";
import { chipProps, iconChipProps } from "../generation/chip";
import { GalleryChoices } from "../generation/GalleryChoices";
import {
  galleryReferenceType,
  nextReferenceTarget,
  referenceKey,
  uploadTypes,
  useReferencePlacement,
  type ReferenceTarget,
} from "../generation/references";
import { ReferenceSlots, referenceCellType } from "../generation/ReferenceSlots";
import { useReferenceBrowser } from "../generation/useReferenceBrowser";

/**
 * A card's editor: a dialog, full screen on phones, whose body scrolls. Above the desktop
 * References popover; phones stack sheets in order, under the text editor.
 */
export function CardDialog({
  opened,
  title,
  onClose,
  children,
}: {
  opened: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const phone = usePhone();
  const id = useId();
  return (
    <Modal
      id={id}
      opened={opened}
      onClose={closeWhenTop(id, onClose)}
      title={title}
      size="lg"
      fullScreen={phone}
      zIndex={phone ? undefined : getDefaultZIndex("overlay")}
      styles={{
        content: { display: "flex", flexDirection: "column" },
        body: {
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        },
      }}
    >
      <FocusTrap.InitialFocus />
      {children}
    </Modal>
  );
}

/** A card form: a column filling its `CardDialog`. */
export function CardForm({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <Stack
      component="form"
      flex={1}
      mih={0}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </Stack>
  );
}

/** Whether the account's text model can read a card's images, for Describe Image and Rate Images. */
function useCardAssistant() {
  const assistant = useQuery(assistantQuery);
  return Boolean(assistant.data?.available && assistant.data.vision);
}

/**
 * Describe Image: writes the card's description from its first image, for any kind of card, as a
 * tool of the Description box (`tools`, with `busy` while it writes).
 */
export function useDescribeImage(
  kind: CardKind,
  image: ReferenceAsset | undefined,
  onDescribed: (description: string) => void,
) {
  const available = useCardAssistant();
  const describe = useMutation({
    mutationFn: (asset: ReferenceAsset) =>
      post<{ description: string }>("/api/assistant/cards/describe", { kind, assetId: asset.id }),
    onSuccess: ({ description }) => onDescribed(description),
  });
  const tool: Action = {
    id: "describe",
    label: "Describe Image",
    icon: icons.assistant,
    disabled: describe.isPending,
    onClick: () => image && describe.mutate(image),
  };
  return {
    tools: available && image ? [tool] : undefined,
    busy: describe.isPending ? "Describing Image…" : undefined,
  };
}

type Rating = { rating: number; note: string };

/**
 * A card's images as numbered slots, reordered by drag or each slot's menu. Add Images opens the
 * References sheet's gallery choices in their own popup (tabs, search, Filter ▾, Upload and
 * tiles), so the form stays short; a tap fills the chosen slot, else the next empty one, and a
 * chosen image's tile removes it. Rate Images scores each as the kind's reference. `children`,
 * such as Generate References, follow the slots.
 */
export function CardImages({
  kind,
  max,
  note,
  value,
  onChange,
  children,
}: {
  kind: CardKind;
  max: number;
  note: string;
  value: ReferenceAsset[];
  onChange: (images: ReferenceAsset[]) => void;
  children?: ReactNode;
}) {
  const phone = usePhone();
  const layout = { mediaInputs: [{ id: "image", label: max > 1 ? "Images" : "Image", max }] };
  const images = value.map((asset) =>
    asset.slot === "image" ? asset : { ...asset, slot: "image" },
  );
  // Uploads and gallery images place once they are saved, into the images as they are by then.
  const latest = useRef(images);
  latest.current = images;
  const set = (next: ReferenceAsset[]) => {
    latest.current = next;
    onChange(next);
  };
  const placement = useReferencePlacement({ profile: layout, get: () => latest.current, set });
  const browser = useReferenceBrowser();
  const [chosen, setChosen] = useState<ReferenceTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const target = nextReferenceTarget(images, layout, chosen);
  const assistant = useCardAssistant();
  // Each image's rating, by its asset id, from the last Rate Images.
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const rate = useMutation({
    mutationFn: (assets: ReferenceAsset[]) =>
      post<{ ratings: Rating[] }>("/api/assistant/cards/rate", {
        kind,
        assetIds: assets.map((asset) => asset.id),
      }),
    onSuccess: ({ ratings: scored }, assets) =>
      setRatings(Object.fromEntries(assets.map((asset, index) => [asset.id, scored[index]]))),
  });
  function drop(data: DataTransfer, into: ReferenceTarget) {
    const cell = data.getData(referenceCellType);
    const gallery = data.getData(galleryReferenceType);
    if (cell && into.replace && cell !== into.replace) {
      // One role, so a slot dropped on another swaps places with it.
      const keys = images.map(referenceKey);
      const [from, to] = [keys.indexOf(cell), keys.indexOf(into.replace)];
      const next = [...images];
      [next[from], next[to]] = [next[to], next[from]];
      set(next);
    } else if (gallery) placement.addGalleryItem(JSON.parse(gallery), into);
    else if (data.files.length) void placement.uploadFiles([...data.files], into);
    setChosen(null);
  }
  const upload = (
    <FileButton
      accept={uploadTypes.join(",")}
      multiple
      onChange={(files) => {
        void placement.uploadFiles(files, chosen);
        setChosen(null);
      }}
    >
      {(props) => (
        <Tooltip label="Upload" disabled={!phone}>
          <Button
            {...props}
            {...(phone ? iconChipProps : chipProps)}
            aria-label="Upload Image"
            loading={placement.uploading}
            disabled={!target}
            leftSection={phone ? undefined : <icons.upload size={15} />}
          >
            {phone ? <icons.upload size={16} /> : "Upload"}
          </Button>
        </Tooltip>
      )}
    </FileButton>
  );
  const rated = images.filter((asset) => ratings[asset.id]);
  return (
    <Stack component="section" aria-label="Images" gap="xs">
      <div>
        <Text size="sm" fw={500}>
          Images
        </Text>
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      </div>
      <ReferenceSlots
        references={images}
        profile={layout}
        target={target}
        onChoose={(next) => {
          setChosen(next);
          // Choosing an empty slot, or one to replace, picks its image.
          if (next) setPicking(true);
        }}
        onChange={(next) => {
          set(next);
          setChosen(null);
        }}
        onDrop={drop}
      />
      <Group gap="xs">
        <Button
          {...chipProps}
          leftSection={<icons.add size={15} />}
          disabled={!target && !images.length}
          onClick={() => setPicking(true)}
        >
          Add Images
        </Button>
        {assistant && images.length > 0 && (
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<icons.assistant size={15} />}
            loading={rate.isPending}
            onClick={() => rate.mutate(images)}
          >
            Rate Images
          </Button>
        )}
      </Group>
      {rate.error && (
        <Text size="xs" c="red">
          {rate.error.message}
        </Text>
      )}
      {rated.length > 0 && (
        <Stack gap={4} aria-label="Image Ratings">
          {rated.map((asset) => {
            const { rating, note: why } = ratings[asset.id];
            return (
              <Group key={asset.id} gap="xs" wrap="nowrap">
                <Badge
                  variant="light"
                  color={rating >= 4 ? "green" : rating >= 3 ? "yellow" : "red"}
                  style={{ flexShrink: 0 }}
                >
                  {images.indexOf(asset) + 1} · {rating}/5
                </Badge>
                <Text size="xs" c="dimmed">
                  {why}
                </Text>
              </Group>
            );
          })}
        </Stack>
      )}
      {children}
      <Modal
        opened={picking}
        onClose={() => {
          setPicking(false);
          setChosen(null);
        }}
        title="Add Images"
        size="xl"
        fullScreen={phone}
        // Over the card's own dialog, which sits above the desktop References popover.
        zIndex={phone ? undefined : getDefaultZIndex("overlay") + 1}
        styles={{
          content: { display: "flex", flexDirection: "column" },
          body: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
        }}
      >
        <Stack gap="xs" flex={1} mih={0} h={phone ? undefined : "min(70dvh, 640px)"}>
          <GalleryChoices
            label="Images"
            browser={browser}
            enabled={picking}
            actions={upload}
            tile={(item, name) => {
              const selected = images.some((asset) => asset.galleryItemId === item.id);
              const removes = selected && !chosen?.replace;
              return {
                label: `${removes ? "Remove" : "Add"} image: ${name}`,
                selected,
                disabled: (!target && !removes) || placement.adding,
                onToggle: () => {
                  if (removes) set(images.filter((asset) => asset.galleryItemId !== item.id));
                  else placement.addGalleryItem(item, chosen);
                  setChosen(null);
                },
              };
            }}
            onDeleted={(id) => set(images.filter((asset) => asset.galleryItemId !== id))}
          />
        </Stack>
        <Group justify="flex-end" pt="sm">
          <Button
            onClick={() => {
              setPicking(false);
              setChosen(null);
            }}
          >
            Done
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
