import { useEffect } from "react";
import { ActionIcon, Group, Text, Textarea, Tooltip } from "@mantine/core";
import { ArrowUp } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { post } from "../../api";
import type { ReferenceAsset, Session } from "../../types";
import { initialInput, inputForProfile, useGeneration } from "./GenerationProvider";
import { blockedProps, GenerationEditor, submitShortcut, useSubmitState } from "./GenerationEditor";
import { PresetEditor } from "./PresetEditor";
import { queueQuery } from "./Queue";
import { generationInput, referencePatch } from "./payload";
import { ReferencePicker } from "./ReferencePicker";
import { useCompare } from "../compare/CompareDialog";
import classes from "./ComposerDock.module.css";

export function GenerationForm({
  onSubmitted,
  compact = false,
  autoFocusPrompt = false,
  fill = false,
}: {
  onSubmitted?: () => void;
  compact?: boolean;
  autoFocusPrompt?: boolean;
  fill?: boolean;
}) {
  const { draft, setDraft, input, update, profile, selectProfile } = useGeneration();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const compare = useCompare();
  useEffect(() => {
    if (!input.profileId && profile) selectProfile(profile);
  }, [input.profileId, profile]);
  const submit = useMutation({
    meta: { inlineError: true },
    mutationFn: async () => {
      if (!profile) throw new Error("Choose an available model first.");
      const payload = {
        ...generationInput(input, profile, draft.references),
        operation: draft.operation,
        parentJobId: draft.parentJobId,
      };
      let sessionId = draft.sessionId;
      if (!sessionId) {
        const result = await post<{ session: Session }>("/api/sessions", { inputs: payload });
        sessionId = result.session.id;
        setDraft((value) => ({ ...value, sessionId }));
      }
      await post(`/api/sessions/${sessionId}/generations`, payload);
      return sessionId;
    },
    // The pending tile is the confirmation: refresh the gallery now instead of waiting for its poll.
    onSuccess: (sessionId) => {
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: queueQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["sessions"] });
      void client.invalidateQueries({ queryKey: ["session", sessionId] });
      onSubmitted?.();
      if (!["/images", "/video"].includes(location.pathname)) navigate(`/chat/${sessionId}`);
    },
  });
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
          {supportsReferences && <ReferencePicker compact />}
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
      presets={(close) => <PresetEditor onLoad={close} />}
      onCompare={() =>
        compare.open({
          input,
          references: draft.references,
          sessionId: draft.sessionId || undefined,
        })
      }
      autoFocusPrompt={autoFocusPrompt}
      fill={fill}
    />
  );
}
