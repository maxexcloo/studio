import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  AspectRatio,
  Box,
  Button,
  Group,
  Image,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useIsMutating } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import type { GenerationInput, MediaKind, Profile, ReferenceAsset } from "../../types";
import { LoadingState } from "../../ui/LoadingState";
import { defaultProfile, useGeneration } from "./GenerationProvider";
import { GenerationInputControls } from "./GenerationInputControls";
import { GenerationSettingsFields } from "./GenerationSettingsFields";
import { LoraPicker, useLoraPicker } from "./LoraPicker";
import { primaryReference, referenceDetails } from "./payload";
import { PromptAssistant } from "./PromptAssistant";
import { PromptHistory } from "./PromptHistory";
import { ReferencePicker } from "./ReferencePicker";
import { ReferenceRoleControl } from "./ReferenceRoleControl";
import { referenceLabel } from "./references";
import { useReferenceBrowser } from "./useReferenceBrowser";
const MaskEditor = lazy(() => import("./MaskEditor"));

/** The one submit label and blocked reason shared by every generation editor. */
export function useSubmitState({
  input,
  profile,
  references,
  operation,
  variation = false,
  blockedReason,
}: {
  input: GenerationInput;
  profile?: Profile;
  references: ReferenceAsset[];
  operation?: string;
  variation?: boolean;
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
  const label = variation
    ? "Generate Variation"
    : operation === "refine"
      ? "Refine Image"
      : input.kind === "video"
        ? "Generate Video"
        : "Generate Image";
  return { label, blockedReason: reason, requiredReference };
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
  variation = false,
  pending,
  blockedReason: callerReason,
  error,
  assistantScope,
  presets,
  autoFocusPrompt = false,
  focusPrompt = false,
  className,
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
  variation?: boolean;
  pending: boolean;
  blockedReason?: string;
  error?: unknown;
  assistantScope: string;
  presets?: ReactNode;
  /** Lets the surrounding focus trap start in the prompt. */
  autoFocusPrompt?: boolean;
  /** Focuses the prompt on mount and again after a phone inline picker closes. */
  focusPrompt?: boolean;
  className?: string;
}) {
  const { models, profiles } = useGeneration();
  const [maskOpen, setMaskOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const referenceBrowser = useReferenceBrowser();
  const loraPicker = useLoraPicker();
  const prompt = useRef<HTMLTextAreaElement>(null);
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  const { label, blockedReason, requiredReference } = useSubmitState({
    input,
    profile,
    references,
    operation,
    variation,
    blockedReason: callerReason,
  });
  useLayoutEffect(() => {
    if (!focusPrompt || referenceOpen || loraPicker.opened) return;
    prompt.current?.focus({ preventScroll: true });
    prompt.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [focusPrompt, referenceOpen, loraPicker.opened, models.isPending]);
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
  const inlinePanel =
    narrow && loraPicker.opened ? (
      <LoraPicker inline value={input} onChange={onChange} picker={loraPicker} />
    ) : narrow && referenceOpen ? (
      referencePicker(true)
    ) : null;
  return (
    <>
      {inlinePanel}
      <form
        data-generation-editor
        className={className}
        style={{ display: inlinePanel ? "none" : undefined }}
        onKeyDown={(event) => submitShortcut(event, !!blockedReason || pending)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockedReason && !pending) onSubmit();
        }}
      >
        <Box className="studio-generation-fields" aria-label="Generation Fields">
          <Stack gap="md" pr={4}>
            {profile?.ready === false && (
              <Alert color="yellow">
                This model needs additional files or worker nodes before it can run.
              </Alert>
            )}
            {!profile && (
              <Alert color="yellow">
                {input.profileId && profiles.length
                  ? "The selected profile is unavailable. Choose another model explicitly."
                  : "No models are available. Check your worker and mounted configuration."}
              </Alert>
            )}
            {models.error && <Alert color="red">{models.error.message}</Alert>}
            <Textarea
              ref={prompt}
              data-expanded-prompt
              variant={variation ? undefined : "unstyled"}
              rightSection={
                <PromptHistory
                  kind="positive"
                  value={input.prompt}
                  onPick={(prompt) => onChange({ prompt })}
                />
              }
              rightSectionPointerEvents="all"
              rightSectionProps={{ style: { alignItems: "flex-start", paddingTop: 8 } }}
              data-autofocus={autoFocusPrompt || undefined}
              label={variation ? "Variation Prompt" : "Prompt"}
              placeholder={
                input.kind === "image"
                  ? "Describe the image you want to create…"
                  : "Describe the motion and camera…"
              }
              autosize
              minRows={3}
              maxRows={10}
              value={input.prompt}
              onChange={(event) => onChange({ prompt: event.currentTarget.value })}
              required
            />
            <GenerationInputControls
              loraPicker={loraPicker}
              input={input}
              profile={profile}
              onChange={onChange}
              references={supportsReferences ? referencePicker(false) : undefined}
            />
            <PromptAssistant
              scopeKey={assistantScope}
              input={input}
              profile={profile}
              references={references}
              onChange={onChange}
            />
            {supportsReferences && (references.length > 0 || requiredReference) ? (
              <Stack gap="xs">
                {!!references.length && (
                  <ReferenceRoleControl
                    locked={Boolean(input.inpaint)}
                    value={input.referenceRole}
                    onChange={(referenceRole) => onChange({ referenceRole })}
                  />
                )}
                {details.map((asset, index) => (
                  <Paper withBorder key={`${asset.slot}:${asset.id}`} p="xs">
                    <Group wrap="nowrap">
                      <AspectRatio ratio={1} w={52}>
                        <Image
                          src={asset.thumbnailUrl || asset.url}
                          alt={referenceLabel(asset, index, profile)}
                          fallbackSrc=""
                        />
                      </AspectRatio>
                      <Text size="sm" lineClamp={1} flex={1}>
                        {referenceLabel(asset, index, profile)}
                      </Text>
                      <Button
                        variant="subtle"
                        size="compact-xs"
                        onClick={() =>
                          onReferencesChange(
                            details.filter((a) => a.id !== asset.id || a.slot !== asset.slot),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </Group>
                  </Paper>
                ))}
                {requiredReference && (
                  <Text size="xs" c="dimmed">
                    This workflow requires a reference image.
                  </Text>
                )}
                {primary && profile?.capabilities?.inpaint && (
                  <Group>
                    <Button variant="default" size="compact-sm" onClick={() => setMaskOpen(true)}>
                      {input.inpaint ? "Edit Mask" : "Paint Mask"}
                    </Button>
                    {!!input.inpaint && (
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        onClick={() => onChange({ inpaint: null })}
                      >
                        Remove Mask
                      </Button>
                    )}
                  </Group>
                )}
              </Stack>
            ) : null}
            <GenerationSettingsFields
              input={input}
              profile={profile}
              onChange={onChange}
              presets={presets}
            />
            {!!error && (
              <Alert color="red">{error instanceof Error ? error.message : String(error)}</Alert>
            )}
          </Stack>
        </Box>
        <Box className="studio-generation-footer">
          <Group justify="space-between" gap="xs" wrap="wrap">
            <SegmentedControl
              aria-label="Generation Output"
              size="xs"
              value={input.kind}
              onChange={(value) => {
                const kind = value as MediaKind;
                onKindChange(kind, defaultProfile(models.data, kind));
              }}
              data={[
                { value: "image", label: "Image" },
                { value: "video", label: "Video" },
              ]}
            />
            <Group gap="xs" flex={1} justify="flex-end">
              <Button variant="subtle" color="gray" size="sm" onClick={onClear}>
                Clear
              </Button>
              <Tooltip label={blockedReason} disabled={!blockedReason}>
                <Button
                  type="submit"
                  rightSection={<ArrowUp size={18} />}
                  size="sm"
                  loading={pending}
                  {...blockedProps(blockedReason)}
                >
                  {label}
                </Button>
              </Tooltip>
            </Group>
          </Group>
        </Box>
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
