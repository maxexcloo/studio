import { Alert, Button, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import {
  type ChatBrief as Brief,
  briefSummary,
  briefTexts,
  maxBriefText,
} from "../../../../shared/chat-brief";
import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { SectionHeader } from "../../ui/SectionToolbar";
import { SettingRow } from "../../ui/SettingRows";
import { CardDialog, CardForm } from "../characters/CardImages";
import { type PreferencesStatus, preferencesQuery } from "../settings/accountPreferences";

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
  const form = useForm({
    initialValues: Object.fromEntries(briefTexts.map((key) => [key, brief[key] ?? ""])) as Record<
      (typeof briefTexts)[number],
      string
    >,
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
      {save.error && <Alert color="red">{save.error.message}</Alert>}
      <DialogFooter pending={save.isPending} onCancel={close}>
        <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </CardForm>
  );
}

/** Library › Chat Brief: the standing brief every chat writes its prompts to. */
export function LibraryChatBrief({ heading }: { heading: ReactNode }) {
  const status = useQuery(preferencesQuery).data;
  const [editing, setEditing] = useState(false);
  if (!status) return <SectionHeader heading={heading}>{null}</SectionHeader>;
  const brief = status.preferences.chatBrief ?? {};
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>{null}</SectionHeader>
      <SettingRow
        label="Brief"
        description={
          briefSummary(brief) || "Standing rules every chat keeps to, so you needn't repeat them."
        }
      >
        <Button size="compact-sm" variant="default" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <CardDialog opened={editing} onClose={() => setEditing(false)} title="Chat Brief">
          {editing && <BriefForm brief={brief} close={() => setEditing(false)} />}
        </CardDialog>
      </SettingRow>
    </Stack>
  );
}
