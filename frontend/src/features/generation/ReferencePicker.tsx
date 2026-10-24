import { useMotionDuration } from "../../ui/Appearance";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Drawer,
  FileButton,
  Group,
  Image,
  Indicator,
  Loader,
  Popover,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
  getDefaultZIndex,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { ImagePlus, ArrowLeft, Trash2, Upload } from "lucide-react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../../api";
import type { MediaItem, ReferenceAsset, Profile, GenerationInput } from "../../types";
import { LoadingState } from "../../ui/LoadingState";
import { EmptyState } from "../../ui/EmptyState";
import { SearchInput } from "../../ui/SearchInput";
import { GalleryFilterToolbar, appendGalleryFilters } from "../gallery/GalleryFilters";
import { referenceDetails, referenceGroup } from "./payload";
import { useGeneration } from "./GenerationProvider";
import {
  galleryReferenceType,
  nextReferenceTarget,
  orderedReferences,
  placeReference,
  referenceKey,
  referenceLabel,
  uploadReferenceType,
  useReferenceList,
  useReferencePlacement,
  useSaveUploadToImages,
  type ReferenceTarget,
} from "./references";
import { ReferenceSlots, referenceCellType } from "./ReferenceSlots";
import { useReferenceBrowser, type ReferenceBrowser } from "./useReferenceBrowser";
import { usePhone } from "../../ui/usePhone";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { chipProps } from "./chip";
import editorClasses from "./GenerationEditor.module.css";
import classes from "./ReferencePicker.module.css";

