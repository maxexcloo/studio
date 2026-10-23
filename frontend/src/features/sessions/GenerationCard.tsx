import { useLayoutEffect, useRef, useState } from "react";
import { Badge, Button, Group, Image, Paper, Stack, Text, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import type { GenerationInput, QueueJob, ReferenceAsset } from "../../types";
import { initialInput, useGeneration } from "../generation/GenerationProvider";
import { ProfilePicker } from "../generation/ProfilePicker";
import { ReferenceRoleControl } from "../generation/ReferenceRoleControl";
import { ReferencePicker } from "../generation/ReferencePicker";
import { GenerationSettingsFields } from "../generation/GenerationSettingsFields";
import { PromptHistory } from "../generation/PromptHistory";
import { GenerationFooter } from "../generation/GenerationFooter";
import { SizePicker } from "../generation/SizePicker";
import { generationInput, referencePatch } from "../generation/payload";
import type { ChatDraft } from "../../../../shared/chat";
import { useChat } from "./ChatProvider";

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
  const { profiles } = useGeneration();
  const { send, sendingSession, status } = useChat();
  const form = useForm<GenerationInput>({
    initialValues: { ...initialInput, ...snapshot } as GenerationInput,
  });
  const profile = profiles.find(
    (profile) => profile.id === form.values.profileId && profile.kind === form.values.kind,
  );
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
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" fw={600} c="dimmed">
            {editing ? "New Variation" : "Prompt"}
          </Text>
          <Badge variant="light" color={snapshot.kind === "video" ? "violet" : "gray"}>
            {operation === "upscale" ? "Upscale" : snapshot.kind === "video" ? "Video" : "Image"}
          </Badge>
        </Group>
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
              <ProfilePicker value={form.values} onChange={(values) => form.setValues(values)} />
              <Group>
                <ReferencePicker
                  opened={referenceOpen}
                  onOpenedChange={setReferenceOpen}
                  profile={profile}
                  input={form.values}
                  value={references}
                  onChange={changeReferences}
                />
                {references.map((asset) => (
                  <Image
                    key={`${asset.slot}:${asset.id}`}
                    src={asset.thumbnailUrl || asset.url}
                    alt={asset.name}
                    h={36}
                    w={36}
                    radius="sm"
                  />
                ))}
              </Group>
              {!!references.length && (
                <ReferenceRoleControl
                  value={form.values.referenceRole}
                  onChange={(referenceRole) => form.setValues({ referenceRole })}
                />
              )}
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
              <SizePicker
                input={form.values}
                profile={profile}
                onChange={(patch) => form.setValues(patch)}
              />
              <GenerationSettingsFields
                input={form.values}
                profile={profile}
                onChange={(patch) => form.setValues(patch)}
              />
              <Text size="xs" c="dimmed">
                Your changed inputs continue the conversation. The original stays here.
              </Text>
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
            <Group gap="xs">
              {references.map((asset) => (
                <Image
                  key={`${asset.slot}:${asset.id}`}
                  src={asset.thumbnailUrl || asset.url}
                  alt={asset.name || "Reference"}
                  h={40}
                  w={40}
                  radius="sm"
                />
              ))}
            </Group>
            <Group justify="space-between" align="end">
              <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                <Text size="xs" fw={500} truncate>
                  {String(
                    snapshot.profileName ||
                      snapshot.profileId ||
                      snapshot.model ||
                      "Selected Model",
                  )}
                </Text>
                <Text size="xs" c="dimmed">
                  {String(snapshot.width || "")} × {String(snapshot.height || "")}
                  {snapshot.steps ? ` · ${snapshot.steps} steps` : ""}
                  {snapshot.seed ? ` · Seed ${snapshot.seed}` : ""}
                </Text>
              </Stack>
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
