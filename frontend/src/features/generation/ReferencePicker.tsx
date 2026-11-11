import { useState } from "react";
import { ActionIcon, Button, FileButton, Image, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ChevronDown, ImagePlus } from "lucide-react";
import { icons } from "../../ui/icons";
import { failure } from "../../api";
import type { ReferenceAsset, Profile, GenerationInput } from "../../types";
import {
  controlRange,
  referenceCapacity,
  referenceDetails,
  referenceGroup,
  referenceGroups,
} from "./payload";
import { draftForProfile, useGeneration } from "./GenerationProvider";
import {
  galleryReferenceType,
  nextReferenceTarget,
  orderedReferences,
  placeReference,
  referenceKey,
  referenceLabel,
  uploadTypes,
  useReferenceList,
  useReferencePlacement,
  type ReferenceTarget,
} from "./references";
import { ReferenceRoles, ReferenceSlots, referenceCellType } from "./ReferenceSlots";
import { startImageSlot } from "../../../../shared/characters";
import { useReferenceBrowser, type ReferenceBrowser } from "./useReferenceBrowser";
import { usePhone, useTouch } from "../../ui/usePhone";
import { canReadClipboard, readClipboardImages } from "../../ui/clipboard";
import { chipProps, iconChipProps } from "./chip";
import { ChipPopup, ChipContent, PickerHeader } from "./Picker";
import { GalleryChoices, galleryTabs } from "./GalleryChoices";
import { useGroupFeature } from "../auth/AccountGate";
import { CharacterChoices } from "../characters/CharacterChoices";
import { PromptCardChoices } from "../characters/PromptCardChoices";

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
    next: { references: ReferenceAsset[]; prompt: string },
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
  // A dialog over the sheet, such as Delete Upload or a card's editor, holds its focus and clicks.
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
  const single = groups.length === 1 && referenceCapacity(groups[0]) === 1;
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
    if (cell) {
      if (into) moveReference(cell, into);
    } else if (gallery) placement.addGalleryItem(JSON.parse(gallery), into);
    else if (data.files.length) void placement.uploadFiles([...data.files], into);
    settle();
  }
  // Uploads go straight into the next slot, so this is an action rather than the gallery's menu.
  const uploadButton = (
    <FileButton accept={uploadTypes.join(",")} multiple onChange={(files) => uploadFiles(files)}>
      {(props) => (
        <Tooltip label="Upload" disabled={!phone}>
          <Button
            {...props}
            {...(phone ? iconChipProps : chipProps)}
            aria-label="Upload Reference"
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
          void readClipboardImages().then((files) => {
            if (files.length) uploadFiles(files);
            else notifications.show({ message: "There is no image to paste." });
          }, failure)
        }
      >
        {phone ? <icons.paste size={16} /> : "Paste"}
      </Button>
    </Tooltip>
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
      // Phones fill the sheet between its header and footer; the grid owns scrolling and keeps its
      // position.
      flex={phone ? 1 : undefined}
      mih={0}
      h={phone ? undefined : "min(70dvh, 620px)"}
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
      <ReferenceRoles
        references={references}
        profile={profile}
        start={startSlot ? { slot: startSlot, denoise: denoise || undefined } : undefined}
        onChange={list.set}
      />
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
            onChange={prompt.onChange}
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
            profile={profile}
            switchable={Boolean(onCharacterProfile) || (!value && !selectedProfile && !ownPrompt)}
            onChange={(next) => {
              const editor = next.profile;
              // The composer's draft moves to the character's model, its images and prompt with it.
              if (editor && onCharacterProfile) onCharacterProfile(editor, next);
              else if (editor) setDraft((previous) => draftForProfile(previous, editor, next));
              else {
                list.set(next.references);
                if (next.prompt !== prompt.value) prompt.onChange(next.prompt);
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
          actions={
            <>
              {pasteButton}
              {uploadButton}
            </>
          }
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
                  if (single) setOpened(false);
                }
                settle();
              },
            };
          }}
          onDeleted={(id) => list.set(list.get().filter((asset) => asset.galleryItemId !== id))}
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
  return (
    <>
      <ChipPopup
        title="References"
        width={560}
        opened={opened}
        onOpenedChange={setOpened}
        trap={!layer}
        target={trigger}
        headerEnd={
          <Button
            size="compact-sm"
            variant="subtle"
            aria-label="Clear References"
            disabled={!references.length}
            onClick={() => {
              list.set([]);
              settle();
            }}
          >
            Clear
          </Button>
        }
        footer={{ apply: true }}
      >
        {content}
      </ChipPopup>
    </>
  );
}
