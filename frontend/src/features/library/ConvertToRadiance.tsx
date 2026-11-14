import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  FocusTrap,
  Group,
  Modal,
  Progress,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { formatBytes } from "../../ui/bytes";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { profileNameParts } from "../../../../shared/profiles";
import { modelsQuery } from "../generation/GenerationProvider";
import { definitionsKey } from "./queries";

interface Conversion {
  name: string;
  status: "running" | "done" | "failed" | "stopped";
  stage: string;
  bytes: number;
  totalBytes: number;
  error: string;
  applied: boolean;
  note?: { profile?: string };
}
const stages: Record<string, string> = {
  base: "Downloading Krea 2 Parts",
  download: "Downloading Fine-Tune",
  verify: "Checking Download",
  check: "Reading Weights",
  map: "Renaming Tensors",
  convert: "Converting",
  install: "Installing",
};

export const radianceConversionQuery = queryOptions({
  queryKey: ["radiance-conversion"],
  queryFn: () => api<{ conversion: Conversion | null }>("/api/profiles/radiance"),
  refetchInterval: (query) => (query.state.data?.conversion?.status === "running" ? 2000 : false),
});

/** A model name from the profile's: "FinePorn 6 · Fast" suggests "fineporn-6-fp8". */
const suggestedName = (name: string) =>
  `${(profileNameParts(name)[0] || "fine-tune")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")}-fp8`;

/**
 * Library › Profiles › Convert to Radiance…: converts a Krea 2 profile's fine-tune to a Radiance
 * model on the worker and adds a text-only Radiance backend to the profile (profile/radiance.js).
 * The conversion carries on when the dialog closes.
 */
export function ConvertToRadiance({
  profile,
  onClose,
}: {
  profile: { id: string; name?: string } | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const state = useQuery({ ...radianceConversionQuery, enabled: Boolean(profile) });
  const conversion = state.data?.conversion;
  const running = conversion?.status === "running";
  useEffect(() => {
    if (profile) setName(suggestedName(profile.name || profile.id));
  }, [profile]);
  useEffect(() => {
    if (conversion?.applied)
      for (const queryKey of [definitionsKey, modelsQuery.queryKey])
        void client.invalidateQueries({ queryKey });
  }, [client, conversion?.applied]);
  const start = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      post<{ conversion: Conversion }>(`/api/profiles/editable/${profile!.id}/radiance`, {
        url,
        name,
      }),
    onSuccess: (data) => client.setQueryData(radianceConversionQuery.queryKey, data),
  });
  const stop = useMutation({
    mutationFn: () => post<{ conversion: Conversion }>("/api/profiles/radiance/cancel"),
    onSuccess: (data) => client.setQueryData(radianceConversionQuery.queryKey, data),
  });
  const close = () => {
    start.reset();
    setUrl("");
    onClose();
  };
  const downloading = running && conversion.stage === "download" && conversion.totalBytes;
  return (
    <Modal opened={Boolean(profile)} onClose={close} title="Convert to Radiance">
      <FocusTrap.InitialFocus />
      <Stack>
        {running ? (
          <Stack gap="xs">
            <Text size="sm">
              Converting {conversion.name}.rad for {conversion.note?.profile}. It carries on when
              this closes.
            </Text>
            <Text size="sm" c="dimmed">
              {stages[conversion.stage] || "Converting"}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Progress
                aria-label={`Converting ${conversion.name}`}
                flex={1}
                animated={!downloading}
                value={downloading ? (100 * conversion.bytes) / conversion.totalBytes : 100}
              />
              {downloading && (
                <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {formatBytes(conversion.bytes) || "0 B"} / {formatBytes(conversion.totalBytes)}
                </Text>
              )}
            </Group>
          </Stack>
        ) : (
          <>
            {conversion?.status === "done" && (
              <Alert color="green">
                {conversion.applied
                  ? `Added ${conversion.name}.rad as the Radiance backend of ${conversion.note?.profile}.`
                  : `Installed ${conversion.name}.rad.`}
              </Alert>
            )}
            {conversion?.status === "failed" && (
              <Alert color="red">
                {conversion.name}.rad failed: {conversion.error}
              </Alert>
            )}
            {conversion?.status === "stopped" && (
              <Text size="sm" c="dimmed">
                {conversion.name}.rad stopped. Converting again resumes its download.
              </Text>
            )}
            <Text size="sm">
              Radiance runs text-to-image only, so references stay on ComfyUI, which remains the
              default.
            </Text>
            <TextInput
              label="Fine-Tune Link"
              description="A Civitai or Hugging Face link to its plain fp8 or bf16 SafeTensors file"
              value={url}
              required
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            <TextInput
              label="Model Name"
              value={name}
              required
              rightSection={<Text size="sm">.rad</Text>}
              rightSectionWidth={44}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </>
        )}
        {(start.error || stop.error || state.error) && (
          <Alert color="red">{(start.error || stop.error || state.error)?.message}</Alert>
        )}
        <DialogFooter onCancel={close}>
          {running ? (
            <Button color="red" loading={stop.isPending} onClick={() => stop.mutate()}>
              Stop Conversion
            </Button>
          ) : (
            <Button
              loading={start.isPending}
              disabled={!url.trim() || !name.trim() || state.isPending}
              onClick={() => start.mutate()}
            >
              Convert
            </Button>
          )}
        </DialogFooter>
      </Stack>
    </Modal>
  );
}
