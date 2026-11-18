import { ActionIcon, Button, Image, ScrollArea, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ChevronDown, ImagePlus } from "lucide-react";
import { type ClipboardEvent, type DragEvent, useState } from "react";

import { startImageSlot } from "../../../../shared/characters";
import { slotCapacity } from "../../../../shared/profiles";
import { failure } from "../../api";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { canReadClipboard, readClipboard } from "../../ui/clipboard";
import { icons } from "../../ui/icons";
import { usePhone, useTouch } from "../../ui/usePhone";
import { useGroupFeature } from "../auth/AccountGate";
import { CharacterChoices } from "../characters/CharacterChoices";
import { PromptCardChoices } from "../characters/PromptCardChoices";
import { chipProps, iconChipProps } from "./chip";
import { GalleryChoices, galleryTabs } from "./GalleryChoices";
import { draftForProfile, useGeneration } from "./GenerationProvider";
import { controlRange, referenceDetails, referenceGroup, referenceGroups } from "./payload";
import { ChipContent, ChipPopup, PickerHeader, PopupHeading, UploadTile } from "./Picker";
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
import { ReferenceRoles, ReferenceSlots, referenceCellType } from "./ReferenceSlots";
import { type ReferenceBrowser, useReferenceBrowser } from "./useReferenceBrowser";

/** The Library's cards, after the gallery's tabs, with Characters. */
const cardTabs: typeof galleryTabs = [
  { value: "characters", label: "Characters" },
  { value: "outfits", label: "Outfits" },
  { value: "scenes", label: "Scenes" },
];

export function ReferencePicker({
  compact = false,
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
  compact?: boolean;
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
    if (!opened) setAdding(false);
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
  // Phones choose in a sheet over the stack.
  const [adding, setAdding] = useState(false);
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
  // An img2img start image's Strength is the profile's denoise, where the profile maps one.
  const input = selectedInput || draft.input;
  const startSlot = profile?.kind === "image" ? startImageSlot(profile) : undefined;
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
  const galleryTab = galleryTabs.some((item) => item.value === tab);
  const target = nextReferenceTarget(references, profile, chosen);
  function browse(patch: Partial<ReferenceBrowser["state"]>) {
    if (!("target" in patch)) browser.scroll.current = 0;
    browser.setState((previous) => ({ ...previous, ...patch }));
  }
  const settle = () => browse({ target: null });
  // A profile taking one reference closes the picker once it is picked, saving the dismissing click.
  const groups = referenceGroups(profile);
  const single = groups.length === 1 && slotCapacity(groups[0]) === 1;
  const capacity = groups.reduce((total, group) => total + slotCapacity(group), 0);
  // The phone's choices return to the stack once a pick fills its chosen slot or the last free one.
  const placed = (into: ReferenceTarget | null, count: number) => {
    if (into || count >= capacity) setAdding(false);
  };
  function uploadFiles(files: File[], into: ReferenceTarget | null = chosen) {
    if (!files.length) return;
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
    if (cell) {
      if (into) moveReference(cell, into);
    } else if (gallery) placement.addGalleryItem(JSON.parse(gallery), into);
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
  // Touch screens have no paste key, and iOS no paste event outside a text field: Paste reads the
  // clipboard on a tap instead.
  const touch = useTouch();
  const pasteButton = touch && canReadClipboard() && (
    <Tooltip label="Paste" disabled={!phone}>
      <Button
        {...(phone ? iconChipProps : chipProps)}
        aria-label="Paste Reference"
        disabled={!target || placement.uploading}
        leftSection={phone ? undefined : <icons.paste size={15} />}
        onClick={() =>
          void readClipboard().then(({ files }) => {
            if (files.length) uploadFiles(files);
            else notifications.show({ message: "There is no image to paste." });
          }, failure)
        }
      >
        {phone ? <icons.paste size={16} /> : "Paste"}
      </Button>
    </Tooltip>
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
  const count = (
    <Text
      span
      size="xs"
      c="dimmed"
      style={{ whiteSpace: "nowrap" }}
      aria-label={`${references.length} of ${capacity} References`}
    >
      {references.length}/{capacity}
    </Text>
  );
  // The chosen references and their roles; choosing a slot opens the choices on phones.
  const stackContent = (
    <Stack component="section" aria-label="Reference Stack" gap="sm" {...fileProps}>
      <ReferenceSlots
        references={references}
        profile={profile}
        target={target}
        onChoose={(target) => {
          browse({ target });
          if (phone) setAdding(true);
        }}
        onChange={(next) => {
          list.set(next);
          settle();
        }}
        onDrop={dropData}
      />
      <ReferenceRoles
        references={references}
        profile={profile}
        start={startSlot ? { slot: startSlot, denoise: denoise || undefined } : undefined}
        onChange={list.set}
      />
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
      gap="sm"
      // Phones fill the sheet between its header and footer; the grid owns scrolling and keeps its
      // position.
      flex={phone ? 1 : undefined}
      mih={0}
      h={phone ? undefined : "min(70dvh, 620px)"}
      {...fileProps}
    >
      {!target && galleryTab && (
        <Text size="xs" c="dimmed">
          All slots are filled. Choose a reference to replace it, or a selected image to remove it.
        </Text>
      )}
      {tab === "outfits" || tab === "scenes" ? (
        <>
          <PickerHeader
            label="References"
            searched={tab === "outfits" ? "Outfits" : "Scenes"}
            tabs={referenceTabs}
            tab={tab}
            onTabChange={(tab) => browse({ tab })}
            query={cardQuery}
            onQueryChange={setCardQuery}
          />
          <PromptCardChoices
            kind={tab}
            query={cardQuery}
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
        </>
      ) : tab === "characters" ? (
        <>
          <PickerHeader
            label="References"
            searched="Characters"
            tabs={referenceTabs}
            tab={tab}
            onTabChange={(tab) => browse({ tab })}
            query={cardQuery}
            onQueryChange={setCardQuery}
          />
          <CharacterChoices
            query={cardQuery}
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
                if (onInputChange)
                  onInputChange({ prompt: next.prompt, cardParts: next.cardParts });
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
        </>
      ) : (
        <GalleryChoices
          label="References"
          more={charactersOn ? [cardTabs] : []}
          browser={browser}
          enabled={opened}
          actions={pasteButton}
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
              disabled: !target,
              onToggle: () => {
                if (removes) list.set(list.get().filter((asset) => !matches(asset)));
                else {
                  placement.addGalleryItem(item, chosen);
                  placed(chosen, references.length + 1);
                  if (single) setOpened(false);
                }
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
  const trigger = compact ? (
    <ActionIcon
      aria-label="Choose References"
      aria-expanded={opened}
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
      rightSection={<ChevronDown size={14} />}
      onClick={() => setOpened(!opened)}
    >
      <ChipContent
        label="References"
        icon={ImagePlus}
        items={references.map((asset, index) => ({
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
  // Phones open the stack, with Add opening the choices in a sheet over it, as LoRAs do.
  if (phone)
    return (
      <ChipPopup
        title="References"
        width="100%"
        opened={opened}
        onOpenedChange={setOpened}
        trap={!layer}
        target={trigger}
        detail={count}
        {...clear}
        leading={
          <ChipPopup
            title="Add References"
            width="100%"
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
      width="min(56rem, calc(100vw - 2rem))"
      opened={opened}
      onOpenedChange={setOpened}
      trap={!layer}
      target={trigger}
      aside={stack}
      {...clear}
    >
      {choices}
    </ChipPopup>
  );
}
