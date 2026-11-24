import {
  Alert,
  Button,
  Center,
  Group,
  SegmentedControl,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useIsMutating } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { type ReactNode, Suspense, lazy, useLayoutEffect, useMemo, useRef, useState } from "react";

import { maxLoras, slotCapacity } from "../../../../shared/profiles";
import type { GenerationInput, MediaKind, Profile, ReferenceAsset } from "../../types";
import { ClearButton } from "../../ui/ClearButton";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { TextToolsBar } from "../../ui/TextBox";
import { useFailureBanner } from "../../ui/useFailureBanner";
import { usePhone } from "../../ui/usePhone";
import { GenerationInputControls } from "./GenerationInputControls";
import { type Draft, defaultProfile, useDraft, useGeneration } from "./GenerationProvider";
import { useLoraPicker } from "./LoraPicker";
import {
  primaryReference,
  profileForBackend,
  referenceDetails,
  runReferenceSlots,
  splitReferenceSlots,
  usesNegative,
} from "./payload";
import { type DraftChange, PromptFields, useGenerationPromptAssistant } from "./PromptFields";
import { ReferencePicker } from "./ReferencePicker";
import { useReferenceBrowser } from "./useReferenceBrowser";

import textClasses from "../../ui/TextBox.module.css";
import classes from "./GenerationEditor.module.css";
const MaskEditor = lazy(() => import("./MaskEditor"));

/** The one submit label and blocked reason shared by every generation editor. */
export function useSubmitState({
  input,
  profile,
  references,
  operation,
  blockedReason,
}: {
  input: GenerationInput;
  profile?: Profile;
  references: ReferenceAsset[];
  operation?: string;
  blockedReason?: string;
}) {
  const uploading = useIsMutating({ mutationKey: ["reference-upload"] }) > 0;
  const assisting = useIsMutating({ mutationKey: ["prompt-assistance"] }) > 0;
  const many = (input.count || 1) > 1;
  const label =
    operation === "refine"
      ? "Edit Image"
      : `Generate ${input.kind === "video" ? "Video" : "Image"}${many ? "s" : ""}`;
  return {
    label,
    blockedReason:
      blockedReason || submitBlockedReason({ input, profile, references, uploading, assisting }),
  };
}

/** Why a run can't be submitted yet, if it can't; Compare checks each variant with it. */
export function submitBlockedReason({
  input,
  profile: listedProfile,
  references,
  uploading,
  assisting,
}: {
  input: GenerationInput;
  profile?: Profile;
  references: ReferenceAsset[];
  uploading: boolean;
  assisting: boolean;
}) {
  const referenceCount = references.length || input.referenceAssets.length;
  const profile = profileForBackend(
    listedProfile,
    input.profileBackend,
    referenceCount > 0,
    input.loras.some((lora) => lora.enabled),
  );
  const slots = runReferenceSlots(profile);
  const supplied = references.length
    ? referenceDetails(references, input, profile)
    : input.referenceAssets;
  const referenceMaximum = slotCapacity(slots);
  const { placed, unused } = splitReferenceSlots<{ slot?: string }>(supplied, slots);
  const loraMaximum = profile?.maxLoras ?? maxLoras;
  const requiredReference = slots.some(
    (slot) => slot.required && !placed.some((asset) => asset.slot === slot.id),
  );
  // A combined profile is ready when the backend this run uses is, whatever its current one is.
  const backend = profile?.backendOptions?.find(
    (option) => option.id === (input.profileBackend || profile.backend),
  );
  return !profile
    ? "Choose an available profile first."
    : (backend ? backend.ready === false : profile.ready === false)
      ? backend?.reason
        ? `${backend.label} isn't ready: ${backend.reason}`
        : "This model isn't ready."
      : !input.prompt.trim()
        ? "Describe what you want to create."
        : referenceCount > referenceMaximum
          ? `This backend takes at most ${referenceMaximum} reference images. Choose another backend or remove references.`
          : unused.length
            ? "Some references don't fit this backend's slots. Remove them or choose another backend."
            : input.loras.filter((lora) => lora.enabled !== false).length > loraMaximum
              ? `This backend takes at most ${loraMaximum} enabled LoRAs. Disable or remove LoRAs, or choose another backend.`
              : requiredReference
                ? "Add a reference image."
                : uploading
                  ? "Wait for the reference upload to finish."
                  : assisting
                    ? "Wait for the prompt assistant to finish."
                    : undefined;
}

/** Keeps a blocked Generate focusable so its tooltip and description still explain why. */
export function blockedProps(reason: string | undefined) {
  return {
    "data-disabled": reason ? true : undefined,
    "aria-disabled": reason ? true : undefined,
    "aria-description": reason,
    onClick: (event: React.MouseEvent) => {
      if (reason) event.preventDefault();
    },
  };
}

/** Cmd/Ctrl+Enter submits unless blocked, without triggering native validation bubbles. */
export function submitShortcut(event: React.KeyboardEvent<HTMLFormElement>, blocked: boolean) {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing)
    return;
  event.preventDefault();
  if (!blocked) event.currentTarget.requestSubmit();
}

