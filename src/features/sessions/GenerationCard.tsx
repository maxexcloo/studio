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
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { failure, post } from "../../api";
import type { GenerationInput, QueueJob, ReferenceAsset } from "../../types";
import { initialInput } from "../generation/GenerationProvider";

export function GenerationCard({ job }: { job: QueueJob }) {
  const [editing, setEditing] = useState(false);
  const client = useQueryClient();
  const form = useForm<GenerationInput>({
    initialValues: { ...initialInput, ...job.input } as GenerationInput,
  });
  const references = Array.isArray(job.input.referenceDetails)
    ? (job.input.referenceDetails as ReferenceAsset[])
    : [];
  const rerun = useMutation({
    mutationFn: () =>
      post(`/api/sessions/${job.sessionId}/generations`, {
        ...job.input,
        ...form.getValues(),
        parentJobId: job.id,
        operation: job.operation === "upscale" ? "image" : job.operation,
      }),
    onSuccess: () => {
      setEditing(false);
      form.reset();
      void client.invalidateQueries({ queryKey: ["session", job.sessionId] });
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: failure,
  });
  return (
    <Paper radius="lg" p="md" className="studio-generation-card">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" fw={600} c="dimmed">
            {editing ? "NEW VARIATION" : "GENERATION INPUTS"}
          </Text>
          <Badge variant="light" color={job.input.kind === "video" ? "violet" : "gray"}>
            {job.operation === "upscale"
              ? "Upscale"
              : job.input.kind === "video"
                ? "Video"
                : "Image"}
          </Badge>
        </Group>
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              rerun.mutate();
            }}
          >
            <Stack gap="sm">
              <Textarea
                label="Variation Prompt"
                autosize
                minRows={3}
                maxRows={8}
                required
                {...form.getInputProps("prompt")}
              />
              <Accordion variant="default">
                <Accordion.Item value="settings">
                  <Accordion.Control>Variation Settings</Accordion.Control>
                  <Accordion.Panel>
                    <SimpleGrid cols={2}>
                      {(
                        [
                          ["width", "Width"],
                          ["height", "Height"],
                          ["steps", "Steps"],
                          ["cfg", "Guidance"],
                        ] as const
                      ).map(([key, label]) => (
                        <NumberInput key={key} label={label} {...form.getInputProps(key)} />
                      ))}
                      <TextInput label="Seed" {...form.getInputProps("seed")} />
                    </SimpleGrid>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <Text size="xs" c="dimmed">
                Uses this generation’s model, references and remaining settings. The original stays
                here.
              </Text>
              <Group>
                <Button type="submit" size="sm" loading={rerun.isPending}>
                  Generate Variation
                </Button>
                <Button
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => {
                    form.reset();
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          </form>
        ) : (
          <>
            <Text style={{ whiteSpace: "pre-wrap" }}>{String(job.input.prompt || "")}</Text>
            <Group gap="xs">
              {references.map((asset) => (
                <Image
                  key={asset.id}
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
                    job.input.profileName ||
                      job.input.profileId ||
                      job.input.model ||
                      "Selected Model",
                  )}
                </Text>
                <Text size="xs" c="dimmed">
                  {String(job.input.width || "")} × {String(job.input.height || "")}
                  {job.input.steps ? ` · ${job.input.steps} steps` : ""}
                  {job.input.seed ? ` · Seed ${job.input.seed}` : ""}
                </Text>
              </Stack>
              <Button variant="subtle" size="compact-sm" onClick={() => setEditing(true)}>
                Edit & Rerun
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