/** Nested pickers, menus and open comboboxes inside the panel handle their own Escape. */
const nestedLayers =
  '.mantine-Popover-dropdown, [role="menu"], [role="dialog"], [role="combobox"][aria-expanded="true"]';

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
  const phone = usePhone();
  // Phones show the panel as a full-height sheet with its action at the safe bottom.
  const sheet = inline || phone;
  const motionDuration = useMotionDuration();
  const { draft } = useGeneration();
  const list = useReferenceList({
    value,
    onChange,
    profile: selectedProfile,
    input: selectedInput,
  });
  const { profile } = list;
  const references = orderedReferences(
    referenceDetails(value || draft.references, selectedInput || draft.input, profile),
    profile,
  );
  const placement = useReferencePlacement(list);
  const save = useSaveUploadToImages();
  const localBrowser = useReferenceBrowser();
  const browser = controlledBrowser || localBrowser;
  const { target: chosen, query, source, filters, starred } = browser.state;
  const target = nextReferenceTarget(references, profile, chosen);
  function browse(patch: Partial<ReferenceBrowser["state"]>) {
    if (!("target" in patch)) browser.scroll.current = 0;
    browser.setState((previous) => ({ ...previous, ...patch }));
  }
  const settle = () => browse({ target: null });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search] = useDebouncedValue(query, 250);
  const client = useQueryClient();
  const deletion = useMutation({
    meta: { inlineError: true },
    mutationFn: (id: string) =>
      api(`/api/reference-assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async (_result, id) => {
      list.set(list.get().filter((asset) => asset.id !== id));
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
    <ConfirmDialog
      opened={deleteId !== null}
      title="Delete Upload"
      action="Delete Upload"
      pending={deletion.isPending}
      error={deletion.error?.message}
      zIndex={getDefaultZIndex("overlay")}
      onConfirm={() => deleteId && deletion.mutate(deleteId)}
      onClose={dismissDelete}
    >
      Delete this uploaded image from Studio? References using it will need another image.
    </ConfirmDialog>
  );
  function uploadFiles(files: File[], into: ReferenceTarget | null = chosen) {
    void placement.uploadFiles(files, into);
    settle();
  }
  /** A placed reference dropped on another slot moves there; within its role it swaps places. */
  function moveReference(key: string, into: ReferenceTarget) {
    const current = list.get();
    const asset = current.find((reference) => referenceKey(reference) === key);
    if (!asset || into.replace === key) return;
    if (referenceGroup(profile, asset.slot)[0].id === into.slot) {
      const other = current.findIndex((reference) => referenceKey(reference) === into.replace);
      if (other < 0) return;
      const next = [...current];
      [next[current.indexOf(asset)], next[other]] = [next[other], next[current.indexOf(asset)]];
      list.set(next);
      return;
    }
    const rest = current.filter((reference) => reference !== asset);
    const next = placeReference(rest, { ...asset, slot: undefined }, profile, into);
    if (next !== rest) list.set(next);
  }
  function dropData(data: DataTransfer, into: ReferenceTarget | null = chosen) {
    const cell = data.getData(referenceCellType);
    const upload = data.getData(uploadReferenceType);
    const gallery = data.getData(galleryReferenceType);
    if (cell) {
      if (into) moveReference(cell, into);
    } else if (upload) placement.place(JSON.parse(upload), into);
    else if (gallery) placement.addGalleryItem(JSON.parse(gallery), into);
    else if (data.files.length) void placement.uploadFiles([...data.files], into);
    settle();
  }
  const gallery = useInfiniteQuery({
    queryKey: ["reference-gallery", search, filters, starred],
    enabled: opened && source === "gallery",
    // Searching and filtering keep the current tiles until the new ones arrive.
    placeholderData: keepPreviousData,
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
    placeholderData: keepPreviousData,
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
          drag: [uploadReferenceType, JSON.stringify(asset)],
          choose: () => placement.place(asset, chosen),
        }))
      : (gallery.data?.pages.flatMap((page) => page.items) || [])
          .filter((item) => item.type === "image" && item.status === "done")
          .map((item) => ({
            id: item.id,
            name: item.prompt || "Result",
            deleteId: undefined,
            thumbnailUrl: item.thumbnailUrl || item.url,
            drag: [galleryReferenceType, JSON.stringify({ id: item.id, type: item.type })],
            choose: () => placement.addGalleryItem(item, chosen),
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
  function escape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const layer = (event.target as Element).closest(nestedLayers);
    if (layer && layer !== event.currentTarget.closest(".mantine-Popover-dropdown")) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  const uploadTile = (
    <FileButton
      accept="image/png,image/jpeg,image/webp"
      multiple
      onChange={(files) => uploadFiles(files)}
    >
      {(props) => (
        <UnstyledButton
          {...props}
          className={classes.tile}
          data-upload
          aria-label="Upload Reference"
          disabled={!target}
        >
          {placement.uploading ? (
            <Loader size="sm" />
          ) : (
            <Stack gap={4} align="center">
              <Upload size={20} aria-hidden />
              <Text size="xs">Upload</Text>
            </Stack>
          )}
        </UnstyledButton>
      )}
    </FileButton>
  );
  const content = (
    <Stack
      component="section"
      aria-label="References"
      data-composer-layer
      onKeyDown={escape}
      onPaste={(event) => {
        if (event.defaultPrevented || !event.clipboardData.files.length) return;
        event.preventDefault();
        uploadFiles([...event.clipboardData.files]);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.defaultPrevented || !event.dataTransfer.files.length) return;
        event.preventDefault();
        dropData(event.dataTransfer);
      }}
      gap="sm"
      style={{
        minHeight: 0,
        // The sheet fills the phone Drawer below its 3.75rem header, so the grid owns scrolling
        // and keeps its position while the footer stays at the safe bottom.
        height: sheet ? "calc(100dvh - 3.75rem)" : "min(70dvh, 620px)",
      }}
    >
      {inline && (
        <Group justify="space-between">
          <Button
            autoFocus
            size="compact-sm"
            variant="subtle"
            color="gray"
            leftSection={<ArrowLeft size={16} />}
            onClick={close}
          >
            Back
          </Button>
          <Text size="sm" fw={500}>
            References
          </Text>
        </Group>
      )}
      <ReferenceSlots
        references={references}
        profile={profile}
        target={target}
        onChoose={(target) => browse({ target })}
        onChange={(next) => {
          list.set(next);
          settle();
        }}
        onDrop={dropData}
        onSave={(asset) => save.mutate(asset.id)}
      />
      {!target && (
        <Text size="xs" c="dimmed">
          All slots are filled. Choose a reference to replace it.
        </Text>
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
        offsetScrollbars="present"
        viewportRef={setViewport}
        onScrollPositionChange={({ y }) => {
          if (!restoreScroll.current) browser.scroll.current = y;
        }}
      >
        {listing.isPending ? (
          <LoadingState label="Loading References" />
        ) : listing.error ? (
          <Alert color="red">{listing.error.message}</Alert>
        ) : choices.length || source === "uploads" ? (
          <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
            {source === "uploads" && uploadTile}
            {choices.map((item, index) => (
              <div key={item.id} className={classes.tileWrap} style={{ position: "relative" }}>
                <UnstyledButton
                  className={classes.tile}
                  aria-label={`Use reference: ${item.name}`}
                  onClick={() => {
                    item.choose();
                    settle();
                  }}
                  disabled={!target}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(item.drag[0], item.drag[1]);
                  }}
                >
                  <Image
                    src={item.thumbnailUrl}
                    alt=""
                    h="100%"
                    w="100%"
                    fit="cover"
                    fallbackSrc=""
                    draggable={false}
                  />
                </UnstyledButton>
                {item.deleteId && (
                  <ActionIcon
                    className={classes.tileAction}
                    size="sm"
                    variant="default"
                    color="red"
                    aria-label={`Delete Upload ${index + 1}`}
                    onClick={() => {
                      deletion.reset();
                      setDeleteId(item.deleteId);
                    }}
                  >
                    <Trash2 size={14} />
                  </ActionIcon>
                )}
              </div>
            ))}
          </SimpleGrid>
        ) : (
          <EmptyState fill>{search ? "No Matching Images" : "No Images"}</EmptyState>
        )}
        {source === "uploads" && !choices.length && !listing.isPending && (
          <Text size="xs" c="dimmed" ta="center" mt="sm">
            {search ? "No matching uploads." : "Upload, paste or drop images to use them here."}
          </Text>
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
      {sheet && (
        <Box className={editorClasses.footer} data-sticky>
          <Button fullWidth onClick={close}>
            Use References
          </Button>
        </Box>
      )}
    </Stack>
  );
  const missing = profile?.mediaInputs?.some(
    (slot) => slot.required && !references.some((asset) => asset.slot === slot.id),
  );
  const trigger = compact ? (
    <ActionIcon
      aria-label="Choose References"
      variant="subtle"
      color="gray"
      size={44}
      onClick={() => setOpened(!opened)}
    >
      {references[0] ? (
        <Image
          src={references[0].thumbnailUrl || references[0].url}
          alt={referenceLabel(references[0], 0, profile)}
          h={36}
          w={36}
          radius="sm"
          fallbackSrc=""
        />
      ) : (
        <ImagePlus size={20} />
      )}
    </ActionIcon>
  ) : (
    <Button
      {...chipProps}
      aria-label="Choose References"
      aria-expanded={opened}
      color={missing ? "yellow" : undefined}
      variant={missing ? "outline" : chipProps.variant}
      leftSection={<ImagePlus size={16} />}
      onClick={() => setOpened(!opened)}
    >
      {references.length ? (
        <Group gap={6} wrap="nowrap" component="span">
          {references.map((asset, index) => (
            <Indicator
              key={referenceKey(asset)}
              component="span"
              label={index + 1}
              size={14}
              offset={7}
              position="bottom-end"
              color="dark"
              fz={9}
            >
              <Image
                src={asset.thumbnailUrl || asset.url}
                alt={referenceLabel(asset, index, profile)}
                h={24}
                w={24}
                radius="sm"
                fallbackSrc=""
              />
            </Indicator>
          ))}
        </Group>
      ) : (
        "References"
      )}
    </Button>
  );
  if (inline && opened)
    return (
      <>
        {content}
        {deleteDialog}
      </>
    );
  if (phone)
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
          styles={{ body: { paddingBottom: 0 } }}
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
        // Escape closes nested layers first; the panel's own handler closes it last.
        closeOnEscape={false}
        returnFocus
        shadow="md"
      >
        <Popover.Target>{trigger}</Popover.Target>
        <Popover.Dropdown aria-label="References">{content}</Popover.Dropdown>
      </Popover>
      {deleteDialog}
    </>
  );
}
