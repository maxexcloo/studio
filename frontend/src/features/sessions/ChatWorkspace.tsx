import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Input,
  NavLink,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { SquareCheck, SquarePen, X } from "lucide-react";
import { Link, useMatch, useNavigate } from "react-router";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { SectionHeading } from "../../ui/SectionHeading";
import { SectionToolbar } from "../../ui/SectionToolbar";
import { usePhone } from "../../ui/usePhone";
import type { Session } from "../../types";
import { ActionBarGroups } from "../gallery/ActionBar";
import { initialInput, useGenerationActions } from "../generation/GenerationProvider";
import { ChatMenu, ChatRename, chatTitle, DeleteChatsDialog, useArchiveChats } from "./ChatActions";
import { sessionSearchQuery, sessionsQuery } from "./queries";
import classes from "./ChatWorkspace.module.css";

export const chatShellClass = classes.shell;

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
/** The time for today's chats, otherwise the date (with the year once it differs). */
function updated(value: string) {
  const date = new Date(value),
    now = new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(
    undefined,
    sameDay(date, now)
      ? { hour: "numeric", minute: "2-digit" }
      : date.getFullYear() === now.getFullYear()
        ? { day: "numeric", month: "short" }
        : { day: "numeric", month: "short", year: "numeric" },
  );
}

