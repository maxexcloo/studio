import { useEffect } from "react";
import { ActionIcon, Group, Text, Textarea, Tooltip } from "@mantine/core";
import { ArrowUp } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { post } from "../../api";
import type { QueueJob, ReferenceAsset, Session } from "../../types";
import { initialInput, inputForProfile, useGeneration } from "./GenerationProvider";
import { blockedProps, GenerationEditor, submitShortcut, useSubmitState } from "./GenerationEditor";
import { PresetPicker } from "./PresetPicker";
import { queueQuery } from "./Queue";
import { generationInput, referencePatch } from "./payload";
import { ReferencePicker } from "./ReferencePicker";
import { useCompare } from "../compare/CompareDialog";
import classes from "./ComposerDock.module.css";

/**
 * Queues the composer's draft. `prompt` runs a prompt the draft hasn't caught up with yet (a
 * viewer next step); an `embedded` composer stays on its surface rather than opening the Chat.
 * Forms show the error inline; elsewhere (`inlineError` false) it is the default notification.
 */
export function useDraftSubmit({
  onSubmitted,
  embedded = false,
  inlineError = true,
}: {
  onSubmitted?: (jobId: string) => void;
  embedded?: boolean;
  inlineError?: boolean;
}) {
  const { draft, setDraft, input, profile } = useGeneration();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
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
        const result = await post<{ session: Session }>("/api/sessions", { inputs: payload });
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
          queue ? { jobs: [...queue.jobs, job] } : queue,
        );
      return { sessionId, jobId };
    },
    // The pending tile is the confirmation: refresh the gallery now instead of waiting for its poll.
    onSuccess: ({ sessionId, jobId }) => {
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: queueQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["sessions"] });
      void client.invalidateQueries({ queryKey: ["session", sessionId] });
      onSubmitted?.(jobId);
      if (!embedded && !["/images", "/video"].includes(location.pathname))
        navigate(`/chat/${sessionId}`);
    },
  });
}

export function GenerationForm({
  onSubmitted,
  compact = false,
  autoFocusPrompt = false,
  focusPrompt = false,
  editPrompt = false,
  fill = false,
}: {
  onSubmitted?: (jobId: string) => void;
  compact?: boolean;
  autoFocusPrompt?: boolean;
  focusPrompt?: boolean;
  editPrompt?: boolean;
  fill?: boolean;
}) {
  const { draft, setDraft, input, update, profile, selectProfile, models } = useGeneration();
  const navigate = useNavigate();
  const location = useLocation();
  const compare = useCompare();
  useEffect(() => {
    if (!input.profileId && profile) selectProfile(profile);
  }, [input.profileId, profile]);
  const submit = useDraftSubmit({ onSubmitted });
  const { label, blockedReason } = useSubmitState({
    input,
    profile,
    references: draft.references,
    operation: draft.operation,
  });
  const supportsReferences = Boolean(
    profile?.mediaInputs?.length ||
    profile?.capabilities?.img2img ||
    profile?.capabilities?.imageInput,
  );
  if (compact)
    return (
      <form
        onKeyDown={(event) => submitShortcut(event, !!blockedReason || submit.isPending)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockedReason && !submit.isPending) submit.mutate();
        }}
      >
        <Group wrap="nowrap" gap="xs">
          <Textarea
            data-composer-prompt
            aria-label="Prompt"
            placeholder={input.kind === "video" ? "Describe the motion…" : "Describe your image…"}
            autosize
            minRows={1}
            maxRows={1}
            variant="unstyled"
            className={classes.compactPrompt}
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
      // The output toggle switches the gallery; the route restores that output's draft.
      onKindChange={(kind) =>
        navigate({ pathname: kind === "video" ? "/video" : "/images", search: location.search })
      }
      onClear={() =>
        setDraft((previous) => ({
          sessionId: previous.sessionId,
          operation: previous.input.kind === "video" ? "animate" : "image",
          references: [],
          input: {
            ...(profile
              ? inputForProfile({ ...initialInput, backendId: previous.input.backendId }, profile)
              : { ...initialInput, kind: previous.input.kind }),
            seed: "",
          },
        }))
      }
      onSubmit={() => submit.mutate()}
      operation={draft.operation}
      pending={submit.isPending}
      error={submit.error}
      assistantScope={JSON.stringify([
        input.kind,
        draft.sessionId,
        draft.parentJobId,
        draft.presetId,
        draft.operation,
      ])}
      presets={(close) => (
        <PresetPicker
          input={input}
          references={draft.references}
          profile={profile}
          selection={draft}
          onSelectionChange={(selection) => setDraft((value) => ({ ...value, ...selection }))}
          onLoad={(preset) => {
            setDraft((value) => ({
              ...value,
              presetId: preset.id,
              presetTitle: preset.title,
              sessionId: "",
              parentJobId: undefined,
              parentItemId: undefined,
              operation: preset.input.kind === "video" ? "animate" : "image",
              input: { ...initialInput, ...preset.input },
              references: Array.isArray(preset.input.referenceDetails)
                ? preset.input.referenceDetails
                : [],
            }));
            close();
          }}
        />
      )}
      onCompare={() =>
        compare.open({
          input,
          references: draft.references,
          sessionId: draft.sessionId || undefined,
        })
      }
      autoFocusPrompt={autoFocusPrompt}
      focusPrompt={focusPrompt}
      editPrompt={editPrompt}
      fill={fill}
      ideas
    />
  );
}
