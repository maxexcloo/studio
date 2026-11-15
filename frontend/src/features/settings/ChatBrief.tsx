import { Alert, Button, MultiSelect, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  type ChatBrief as Brief,
  briefSummary,
  briefTexts,
  maxBriefList,
  maxBriefText,
} from "../../../../shared/chat-brief";
import { loraName } from "../../../../shared/profiles";
import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { SettingRow } from "../../ui/SettingRows";
import { CardDialog, CardForm } from "../characters/CardImages";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { type PreferencesStatus, preferencesQuery } from "./accountPreferences";

const labels: Record<(typeof briefTexts)[number], string> = {
  subjects: "Subjects",
  ethnicity: "Ethnicity",
  age: "Age",
  body: "Body",
  styles: "Styles",
  rules: "Banned Changes & Rules",
};

/** The brief's fields, each saved as given; an empty one clears. */
function BriefForm({ brief, close }: { brief: Brief; close: () => void }) {
  const client = useQueryClient();
  const models = useQuery(modelsQuery);
  const loras = useQuery(loraInfoQuery);
  const form = useForm({
    initialValues: {
      ...Object.fromEntries(briefTexts.map((key) => [key, brief[key] ?? ""])),
      profiles: brief.profiles ?? [],
      loras: brief.loras ?? [],
    } as Record<(typeof briefTexts)[number], string> & { profiles: string[]; loras: string[] },
  });
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      api<PreferencesStatus>("/api/preferences", {
        method: "PATCH",
        body: JSON.stringify({ chatBrief: form.values }),
      }),
    onSuccess: (status) => {
      client.setQueryData(preferencesQuery.queryKey, status);
      close();
    },
  });
  // Saved favourites stay choices even when they are no longer listed.
  const choices = (values: { value: string; label: string }[], kept: string[]) => [
    ...values,
    ...kept
      .filter((value) => !values.some((entry) => entry.value === value))
      .map((value) => ({ value, label: value })),
  ];
  return (
    <CardForm onSubmit={() => save.mutate()}>
      {briefTexts.map((key) => (
        <TextInput
          key={key}
          label={labels[key]}
          maxLength={maxBriefText}
          {...form.getInputProps(key)}
        />
      ))}
      <MultiSelect
        label="Favourite Models"
        searchable
        maxValues={maxBriefList}
        nothingFoundMessage="No Matches"
        data={choices(
          (models.data?.profiles || []).map((profile) => ({
            value: profile.id,
            label: profile.displayName || profile.label || profile.id,
          })),
          form.values.profiles,
        )}
        {...form.getInputProps("profiles")}
      />
      <MultiSelect
        label="Favourite LoRAs"
        searchable
        maxValues={maxBriefList}
        nothingFoundMessage="No Matches"
        data={choices(
          Object.entries(loras.data?.loras || {}).map(([name, info]) => ({
            value: name,
            label: loraName(name, info),
          })),
          form.values.loras,
        )}
        {...form.getInputProps("loras")}
      />
      {save.error && <Alert color="red">{save.error.message}</Alert>}
      <DialogFooter pending={save.isPending} onCancel={close}>
        <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </CardForm>
  );
}

/** Settings › Preferences › Prompts: the standing brief every chat writes its prompts to. */
export function ChatBrief() {
  const status = useQuery(preferencesQuery).data;
  const models = useQuery(modelsQuery).data;
  const [editing, setEditing] = useState(false);
  if (!status) return null;
  const brief = status.preferences.chatBrief ?? {};
  const name = (id: string) => {
    const profile = models?.profiles.find((entry) => entry.id === id);
    return profile?.displayName || profile?.label || id;
  };
  return (
    <SettingRow
      label="Chat Brief"
      description={
        briefSummary(brief, name) ||
        "Standing rules every chat keeps to, so you needn't repeat them."
      }
    >
      <Button size="compact-sm" variant="default" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <CardDialog opened={editing} onClose={() => setEditing(false)} title="Chat Brief">
        {editing && <BriefForm brief={brief} close={() => setEditing(false)} />}
      </CardDialog>
    </SettingRow>
  );
}
