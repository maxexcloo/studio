import { ActionIcon, Button, ScrollArea, Stack, Text, Tooltip } from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { type ClipboardEvent, type DragEvent, useState } from "react";

import { startImageSlot } from "../../../../shared/characters";
import type { GallerySort } from "../../../../shared/gallery-sort";
import { slotCapacity } from "../../../../shared/profiles";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { ChipPopup, PopupHeading } from "../../ui/ChipPopup";
import { icons } from "../../ui/icons";
import { SortMenu } from "../../ui/SortMenu";
import { usePhone } from "../../ui/usePhone";
import { useGroupFeature } from "../auth/AccountGate";
import { useRemembered } from "../auth/useRemembered";
import { cardSortGroups, useCardListing } from "../characters/cardListing";
import { CharacterChoices } from "../characters/CharacterChoices";
import { PromptCardChoices } from "../characters/PromptCardChoices";
import { pictureItem, useMediaPreview } from "../gallery/MediaPreview";
import { chipProps } from "./chip";
import { GalleryChoices, galleryTabs } from "./GalleryChoices";
import { draftForProfile, useGeneration } from "./GenerationProvider";
import {
  controlRange,
  referenceDetails,
  referenceGroup,
  runReferenceSlots,
  splitReferenceSlots,
} from "./payload";
import {
  ChipContent,
  PickerGrid,
  PickerHeader,
  PickerTile,
  UploadTile,
  usePickerChoices,
} from "./Picker";
import {
  type ReferenceTarget,
  galleryReferenceType,
  nextReferenceTarget,
  orderedReferences,
  placeReference,
  referenceKey,
  referenceLabel,
  useReferenceList,
  useReferencePlacement,
} from "./references";
import { ReferenceSlots, referenceCellType } from "./ReferenceSlots";
import { type ReferenceBrowser, useReferenceBrowser } from "./useReferenceBrowser";

/** The Library's cards, after the gallery's tabs, with Characters. */
const cardTabs: typeof galleryTabs = [
  { value: "characters", label: "Characters" },
  { value: "outfits", label: "Outfits" },
  { value: "scenes", label: "Scenes" },
];

