import { Alert, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { GenerationInput } from "../../types";
import { initialInput, useGeneration } from "./GenerationProvider";
import { generationInput } from "./payload";
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
    meta: { inlineError: true },
    mutationFn: (existing: boolean) =>
      api<{ preset: Preset }>(
        existing ? `/api/user-presets/${draft.presetId}` : "/api/user-presets",
        {
          method: existing ? "PATCH" : "POST",
          body: JSON.stringify({
            title: draft.presetTitle,
            input: generationInput(input, profile, draft.references),
          }),
        },
      ),
    onSuccess: ({ preset }) => {
      setDraft((value) => ({ ...value, presetId: preset.id, presetTitle: preset.title }));
      void client.invalidateQueries({ queryKey: ["user-presets"] });
      notifications.show({ message: "Preset saved" });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/user-presets/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      if (id === draft.presetId)
        setDraft((value) => ({ ...value, presetId: undefined, presetTitle: "" }));
      void client.invalidateQueries({ queryKey: ["user-presets"] });
    },
  });
  function savePreset(existing: boolean) {
    if (save.isPending || !draft.presetTitle?.trim()) return;
    save.mutate(existing);
  }
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
                sessionId: "",
                parentJobId: undefined,
                operation: preset.input.kind === "video" ? "animate" : "image",
                input: { ...initialInput, ...preset.input },
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
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.metaKey ||
            event.ctrlKey ||
            event.nativeEvent.isComposing
          )
            return;
          event.preventDefault();
          savePreset(Boolean(draft.presetId));
        }}
        onChange={(event) => {
          const presetTitle = event.currentTarget.value;
          setDraft((value) => ({ ...value, presetTitle }));
        }}
      />
      {save.error && <Alert color="red">{save.error.message}</Alert>}
      <Group>
        {draft.presetId && (
          <Button
            disabled={!draft.presetTitle?.trim()}
            loading={save.isPending}
            onClick={() => savePreset(true)}
          >
            Update Preset
          </Button>
        )}
        <Button
          variant="default"
          disabled={!draft.presetTitle?.trim()}
          loading={save.isPending}
          onClick={() => savePreset(false)}
        >
          {draft.presetId ? "Save as New Preset" : "Save Preset"}
        </Button>
      </Group>
    </Stack>
  );
}
