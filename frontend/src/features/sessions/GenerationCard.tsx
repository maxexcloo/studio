import { useLayoutEffect, useRef, useState } from "react";
import { Badge, Button, Group, Image, Paper, Stack, Text, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import type { GenerationInput, QueueJob, ReferenceAsset } from "../../types";
import { initialInput, useGenerationActions } from "../generation/GenerationProvider";
import { GenerationInputControls } from "../generation/GenerationInputControls";
import { ReferenceRoleControl } from "../generation/ReferenceRoleControl";
import { ReferencePicker } from "../generation/ReferencePicker";
import { GenerationSettingsFields } from "../generation/GenerationSettingsFields";
import { PromptHistory } from "../generation/PromptHistory";
import { GenerationFooter } from "../generation/GenerationFooter";
import { generationInput, referencePatch } from "../generation/payload";
import { referenceLabel } from "../generation/references";
import type { ChatDraft } from "../../../../shared/chat";
import { useChatController } from "./ChatProvider";

export function GenerationCard({
  job,
  draft,
  sessionId,
  onDismiss,
}: {
  job?: QueueJob;
  draft?: ChatDraft;
  sessionId?: string;
  onDismiss?: () => void;
}) {
  const snapshot = job?.input || draft!.input;
  const operation = job?.operation || draft!.operation;
  const [editing, setEditing] = useState(!job);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  useLayoutEffect(() => {
    if (!editing || referenceOpen) return;
    prompt.current?.focus({ preventScroll: true });
    prompt.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [editing, referenceOpen]);
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  const { profiles } = useGenerationActions();
  const { send, sendingSession, status } = useChatController();
  const form = useForm<GenerationInput>({
    initialValues: { ...initialInput, ...snapshot } as GenerationInput,
  });
  const profile = profiles.find(
    (profile) => profile.id === form.values.profileId && profile.kind === form.values.kind,
  );
  const recordedProfile = profiles.find(
    (candidate) => candidate.id === snapshot.profileId && candidate.kind === snapshot.kind,
  );
  const recordedProfileLabel = String(
    snapshot.profileName ||
      recordedProfile?.displayName ||
      recordedProfile?.label ||
      "Saved Profile",
  );
  const recordedSettings = `${snapshot.width || ""} × ${snapshot.height || ""}${snapshot.steps ? ` · ${snapshot.steps} steps` : ""}${snapshot.seed !== undefined && snapshot.seed !== "" ? ` · Seed ${snapshot.seed}` : ""}`;
  const references = Array.isArray(form.values.referenceDetails)
    ? (form.values.referenceDetails as ReferenceAsset[])
    : [];
  const canSubmit =
    operation !== "upscale" &&
    !!profile &&
    profile.ready !== false &&
    !!form.values.prompt.trim() &&
    !sendingSession &&
    !status.isPending &&
    !status.isError &&
    status.data?.available !== false;
  async function submit() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    try {
      const input = generationInput(form.getValues(), profile, references);
      const requestedOperation =
        input.kind === "video" ? "animate" : operation === "animate" ? "image" : operation;
      const sourceJobId = job?.id || draft?.parentJobId;
      const generated = await send(
        {
          content: `Generate a variation: ${input.prompt}`,
          ...(sourceJobId
            ? { revision: { sourceJobId, input, operation: requestedOperation } }
            : { generation: { input, operation: requestedOperation } }),
        },
        job?.sessionId || sessionId,
      );
      if (generated) {
        setEditing(false);
        form.reset();
        onDismiss?.();
      }
    } finally {
      submitting.current = false;
    }
  }
  const changeReferences = (next: ReferenceAsset[]) =>
    form.setValues(referencePatch(form.getValues(), references, next, profile));
  if (editing && narrow && referenceOpen)
    return (
      <Paper withBorder p="md">
        <ReferencePicker
          inline
          opened
          onOpenedChange={setReferenceOpen}
          value={references}
          onChange={changeReferences}
          profile={profile}
          input={form.values}
        />
      </Paper>
    );
  return (
    <Paper withBorder radius="lg" p="md" className="studio-generation-card">
      <Stack gap="sm">
        {editing && (
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" fw={600} c="dimmed">
              New Variation
            </Text>
            <Badge variant="light" color={snapshot.kind === "video" ? "violet" : "gray"}>
              {operation === "upscale" ? "Upscale" : snapshot.kind === "video" ? "Video" : "Image"}
            </Badge>
          </Group>
        )}
        {editing ? (
          <form
            data-generation-editor
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Stack gap="sm">
              <Textarea
                ref={prompt}
                label="Variation Prompt"
                autosize
                minRows={3}
                maxRows={8}
                required
                rightSection={
                  <PromptHistory
                    kind="positive"
                    value={form.values.prompt}
                    onPick={(prompt) => form.setFieldValue("prompt", prompt)}
                  />
                }
                rightSectionPointerEvents="all"
                {...form.getInputProps("prompt")}
              />
              <GenerationInputControls
                input={form.values}
                profile={profile}
                onChange={(patch) => form.setValues(patch)}
                references={
                  <ReferencePicker
                    opened={referenceOpen}
                    onOpenedChange={setReferenceOpen}
                    profile={profile}
                    input={form.values}
                    value={references}
                    onChange={changeReferences}
                  />
                }
              />
              {!!references.length && (
                <>
                  <Group gap="xs">
                    {references.map((asset, index) => (
                      <Image
                        key={`${asset.slot}:${asset.id}`}
                        src={asset.thumbnailUrl || asset.url}
                        alt={referenceLabel(asset, index, profile)}
                        h={36}
                        w={36}
                        radius="sm"
                      />
                    ))}
                  </Group>
                  <ReferenceRoleControl
                    value={form.values.referenceRole}
                    onChange={(referenceRole) => form.setValues({ referenceRole })}
                  />
                </>
              )}
              <GenerationSettingsFields
                input={form.values}
                profile={profile}
                onChange={(patch) => form.setValues(patch)}
              />
              <GenerationFooter
                kind={form.values.kind}
                onKindChange={(kind) => form.setValues({ kind, profileId: "" })}
                onClear={() => {
                  form.reset();
                  setEditing(false);
                  onDismiss?.();
                }}
              >
                <Button type="submit" size="sm" loading={!!sendingSession} disabled={!canSubmit}>
                  Generate Variation
                </Button>
              </GenerationFooter>
            </Stack>
          </form>
        ) : (
          <>
            <Text style={{ whiteSpace: "pre-wrap" }}>{String(snapshot.prompt || "")}</Text>
            {!!references.length && (
              <Group gap="xs">
                {references.map((asset, index) => (
                  <Image
                    key={`${asset.slot}:${asset.id}`}
                    src={asset.thumbnailUrl || asset.url}
                    alt={referenceLabel(asset, index, profile)}
                    h={40}
                    w={40}
                    radius="sm"
                  />
                ))}
              </Group>
            )}
            <Group gap="xs" wrap="nowrap">
              <Badge
                size="xs"
                variant="light"
                color={snapshot.kind === "video" ? "violet" : "gray"}
                style={{ flexShrink: 0 }}
              >
                {operation === "upscale"
                  ? "Upscale"
                  : snapshot.kind === "video"
                    ? "Video"
                    : "Image"}
              </Badge>
              <Text
                size="xs"
                c="dimmed"
                truncate
                flex={1}
                miw={0}
                title={[recordedProfileLabel, snapshot.profileId, recordedSettings]
                  .filter(Boolean)
                  .join(" · ")}
              >
                {recordedProfileLabel} · {recordedSettings}
              </Text>
              {operation !== "upscale" && (
                <Button variant="subtle" size="compact-sm" onClick={() => setEditing(true)}>
                  Edit & Rerun
                </Button>
              )}
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