export function ReferencePicker({
  value,
  onChange,
  profile: selectedProfile,
  input: selectedInput,
  onInputChange,
  opened: controlled,
  onOpenedChange,
  browser: controlledBrowser,
  prompt: ownPrompt,
  onCharacterProfile,
}: {
  /**
   * Where the sheet may move the model for a picked character, which then takes the character's
   * references and prompt: the composer's form (GenerationEditor) passes its draft's.
   */
  onCharacterProfile?: (
    profile: Profile,
    next: {
      references: ReferenceAsset[];
      prompt: string;
      cardParts?: GenerationInput["cardParts"];
    },
  ) => void;
  browser?: ReferenceBrowser;
  /** The text a character's description joins: the editor's prompt. */
  prompt?: { value: string; onChange: (value: string) => void };
  value?: ReferenceAsset[];
  onChange?: (references: ReferenceAsset[]) => void;
  profile?: Profile;
  input?: GenerationInput;
  /** Changes the editor's own input, such as the denoise an img2img start image's Strength sets. */
  onInputChange?: (patch: Partial<GenerationInput>) => void;
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
  const { draft, setDraft } = useGeneration();
  const prompt = ownPrompt || {
    value: String(draft.input.prompt || ""),
    onChange: (prompt: string) =>
      setDraft((previous) => ({ ...previous, input: { ...previous.input, prompt } })),
  };
  const charactersOn = useGroupFeature("characters");
  const [cardQuery, setCardQuery] = useState("");
  // A dialog over the sheet, such as a preview or a card's editor, holds its focus and clicks.
  const [layer, setLayer] = useState(false);
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
  const slots = runReferenceSlots(profile);
  const { placed: active, unused } = splitReferenceSlots(references, slots);
  const preview = useMediaPreview();
  const openPreview = (asset: ReferenceAsset) =>
    preview.open(
      references.map((reference, index) =>
        pictureItem({
          ...reference,
          id: referenceKey(reference),
          url: reference.url || reference.thumbnailUrl,
          name: referenceLabel(reference, index, profile),
        }),
      ),
      references.indexOf(asset),
    );
  const [adding, setAdding] = usePickerChoices(phone && opened, !references.length);
  const placement = useReferencePlacement(list);
  // An img2img start image's Strength is the profile's denoise, where the profile maps one.
  const input = selectedInput || draft.input;
  const startSlot =
    profile?.kind === "image" ? startImageSlot({ ...profile, mediaInputs: slots }) : undefined;
  const denoiseRange =
    profile?.capabilities.denoise === true
      ? controlRange(profile, "denoise", { min: 0, max: 1, step: 0.05 })
      : null;
  const denoise = denoiseRange && {
    value:
      typeof input.denoise === "number" ? input.denoise : Number(profile?.defaults.denoise ?? 1),
    min: denoiseRange.min ?? 0,
    max: denoiseRange.max ?? 1,
    step: denoiseRange.step ?? 0.05,
    onChange: (value: number) =>
      onInputChange
        ? onInputChange({ denoise: value })
        : setDraft((previous) => ({ ...previous, input: { ...previous.input, denoise: value } })),
  };
  const localBrowser = useReferenceBrowser();
  const browser = controlledBrowser || localBrowser;
  const chosen = browser.state.target;
  const referenceTabs = charactersOn ? [galleryTabs, cardTabs] : [galleryTabs];
  const tab = referenceTabs.flat().some((item) => item.value === browser.state.tab)
    ? browser.state.tab
    : "gallery";
  const cardTab = tab !== "gallery" && tab !== "uploads" ? tab : undefined;
  const cardOrder = useCardListing("references", cardTab ?? "characters");
  const [mediaSort, setMediaSort] = useRemembered<GallerySort>("reference-media-sort", "newest");
  const target = slots.length ? nextReferenceTarget(active, profile, chosen) : null;
  function browse(patch: Partial<ReferenceBrowser["state"]>) {
    if (!("target" in patch)) browser.scroll.current = 0;
    browser.setState((previous) => ({ ...previous, ...patch }));
  }
  const settle = () => browse({ target: null });
  // A profile taking one reference closes the picker once it is picked, saving the dismissing click.
  const capacity = slotCapacity(slots);
  const single = capacity === 1;
  // The phone's choices return to the stack once a pick fills its chosen slot or the last free one.
  const placed = (into: ReferenceTarget | null, count: number) => {
    if (into || count >= capacity) setAdding(false);
  };
  function addGalleryItem(item: Parameters<typeof placement.addGalleryItem>[0], into = chosen) {
    placement.addGalleryItem(item, into, (count) => {
      settle();
      placed(into, count);
      if (single) setOpened(false);
    });
  }
  function uploadFiles(files: File[], into: ReferenceTarget | null = chosen) {
    if (!target || !files.length) return;
    const before = list.get().map(referenceKey);
    void placement.uploadFiles(files, into).then(() => {
      if (!list.get().some((asset, index) => referenceKey(asset) !== before[index])) return;
      settle();
      placed(into, list.get().length);
    });
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
    // Another role starts from its own default strength.
    const next = placeReference(
      rest,
      { ...asset, slot: undefined, strength: undefined },
      profile,
      into,
    );
    if (next !== rest) list.set(next);
  }
  function dropData(data: DataTransfer, into: ReferenceTarget | null = chosen) {
    const cell = data.getData(referenceCellType);
    const gallery = data.getData(galleryReferenceType);
    if (data.files.length && !cell && !gallery) return uploadFiles([...data.files], into);
    if (gallery && !cell) return addGalleryItem(JSON.parse(gallery), into);
    if (cell && into) moveReference(cell, into);
    settle();
  }
  const uploadTile = (
    <UploadTile
      label="Upload Reference"
      disabled={!target}
      loading={placement.uploading}
      onFiles={uploadFiles}
    />
  );
  // Pasting or dropping files anywhere in the picker uploads them.
  const fileProps = {
    onPaste: (event: ClipboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || !event.clipboardData.files.length) return;
      event.preventDefault();
      uploadFiles([...event.clipboardData.files]);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (event.defaultPrevented || !event.dataTransfer.files.length) return;
      event.preventDefault();
      dropData(event.dataTransfer);
    },
  };
  const count = capacity > 0 && (
    <Text
      span
      size="xs"
      c="dimmed"
      style={{ whiteSpace: "nowrap" }}
      aria-label={`${active.length} of ${capacity} References`}
    >
      {active.length}/{capacity}
    </Text>
  );
  // Choosing a slot opens the choices on phones.
  const stackContent = (
    <Stack component="section" aria-label="Reference Stack" gap="sm" {...fileProps}>
      {slots.length > 0 && (
        <ReferenceSlots
          references={active}
          profile={profile}
          target={target}
          onChoose={(target) => {
            browse({ target });
            if (phone) setAdding(true);
          }}
          onChange={(next) => {
            list.set([...next, ...unused]);
            settle();
          }}
          onDrop={dropData}
          onView={openPreview}
          start={startSlot ? { slot: startSlot, denoise: denoise || undefined } : undefined}
          onStrengthChange={(next) => list.set([...next, ...unused])}
        />
      )}
      {unused.length > 0 && (
        <Stack gap="xs" component="section" aria-label="Unused References">
          <Text size="sm" fw={500}>
            Not Used
          </Text>
          <Text size="xs" c="dimmed">
            These images don't fit the selected profile's slots. Remove them here or choose another
            profile.
          </Text>
          <PickerGrid label="Unused References">
            {unused.map((asset) => {
              const label = referenceLabel(asset, references.indexOf(asset), profile);
              return (
                <PickerTile
                  key={referenceKey(asset)}
                  label={`Preview ${label}`}
                  image={asset.thumbnailUrl || asset.url}
                  onToggle={() => openPreview(asset)}
                  action={
                    <Tooltip label="Remove">
                      <ActionIcon
                        variant="default"
                        aria-label={`Remove ${label}`}
                        onClick={() =>
                          list.set(
                            list
                              .get()
                              .filter((other) => referenceKey(other) !== referenceKey(asset)),
                          )
                        }
                      >
                        <icons.clear size={16} />
                      </ActionIcon>
                    </Tooltip>
                  }
                />
              );
            })}
          </PickerGrid>
        </Stack>
      )}
      {preview.element}
    </Stack>
  );
  // Desktop heads its column Stack and scrolls it; the phone sheet is the stack itself.
  const stack = phone ? (
    stackContent
  ) : (
    <>
      <PopupHeading title="Stack" detail={count} />
      <ScrollArea flex={1}>{stackContent}</ScrollArea>
    </>
  );
  const choices = (
    <Stack
      component="section"
      aria-label="Reference Choices"
      aria-busy={placement.adding || placement.uploading || undefined}
      gap="sm"
      // Phones fill the sheet between its header and footer; the grid owns scrolling and keeps its
      // position.
      flex={phone ? 1 : undefined}
      mih={0}
      h={phone ? undefined : "min(70dvh, 620px)"}
      {...fileProps}
    >
      {cardTab && (
        <PickerHeader
          label="References"
          searched={cardTabs.find((item) => item.value === cardTab)?.label}
          tabs={referenceTabs}
          tab={tab}
          onTabChange={(tab) => browse({ tab })}
          query={cardQuery}
          onQueryChange={setCardQuery}
          actions={
            <SortMenu
              label="Sort References"
              groups={cardSortGroups}
              value={cardOrder.sort}
              onChange={cardOrder.setSort}
            />
          }
        />
      )}
      {tab === "outfits" || tab === "scenes" ? (
        <PromptCardChoices
          kind={tab}
          query={cardQuery}
          sort={cardOrder.sort}
          prompt={prompt.value}
          parts={input.cardParts}
          onChange={(prompt, cardParts) => {
            if (onInputChange) onInputChange({ prompt, cardParts });
            else
              setDraft((previous) => ({
                ...previous,
                input: { ...previous.input, prompt, cardParts },
              }));
          }}
          onLayer={setLayer}
        />
      ) : tab === "characters" ? (
        <CharacterChoices
          query={cardQuery}
          sort={cardOrder.sort}
          references={references}
          prompt={prompt.value}
          parts={input.cardParts}
          profile={profile}
          switchable={Boolean(onCharacterProfile) || (!value && !selectedProfile && !ownPrompt)}
          onChange={(next) => {
            const editor = next.profile;
            // The composer's draft moves to the character's model, its images and prompt with it.
            if (editor && onCharacterProfile) onCharacterProfile(editor, next);
            else if (editor) setDraft((previous) => draftForProfile(previous, editor, next));
            else {
              list.set(next.references);
              if (onInputChange) onInputChange({ prompt: next.prompt, cardParts: next.cardParts });
              else
                setDraft((previous) => ({
                  ...previous,
                  input: { ...previous.input, prompt: next.prompt, cardParts: next.cardParts },
                }));
            }
            settle();
          }}
          onLayer={setLayer}
        />
      ) : (
        <GalleryChoices
          label="References"
          more={charactersOn ? [cardTabs] : []}
          browser={browser}
          enabled={opened}
          sorting={{ value: mediaSort, onChange: setMediaSort }}
          notice={
            !target && (
              <Text size="xs" c="dimmed">
                {slots.length
                  ? "All slots are filled. Choose a reference to replace it, or a selected image to remove it."
                  : "This profile doesn't take references."}
              </Text>
            )
          }
          uploadTile={uploadTile}
          tile={(item, name) => {
            const matches = (reference: ReferenceAsset) => reference.galleryItemId === item.id;
            const selected = references.some(matches);
            // A selected image removes on a second tap, except into a chosen slot, so one image
            // can still play several roles.
            const removes = selected && !chosen;
            return {
              label: `${removes ? "Remove" : "Use"} reference: ${name}`,
              selected,
              disabled: !target || placement.adding,
              onToggle: () => {
                if (!removes) return addGalleryItem(item);
                list.set(list.get().filter((asset) => !matches(asset)));
                settle();
              },
            };
          }}
          onLayer={setLayer}
        />
      )}
    </Stack>
  );
  const missing = profile?.mediaInputs?.some(
    (slot) => slot.required && !references.some((asset) => asset.slot === slot.id),
  );
  const trigger = (
    <Button
      {...chipProps}
      aria-label="Choose References"
      aria-expanded={opened}
      color={missing || unused.length ? "yellow" : undefined}
      variant={missing || unused.length ? "outline" : chipProps.variant}
      rightSection={<ChevronDown size={14} />}
      onClick={() => setOpened(!opened)}
    >
      <ChipContent
        label="References"
        icon={icons.reference}
        items={active.map((asset, index) => ({
          key: referenceKey(asset),
          label: referenceLabel(asset, index, profile),
          src: asset.thumbnailUrl || asset.url,
        }))}
      />
    </Button>
  );
  const clear = {
    onClear: () => {
      list.set([]);
      settle();
    },
    clearDisabled: !references.length,
  };
  if (phone)
    return (
      <ChipPopup
        title="References"
        opened={opened}
        onOpenedChange={setOpened}
        trap={!layer && !adding && !preview.opened}
        target={trigger}
        detail={count}
        {...clear}
        leading={
          <ChipPopup
            title="Add References"
            opened={opened && adding}
            onOpenedChange={(adding) => {
              setAdding(adding);
              if (!adding) settle();
            }}
            trap={!layer}
            target={
              <Button
                variant="default"
                aria-label="Add References"
                aria-expanded={opened && adding}
                onClick={() => setAdding(true)}
              >
                Add
              </Button>
            }
          >
            {choices}
          </ChipPopup>
        }
      >
        {stack}
      </ChipPopup>
    );
  return (
    <ChipPopup
      title="References"
      wide
      opened={opened}
      onOpenedChange={setOpened}
      trap={!layer && !preview.opened}
      target={trigger}
      aside={stack}
      {...clear}
    >
      {choices}
    </ChipPopup>
  );
}
