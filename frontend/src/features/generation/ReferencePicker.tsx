import { useMotionDuration } from "../../ui/Appearance";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Drawer,
  FileButton,
  Group,
  Image,
  Modal,
  Pill,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
  getDefaultZIndex,
} from "@mantine/core";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { ImagePlus, ArrowLeft, Trash2, Upload } from "lucide-react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { MediaItem, ReferenceAsset, Profile, GenerationInput } from "../../types";
import { OrderedItems } from "../../ui/OrderedItems";
import { LoadingState } from "../../ui/LoadingState";
import { EmptyState } from "../../ui/EmptyState";
import { SearchInput } from "../../ui/SearchInput";
import { GalleryFilterToolbar, appendGalleryFilters } from "../gallery/GalleryFilters";
import {
  addReference,
  referenceDetails,
  referencePatch,
  referenceGroups,
  referenceGroupAssets,
  referenceCapacity,
} from "./payload";
import { useGeneration } from "./GenerationProvider";
import { referenceLabel, useGalleryReference } from "./references";
import { useReferenceUpload } from "./useReferenceUpload";
import { useReferenceBrowser, type ReferenceBrowser } from "./useReferenceBrowser";

export function ReferencePicker({
  compact = false,
  value,
  onChange,
  profile: selectedProfile,
  input: selectedInput,
  inline = false,
  embedded = false,
  opened: controlled,
  onOpenedChange,
  browser: controlledBrowser,
}: {
  browser?: ReferenceBrowser;
  compact?: boolean;
  value?: ReferenceAsset[];
  onChange?: (references: ReferenceAsset[]) => void;
  profile?: Profile;
  input?: GenerationInput;
  inline?: boolean;
  embedded?: boolean;
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
  const localBrowser = useReferenceBrowser();
  const browser = controlledBrowser || localBrowser;
  const { chosenSlot, query, source, filters, starred } = browser.state;
  function browse(patch: Partial<ReferenceBrowser["state"]>) {
    if (!("chosenSlot" in patch)) browser.scroll.current = 0;
    browser.setState((previous) => ({ ...previous, ...patch }));
  }
  const groups = referenceGroups(profile);
  const group = groups.find((items) => items.some((input) => input.id === chosenSlot)) || groups[0];
  const slot = group[0].id;
  const slotLimit = referenceCapacity(group);
  const selectedCount = referenceGroupAssets(references, group).length;
  const slotFull = slotLimit > 1 && selectedCount >= slotLimit;
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search] = useDebouncedValue(query, 250);
  const client = useQueryClient();
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
  const deletion = useMutation({
    mutationFn: (id: string) =>
      api(`/api/reference-assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async (_result, id) => {
      setReferences(currentReferences.current.filter((asset) => asset.id !== id));
      await client.invalidateQueries({ queryKey: ["reference-uploads"] });
      setDeleteId(null);
    },
  });
  function dismissDelete() {
    if (deletion.isPending) return;
    setDeleteId(null);
    deletion.reset();
  }
  const deleteDialog = (
    <Modal
      opened={deleteId !== null}
      onClose={dismissDelete}
      zIndex={getDefaultZIndex("overlay")}
      title="Delete Upload"
      centered
      closeOnClickOutside={!deletion.isPending}
      closeOnEscape={!deletion.isPending}
      closeButtonProps={{ disabled: deletion.isPending }}
    >
      <Stack>
        <Text>
          Delete this uploaded image from Studio? References using it will need another image.
        </Text>
        {deletion.error && <Alert color="red">{deletion.error.message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" disabled={deletion.isPending} onClick={dismissDelete}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={deletion.isPending}
            onClick={() => deleteId && deletion.mutate(deleteId)}
          >
            Delete Upload
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
  const select = useGalleryReference(adopt);
  const { upload, uploading } = useReferenceUpload((asset) => {
    adopt(asset);
    void client.invalidateQueries({ queryKey: ["reference-uploads"] });
  });
  async function uploadFiles(files: File[]) {
    const remaining =
      slotLimit === 1
        ? 1
        : Math.max(0, slotLimit - referenceGroupAssets(currentReferences.current, group).length);
    for (const file of files.filter((file) => file.type.startsWith("image/")).slice(0, remaining))
      await upload(file);
  }
  const gallery = useInfiniteQuery({
    queryKey: ["reference-gallery", search, filters, starred],
    enabled: opened && source === "gallery",
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<{ items: MediaItem[]; hasMore: boolean; nextCursor: string }>(
        `/api/gallery?${appendGalleryFilters(new URLSearchParams({ limit: "60", cursor: pageParam, type: "image", q: search, favorites: starred ? "1" : "0" }), filters)}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });
  const uploads = useInfiniteQuery({
    queryKey: ["reference-uploads", search],
    enabled: opened && source === "uploads",
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<{ items: ReferenceAsset[]; hasMore: boolean; nextCursor: string }>(
        `/api/reference-assets?${new URLSearchParams({ source: "upload", limit: "60", cursor: pageParam, q: search })}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });
  const listing = source === "uploads" ? uploads : gallery;
  const choices =
    source === "uploads"
      ? (uploads.data?.pages.flatMap((page) => page.items) || []).map((asset, index) => ({
          id: asset.id,
          name: `Reference ${index + 1}`,
          deleteId: asset.id,
          thumbnailUrl: asset.thumbnailUrl || asset.url,
          choose: () => adopt(asset),
        }))
      : (gallery.data?.pages.flatMap((page) => page.items) || [])
          .filter((item) => item.type === "image" && item.status === "done")
          .map((item) => ({
            id: item.id,
            name: item.prompt || "Result",
            deleteId: undefined,
            thumbnailUrl: item.thumbnailUrl || item.url,
            choose: () => select.mutate(item),
          }));
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const restoreScroll = useRef(true);
  useLayoutEffect(() => {
    if (!viewport) restoreScroll.current = true;
    else if (restoreScroll.current && choices.length) {
      viewport.scrollTop = browser.scroll.current;
      restoreScroll.current = false;
    }
  }, [viewport, choices.length, browser.scroll]);
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
      style={{
        minHeight: 0,
        // Inline fills the phone Drawer below its header so the listing owns its scroll position.
        height: inline ? "calc(100dvh - 6rem)" : "min(70dvh, 640px)",
      }}
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
      {groups.length > 1 && (
        <Select
          comboboxProps={{ withinPortal: false }}
          label="Reference Slot"
          value={slot}
          onChange={(chosenSlot) => browse({ chosenSlot })}
          allowDeselect={false}
          data={groups.map((items) => ({
            value: items[0].id,
            label: `${items[0].label || items[0].id}${items.some((input) => input.required) ? " · Required" : " · Optional"}${referenceCapacity(items) > 1 || items[0].max ? ` · Up to ${referenceCapacity(items)}` : ""}`,
          }))}
        />
      )}
      <Text size="xs" c="dimmed">
        {group[0].label || slot}: {selectedCount} / {slotLimit}
      </Text>
      {!!references.length && (
        <ScrollArea.Autosize mah="25dvh" style={{ flexShrink: 0 }}>
          <OrderedItems
            kind="references"
            items={references}
            identity={(asset) => `${asset.slot}:${asset.id}`}
            label={(asset) => referenceLabel(asset, references.indexOf(asset), profile)}
            onChange={setReferences}
          >
            {(asset, index) => (
              <Group gap="xs" wrap="nowrap">
                <Image
                  src={asset.thumbnailUrl || asset.url}
                  alt={referenceLabel(asset, index, profile)}
                  h={32}
                  w={32}
                  radius="sm"
                />
                <Pill
                  withRemoveButton
                  removeButtonProps={{
                    "aria-label": `Remove ${referenceLabel(asset, index, profile)}`,
                    "aria-hidden": false,
                    tabIndex: 0,
                  }}
                  onRemove={() =>
                    setReferences(
                      references.filter(
                        (reference) => reference.id !== asset.id || reference.slot !== asset.slot,
                      ),
                    )
                  }
                >
                  {referenceLabel(asset, index, profile)}
                </Pill>
              </Group>
            )}
          </OrderedItems>
        </ScrollArea.Autosize>
      )}
      <SegmentedControl
        aria-label="Reference Source"
        value={source}
        onChange={(value) => browse({ source: value as "gallery" | "uploads" })}
        fullWidth
        data={[
          { value: "gallery", label: "Gallery" },
          { value: "uploads", label: "Uploads" },
        ]}
      />
      {source === "gallery" ? (
        <GalleryFilterToolbar
          withinPortal={false}
          query={query}
          onQueryChange={(query) => browse({ query })}
          kind="image"
          value={filters}
          onChange={(filters) => browse({ filters })}
          starred={starred}
          onStarredChange={(starred) => browse({ starred })}
        />
      ) : (
        <SearchInput
          aria-label="Search Uploads"
          placeholder="Search uploads…"
          value={query}
          onChange={(event) => browse({ query: event.currentTarget.value })}
          onClear={() => browse({ query: "" })}
        />
      )}
      <ScrollArea.Autosize
        style={{ flex: 1, minHeight: 0 }}
        viewportRef={setViewport}
        onScrollPositionChange={({ y }) => {
          if (!restoreScroll.current) browser.scroll.current = y;
        }}
      >
        {listing.isPending ? (
          <LoadingState label="Loading References" />
        ) : listing.error ? (
          <Alert color="red">{listing.error.message}</Alert>
        ) : choices.length ? (
          <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
            {choices.map((item, index) => (
              <Stack key={item.id} gap={4}>
                <UnstyledButton
                  aria-label={`Use reference: ${item.name}`}
                  onClick={item.choose}
                  disabled={select.isPending || slotFull}
                  style={{
                    borderRadius: "var(--mantine-radius-md)",
                    overflow: "hidden",
                    aspectRatio: "1",
                    border: "1px solid var(--mantine-color-default-border)",
                  }}
                >
                  <Image src={item.thumbnailUrl} alt={item.name} h="100%" w="100%" fit="cover" />
                </UnstyledButton>
                {item.deleteId && (
                  <Group justify="flex-end">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Delete Upload ${index + 1}`}
                      onClick={() => {
                        deletion.reset();
                        setDeleteId(item.deleteId);
                      }}
                    >
                      <Trash2 size={16} />
                    </ActionIcon>
                  </Group>
                )}
              </Stack>
            ))}
          </SimpleGrid>
        ) : (
          <EmptyState fill>
            {search
              ? "No matching references."
              : source === "uploads"
                ? "No Uploads"
                : "Your images will appear here."}
          </EmptyState>
        )}
        {listing.hasNextPage && (
          <Button
            variant="subtle"
            loading={listing.isFetchingNextPage}
            onClick={() => void listing.fetchNextPage()}
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
          alt={referenceLabel(references[0], 0, profile)}
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
      size="md"
      onClick={() => setOpened(true)}
    >
      Add Reference
    </Button>
  );
  if (inline && opened)
    return (
      <>
        {content}
        {deleteDialog}
      </>
    );
  if (narrow)
    return (
      <>
        {trigger}
        <Drawer
          opened={opened && !embedded}
          onClose={close}
          title="References"
          position="bottom"
          size="100%"
          transitionProps={{ duration: motionDuration }}
          trapFocus={deleteId === null}
        >
          {content}
        </Drawer>
        {deleteDialog}
      </>
    );
  return (
    <>
      <Popover
        opened={opened}
        onChange={setOpened}
        width={560}
        position="top-start"
        trapFocus={deleteId === null}
        closeOnClickOutside={deleteId === null}
        shadow="md"
      >
        <Popover.Target>{trigger}</Popover.Target>
        <Popover.Dropdown aria-label="References">{content}</Popover.Dropdown>
      </Popover>
      {deleteDialog}
    </>
  );
}
