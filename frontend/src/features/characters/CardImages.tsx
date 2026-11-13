import { useId, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  FileButton,
  FocusTrap,
  getDefaultZIndex,
  Group,
  Image,
  Input,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { post } from "../../api";
import type { ReferenceAsset } from "../../types";
import { icons } from "../../ui/icons";
import type { Action } from "../../ui/ActionBar";
import { TextBox } from "../../ui/TextBox";
import { closeWhenTop } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { maxCardDescription, maxCardName, type CardKind } from "../../../../shared/characters";
import { useImagePreview, type PreviewImage } from "../gallery/ImagePreview";
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

/**
 * Every card's fields, one column sharing its edges: Name, Description (with Describe Image) and
 * Images, so Character, Outfit and Scene stay alike.
 */
export function CardFields({
  kind,
  name,
  onName,
  description,
  onDescription,
  hint,
  placeholder,
  max,
  note,
  images,
  onImages,
}: {
  kind: CardKind;
  name: string;
  onName: (name: string) => void;
  description: string;
  onDescription: (description: string) => void;
  /** What the description should hold, in a line. */
  hint: string;
  placeholder: string;
  max: number;
  /** What the images are for, in a line. */
  note: string;
  images: ReferenceAsset[];
  onImages: (images: ReferenceAsset[]) => void;
}) {
  const describe = useDescribeImage(kind, images[0], onDescription);
  return (
    <>
      <TextInput
        label="Name"
        required
        maxLength={maxCardName}
        data-autofocus
        value={name}
        onChange={(event) => onName(event.currentTarget.value)}
      />
      <TextBox
        label="Description"
        description={hint}
        placeholder={placeholder}
        autosize
        minRows={2}
        maxLength={maxCardDescription}
        value={description}
        onChange={onDescription}
        {...describe}
      />
      <CardImages kind={kind} max={max} note={note} value={images} onChange={onImages} />
    </>
  );
}

/** A card's thumbnails, each opening them all full size from itself. */
export function CardThumbnails({
  label,
  images,
  views = false,
}: {
  /** Names the row, such as Mara's Sheet. */
  label: string;
  images: (PreviewImage & { key: string })[];
  /** A sheet's views, in their own shapes rather than squares. */
  views?: boolean;
}) {
  const preview = useImagePreview();
  return (
    <Group gap={6} role="group" aria-label={label}>
      {images.map((image, index) => (
        <UnstyledButton
          key={image.key}
          aria-label={`Preview ${image.alt}`}
          style={{ flexShrink: 0 }}
          onClick={() => preview.open(images, index)}
        >
          <Image
            src={image.thumbnailUrl || image.src}
            alt={image.alt}
            h={56}
            w={views ? "auto" : 56}
            fit={views ? "contain" : "cover"}
            radius="md"
            fallbackSrc=""
          />
        </UnstyledButton>
      ))}
      {preview.element}
    </Group>
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
function useDescribeImage(
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
 * A card's images as numbered slots, reordered by drag or each slot's menu, whose Preview shows one
 * full size. Add Images, or an empty slot, opens the References sheet's gallery choices in their
 * own popup (tabs, search, Filter ▾, Upload and tiles), so the form stays short; a tap fills the
 * chosen slot, else the next empty one, and a chosen image's tile removes it. Rate Images scores
 * each as the kind's reference.
 */
function CardImages({
  kind,
  max,
  note,
  value,
  onChange,
}: {
  kind: CardKind;
  max: number;
  note: string;
  value: ReferenceAsset[];
  onChange: (images: ReferenceAsset[]) => void;
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
  const pickerId = useId();
  const target = nextReferenceTarget(images, layout, chosen);
  const assistant = useCardAssistant();
  const preview = useImagePreview();
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
  const noun = max > 1 ? "Images" : "Image";
  return (
    <Input.Wrapper
      component="section"
      aria-label={noun}
      label={noun}
      labelElement="div"
      description={max > 1 ? `${images.length} of ${max}. ${note}` : note}
    >
      <Stack gap="xs" mt={6}>
        <ReferenceSlots
          references={images}
          profile={layout}
          // Only a slot chosen to fill or replace stands out; the next empty one is plain.
          target={chosen}
          caption={false}
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
          onView={(asset) =>
            preview.open(
              images.map((each, index) => ({
                src: each.url || each.thumbnailUrl,
                thumbnailUrl: each.thumbnailUrl,
                alt: `${noun} ${index + 1}`,
              })),
              images.indexOf(asset),
            )
          }
        />
        <Group gap="xs">
          <Button
            {...chipProps}
            leftSection={<icons.add size={15} />}
            disabled={!target && !images.length}
            onClick={() => setPicking(true)}
          >
            Add {noun}
          </Button>
          {assistant && images.length > 0 && (
            <Button
              {...chipProps}
              leftSection={<icons.assistant size={15} />}
              loading={rate.isPending}
              onClick={() => rate.mutate(images)}
            >
              Rate {noun}
            </Button>
          )}
        </Group>
        {rate.error && (
          <Text size="xs" c="red">
            {rate.error.message}
          </Text>
        )}
        {rated.length > 0 && (
          <Stack gap={6} aria-label="Image Ratings">
            {rated.map((asset) => {
              const { rating, note: why } = ratings[asset.id];
              return (
                <Group key={asset.id} gap="xs" wrap="nowrap" align="flex-start">
                  <Text size="xs" fw={500} style={{ flexShrink: 0 }}>
                    {`${noun.replace(/s$/, "")} ${images.indexOf(asset) + 1}`}
                  </Text>
                  <Badge
                    variant="light"
                    color={rating >= 4 ? "green" : rating >= 3 ? "yellow" : "red"}
                    style={{ flexShrink: 0 }}
                  >
                    {rating}/5
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {why}
                  </Text>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
      {preview.element}
      <Modal
        id={pickerId}
        opened={picking}
        onClose={closeWhenTop(pickerId, () => {
          setPicking(false);
          setChosen(null);
        })}
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
    </Input.Wrapper>
  );
}
