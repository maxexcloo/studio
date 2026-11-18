import { Alert, Button, Group, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { type ChatBrief as Brief, briefTexts, maxBriefText } from "../../../../shared/chat-brief";
import { api } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader } from "../../ui/SectionToolbar";
import { type PreferencesStatus, preferencesQuery } from "../settings/accountPreferences";

const labels: Record<(typeof briefTexts)[number], string> = {
  subjects: "Subjects",
  ethnicity: "Ethnicity",
  age: "Age",
  body: "Body",
  styles: "Styles",
  rules: "Banned Changes & Rules",
};

/** The brief's fields, edited in place and saved as given; an empty one clears. */
function BriefForm({ brief }: { brief: Brief }) {
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
      form.resetDirty();
    },
  });
  return (
    <Stack
      component="form"
      aria-label="Brief"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {briefTexts.map((key) => (
        <TextInput
          key={key}
          label={labels[key]}
          maxLength={maxBriefText}
          {...form.getInputProps(key)}
        />
      ))}
      {save.error && <Alert color="red">{save.error.message}</Alert>}
      <Group justify="flex-end">
        <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
          Save
        </Button>
      </Group>
    </Stack>
  );
}

/** Library › Chat Brief: the standing brief every chat writes its prompts to. */
export function LibraryChatBrief({ heading }: { heading: ReactNode }) {
  const status = useQuery(preferencesQuery).data;
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>{null}</SectionHeader>
      {status ? (
        <BriefForm brief={status.preferences.chatBrief ?? {}} />
      ) : (
        <LoadingState label="Loading Chat Brief" />
      )}
    </Stack>
  );
}
