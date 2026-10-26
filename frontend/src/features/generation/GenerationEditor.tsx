import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Group,
  SegmentedControl,
  Stack,
  Textarea,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useIsMutating } from "@tanstack/react-query";
import { ArrowUp, Brush, Image as ImageIcon, RotateCcw, Video, X } from "lucide-react";
import type { GenerationInput, MediaKind, Profile, ReferenceAsset } from "../../types";
import { LoadingState } from "../../ui/LoadingState";
import { defaultProfile, useGeneration } from "./GenerationProvider";
import { GenerationInputControls } from "./GenerationInputControls";
import { ExpertSettings } from "./ExpertSettings";
import { chipProps } from "./chip";
import { LoraPicker, useLoraPicker } from "./LoraPicker";
import { primaryReference, referenceDetails } from "./payload";
import { usePromptAssistant } from "./PromptAssistant";
import { usePromptIdeas } from "./PromptIdeas";
import { PromptHistory } from "./PromptHistory";
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
  const requiredReference = profile?.mediaInputs?.some(
    (slot) =>
      slot.required &&
      !referenceDetails(references, input, profile).some((asset) => asset.slot === slot.id) &&
      !input.referenceAssets.some((asset) => asset.slot === slot.id),
  );
  const reason =
    blockedReason ||
    (!profile
      ? "Choose an available profile first."
      : profile.ready === false
        ? "This model is not ready to run."
        : !input.prompt.trim()
          ? "Describe what you want to create."
          : requiredReference
            ? "This workflow requires a reference image."
            : uploading
              ? "Wait for the reference upload to finish."
              : assisting
                ? "Wait for the prompt assistant to finish."
                : undefined);
  const label =
    operation === "refine"
      ? "Refine Image"
      : input.kind === "video"
        ? "Generate Video"
        : "Generate Image";
  return { label, blockedReason: reason };
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
  onSubmit,
  operation,
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
  operation?: string;
  pending: boolean;
  blockedReason?: string;
  error?: unknown;
  assistantScope: string;
  /** The Presets popover's content; `close` dismisses it after a preset loads. */
  presets?: (close: () => void) => ReactNode;
  onCompare?: () => void;
  /** Lets the surrounding focus trap start in the prompt. */
  autoFocusPrompt?: boolean;
  /** Focuses the prompt on mount and again after a phone inline picker closes. */
  focusPrompt?: boolean;
  /** Fills a phone Drawer that owns scrolling, keeping the actions at its safe bottom. */
  fill?: boolean;
  /** Offers taste-led prompt ideas while the prompt is empty and focused. */
  ideas?: boolean;
}) {
  const { models, profiles } = useGeneration();
  const [maskOpen, setMaskOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [expertOpen, setExpertOpen] = useState(false);
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
  const assistant = usePromptAssistant({
    scopeKey: assistantScope,
    input,
    profile,
    references,
    onChange,
  });
  const ideas = usePromptIdeas({
    kind: input.kind,
    empty: !input.prompt.trim(),
    onPick: (prompt) => onChange({ prompt }),
    className: classes.promptIdeas,
    stacked: fill,
  });
  const inlineOpen = phone && (referenceOpen || loraPicker.opened || expertOpen);
  const placedCaret = useRef(false);
  useLayoutEffect(() => {
    const element = prompt.current;
    if (!focusPrompt || inlineOpen || !element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest", behavior: "instant" });
    // Typing begun in the collapsed prompt carries on at the end.
    if (!placedCaret.current) element.setSelectionRange(element.value.length, element.value.length);
    placedCaret.current = true;
  }, [focusPrompt, inlineOpen, models.isPending]);
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
  const referencePicker = (inline: boolean) => (
    <ReferencePicker
      inline={inline}
      embedded={!inline}
      opened={inline || referenceOpen}
      browser={referenceBrowser}
      onOpenedChange={setReferenceOpen}
      profile={profile}
      input={input}
      value={references}
      onChange={onReferencesChange}
    />
  );
  const expert = {
    opened: expertOpen,
    onOpenedChange: setExpertOpen,
    hasReferences: !!details.length,
  };
  const inlinePanel = !phone ? null : loraPicker.opened ? (
    <LoraPicker inline value={input} onChange={onChange} picker={loraPicker} />
  ) : referenceOpen ? (
    referencePicker(true)
  ) : expertOpen ? (
    <ExpertSettings inline input={input} profile={profile} onChange={onChange} {...expert} />
  ) : null;
  const mask = primary && profile?.capabilities?.inpaint && (
    <Button.Group>
      <Button {...chipProps} leftSection={<Brush size={15} />} onClick={() => setMaskOpen(true)}>
        {input.inpaint ? "Edit Mask" : "Paint Mask"}
      </Button>
      {!!input.inpaint && (
        <Button
          {...chipProps}
          px="xs"
          aria-label="Remove Mask"
          onClick={() => onChange({ inpaint: null })}
        >
          <X size={14} />
        </Button>
      )}
    </Button.Group>
  );
  return (
    <>
      {inlinePanel}
      <form
        data-generation-editor
        data-fill={fill || undefined}
        className={classes.editor}
        style={{ display: inlinePanel ? "none" : undefined }}
        onKeyDown={(event) => submitShortcut(event, !!blockedReason || pending)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockedReason && !pending) onSubmit();
        }}
      >
        <div className={classes.fields} aria-label="Generation Fields">
          {!profile && (
            <Alert color="yellow">
              {input.profileId && profiles.length
                ? "The selected profile is unavailable. Choose another model explicitly."
                : "No models are available. Check your worker and mounted configuration."}
            </Alert>
          )}
          {models.error && <Alert color="red">{models.error.message}</Alert>}
          <div className={classes.promptArea} {...(offerIdeas ? ideas.focusProps : {})}>
            <Textarea
              ref={prompt}
              data-expanded-prompt
              classNames={{
                root: classes.prompt,
                wrapper: classes.promptWrapper,
                input: classes.promptInput,
              }}
              variant="unstyled"
              aria-label="Prompt"
              data-autofocus={autoFocusPrompt || undefined}
              placeholder={
                input.kind === "image"
                  ? "Describe the image you want to create…"
                  : "Describe the motion and camera…"
              }
              // The phone editor gives the prompt all the room above the chips.
              autosize={!fill}
              minRows={3}
              maxRows={10}
              rightSection={
                <Stack gap={4}>
                  <PromptHistory
                    kind="positive"
                    value={input.prompt}
                    onPick={(prompt) => onChange({ prompt })}
                  />
                  {assistant.action}
                </Stack>
              }
              rightSectionWidth={40}
              rightSectionPointerEvents="all"
              rightSectionProps={{ style: { alignItems: "flex-start" } }}
              value={input.prompt}
              onChange={(event) => onChange({ prompt: event.currentTarget.value })}
            />
            {offerIdeas && ideas.ideas}
          </div>
          {assistant.suggestions}
          <GenerationInputControls
            loraPicker={loraPicker}
            input={input}
            profile={profile}
            onChange={onChange}
            references={supportsReferences ? referencePicker(false) : undefined}
            mask={mask}
            presets={presets}
            expert={expert}
            onCompare={onCompare}
          />
          {!!error && (
            <Alert color="red">{error instanceof Error ? error.message : String(error)}</Alert>
          )}
        </div>
        <div className={classes.footer} data-sticky={fill || undefined}>
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
                  <RotateCcw size={18} />
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