function ChatRow({
  session,
  active,
  close,
  selected,
  toggle,
}: {
  session: Session;
  active: boolean;
  close: () => void;
  /** While selecting, whether this chat is chosen; a click then toggles it instead of opening it. */
  selected?: boolean;
  toggle: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const description = [session.mcp && "MCP", updated(session.updatedAt)]
    .filter(Boolean)
    .join(" · ");
  if (selected !== undefined)
    return (
      <NavLink
        component="button"
        role="checkbox"
        aria-checked={selected}
        label={chatTitle(session)}
        description={description}
        active={selected}
        leftSection={<Checkbox.Indicator checked={selected} size="xs" aria-hidden />}
        onClick={toggle}
        classNames={{ label: classes.label }}
      />
    );
  if (renaming) return <ChatRename session={session} onDone={() => setRenaming(false)} />;
  return (
    <div className={classes.row}>
      <NavLink
        component={Link}
        to={`/chat/${session.id}`}
        label={chatTitle(session)}
        description={description}
        active={active}
        aria-current={active ? "page" : undefined}
        onClick={close}
        classNames={{ root: classes.link, label: classes.label }}
      />
      <ChatMenu session={session} onRename={() => setRenaming(true)} className={classes.menu} />
    </div>
  );
}

/** Leaves the open chat for an empty draft on `/chat`, where the first message starts a new one. */
function useNewChat() {
  const { setDraft } = useGenerationActions();
  const navigate = useNavigate();
  return () => {
    setDraft({ input: initialInput, sessionId: "", references: [], operation: "image" });
    void navigate("/chat");
  };
}

/** New Chat as a small icon action beside the Chats heading; `onDone` closes the phone sheet. */
export function NewChatAction({ onDone }: { onDone?: () => void }) {
  const newChat = useNewChat();
  return (
    <Tooltip label="New Chat">
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label="New Chat"
        onClick={() => {
          newChat();
          onDone?.();
        }}
      >
        <SquarePen size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

/** When a chat was last updated, as the list's date heading. */
function period(value: string) {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - date.getTime()) / 86400000) + 1;
  if (Number.isNaN(days) || days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 Days";
  if (days < 30) return "Previous 30 Days";
  return "Older";
}

/**
 * The selection bar in the toolbar's place: the count, Select All, Archive (Unarchive among
 * archived chats) and Delete, then Clear Selection last. The list is narrow everywhere, so the
 * actions stay on this row; phones name them, as they show no tooltips.
 */
function ChatSelectionBar({
  listed,
  chosen,
  archived,
  pending,
  selectAll,
  archive,
  remove,
  end,
}: {
  listed: number;
  chosen: number;
  archived: boolean;
  pending: boolean;
  selectAll: () => void;
  archive: () => void;
  remove: () => void;
  end: () => void;
}) {
  const phone = usePhone();
  return (
    <div className={classes.selection} role="group" aria-label="Chat Selection">
      <Text size="sm" fw={500} role="status" className={classes.count}>
        {chosen} Selected
      </Text>
      {!phone && <Divider orientation="vertical" className={classes.divider} />}
      <Button
        size="compact-sm"
        variant="subtle"
        color="gray"
        aria-label="Select All"
        // Focus stays in the list once Select, which opened the bar, is gone.
        autoFocus
        disabled={pending || !listed}
        onClick={selectAll}
      >
        All
      </Button>
      <div role="group" aria-label="Selected Chat Actions" className={classes.selectionActions}>
        <ActionBarGroups
          labelled={phone ? ["archive", "delete"] : []}
          menuPosition="bottom-end"
          groups={[
            [
              {
                id: "archive",
                label: archived ? "Unarchive" : "Archive",
                icon: archived ? icons.unarchive : icons.archive,
                disabled: !chosen || pending,
                loading: pending,
                onClick: archive,
              },
              {
                id: "delete",
                label: "Delete",
                icon: icons.delete,
                color: "red",
                disabled: !chosen || pending,
                onClick: remove,
              },
            ],
          ]}
        />
      </div>
      {!phone && <Divider orientation="vertical" className={classes.divider} />}
      <Tooltip label="Clear Selection">
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Clear Selection"
          disabled={pending}
          onClick={end}
        >
          <icons.clear size={18} />
        </ActionIcon>
      </Tooltip>
    </div>
  );
}

/**
 * The account's Chats under date headings, in the desktop sidebar (`heading`: the Chats heading
 * and New Chat), the phone Chat page and the phone Drawer. Its toolbar searches titles and messages
 * on the server, shows All or Archived chats, and selects chats to archive or delete together.
 */
export function SessionList({
  close = () => {},
  heading = false,
}: {
  close?: () => void;
  heading?: boolean;
}) {
  const id = useMatch("/chat/:id")?.params.id;
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query.trim(), 200);
  const [show, setShow] = useState<"all" | "archived">("all");
  const all = useQuery(sessionsQuery);
  const found = useQuery({ ...sessionSearchQuery(search), enabled: Boolean(search) });
  const sessions = search ? found : all;
  const archived = show === "archived";
  const listed = (sessions.data?.sessions || []).filter(
    (session) => Boolean(session.archived) === archived,
  );
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const chosen = selected ? listed.filter((session) => selected.has(session.id)) : [];
  const [deleting, setDeleting] = useState(false);
  const archive = useArchiveChats();
  const end = () => setSelected(null);
  // While selecting, Escape ends the selection and Delete asks to delete.
  const keys = (event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      // Ends the selection only, not the Drawer around the list.
      event.stopPropagation();
      end();
    } else if ((event.key === "Delete" || event.key === "Backspace") && chosen.length) {
      event.preventDefault();
      setDeleting(true);
    }
  };
  const listening = Boolean(selected) && !deleting;
  // Keys with focus nowhere, as after a dialog closes, belong to the selection too.
  useEffect(() => {
    if (!listening) return;
    const loose = (event: globalThis.KeyboardEvent) => {
      if (event.target === document.body && !event.defaultPrevented) keys(event);
    };
    window.addEventListener("keydown", loose);
    return () => window.removeEventListener("keydown", loose);
  });
  const groups = new Map<string, Session[]>();
  for (const session of listed) {
    const key = period(session.updatedAt);
    groups.set(key, [...(groups.get(key) || []), session]);
  }
  const toolbar = selected ? (
    <ChatSelectionBar
      listed={listed.length}
      chosen={chosen.length}
      archived={archived}
      pending={archive.isPending}
      selectAll={() => setSelected(new Set(listed.map((session) => session.id)))}
      archive={() =>
        archive.mutate(
          { ids: chosen.map((session) => session.id), archived: !archived },
          { onSuccess: end },
        )
      }
      remove={() => setDeleting(true)}
      end={end}
    />
  ) : (
    <div className={classes.toolbar}>
      <SectionToolbar
        label="Chats"
        query={query}
        onQueryChange={setQuery}
        filterCount={archived ? 1 : 0}
        onResetFilters={() => setShow("all")}
        filters={
          // One of these at a time, as the gallery's Show.
          <Input.Wrapper label="Show">
            <SegmentedControl
              aria-label="Show"
              fullWidth
              size="xs"
              mt={4}
              value={show}
              onChange={(next) => setShow(next as typeof show)}
              data={[
                { value: "all", label: "All" },
                { value: "archived", label: "Archived" },
              ]}
            />
          </Input.Wrapper>
        }
        actions={
          <>
            <Tooltip label="Select Chats">
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Select Chats"
                disabled={!listed.length}
                onClick={() => setSelected(new Set())}
              >
                <SquareCheck size={18} />
              </ActionIcon>
            </Tooltip>
            {heading && <NewChatAction />}
          </>
        }
      />
    </div>
  );
  return (
    <Stack
      gap={4}
      flex={1}
      mih={0}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        // Keys from dialogs portalled out of the list (Delete's confirmation) are theirs.
        if (listening && event.currentTarget.contains(event.target as Node))
          keys(event.nativeEvent);
      }}
    >
      {heading ? (
        <Group gap="xs" wrap="nowrap" className={classes.sidebarHeading}>
          {!selected && <SectionHeading>Chats</SectionHeading>}
          {toolbar}
        </Group>
      ) : (
        toolbar
      )}
      {sessions.error ? (
        <Alert color="red">{sessions.error.message}</Alert>
      ) : sessions.data && !listed.length ? (
        <EmptyState fill>{search || archived ? "No Matches" : "No Chats"}</EmptyState>
      ) : (
        [...groups].map(([label, entries]) => (
          <Stack key={label} gap={2} component="section" aria-label={label}>
            <Text size="xs" fw={600} c="dimmed" px="sm" pt="sm" pb={4}>
              {label}
            </Text>
            {entries.map((session) => (
              <ChatRow
                key={session.id}
                session={session}
                active={session.id === id}
                close={close}
                selected={selected ? selected.has(session.id) : undefined}
                toggle={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (!next.delete(session.id)) next.add(session.id);
                    return next;
                  })
                }
              />
            ))}
          </Stack>
        ))
      )}
      <DeleteChatsDialog
        opened={deleting}
        ids={chosen.map((session) => session.id)}
        onClose={() => setDeleting(false)}
        onDone={(failed) => (failed.length ? setSelected(new Set(failed)) : end())}
      />
    </Stack>
  );
}

