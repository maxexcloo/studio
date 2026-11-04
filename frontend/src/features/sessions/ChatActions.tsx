import { useState } from "react";
import {
  ActionIcon,
  Center,
  Checkbox,
  Group,
  Image,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Video } from "lucide-react";
import { icons } from "../../ui/icons";
import { useMatch, useNavigate } from "react-router";
import { api, post } from "../../api";
import type { Session } from "../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { useGenerationActions } from "../generation/GenerationProvider";
import { mediaTitle } from "../gallery/mediaLabels";
import { mediaSource } from "../gallery/mediaSource";
import { queueQuery } from "../generation/Queue";
import { jobResults, sessionQuery, sessionsQuery } from "./queries";
import classes from "./ChatActions.module.css";

export const chatTitle = (session: Pick<Session, "title">) => session.title || "New Chat";

/** Renames a chat in place; an empty or unchanged title keeps the current one. */
export function ChatRename({ session, onDone }: { session: Session; onDone: () => void }) {
  const client = useQueryClient();
  const rename = useMutation({
    mutationFn: (title: string) =>
      api<{ session: Session }>(`/api/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    onMutate: (title) => {
      client.setQueryData(sessionsQuery.queryKey, (data) =>
        data
          ? {
              sessions: data.sessions.map((entry) =>
                entry.id === session.id ? { ...entry, title, titleSource: "user" as const } : entry,
              ),
            }
          : data,
      );
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
        client.invalidateQueries({ queryKey: sessionQuery(session.id).queryKey }),
      ]),
  });
  const [value, setValue] = useState(chatTitle(session));
  function finish(save: boolean) {
    const title = value.trim();
    if (save && title && title !== chatTitle(session)) rename.mutate(title);
    onDone();
  }
  return (
    <TextInput
      aria-label="Chat Title"
      flex={1}
      size="sm"
      maxLength={80}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          // Escape cancels the rename only, not the surrounding Drawer.
          event.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

/** Archives or unarchives chats in one request, moving them between the Chats list's views at once. */
export function useArchiveChats() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, archived }: { ids: string[]; archived: boolean }) =>
      post<{ ids: string[] }>("/api/sessions/archive", { ids, archived }),
    onMutate: ({ ids, archived }) => {
      const chosen = new Set(ids);
      // The list and any search of it.
      client.setQueriesData<{ sessions: Session[] }>(
        { queryKey: sessionsQuery.queryKey },
        (data) =>
          data && {
            sessions: data.sessions.map((entry) =>
              chosen.has(entry.id) ? { ...entry, archived: archived || undefined } : entry,
            ),
          },
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
  });
}

/** Forgets deleted chats: drafts and staged cards that pointed at them, their caches, and the open one. */
function useForgetChats() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const current = useMatch("/chat/:id")?.params.id;
  const { setDraft, setStaged } = useGenerationActions();
  return (ids: string[]) => {
    const gone = new Set(ids);
    const forget = (previous: { sessionId: string; parentJobId?: string }) =>
      gone.has(previous.sessionId)
        ? { ...previous, sessionId: "", parentJobId: undefined, parentItemId: undefined }
        : previous;
    setDraft((previous) => ({ ...previous, ...forget(previous) }), "chat");
    setDraft((previous) => ({ ...previous, ...forget(previous) }), "gallery");
    setStaged((staged) => (staged && gone.has(staged.sessionId) ? null : staged));
    if (current && gone.has(current)) void navigate("/chat", { replace: true });
    client.setQueriesData<{ sessions: Session[] }>(
      { queryKey: sessionsQuery.queryKey },
      (data) => data && { sessions: data.sessions.filter((entry) => !gone.has(entry.id)) },
    );
    for (const id of ids) {
      client.removeQueries({ queryKey: sessionQuery(id).queryKey });
      client.removeQueries({ queryKey: ["chat", id] });
    }
    for (const queryKey of [sessionsQuery.queryKey, ["gallery"], ["gallery-filters"]])
      void client.invalidateQueries({ queryKey });
    void client.invalidateQueries({ queryKey: queueQuery.queryKey });
  };
}

/**
 * Deletes several chats in one request after confirming; their results stay in the gallery.
 * `onDone` hears the IDs it could not delete (still running), which stay selected.
 */
export function DeleteChatsDialog({
  opened,
  ids,
  onClose,
  onDone,
}: {
  opened: boolean;
  ids: string[];
  onClose: () => void;
  onDone: (failed: string[]) => void;
}) {
  const forget = useForgetChats();
  const [failure, setFailure] = useState("");
  const remove = useMutation({
    meta: { inlineError: true },
    mutationFn: (chosen: string[]) =>
      post<{ removed: string[]; failed: { id: string; error: string }[] }>("/api/sessions/delete", {
        ids: chosen,
      }),
    onSuccess: ({ removed, failed }) => {
      if (removed.length) forget(removed);
      onDone(failed.map((entry) => entry.id));
      if (!failed.length) return close();
      const reasons = [...new Set(failed.map((entry) => entry.error))].join(" ");
      setFailure(
        `${failed.length} ${failed.length === 1 ? "chat" : "chats"} couldn’t be deleted. ${reasons}`,
      );
    },
  });
  function close() {
    setFailure("");
    remove.reset();
    onClose();
  }
  const count = ids.length;
  return (
    <ConfirmDialog
      opened={opened}
      title={count === 1 ? "Delete Chat" : "Delete Chats"}
      action="Delete"
      pending={remove.isPending}
      disabled={!count}
      error={remove.error?.message || failure}
      onConfirm={() => remove.mutate(ids)}
      onClose={close}
    >
      Delete {count} {count === 1 ? "chat and its messages" : "chats and their messages"}? Their
      results stay in your gallery.
    </ConfirmDialog>
  );
}

/** Rename, Archive or Unarchive, and Delete for one chat, in the Chats list and the open chat's title. */
export function ChatMenu({
  session,
  onRename,
  className,
}: {
  session: Session;
  onRename: () => void;
  className?: string;
}) {
  const [deleting, setDeleting] = useState(false);
  const archive = useArchiveChats();
  const title = chatTitle(session);
  return (
    <>
      <Menu position="bottom-end" width={180}>
        <Menu.Target>
          <ActionIcon
            className={className}
            variant="subtle"
            color="gray"
            aria-label={`Chat Options for ${title}`}
          >
            <icons.more size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item h={36} leftSection={<Pencil size={16} />} onClick={onRename}>
            Rename
          </Menu.Item>
          <Menu.Item
            h={36}
            leftSection={
              session.archived ? <icons.unarchive size={16} /> : <icons.archive size={16} />
            }
            onClick={() => archive.mutate({ ids: [session.id], archived: !session.archived })}
          >
            {session.archived ? "Unarchive" : "Archive"}
          </Menu.Item>
          <Menu.Item
            h={36}
            color="red"
            leftSection={<icons.delete size={16} />}
            onClick={() => setDeleting(true)}
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {deleting && <DeleteChatDialog session={session} onClose={() => setDeleting(false)} />}
    </>
  );
}

/** Deletes a chat; its results stay in the gallery unless ticked in the checklist. */
function DeleteChatDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const forget = useForgetChats();
  const detail = useQuery(sessionQuery(session.id));
  const results = (detail.data?.jobs || []).flatMap((job, index) =>
    jobResults(job)
      .filter((item) => item.status === "done")
      .map((item) => ({ item, iteration: index + 1 })),
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const remove = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      api<{ media: { removed: string[]; failed: { id: string }[] } }>(
        `/api/sessions/${session.id}`,
        { method: "DELETE", body: JSON.stringify({ mediaIds: [...selected] }) },
      ),
    onSuccess: ({ media }) => {
      forget([session.id]);
      if (media.failed.length)
        notifications.show({
          color: "yellow",
          title: "Some Results Were Kept",
          message: `${media.failed.length} ${media.failed.length === 1 ? "result" : "results"} couldn’t be deleted and stay in your gallery.`,
        });
      onClose();
    },
  });
  const all = results.length > 0 && selected.size === results.length;
  const count = selected.size;
  return (
    <ConfirmDialog
      opened
      title="Delete Chat"
      action={
        count ? `Delete Chat & ${count} ${count === 1 ? "Result" : "Results"}` : "Delete Chat"
      }
      pending={remove.isPending}
      disabled={detail.isPending}
      error={remove.error?.message || detail.error?.message}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    >
      <Stack gap="sm">
        <Text size="sm">
          “{chatTitle(session)}” and its messages will be deleted.
          {results.length > 0 && " Its results stay in your gallery unless you tick them below."}
        </Text>
        {detail.isPending && <Loader size="sm" color="gray" aria-label="Loading Results" />}
        {results.length > 0 && (
          <>
            <Checkbox
              label="Select All"
              checked={all}
              indeterminate={count > 0 && !all}
              onChange={() =>
                setSelected(all ? new Set() : new Set(results.map(({ item }) => item.id)))
              }
            />
            <ScrollArea.Autosize mah={280}>
              <Stack gap="xs" role="group" aria-label="Results to Delete">
                {results.map(({ item, iteration }) => {
                  const thumbnail = mediaSource(item).thumbnailUrl || item.preview;
                  return (
                    <Checkbox
                      key={item.id}
                      checked={selected.has(item.id)}
                      onChange={() =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (!next.delete(item.id)) next.add(item.id);
                          return next;
                        })
                      }
                      classNames={{ body: classes.result, labelWrapper: classes.resultLabel }}
                      label={
                        <Group gap="sm" wrap="nowrap">
                          {thumbnail ? (
                            <Image src={thumbnail} alt="" w={40} h={40} radius="sm" />
                          ) : (
                            <Center w={40} h={40} className={classes.thumbnail}>
                              <Video size={16} aria-hidden />
                            </Center>
                          )}
                          <Stack gap={0} miw={0}>
                            <Text size="sm" truncate>
                              {mediaTitle(item)}
                            </Text>
                            <Text size="xs" c="dimmed">
                              Iteration {iteration} · {item.type === "video" ? "Video" : "Image"}
                            </Text>
                          </Stack>
                        </Group>
                      }
                    />
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          </>
        )}
      </Stack>
    </ConfirmDialog>
  );
}
