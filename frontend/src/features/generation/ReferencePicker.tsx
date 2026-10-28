import { useLayoutEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  FileButton,
  getDefaultZIndex,
  Image,
  Loader,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { ImagePlus, Trash2, Upload } from "lucide-react";
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
import {
  GalleryFilters,
  appendGalleryFilters,
  galleryFilterCount,
} from "../gallery/GalleryFilters";
import { referenceDetails, referenceGroup } from "./payload";
import { useGeneration } from "./GenerationProvider";
import {
  galleryReferenceType,
  nextReferenceTarget,
  orderedReferences,
  placeReference,
  referenceKey,
  referenceLabel,
  useReferenceList,
  useReferencePlacement,
  type ReferenceTarget,
} from "./references";
import { ReferenceSlots, referenceCellType } from "./ReferenceSlots";
import { useReferenceBrowser, type ReferenceBrowser } from "./useReferenceBrowser";
import { usePhone } from "../../ui/usePhone";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { chipProps } from "./chip";
import { ChipPopup, ChipThumbnails, PickerGrid, PickerHeader, PickerTile } from "./Picker";
import classes from "./ReferencePicker.module.css";

export function ReferencePicker({
  compact = false,
  value,
  onChange,
  profile: selectedProfile,
  input: selectedInput,
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
  opened?: boolean;
  onOpenedChange?: (opened: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const opened = controlled ?? localOpen;
  const setOpened = (opened: boolean) => {
    setLocalOpen(opened);
    onOpenedChange?.(opened);
  };
  const phone = usePhone();
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
  const localBrowser = useReferenceBrowser();
  const browser = controlledBrowser || localBrowser;
  const { target: chosen, query, filters, starred, uploads } = browser.state;
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
    mutationFn: (id: string) => api(`/api/gallery/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async (_result, id) => {
      list.set(list.get().filter((asset) => asset.galleryItemId !== id));
      await client.invalidateQueries({ queryKey: ["reference-gallery"] });
      await client.invalidateQueries({ queryKey: ["gallery"] });
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
    const gallery = data.getData(galleryReferenceType);
    if (cell) {
      if (into) moveReference(cell, into);
    } else if (gallery) placement.addGalleryItem(JSON.parse(gallery), into);
    else if (data.files.length) void placement.uploadFiles([...data.files], into);
    settle();
  }
  // Uploads are gallery images too, behind the gallery's Uploads filter.
  const listing = useInfiniteQuery({
    queryKey: ["reference-gallery", search, filters, starred, uploads],
    enabled: opened,
    // Searching and filtering keep the current tiles until the new ones arrive.
    placeholderData: keepPreviousData,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<{ items: MediaItem[]; hasMore: boolean; nextCursor: string }>(
        `/api/gallery?${appendGalleryFilters(new URLSearchParams({ limit: "60", cursor: pageParam, type: "image", q: search, favorites: starred ? "1" : "0", uploads: uploads ? "1" : "0" }), filters)}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });
  const listed = (listing.data?.pages.flatMap((page) => page.items) || [])
    .filter((item) => item.type === "image" && item.status === "done")
    .map((item, index) => ({
      id: item.id,
      name: item.uploaded ? `Upload ${index + 1}` : item.prompt || "Result",
      uploaded: Boolean(item.uploaded),
      thumbnailUrl: item.thumbnailUrl || item.url,
      drag: [galleryReferenceType, JSON.stringify({ id: item.id, type: item.type })] as [
        string,
        string,
      ],
      choose: () => placement.addGalleryItem(item, chosen),
      matches: (reference: ReferenceAsset) => reference.galleryItemId === item.id,
    }));
  // A selected image removes on a second click, except into a chosen slot, so one image can
  // still play several roles.
  const choices = listed.map((item) => {
    const selected = references.some((reference) => item.matches(reference));
    return { ...item, selected, removes: selected && !chosen };
  });
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const restoreScroll = useRef(true);
  useLayoutEffect(() => {
    if (!viewport) restoreScroll.current = true;
    else if (restoreScroll.current && choices.length) {
      viewport.scrollTop = browser.scroll.current;
      restoreScroll.current = false;
    }
  }, [viewport, choices.length, browser.scroll]);
  const uploadTile = (
    <div role="listitem">
      <FileButton
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(files) => uploadFiles(files)}
      >
        {(props) => (
          <UnstyledButton
            {...props}
            className={classes.upload}
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
    </div>
  );
  const content = (
    <Stack
      component="section"
      aria-label="References"
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
        // Phones fill the popup below its header; the grid owns scrolling and keeps its position.
        height: phone ? "calc(100dvh - 5rem)" : "min(70dvh, 620px)",
      }}
    >
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
      />
      {!target && (
        <Text size="xs" c="dimmed">
          All slots are filled. Choose a reference to replace it, or a selected image to remove it.
        </Text>
      )}
      <PickerHeader
        label="References"
        searched={uploads ? "Uploads" : "Gallery"}
        query={query}
        onQueryChange={(query) => browse({ query })}
        placeholder={uploads ? "Search uploads…" : "Search your generations…"}
        filterCount={galleryFilterCount(filters, starred, uploads)}
        filters={
          <GalleryFilters
            withinPortal={false}
            kind="image"
            value={filters}
            onChange={(filters) => browse({ filters })}
            starred={starred}
            onStarredChange={(starred) => browse({ starred })}
            uploads={uploads}
            onUploadsChange={(uploads) => browse({ uploads })}
          />
        }
      />
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
        ) : choices.length || uploads ? (
          <PickerGrid label="Reference Choices">
            {uploads && uploadTile}
            {choices.map((item, index) => (
              <PickerTile
                key={item.id}
                label={`${item.removes ? "Remove" : "Use"} reference: ${item.name}`}
                selected={item.selected}
                disabled={!target}
                image={item.thumbnailUrl}
                drag={item.drag}
                onToggle={() => {
                  if (item.removes) list.set(list.get().filter((asset) => !item.matches(asset)));
                  else item.choose();
                  settle();
                }}
                action={
                  item.uploaded && (
                    <ActionIcon
                      variant="default"
                      color="red"
                      aria-label={`Delete Upload ${index + 1}`}
                      onClick={() => {
                        deletion.reset();
                        setDeleteId(item.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </ActionIcon>
                  )
                }
              />
            ))}
          </PickerGrid>
        ) : (
          <EmptyState fill>{search ? "No Matching Images" : "No Images"}</EmptyState>
        )}
        {uploads && !choices.length && !listing.isPending && (
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
      leftSection={references.length ? undefined : <ImagePlus size={16} />}
      onClick={() => setOpened(!opened)}
    >
      {references.length ? (
        <ChipThumbnails
          placeholder={ImagePlus}
          items={references.map((asset, index) => ({
            key: referenceKey(asset),
            label: referenceLabel(asset, index, profile),
            src: asset.thumbnailUrl || asset.url,
          }))}
        />
      ) : (
        "References"
      )}
    </Button>
  );
  return (
    <>
      <ChipPopup
        title="References"
        width={560}
        opened={opened}
        onOpenedChange={setOpened}
        trap={deleteId === null}
        target={trigger}
        headerEnd={
          <Button
            size="compact-sm"
            variant="subtle"
            color="gray"
            disabled={!references.length}
            onClick={() => {
              list.set([]);
              settle();
            }}
          >
            Clear References
          </Button>
        }
      >
        {content}
      </ChipPopup>
      {deleteDialog}
    </>
  );
}
