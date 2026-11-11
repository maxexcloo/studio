import { useRef, useState, type ReactNode } from "react";
import {
  Button,
  FileButton,
  FocusTrap,
  getDefaultZIndex,
  Modal,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import type { ReferenceAsset } from "../../types";
import { icons } from "../../ui/icons";
import { usePhone } from "../../ui/usePhone";
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
 * A card's editor: a dialog, full screen on phones, whose form fills it so its images' choices
 * scroll within their own room and the form itself stays put. Above the desktop References
 * popover; phones stack sheets in order, under the text editor.
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
  return (
    <Modal
      opened={opened}
      onClose={onClose}
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

/** A card form: a column filling its `CardDialog`, the last field (`CardImages`) taking the rest. */
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
 * A card's images as numbered slots, reordered by drag or each slot's menu, over the References
 * sheet's gallery choices: its tabs, search, Filter ▾, Upload and tiles, scrolling in their own
 * room. A tap fills the chosen slot, else the next empty one; a chosen image's tile removes it.
 * `children`, such as Generate References, sit between the slots and the choices.
 */
export function CardImages({
  max,
  note,
  value,
  onChange,
  children,
}: {
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
  const target = nextReferenceTarget(images, layout, chosen);
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
  return (
    <Stack
      component="section"
      aria-label="Images"
      gap="xs"
      // Phones give the choices the rest of the screen; desktop a set room.
      flex={phone ? "1 1 0" : undefined}
      mih={phone ? "20rem" : undefined}
      h={phone ? undefined : "min(60dvh, 560px)"}
    >
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
        onChoose={setChosen}
        onChange={(next) => {
          set(next);
          setChosen(null);
        }}
        onDrop={drop}
      />
      {children}
      <GalleryChoices
        label="Images"
        browser={browser}
        enabled
        actions={upload}
        tile={(item, name) => {
          const selected = images.some((asset) => asset.galleryItemId === item.id);
          const removes = selected && !chosen?.replace;
          return {
            label: `${removes ? "Remove" : "Add"} image: ${name}`,
            selected,
            disabled: !target || placement.adding,
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
  );
}
