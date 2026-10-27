import { useState } from "react";
import { Alert, Checkbox, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { LoadingState } from "../../ui/LoadingState";
import { backendLabel } from "../generation/payload";

interface Member {
  id: string;
  name: string;
}
interface Pair {
  key: string;
  id: string;
  name: string;
  radiance: Member;
  comfyui: Member;
  differences: { label: string; radiance: string; comfyui: string }[];
}
interface BackendPreview {
  hash: string;
  pairs: Pair[];
}
interface Choice {
  name: string;
  backend: string;
}
export const backendCandidatesQuery = queryOptions({
  queryKey: ["profile-backends"],
  queryFn: () => api<BackendPreview>("/api/profiles/backends"),
});

/** One candidate pair: whether it is picked, the combined name and default backend, and what differs. */
function PairRow({
  pair,
  choice,
  blocked,
  onChange,
}: {
  pair: Pair;
  choice?: Choice;
  blocked: boolean;
  onChange: (choice?: Choice) => void;
}) {
  return (
    <Stack gap={6}>
      <Checkbox
        label={pair.name}
        description={`${pair.radiance.id} and ${pair.comfyui.id} become ${pair.id}`}
        checked={Boolean(choice)}
        disabled={blocked && !choice}
        onChange={(event) =>
          onChange(
            event.currentTarget.checked ? { name: pair.name, backend: "comfyui" } : undefined,
          )
        }
        styles={{ description: { overflowWrap: "anywhere" } }}
      />
      {choice && (
        <Group grow align="flex-start" gap="xs">
          <TextInput
            label="Combined Name"
            value={choice.name}
            required
            onChange={(event) => onChange({ ...choice, name: event.currentTarget.value })}
          />
          <Select
            label="Default Backend"
            data={["comfyui", "radiance"].map((value) => ({ value, label: backendLabel(value) }))}
            value={choice.backend}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
            onChange={(value) => value && onChange({ ...choice, backend: value })}
          />
        </Group>
      )}
      {pair.differences.length ? (
        <DataTable
          label={`Differences for ${pair.name}`}
          rows={pair.differences}
          rowKey={(row) => row.label}
          rowName={(row) => row.label}
          empty="No Differences"
          columns={[
            { key: "label", header: "Differs", cell: (row) => row.label },
            { key: "radiance", header: "Radiance", cell: (row) => row.radiance },
            { key: "comfyui", header: "ComfyUI", cell: (row) => row.comfyui },
          ]}
        />
      ) : (
        <Text size="xs" c="dimmed">
          Same steps, size, references, modes, LoRAs and guide.
        </Text>
      )}
    </Stack>
  );
}

/**
 * Settings › Profiles › Combine Backends: previews a model's Radiance and ComfyUI profiles, then
 * makes each picked pair one profile with both backends, keeping the old ids as aliases that run
 * on their own backend (profile-backends.js).
 */
export function CombineBackends({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const preview = useQuery({ ...backendCandidatesQuery, enabled: opened, staleTime: 0 });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const combine = useMutation({
    meta: { inlineError: true },
    mutationFn: (hash: string) =>
      post<{ combined: { id: string; name: string }[]; backup: string }>(
        "/api/profiles/backends/combine",
        {
          hash,
          selections: preview
            .data!.pairs.filter((pair) => choices[pair.key])
            .map((pair) => ({
              radiance: pair.radiance.id,
              comfyui: pair.comfyui.id,
              ...choices[pair.key],
            })),
        },
      ),
    onSuccess: () => {
      setChoices({});
      return Promise.all(
        [["profile-backends"], ["profile-duplicates"], ["definition-list"], ["models"]].map(
          (queryKey) => client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
  const pairs = preview.data?.pairs || [];
  const picked = pairs.filter((pair) => choices[pair.key]);
  const members = new Set(picked.flatMap((pair) => [pair.radiance.id, pair.comfyui.id]));
  const count = picked.length;
  const unnamed = picked.some((pair) => !choices[pair.key].name.trim());
  return (
    <ConfirmDialog
      opened={opened}
      title="Combine Backends"
      action={count ? `Combine ${count} ${count === 1 ? "Pair" : "Pairs"}` : "Combine Pairs"}
      pending={combine.isPending}
      disabled={!count || unnamed}
      error={combine.error?.message || preview.error?.message}
      onConfirm={() => preview.data && combine.mutate(preview.data.hash)}
      onClose={() => {
        combine.reset();
        setChoices({});
        onClose();
      }}
    >
      {preview.isPending ? (
        <LoadingState label="Finding Backend Pairs" />
      ) : (
        <Stack gap="md">
          {combine.data && (
            <Alert color="green">
              Combined {combine.data.combined.map((item) => item.name).join(", ")}. The old
              definitions are kept in {combine.data.backup}.
            </Alert>
          )}
          {pairs.length ? (
            <>
              <Text size="sm">
                Each picked pair becomes one profile that runs on its default backend; switch it in
                the profile. The old ids stay as aliases, so their results rerun on the backend they
                ran on.
              </Text>
              {pairs.map((pair) => (
                <PairRow
                  key={pair.key}
                  pair={pair}
                  choice={choices[pair.key]}
                  blocked={members.has(pair.radiance.id) || members.has(pair.comfyui.id)}
                  onChange={(choice) =>
                    setChoices((current) => {
                      const { [pair.key]: _previous, ...rest } = current;
                      return choice ? { ...rest, [pair.key]: choice } : rest;
                    })
                  }
                />
              ))}
            </>
          ) : (
            !combine.data && <Text size="sm">No Radiance and ComfyUI profiles to combine.</Text>
          )}
        </Stack>
      )}
    </ConfirmDialog>
  );
}