/**
 * The open chat's title with Rename and Delete, and a close cross back to No Chat Selected;
 * follows the list so generated titles arrive.
 */
export function ChatHeading({ session }: { session: Session }) {
  const listed = useQuery({
    ...sessionsQuery,
    select: (data) => data.sessions.find((entry) => entry.id === session.id),
  }).data;
  const current = listed || session;
  const [renaming, setRenaming] = useState(false);
  const newChat = useNewChat();
  return (
    <Group gap={4} wrap="nowrap" mb="sm" mih={36} className={classes.heading}>
      {renaming ? (
        <ChatRename session={current} onDone={() => setRenaming(false)} />
      ) : (
        <>
          <Title order={2} size="h4" lineClamp={1} title={chatTitle(current)} miw={0}>
            {chatTitle(current)}
          </Title>
          {current.mcp && (
            <Badge variant="default" style={{ flexShrink: 0 }}>
              MCP Chat
            </Badge>
          )}
          {current.archived && (
            <Badge variant="default" style={{ flexShrink: 0 }}>
              Archived
            </Badge>
          )}
          <ChatMenu session={current} onRename={() => setRenaming(true)} />
          <Tooltip label="Close Chat">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Close Chat"
              ml="auto"
              onClick={newChat}
            >
              <X size={18} />
            </ActionIcon>
          </Tooltip>
        </>
      )}
    </Group>
  );
}

export function ChatWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className={classes.workspace} data-chat-workspace>
      <aside className={classes.sidebar} aria-label="Chats">
        <SessionList heading />
      </aside>
      <div className={classes.main}>{children}</div>
    </div>
  );
}