export function GenerationEditor({
  input,
  references,
  profile: listedProfile,
  onChange,
  onReferencesChange,
  onCharacterProfile,
  onKindChange,
  onClear,
  onUndoClear,
  onSubmit,
  operation,
  ask,
  pending,
  blockedReason: callerReason,
  error,
  assistantScope,
  presets,
  compare,
  submitLabel,
  autoFocusPrompt = false,
  focusPrompt = false,
  fill = false,
  onDone,
  onNegativeWritten,
  ideas: offerIdeas = false,
}: {
  input: GenerationInput;
  references: ReferenceAsset[];
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  onReferencesChange: (references: ReferenceAsset[]) => void;
  /** The composer's: a picked character moves the draft to a model that keeps faces. */
  onCharacterProfile?: (
    profile: Profile,
    next: {
      references: ReferenceAsset[];
      prompt: string;
      cardParts?: GenerationInput["cardParts"];
    },
  ) => void;
  /** Receives the profile the gallery would choose for that output, if any. */
  onKindChange: (kind: MediaKind, profile?: Profile) => void;
  onClear: () => void;
  /** Restores the draft Clear replaced; Clear shows as Undo while it is set. */
  onUndoClear?: () => void;
  onSubmit: () => void;
  operation?: Draft["operation"];
  ask: DraftChange;
  pending: boolean;
  blockedReason?: string;
  error?: unknown;
  assistantScope: string;
  /** The Presets chip (`PresetPicker`). */
  presets?: ReactNode;
  /** The gallery composer's Compare ▾, in the generation controls. */
  compare?: ReactNode;
  /** Names the submit in place of Generate, as a comparison's does. */
  submitLabel?: string;
  /** Lets the surrounding focus trap start in the prompt. */
  autoFocusPrompt?: boolean;
  /** Focuses the prompt on mount. */
  focusPrompt?: boolean;
  /**
   * Fills the phone Generate sheet without scrolling: the prompt takes the room above a bottom bar
   * of the chips, one row that scrolls sideways, and actions, and a text box being edited takes it alone.
   */
  fill?: boolean;
  /** Done in the filled sheet: leaves the text box being edited, keeping focus in the sheet. */
  onDone?: () => void;
  onNegativeWritten?: () => void;
  /** Offers taste-led prompt ideas in the prompt's AI menu while the prompt is empty. */
  ideas?: boolean;
}) {
  const anyReferences = Boolean(references.length || input.referenceAssets.length);
  const profile = useMemo(
    () => profileForBackend(listedProfile, input.profileBackend, anyReferences),
    [listedProfile, input.profileBackend, anyReferences],
  );
  const { models, profiles } = useGeneration();
  useFailureBanner(models.error);
  // The chips take the draft as typing leaves it, so they keep still while the prompt changes.
  const settled = useDraft().input;
  const [maskOpen, setMaskOpen] = useState(false);
  const lastMask = useRef<{ assetId?: string; mask?: string }>(undefined);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsBar, setToolsBar] = useState<HTMLDivElement | null>(null);
  const referenceBrowser = useReferenceBrowser();
  const loraPicker = useLoraPicker();
  const prompt = useRef<HTMLTextAreaElement>(null);
  const phone = usePhone();
  const assistant = useGenerationPromptAssistant({
    input,
    profile,
    references,
    onChange,
    onNegativeWritten,
    scopeKey: assistantScope,
    ask,
  });
  const submitState = useSubmitState({
    input,
    profile,
    references,
    operation,
    blockedReason: callerReason,
  });
  const label = submitLabel ?? submitState.label;
  const { blockedReason } = submitState;
  const placedCaret = useRef(false);
  useLayoutEffect(() => {
    const element = prompt.current;
    if (!focusPrompt || !element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest", behavior: "instant" });
    // Typing begun in the collapsed prompt carries on at the end.
    if (!placedCaret.current) element.setSelectionRange(element.value.length, element.value.length);
    placedCaret.current = true;
  }, [focusPrompt, models.isPending]);
  const details = referenceDetails(references, input, profile);
  const primary = primaryReference(details, profile);
  const referenceProfile = profileForBackend(listedProfile, input.profileBackend, true);
  const supportsReferences = runReferenceSlots(referenceProfile).length > 0;
  const inpaint = input.inpaint as
    | { assetId?: string; mask?: string; strength?: number; feather?: number }
    | undefined;
  const referencePicker = useMemo(
    () => (
      <ReferencePicker
        opened={referenceOpen}
        browser={referenceBrowser}
        onOpenedChange={setReferenceOpen}
        profile={profile}
        input={settled}
        onInputChange={onChange}
        value={references}
        onChange={onReferencesChange}
        onCharacterProfile={onCharacterProfile}
      />
    ),
    [
      referenceOpen,
      referenceBrowser,
      profile,
      settled,
      onChange,
      references,
      onReferencesChange,
      onCharacterProfile,
    ],
  );
  const settings = useMemo(
    () => ({ opened: settingsOpen, onOpenedChange: setSettingsOpen }),
    [settingsOpen],
  );
  const inpaints = !!profile?.capabilities?.inpaint;
  const painted = !!input.inpaint;
  const paintable = !!primary;
  const mask = useMemo(
    () =>
      inpaints
        ? {
            painted,
            painting: maskOpen,
            // Paint stays in place, disabled until there is a first reference to paint on.
            disabled: !paintable,
            onPaint: () => setMaskOpen(true),
          }
        : undefined,
    [inpaints, painted, maskOpen, paintable],
  );
  if (models.isPending) return <LoadingState label="Loading Profiles" />;
  // Choosing Edit or Reference drops the mask; Paint on the same image brings it back to edit.
  if (inpaint?.mask) lastMask.current = inpaint;
  const editing = inpaint ?? lastMask.current;
  const inputs = (
    <GenerationInputControls
      loraPicker={loraPicker}
      loraSuggestions={assistant.loraSuggestions}
      input={settled}
      profile={profile}
      onChange={onChange}
      references={supportsReferences || details.length ? referencePicker : undefined}
      hasReferences={!!details.length}
      mask={mask}
      presets={presets}
      compare={input.kind === "image" ? compare : undefined}
      settings={settings}
    />
  );
  return (
    <>
      <form
        data-generation-editor
        data-fill={fill || undefined}
        className={classes.editor}
        onKeyDown={(event) => submitShortcut(event, !!blockedReason || pending)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockedReason && !pending) onSubmit();
        }}
      >
        <div className={classes.fields} data-generation-fields aria-label="Generation Fields">
          {!profile && (
            <Alert color="yellow">
              {input.profileId && profiles.length
                ? "The selected profile is unavailable. Choose another."
                : "No models are available. Check the workers."}
            </Alert>
          )}
          <TextToolsBar.Provider value={fill ? toolsBar : null}>
            <PromptFields
              textareaRef={prompt}
              input={input}
              references={references}
              onChange={onChange}
              assistant={assistant}
              negative={usesNegative(profile)}
              autoFocus={autoFocusPrompt}
              fill={fill}
              ideas={offerIdeas}
              ask={ask}
            />
          </TextToolsBar.Provider>
          {!fill && inputs}
          {!!error && (
            <Alert color="red">{error instanceof Error ? error.message : String(error)}</Alert>
          )}
        </div>
        <div className={fill ? `${classes.footer} ${textClasses.footerSurface}` : classes.footer}>
          {fill && inputs}
          <Group
            role="group"
            aria-label="Generation Actions"
            justify="space-between"
            gap="xs"
            wrap="nowrap"
          >
            {/* A text box being edited puts its tools here, with Done, in place of the output and Clear. */}
            {fill && <div ref={setToolsBar} className={classes.textTools} />}
            <SegmentedControl
              className={classes.resting}
              aria-label="Generation Output"
              radius="xl"
              style={{ flexShrink: 0 }}
              value={input.kind}
              onChange={(value) => {
                const kind = value as MediaKind;
                onKindChange(kind, defaultProfile(models.data, kind));
              }}
              // Phones show the mode tabs' icons so the actions fit one row.
              data={[
                { value: "image", label: "Image", icon: icons.image },
                { value: "video", label: "Video", icon: icons.video },
              ].map(({ value, label, icon: Icon }) => ({
                value,
                label: phone ? (
                  <Center>
                    <Icon size={18} aria-hidden />
                    <VisuallyHidden>{label}</VisuallyHidden>
                  </Center>
                ) : (
                  label
                ),
              }))}
            />
            <Group className={classes.actions} gap="xs" wrap="nowrap" miw={0} justify="flex-end">
              <ClearButton className={classes.resting} onClear={onClear} onUndo={onUndoClear} />
              <Tooltip
                label={blockedReason}
                disabled={!blockedReason}
                events={{ hover: true, focus: true, touch: false }}
              >
                <Button
                  className={fill ? classes.resting : undefined}
                  type="submit"
                  radius="xl"
                  rightSection={phone ? undefined : <ArrowUp size={18} />}
                  flex={phone ? 1 : undefined}
                  loading={pending}
                  {...blockedProps(blockedReason)}
                >
                  {label}
                </Button>
              </Tooltip>
              {fill && (
                <Button
                  className={classes.typing}
                  radius="xl"
                  // The text keeps focus until the press ends, so the bar keeps Done under it.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onDone}
                >
                  Done
                </Button>
              )}
            </Group>
          </Group>
        </div>
        {maskOpen && primary && (
          <Suspense fallback={null}>
            <MaskEditor
              key={primary.id}
              asset={primary}
              initialMask={
                !editing?.assetId || editing.assetId === primary.id ? editing?.mask : undefined
              }
              close={() => setMaskOpen(false)}
              save={(mask) =>
                onChange({
                  inpaint: {
                    ...inpaint,
                    mask,
                    assetId: primary.id,
                    strength: inpaint?.strength ?? 1,
                    feather: inpaint?.feather ?? 0.4,
                  },
                })
              }
            />
          </Suspense>
        )}
      </form>
    </>
  );
}
