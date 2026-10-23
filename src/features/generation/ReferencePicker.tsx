import { useMotionDuration } from "../../ui/Appearance";
import { useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Drawer,
  FileButton,
  Group,
  Image,
  Pill,
  Popover,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { ImagePlus, ArrowLeft, Upload } from "lucide-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { MediaItem, ReferenceAsset, Profile, GenerationInput } from "../../types";
import { OrderedItems } from "../../ui/OrderedItems";
import { LoadingState } from "../../ui/LoadingState";
import { EmptyState } from "../../ui/EmptyState";
import {
  GalleryFilterToolbar,
  emptyGalleryFilters,
  appendGalleryFilters,
  type GalleryFilterValues,
} from "../gallery/GalleryFilters";
import { addReference, referenceDetails, referencePatch } from "./payload";
import { useGeneration } from "./GenerationProvider";
import { useGalleryReference } from "./references";
import { useReferenceUpload } from "./useReferenceUpload";

export function ReferencePicker({
  compact = false,
  value,
  onChange,
  profile: selectedProfile,
  input: selectedInput,
  inline = false,
  opened: controlled,
  onOpenedChange,
}: {
  compact?: boolean;
  value?: ReferenceAsset[];
  onChange?: (references: ReferenceAsset[]) => void;
  profile?: Profile;
  input?: GenerationInput;
  inline?: boolean;
  opened?: boolean;
  onOpenedChange?: (opened: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const opened = controlled ?? localOpen;
  const setOpened = (opened: boolean) => {
    setLocalOpen(opened);
    onOpenedChange?.(opened);
  };
  const close = () => setOpened(false);
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  const motionDuration = useMotionDuration();
  const context = useGeneration(),
    { draft, setDraft } = context;
  const profile = selectedProfile || context.profile;
  const references = referenceDetails(
    value || draft.references,
    selectedInput || draft.input,
    profile,
  );
  const currentReferences = useRef<ReferenceAsset[]>(references);
  currentReferences.current = references;
  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const slots = profile?.mediaInputs?.length
    ? profile.mediaInputs
    : [{ id: "image", label: "Image", max: 8 }];
  const slot = slots.find((input) => input.id === chosenSlot)?.id || slots[0].id;
  const slotLimit = slots.find((input) => input.id === slot)?.max || 1;
  const slotFull =
    slotLimit > 1 && references.filter((asset) => asset.slot === slot).length >= slotLimit;
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query, 250);
  const [filters, setFilters] = useState<GalleryFilterValues>(emptyGalleryFilters);
  const [starred, setStarred] = useState(false);
  function setReferences(references: ReferenceAsset[]) {
    currentReferences.current = references;
    if (onChange) onChange(references);
    else
      setDraft((previous) => ({
        ...previous,
        references,
        input: {
          ...previous.input,
          ...referencePatch(previous.input, previous.references, references, profile),
        },
      }));
  }
  const adopt = (asset: ReferenceAsset) =>
    setReferences(addReference(currentReferences.current, asset, profile, slot));
  const select = useGalleryReference(undefined, adopt);
  const { upload, uploading } = useReferenceUpload(adopt);
  async function uploadFiles(files: File[]) {
    const remaining =
      slotLimit === 1
        ? 1
        : Math.max(
            0,
            slotLimit - currentReferences.current.filter((asset) => asset.slot === slot).length,
          );
    for (const file of files.filter((file) => file.type.startsWith("image/")).slice(0, remaining))
      await upload(file);
  }
  const gallery = useInfiniteQuery({
    queryKey: ["reference-gallery", search, filters, starred],
    enabled: opened,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<{ items: MediaItem[]; hasMore: boolean; nextCursor: string }>(
        `/api/gallery?${appendGalleryFilters(new URLSearchParams({ limit: "60", cursor: pageParam, type: "image", q: search, favorites: starred ? "1" : "0" }), filters)}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });
  const content = (
    <Stack
      component="section"
      aria-label="References"
      data-composer-layer
      onPaste={(event) => {
        if (event.clipboardData.files.length) {
          event.preventDefault();
          void uploadFiles([...event.clipboardData.files]);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          void uploadFiles([...event.dataTransfer.files]);
        }
      }}
      gap="sm"
      style={{ minHeight: 0, height: inline ? "100%" : undefined }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<ArrowLeft size={16} />}
          onClick={close}
        >
          Back
        </Button>
        <FileButton
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(files) => void uploadFiles(files)}
        >
          {(props) => (
            <Button
              {...props}
              disabled={slotFull}
              size="compact-sm"
              variant="subtle"
              loading={uploading}
              leftSection={<Upload size={16} />}
            >
              Upload Reference
            </Button>
          )}
        </FileButton>
      </Group>
      {slots.length > 1 && (
        <Select
          comboboxProps={{ withinPortal: false }}
          label="Reference Slot"
          value={slot}
          onChange={setChosenSlot}
          allowDeselect={false}
          data={slots.map((input) => ({
            value: input.id,
            label: `${input.label || input.id}${input.required ? " · Required" : " · Optional"}${input.max ? ` · Up to ${input.max}` : ""}`,
          }))}
        />
      )}
      <Text size="xs" c="dimmed">
        {slots.find((input) => input.id === slot)?.label || slot}:{" "}
        {references.filter((asset) => asset.slot === slot).length}
        {slots.find((input) => input.id === slot)?.max
          ? ` / ${slots.find((input) => input.id === slot)?.max}`
          : ""}
      </Text>
      {!!references.length && (
        <OrderedItems
          kind="references"
          items={references}
          identity={(asset) => `${asset.slot}:${asset.id}`}
          label={(asset) =>
            `${asset.name} (${slots.find((slot) => slot.id === asset.slot)?.label || asset.slot})`
          }
          onChange={setReferences}
        >
          {(asset) => (
            <Group gap="xs" wrap="nowrap">
              <Image
                src={asset.thumbnailUrl || asset.url}
                alt={asset.name}
                h={32}
                w={32}
                radius="sm"
              />
              <Pill
                withRemoveButton
                removeButtonProps={{ "aria-label": `Remove ${asset.name} From ${asset.slot}` }}
                onRemove={() =>
                  setReferences(
                    references.filter(
                      (reference) => reference.id !== asset.id || reference.slot !== asset.slot,
                    ),
                  )
                }
              >
                {asset.name}
                {slots.length > 1
                  ? ` · ${slots.find((slot) => slot.id === asset.slot)?.label || asset.slot}`
                  : ""}
              </Pill>
            </Group>
          )}
        </OrderedItems>
      )}
      <GalleryFilterToolbar
        withinPortal={false}
        query={query}
        onQueryChange={setQuery}
        kind="image"
        value={filters}
        onChange={setFilters}
        starred={starred}
        onStarredChange={setStarred}
      />
      <ScrollArea.Autosize
        mah={inline ? undefined : 400}
        style={{ flex: inline ? 1 : undefined, minHeight: 0 }}
      >
        {gallery.isPending ? (
          <LoadingState label="Loading References" />
        ) : gallery.error ? (
          <Alert color="red">{gallery.error.message}</Alert>
        ) : gallery.data?.pages.some((page) => page.items.length) ? (
          <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
            {gallery.data.pages
              .flatMap((page) => page.items)
              .filter((item) => item.type === "image" && item.status === "done")
              .map((item) => (
                <UnstyledButton
                  key={item.id}
                  aria-label={`Use reference: ${item.prompt || "Result"}`}
                  onClick={() => select.mutate(item)}
                  disabled={select.isPending || slotFull}
                  style={{
                    borderRadius: "var(--mantine-radius-md)",
                    overflow: "hidden",
                    aspectRatio: "1",
                    border: "1px solid var(--mantine-color-default-border)",
                  }}
                >
                  <Image
                    src={item.thumbnailUrl || item.url}
                    alt={item.prompt || "Result"}
                    h="100%"
                    w="100%"
                    fit="cover"
                  />
                </UnstyledButton>
              ))}
          </SimpleGrid>
        ) : (
          <EmptyState>Your images will appear here.</EmptyState>
        )}
        {gallery.hasNextPage && (
          <Button
            variant="subtle"
            loading={gallery.isFetchingNextPage}
            onClick={() => void gallery.fetchNextPage()}
          >
            Load More
          </Button>
        )}
      </ScrollArea.Autosize>
      <Button onClick={close}>Use References</Button>
    </Stack>
  );
  const trigger = compact ? (
    <ActionIcon
      aria-label="Choose References"
      variant="subtle"
      color="gray"
      size={44}
      onClick={() => setOpened(true)}
    >
      {references[0] ? (
        <Image
          src={references[0].thumbnailUrl || references[0].url}
          alt={references[0].name}
          h={36}
          w={36}
          radius="sm"
        />
      ) : (
        <ImagePlus size={20} />
      )}
    </ActionIcon>
  ) : (
    <Button
      aria-label="Choose References"
      variant="default"
      size="compact-sm"
      onClick={() => setOpened(true)}
    >
      Add Reference
    </Button>
  );
  if (inline && opened) return content;
  if (narrow)
    return (
      <>
        {trigger}
        <Drawer
          opened={opened}
          onClose={close}
          title="References"
          position="bottom"
          size="100%"
          transitionProps={{ duration: motionDuration }}
        >
          {content}
        </Drawer>
      </>
    );
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={560}
      position="top-start"
      trapFocus
      shadow="md"
    >
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown aria-label="References">{content}</Popover.Dropdown>
    </Popover>
  );
}
