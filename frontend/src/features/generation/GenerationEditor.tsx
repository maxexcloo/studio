import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Group,
  SegmentedControl,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useIsMutating } from "@tanstack/react-query";
import { ArrowUp, Image as ImageIcon, Video } from "lucide-react";
import { icons } from "../../ui/icons";
import type { GenerationInput, MediaKind, Profile, ReferenceAsset } from "../../types";
import { LoadingState } from "../../ui/LoadingState";
import { defaultProfile, useGeneration, type Draft } from "./GenerationProvider";
import { GenerationInputControls } from "./GenerationInputControls";
import { useLoraPicker } from "./LoraPicker";
import { primaryReference, referenceDetails, usesNegative } from "./payload";
import { usePromptIdeas } from "./PromptIdeas";
import { PromptFields, useDraftChange } from "./PromptFields";
import { ReferencePicker } from "./ReferencePicker";
import { useReferenceBrowser } from "./useReferenceBrowser";
import { usePhone } from "../../ui/usePhone";
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
  profile,
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
  const requiredReference = profile?.mediaInputs?.some(
    (slot) =>
      slot.required &&
      !referenceDetails(references, input, profile).some((asset) => asset.slot === slot.id) &&
      !input.referenceAssets.some((asset) => asset.slot === slot.id),
  );
  // A combined profile is ready when the backend this run uses is, whatever its current one is.
  const backend = profile?.backendOptions?.find(
    (option) => option.id === (input.profileBackend || profile.backend),
  );
  return !profile
    ? "Choose an available profile first."
    : (backend ? backend.ready === false : profile.ready === false)
      ? backend?.reason
        ? `${backend.label} isn’t ready: ${backend.reason}`
        : "This model isn’t ready."
      : !input.prompt.trim()
        ? "Describe what you want to create."
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
  profile,
  onChange,
  onReferencesChange,
  onKindChange,
  onClear,
  onSubmit: submitDraft,
  operation,
  onOperationChange,
  pending,
  blockedReason: callerReason,
  error,
  assistantScope,
  presets,
  onCompare,
  autoFocusPrompt = false,
  focusPrompt = false,
  fill = false,
  ideas: offerIdeas = false,
}: {
  input: GenerationInput;
  references: ReferenceAsset[];
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  onReferencesChange: (references: ReferenceAsset[]) => void;
  /** Receives the profile the gallery would choose for that output, if any. */
  onKindChange: (kind: MediaKind, profile?: Profile) => void;
  onClear: () => void;
  onSubmit: () => void;
  operation?: Draft["operation"];
  /** Sends Improve Prompt › Custom… as a change to the draft, whose Edit or fresh run sets the operation. */
  onOperationChange?: (operation: Draft["operation"]) => void;
  pending: boolean;
  blockedReason?: string;
  error?: unknown;
  assistantScope: string;
  /** The Presets chip (`PresetPicker`). */
  presets?: ReactNode;
  onCompare?: () => void;
  /** Lets the surrounding focus trap start in the prompt. */
  autoFocusPrompt?: boolean;
  /** Focuses the prompt on mount. */
  focusPrompt?: boolean;
  /**
   * Fills the phone Generate sheet without scrolling: the prompt takes the room above a bottom bar
   * of the wrapping chips and actions, and a text box being edited takes it alone.
   */
  fill?: boolean;
  /** Offers taste-led prompt ideas as a Suggestions chip while the prompt is empty. */
  ideas?: boolean;
}) {
  const { models, profiles } = useGeneration();
  const [maskOpen, setMaskOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const referenceBrowser = useReferenceBrowser();
  const loraPicker = useLoraPicker();
  const prompt = useRef<HTMLTextAreaElement>(null);
  const phone = usePhone();
  const { label, blockedReason } = useSubmitState({
    input,
    profile,
    references,
    operation,
    blockedReason: callerReason,
  });
  const ask = useDraftChange({
    input,
    references,
    operation: operation ?? "image",
    onChange,
    onOperationChange: (next) => onOperationChange?.(next),
  });
  // Generate runs a proposed change, which ends its review.
  const onSubmit = () => {
    ask.done();
    submitDraft();
  };
  const ideas = usePromptIdeas({
    kind: input.kind,
    empty: !input.prompt.trim(),
    onPick: (prompt) => onChange({ prompt }),
  });
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
  if (models.isPending) return <LoadingState label="Loading Profiles" />;
  const details = referenceDetails(references, input, profile);
  const primary = primaryReference(details, profile);
  const supportsReferences = Boolean(
    profile?.mediaInputs?.length ||
    profile?.capabilities?.img2img ||
    profile?.capabilities?.imageInput,
  );
  const inpaint = input.inpaint as
    | { assetId?: string; mask?: string; strength?: number; feather?: number }
    | undefined;
  const referencePicker = (
    <ReferencePicker
      opened={referenceOpen}
      browser={referenceBrowser}
      onOpenedChange={setReferenceOpen}
      profile={profile}
      input={input}
      value={references}
      onChange={onReferencesChange}
      prompt={{ value: String(input.prompt || ""), onChange: (prompt) => onChange({ prompt }) }}
    />
  );
  const settings = { opened: settingsOpen, onOpenedChange: setSettingsOpen };
  const mask = profile?.capabilities?.inpaint
    ? {
        painted: !!input.inpaint,
        // Paint Mask stays in place, disabled until there is a first reference to paint on.
        disabled: !primary,
        onPaint: () => setMaskOpen(true),
        onRemove: () => onChange({ inpaint: null }),
      }
    : undefined;
  const inputs = (
    <GenerationInputControls
      loraPicker={loraPicker}
      input={input}
      profile={profile}
      onChange={onChange}
      references={supportsReferences ? referencePicker : undefined}
      hasReferences={!!details.length}
      mask={mask}
      presets={presets}
      ideas={offerIdeas && ideas.chip}
      settings={settings}
      onCompare={onCompare}
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
          {models.error && <Alert color="red">{models.error.message}</Alert>}
          <PromptFields
            textareaRef={prompt}
            input={input}
            profile={profile}
            references={references}
            onChange={onChange}
            assistantScope={assistantScope}
            negative={usesNegative(profile)}
            autoFocus={autoFocusPrompt}
            fill={fill}
            ideaFocus={offerIdeas ? ideas.focusProps : undefined}
            ask={onOperationChange && ask}
          />
          {!fill && inputs}
          {!!error && (
            <Alert color="red">{error instanceof Error ? error.message : String(error)}</Alert>
          )}
        </div>
        <div className={classes.footer}>
          {fill && inputs}
          <Group justify="space-between" gap="xs">
            <SegmentedControl
              aria-label="Generation Output"
              size={phone ? "md" : "sm"}
              radius="xl"
              style={{ flexShrink: 0 }}
              value={input.kind}
              onChange={(value) => {
                const kind = value as MediaKind;
                onKindChange(kind, defaultProfile(models.data, kind));
              }}
              // Phones show the mode tabs' icons so the actions fit one row.
              data={[
                { value: "image", label: "Image", icon: ImageIcon },
                { value: "video", label: "Video", icon: Video },
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
            <Group gap="xs" wrap="nowrap" flex={phone ? "1 0 auto" : undefined} justify="flex-end">
              {phone ? (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={44}
                  aria-label="Clear"
                  onClick={onClear}
                >
                  <icons.clear size={18} />
                </ActionIcon>
              ) : (
                <Button variant="subtle" color="gray" size="sm" onClick={onClear}>
                  Clear
                </Button>
              )}
              <Tooltip
                label={blockedReason}
                disabled={!blockedReason}
                events={{ hover: true, focus: true, touch: true }}
              >
                <Button
                  type="submit"
                  radius="xl"
                  rightSection={phone ? undefined : <ArrowUp size={18} />}
                  size={phone ? "md" : "sm"}
                  flex={phone ? 1 : undefined}
                  loading={pending}
                  {...blockedProps(blockedReason)}
                >
                  {label}
                </Button>
              </Tooltip>
            </Group>
          </Group>
        </div>
        {maskOpen && primary && (
          <Suspense fallback={null}>
            <MaskEditor
              key={primary.id}
              asset={primary}
              initialMask={
                !inpaint?.assetId || inpaint.assetId === primary.id ? inpaint?.mask : undefined
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
