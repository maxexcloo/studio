import { Alert, Button, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChatNote } from "../../../../shared/dream";
import { api } from "../../api";
import { formatDateTime } from "../../ui/dates";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { ChatChoices } from "./ChatChoices";
import { chatNotesQuery, projectsQuery } from "./queries";

/**
 * Dream › Taste: what chats told Studio, which Dream may draw on, each with Delete, then what each
 * chat remembers.
 */
export function ChatNotes() {
  const client = useQueryClient();
  const notes = useQuery(chatNotesQuery);
  const projects = useQuery(projectsQuery);
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<{ notes: ChatNote[] }>(`/api/dream/notes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: (next) => client.setQueryData(chatNotesQuery.queryKey, next),
  });
  const projectName = (id?: string) =>
    projects.data?.projects.find((project) => project.id === id)?.name;
  return (
    <>
      <SettingGroup title="Chat Notes">
        {notes.isPending && <LoadingState label="Loading Chat Notes" />}
        {notes.data && !notes.data.notes.length && (
          <Text size="xs" c="dimmed">
            Nothing yet. What chats tell Studio about your work shows here for Dream to draw on.
          </Text>
        )}
        {notes.data?.notes.map((note) => (
          <SettingRow
            key={note.id}
            label={<span style={{ overflowWrap: "anywhere" }}>{note.text}</span>}
            description={[formatDateTime(note.at), projectName(note.project)]
              .filter(Boolean)
              .join(" · ")}
          >
            <Button
              size="compact-sm"
              color="red"
              variant="light"
              loading={remove.isPending && remove.variables === note.id}
              onClick={() => remove.mutate(note.id)}
            >
              Delete
            </Button>
          </SettingRow>
        ))}
        {notes.error && <Alert color="red">{notes.error.message}</Alert>}
      </SettingGroup>
      <ChatChoices />
    </>
  );
}
