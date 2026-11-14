import { useEffect, useRef, useState } from "react";
import { ActionIcon, Group, Text, Textarea, Tooltip } from "@mantine/core";
import { ArrowUp } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import { usePhone } from "../../ui/usePhone";
import type { StudioSession } from "../../../../shared/queue";
import type { MediaKind, QueueJob, ReferenceAsset } from "../../types";
import {
  defaultProfile,
  draftForProfile,
  initialInput,
  inputForProfile,
  useGeneration,
} from "./GenerationProvider";
import { blockedProps, GenerationEditor, submitShortcut, useSubmitState } from "./GenerationEditor";
import { PresetPicker } from "./PresetPicker";
import { queueQuery } from "./Queue";
import { showQueued } from "../settings/accountPreferences";
import { generationInput, profileForBackend, referencePatch } from "./payload";
import { ReferencePicker } from "./ReferencePicker";
import { CompareMenu, VariantStrip } from "../compare/ComposerCompare";
import { useCompareRun, useDraftComparison } from "../compare/variants";
import classes from "./ComposerDock.module.css";

/**
 * Queues the composer's draft. `prompt` runs a prompt the draft hasn't caught up with yet (a
 * viewer next step). Forms show the error inline; elsewhere (`inlineError` false) it is the default notification.
 */
function useDraftSubmit({
  onSubmitted,
  inlineError = true,
}: {
  onSubmitted?: (jobId: string) => void;
  inlineError?: boolean;
}) {
  const { draft, setDraft, input, profile, models } = useGeneration();
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError },
    mutationFn: async (staged?: { prompt: string }) => {
      if (!profile) throw new Error("Choose an available model first.");
      const payload = {
        ...generationInput({ ...input, ...staged }, profile, draft.references),
        operation: draft.operation,
        parentJobId: draft.parentJobId,
        parentItemId: draft.parentItemId,
      };
      let sessionId = draft.sessionId;
      if (!sessionId) {
        const result = await post<{ session: StudioSession }>("/api/sessions");
        sessionId = result.session.id;
        setDraft((value) => ({ ...value, sessionId }));
      }
      const { jobId, job } = await post<{ jobId: string; job?: QueueJob }>(
        `/api/sessions/${sessionId}/generations`,
        payload,
      );
      // The viewer's strip shows the new run at once; polling then follows its progress.
      if (job)
        client.setQueryData(queueQuery.queryKey, (queue) =>
          queue ? { ...queue, jobs: [...queue.jobs, job] } : queue,
        );
      return jobId;
    },
    // The pending tile, or the notice where the gallery holds it back, is the confirmation: refresh
    // the gallery now instead of waiting for its poll.
    onSuccess: (jobId) => {
      // A default that gave way to the other side from the account's preference says so.
      showQueued(
        client,
        (profile &&
          draft.defaultedProfileId === profile.id &&
          models.data?.defaultNotes?.[profile.kind]) ||
          undefined,
      );
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: queueQuery.queryKey });
      onSubmitted?.(jobId);
    },
  });
}

