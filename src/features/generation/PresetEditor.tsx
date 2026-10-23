import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, failure } from "../../api";
import type { GenerationInput } from "../../types";
import { useGeneration } from "./GenerationProvider";
interface Preset {
  id: string;
  title: string;
  input: GenerationInput;
}
export function PresetEditor() {
  const { draft, input, profile, setDraft } = useGeneration(),
    client = useQueryClient();
  const presets = useQuery({
    queryKey: ["user-presets"],
    queryFn: () => api<{ presets: Preset[] }>("/api/user-presets"),
  });
  const save = useMutation({
    mutationFn: (existing: boolean) =>
      api<{ preset: Preset }>(
        existing ? `/api/user-presets/${draft.presetId}` : "/api/user-presets",
        {
          method: existing ? "PATCH" : "POST",
          body: JSON.stringify({
            title: draft.presetTitle,
            input: {
              ...input,
              profileId: profile?.id || input.profileId,
              referenceAssets: draft.references.length
                ? draft.references.map((asset, index) => ({
                    assetId: asset.id,
                    slot: profile?.mediaInputs?.[index]?.id || "image",
                  }))
                : input.referenceAssets,
              referenceDetails: draft.references,
            },
          }),
        },
      ),
    onSuccess: ({ preset }) => {
      setDraft((value) => ({ ...value, presetId: preset.id, presetTitle: preset.title }));
      void client.invalidateQueries({ queryKey: ["user-presets"] });
      notifications.show({ message: "Preset saved" });
    },
    onError: failure,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/user-presets/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      if (id === draft.presetId)
        setDraft((value) => ({ ...value, presetId: undefined, presetTitle: "" }));
      void client.invalidateQueries({ queryKey: ["user-presets"] });
    },
    onError: failure,
  });
  return (
    <Stack>
      {presets.data?.presets.map((preset) => (
        <Group key={preset.id} justify="space-between">
          <Button
            variant={preset.id === draft.presetId ? "light" : "subtle"}
            onClick={() =>
              setDraft((value) => ({
                ...value,
                presetId: preset.id,
                presetTitle: preset.title,
                input: { ...value.input, ...preset.input },
                references: Array.isArray(preset.input.referenceDetails)
                  ? preset.input.referenceDetails
                  : [],
              }))
            }
          >
            {preset.title}
          </Button>
          <Button
            color="red"
            variant="subtle"
            size="compact-xs"
            onClick={() => remove.mutate(preset.id)}
          >
            Delete
          </Button>
        </Group>
      ))}
      {presets.error && (
        <Text c="red" size="xs">
          {presets.error.message}
        </Text>
      )}
      <TextInput
        label="Preset Name"
        value={draft.presetTitle || ""}
        onChange={(event) => {
          const presetTitle = event.currentTarget.value;
          setDraft((value) => ({ ...value, presetTitle }));
        }}
      />
      <Group>
        {draft.presetId && (
          <Button
            disabled={!draft.presetTitle?.trim()}
            loading={save.isPending}
            onClick={() => save.mutate(true)}
          >
            Update Preset
          </Button>
        )}
        <Button
          variant="default"
          disabled={!draft.presetTitle?.trim()}
          loading={save.isPending}
          onClick={() => save.mutate(false)}
        >
          {draft.presetId ? "Save as New Preset" : "Save Preset"}
        </Button>
      </Group>
    </Stack>
  );
}
