import { Alert, Button } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChatNote } from "../../../../shared/dream";
import { api } from "../../api";
import { formatDateTime } from "../../ui/dates";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { PreviewList } from "../../ui/PreviewList";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { chatNotesQuery, projectsQuery } from "./queries";

/**
 * Settings › Taste: what chats told Studio, which Dream may draw on.
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
    <SettingGroup title="Chat Notes">
      {notes.isPending && <LoadingState label="Loading Chat Notes" />}
      {notes.data && !notes.data.notes.length && <EmptyState inline>No Chat Notes</EmptyState>}
      {notes.data?.notes.length ? (
        <PreviewList items={notes.data.notes}>
          {(items) => (
            <div>
              {items.map((note) => (
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
            </div>
          )}
        </PreviewList>
      ) : null}
      {notes.error && <Alert color="red">{notes.error.message}</Alert>}
    </SettingGroup>
  );
}