export function GenerationForm({
  onSubmitted,
  onKindChange,
  onCompared,
  compact = false,
  autoFocusPrompt = false,
  focusPrompt = false,
  fill = false,
}: {
  onSubmitted?: (jobId: string) => void;
  /** Switches the gallery to the other output. */
  onKindChange: (kind: MediaKind) => void;
  /** Shows a comparison the draft's variants queued. */
  onCompared: (comparisonId: string) => void;
  compact?: boolean;
  autoFocusPrompt?: boolean;
  focusPrompt?: boolean;
  fill?: boolean;
}) {
  const { draft, setDraft, input, update, profile, selectProfile, models } = useGeneration();
  const phone = usePhone();
  // A draft without a picked profile runs on the account's default, following it as it changes.
  const preferred = defaultProfile(models.data, input.kind);
  const defaulted = !input.profileId || draft.defaultedProfileId === input.profileId;
  useEffect(() => {
    if (defaulted && preferred && preferred.id !== input.profileId) selectProfile(preferred, true);
  }, [defaulted, preferred, input.profileId]);
  // A draft with variants queues them as one comparison instead.
  const comparison = useDraftComparison();
  const compareRun = useCompareRun((comparisonId) => {
    onSubmitted?.("");
    onCompared(comparisonId);
  });
  const single = useDraftSubmit({ onSubmitted });
  const submit = draft.compare ? compareRun : single;
  const submitLabel = draft.compare ? `Compare ${comparison.variants.length}` : undefined;
  const submitState = useSubmitState({
    input,
    profile,
    references: draft.references,
    operation: draft.operation,
    blockedReason: draft.compare ? comparison.blockedReason : undefined,
  });
  const label = submitLabel ?? submitState.label;
  const { blockedReason } = submitState;
  const referenceProfile = profileForBackend(profile, input.profileBackend, true);
  const supportsReferences = Boolean(
    referenceProfile?.mediaInputs?.length ||
    referenceProfile?.capabilities?.img2img ||
    referenceProfile?.capabilities?.imageInput,
  );
  // Clear turns into Undo, which restores the whole draft, until the draft next changes.
  const [cleared, setCleared] = useState<typeof draft | null>(null);
  const clearing = useRef(false);
  useEffect(() => {
    if (clearing.current) clearing.current = false;
    else setCleared(null);
  }, [draft]);
  if (compact)
    return (
      <form
        onKeyDown={(event) => submitShortcut(event, !!blockedReason || submit.isPending)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockedReason && !submit.isPending) submit.mutate(undefined);
        }}
      >
        {/* Bottom aligned, so the actions stay at the bottom as the prompt grows. */}
        <Group wrap="nowrap" gap="xs" align="flex-end">
          <Textarea
            data-composer-prompt
            aria-label="Prompt"
            placeholder={
              input.kind === "video" ? "Describe the motion and camera" : "Describe the image"
            }
            autosize
            minRows={1}
            maxRows={1}
            // One line that scrolls sideways: a wrapped second line would show through the padding.
            wrap="off"
            variant="unstyled"
            className={classes.compactPrompt}
            // A phone tap opens the Generate sheet, so the bar never raises the keyboard.
            inputMode={phone ? "none" : undefined}
            value={input.prompt}
            onChange={(event) => update({ prompt: event.currentTarget.value })}
          />
          {/* Shown while profiles load so Submit doesn't move when they arrive. */}
          {(models.isPending || supportsReferences) && <ReferencePicker compact />}
          <Tooltip label={blockedReason || label}>
            <ActionIcon
              type="submit"
              aria-label={label}
              size={44}
              variant="filled"
              loading={submit.isPending}
              {...blockedProps(blockedReason)}
            >
              <ArrowUp size={20} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {!!submit.error && (
          <Text c="red" size="xs" px="sm">
            {submit.error instanceof Error ? submit.error.message : String(submit.error)}
          </Text>
        )}
      </form>
    );
  const setReferences = (references: ReferenceAsset[]) =>
    setDraft((value) => ({
      ...value,
      references,
      input: {
        ...value.input,
        ...referencePatch(value.input, value.references, references, profile),
      },
    }));
  return (
    <GenerationEditor
      input={input}
      references={draft.references}
      profile={profile}
      onChange={update}
      onReferencesChange={setReferences}
      onCharacterProfile={(editor, next) =>
        setDraft((previous) => draftForProfile(previous, editor, next))
      }
      onKindChange={onKindChange}
      onUndoClear={cleared ? () => setDraft(cleared) : undefined}
      onClear={() => {
        clearing.current = true;
        setCleared(draft);
        setDraft((previous) => ({
          sessionId: previous.sessionId,
          operation: previous.input.kind === "video" ? "animate" : "image",
          references: [],
          defaultedProfileId: previous.defaultedProfileId,
          input: {
            ...(profile
              ? inputForProfile(initialInput, profile)
              : { ...initialInput, kind: previous.input.kind }),
            seed: "",
          },
        }));
      }}
      onSubmit={() => submit.mutate(undefined)}
      operation={draft.operation}
      onOperationChange={(operation) => setDraft((value) => ({ ...value, operation }))}
      pending={submit.isPending}
      error={submit.error}
      blockedReason={draft.compare ? comparison.blockedReason : undefined}
      submitLabel={submitLabel}
      assistantScope={JSON.stringify([
        input.kind,
        draft.sessionId,
        draft.parentJobId,
        draft.presetId,
        draft.operation,
      ])}
      presets={
        <PresetPicker
          input={input}
          references={draft.references}
          profile={profile}
          selection={draft}
          onSelectionChange={(selection) => setDraft((value) => ({ ...value, ...selection }))}
          onLoad={(loaded, selection) => {
            setDraft((value) => ({
              ...value,
              presetId: selection.presetId,
              presetTitle: selection.presetTitle,
              sessionId: "",
              parentJobId: undefined,
              parentItemId: undefined,
              operation: loaded.kind === "video" ? "animate" : "image",
              input: { ...initialInput, ...loaded },
              references: Array.isArray(loaded.referenceDetails) ? loaded.referenceDetails : [],
            }));
          }}
        />
      }
      compare={<CompareMenu />}
      variants={draft.compare && <VariantStrip />}
      autoFocusPrompt={autoFocusPrompt}
      focusPrompt={focusPrompt}
      fill={fill}
      ideas
    />
  );
}
