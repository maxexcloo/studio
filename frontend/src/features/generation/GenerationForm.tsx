import { useEffect } from "react";
import { ActionIcon, Avatar, Group, Text, Textarea, Tooltip } from "@mantine/core";
import { ArrowUp } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { failure, post } from "../../api";
import type { ReferenceAsset, Session } from "../../types";
import { initialInput, inputForProfile, useGeneration } from "./GenerationProvider";
import { blockedProps, GenerationEditor, submitShortcut, useSubmitState } from "./GenerationEditor";
import { PresetEditor } from "./PresetEditor";
import { generationInput, referencePatch } from "./payload";
import { referenceLabel } from "./references";

export function GenerationForm({
  onSubmitted,
  compact = false,
  autoFocusPrompt = false,
}: {
  onSubmitted?: () => void;
  compact?: boolean;
  autoFocusPrompt?: boolean;
}) {
  const { form, draft, setDraft, input, update, profile, selectProfile } = useGeneration();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!input.profileId && profile) selectProfile(profile);
  }, [input.profileId, profile]);
  const submit = useMutation({
    mutationFn: async () => {
      if (form.validate().hasErrors) throw new Error("Describe what you want to create.");
      if (!profile) throw new Error("Choose an available model first.");
      const payload = {
        ...generationInput(input, profile, draft.references),
        operation: draft.operation,
        parentJobId: draft.parentJobId,
      };
      let sessionId = draft.sessionId;
      if (!sessionId) {
        const result = await post<{ session: Session }>("/api/sessions", {
          title: input.prompt.slice(0, 80),
          inputs: payload,
        });
        sessionId = result.session.id;
        setDraft((value) => ({ ...value, sessionId }));
      }
      await post(`/api/sessions/${sessionId}/generations`, payload);
      return sessionId;
    },
    onSuccess: (sessionId) => {
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["sessions"] });
      void client.invalidateQueries({ queryKey: ["session", sessionId] });
      onSubmitted?.();
      if (!["/images", "/video"].includes(location.pathname)) navigate(`/chat/${sessionId}`);
    },
    onError: failure,
  });
  const { label, blockedReason } = useSubmitState({
    input,
    profile,
    references: draft.references,
    operation: draft.operation,
  });
  if (compact)
    return (
      <form
        onKeyDown={(event) => submitShortcut(event, !!blockedReason || submit.isPending)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blockedReason && !submit.isPending) submit.mutate();
        }}
      >
        <Group wrap="nowrap" gap="xs" className="studio-compact-composer">
          <Textarea
            data-composer-prompt
            aria-label="Prompt"
            placeholder={input.kind === "video" ? "Describe the motion…" : "Describe your image…"}
            autosize
            minRows={1}
            maxRows={1}
            variant="unstyled"
            className="studio-compact-prompt"
            value={input.prompt}
            onChange={(event) => update({ prompt: event.currentTarget.value })}
            required
          />
          {!!draft.references.length && (
            <Avatar.Group aria-label="Selected References" spacing={8}>
              {draft.references.slice(0, 3).map((asset, index) => (
                <Avatar
                  key={`${asset.slot}:${asset.id}`}
                  src={asset.thumbnailUrl || asset.url}
                  alt={referenceLabel(asset, index, profile)}
                  size={28}
                  radius="sm"
                />
              ))}
              {draft.references.length > 3 && (
                <Avatar
                  size={28}
                  radius="sm"
                  aria-label={`${draft.references.length - 3} More References`}
                >
                  +{draft.references.length - 3}
                </Avatar>
              )}
            </Avatar.Group>
          )}
          <Tooltip label={blockedReason || label}>
            <ActionIcon
              type="submit"
              aria-label={label}
              className="studio-generate-button"
              size={44}
              radius="xl"
              variant="filled"
              loading={submit.isPending}
              {...blockedProps(blockedReason)}
            >
              <ArrowUp size={20} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {!!submit.error && (
          <Text c="red" size="xs">
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
      className="studio-generation-form"
      input={input}
      references={draft.references}
      profile={profile}
      onChange={update}
      onReferencesChange={setReferences}
      onKindChange={(kind, next) => (next ? selectProfile(next) : update({ kind, profileId: "" }))}
      onClear={() =>
        setDraft((previous) => ({
          ...previous,
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
      presets={<PresetEditor />}
      autoFocusPrompt={autoFocusPrompt}
    />
  );
}
