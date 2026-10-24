import { useRef, useState } from "react";
import { Badge, Button, Group, Image, Paper, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import type { GenerationInput, QueueJob, ReferenceAsset } from "../../types";
import {
  initialInput,
  inputForProfile,
  useGenerationActions,
} from "../generation/GenerationProvider";
import { GenerationEditor } from "../generation/GenerationEditor";
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
  const submitting = useRef(false);
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
  const chatUnavailable =
    status.isPending || status.isError || status.data?.available === false
      ? "Chat is unavailable."
      : undefined;
  async function submit() {
    if (submitting.current || operation === "upscale") return;
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
  return (
    <Paper withBorder radius="lg" p="md" className="studio-generation-card">
      <Stack gap="sm">
        {editing ? (
          <GenerationEditor
            input={form.values}
            references={references}
            profile={profile}
            onChange={(patch) => form.setValues(patch)}
            onReferencesChange={changeReferences}
            onKindChange={(kind, next) =>
              form.setValues(
                next ? inputForProfile(form.getValues(), next) : { kind, profileId: "" },
              )
            }
            onClear={() => {
              form.reset();
              setEditing(false);
              onDismiss?.();
            }}
            onSubmit={() => void submit()}
            variation
            pending={!!sendingSession}
            blockedReason={chatUnavailable}
            assistantScope={job?.id || draft?.parentJobId || ""}
            focusPrompt
          />
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
