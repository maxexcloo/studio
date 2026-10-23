import { useState } from "react";
import {
  Accordion,
  Badge,
  Button,
  Group,
  Image,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import type { GenerationInput, QueueJob, ReferenceAsset } from "../../types";
import { initialInput, useGeneration } from "../generation/GenerationProvider";
import { ProfilePicker } from "../generation/ProfilePicker";
import { ReferenceRoleControl } from "../generation/ReferenceRoleControl";
import { ReferencePicker } from "../generation/ReferencePicker";
import { LoraPicker } from "../generation/LoraPicker";
import { GenerationFooter } from "../generation/GenerationFooter";
import { SizePicker } from "../generation/SizePicker";
import { generationInput, referencePatch } from "../generation/payload";
import type { ChatDraft } from "../../../shared/chat";
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
  async function submit() {
    if (operation === "upscale") return;
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
                label="Variation Prompt"
                autosize
                minRows={3}
                maxRows={8}
                required
                {...form.getInputProps("prompt")}
              />
              <SizePicker
                input={form.values}
                profile={profile}
                onChange={(patch) => form.setValues(patch)}
              />
              <Accordion variant="default">
                <Accordion.Item value="settings">
                  <Accordion.Control>Variation Settings</Accordion.Control>
                  <Accordion.Panel>
                    <SimpleGrid cols={2}>
                      {(
                        [
                          ["steps", "Steps"],
                          ["cfg", "Guidance"],
                        ] as const
                      ).map(([key, label]) => (
                        <NumberInput key={key} label={label} {...form.getInputProps(key)} />
                      ))}
                      <TextInput label="Seed" {...form.getInputProps("seed")} />
                      <NumberInput label="Count" {...form.getInputProps("count")} />
                      <NumberInput label="Denoise" {...form.getInputProps("denoise")} step={0.05} />
                      {form.values.kind === "video" && (
                        <>
                          <NumberInput label="Frames" {...form.getInputProps("frames")} />
                          <NumberInput label="FPS" {...form.getInputProps("fps")} />
                        </>
                      )}
                    </SimpleGrid>
                    <Textarea label="Negative Prompt" mt="sm" {...form.getInputProps("negative")} />
                    {profile?.capabilities.lora && (
                      <LoraPicker
                        value={form.values}
                        onChange={(values) => form.setValues(values)}
                      />
                    )}
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
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
                <Button
                  type="submit"
                  size="sm"
                  loading={!!sendingSession}
                  disabled={!profile || profile.ready === false || status.data?.available === false}
                >
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
