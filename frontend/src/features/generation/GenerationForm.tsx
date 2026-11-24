import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StudioSession } from "../../../../shared/queue";
import { post } from "../../api";
import type { MediaKind, Profile, QueueJob, ReferenceAsset } from "../../types";
import { CompareMenu } from "../compare/ComposerCompare";
import { useCompareRun, useDraftComparison } from "../compare/variants";
import { GenerationEditor, blockedProps, submitShortcut, useSubmitState } from "./GenerationEditor";
import {
  defaultProfile,
  draftForInput,
  draftForProfile,
  initialInput,
  inputForProfile,
  useDraft,
  useGeneration,
} from "./GenerationProvider";
import { generationInput, referencePatch } from "./payload";
import { PresetPicker } from "./PresetPicker";
import { CompactPromptFields, useDraftChange } from "./PromptFields";
import { queueQuery } from "./Queue";

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
  const { setDraft, profile, models } = useGeneration();
  const draft = useDraft(true);
  const { input } = draft;
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
    // The pending tile, or the header's queue where the gallery holds it back, is the
    // confirmation: the gallery reads its first page as soon as the queue changes.
    onSuccess: (jobId) => {
      // A default that gave way to the other side from the account's preference says so.
      const note =
        profile &&
        draft.defaultedProfileId === profile.id &&
        models.data?.defaultNotes?.[profile.kind];
      if (note) notifications.show({ message: note });
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
  onDone,
  onNegativeWritten,
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
  onDone?: () => void;
  onNegativeWritten?: () => void;
}) {
  const { setDraft, update, profile, selectProfile, models } = useGeneration();
  const draft = useDraft(true);
  const settled = useDraft();
  const { input } = draft;
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
  const submitLabel = draft.compare ? "Compare" : undefined;
  const submitState = useSubmitState({
    input,
    profile,
    references: draft.references,
    operation: draft.operation,
    blockedReason: draft.compare ? comparison.blockedReason : undefined,
  });
  const label = submitLabel ?? submitState.label;
  const { blockedReason } = submitState;
  const ask = useDraftChange({
    input,
    references: draft.references,
    operation: draft.operation,
    onChange: update,
    onOperationChange: (operation) => setDraft((value) => ({ ...value, operation })),
  });
  const assistantScope = JSON.stringify([
    input.kind,
    draft.sessionId,
    draft.parentJobId,
    draft.presetId,
    draft.operation,
  ]);
  const generate = () => {
    ask.done();
    submit.mutate(undefined);
  };
  // Clear turns into Undo, which restores the whole draft, until the draft next changes.
  const [cleared, setCleared] = useState<typeof draft | null>(null);
  const clearing = useRef(false);
  useEffect(() => {
    if (clearing.current) clearing.current = false;
    else setCleared(null);
  }, [draft]);
  // The chips keep still while the prompt is typed.
  const setReferences = useCallback(
    (references: ReferenceAsset[]) =>
      setDraft((value) => ({
        ...value,
        references,
        input: {
          ...value.input,
          ...referencePatch(value.input, value.references, references, profile),
        },
      })),
    [setDraft, profile],
  );
  const characterProfile = useCallback(
    (editor: Profile, next: Parameters<typeof draftForProfile>[2]) =>
      setDraft((previous) => draftForProfile(previous, editor, next)),
    [setDraft],
  );
  const presets = useMemo(
    () => (
      <PresetPicker
        input={settled.input}
        references={settled.references}
        profile={profile}
        selection={settled}
        onSelectionChange={(selection) => setDraft((value) => ({ ...value, ...selection }))}
        onLoad={(loaded, selection) => {
          setDraft(draftForInput(loaded, selection));
        }}
      />
    ),
    [settled, profile, setDraft],
  );
  const compareLabels = JSON.stringify(comparison.labels);
  const compare = useMemo(() => <CompareMenu labels={comparison.labels} />, [compareLabels]);
  if (compact)
    return (
      <form
        onKeyDown={(event) => submitShortcut(event, !!blockedReason || submit.isPending)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockedReason && !submit.isPending) generate();
        }}
      >
        <Group wrap="nowrap" gap="xs" align="center">
          <div className={classes.compactPrompt}>
            <CompactPromptFields
              ideas
              input={input}
              profile={profile}
              references={draft.references}
              onChange={update}
              assistantScope={assistantScope}
              ask={ask}
            />
          </div>
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
  return (
    <GenerationEditor
      input={input}
      references={draft.references}
      profile={profile}
      onChange={update}
      onReferencesChange={setReferences}
      onCharacterProfile={characterProfile}
      onKindChange={onKindChange}
      onUndoClear={cleared ? () => setDraft(cleared) : undefined}
      onClear={() => {
        clearing.current = true;
        setCleared(draft);
        // Clear returns to the account's default profile, which the draft then follows.
        setDraft((previous) => ({
          sessionId: previous.sessionId,
          operation: previous.input.kind === "video" ? "animate" : "image",
          references: [],
          defaultedProfileId: preferred?.id,
          input: {
            ...(preferred
              ? inputForProfile(initialInput, preferred)
              : { ...initialInput, kind: previous.input.kind }),
            seed: "",
          },
        }));
      }}
      onSubmit={generate}
      operation={draft.operation}
      ask={ask}
      pending={submit.isPending}
      error={submit.error}
      blockedReason={draft.compare ? comparison.blockedReason : undefined}
      submitLabel={submitLabel}
      assistantScope={assistantScope}
      presets={presets}
      compare={compare}
      autoFocusPrompt={autoFocusPrompt}
      focusPrompt={focusPrompt}
      fill={fill}
      onDone={onDone}
      onNegativeWritten={onNegativeWritten}
      ideas
    />
  );
}
