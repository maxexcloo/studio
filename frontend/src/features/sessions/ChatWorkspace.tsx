import { useState, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  NavLink,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { SquarePen, X } from "lucide-react";
import { Link, useMatch, useNavigate } from "react-router";
import { EmptyState } from "../../ui/EmptyState";
import { SectionHeading } from "../../ui/SectionHeading";
import type { Session } from "../../types";
import { initialInput, useGenerationActions } from "../generation/GenerationProvider";
import { ChatMenu, ChatRename, chatTitle } from "./ChatActions";
import { sessionsQuery } from "./queries";
import classes from "./ChatWorkspace.module.css";

export const chatShellClass = classes.shell;

/** Opens the header's Chats list, for phones, which have no sidebar. */
export const openChatsEvent = "studio-open-chats";

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
}: {
  session: Session;
  active: boolean;
  close: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  if (renaming) return <ChatRename session={session} onDone={() => setRenaming(false)} />;
  return (
    <div className={classes.row}>
      <NavLink
        component={Link}
        to={`/chat/${session.id}`}
        label={chatTitle(session)}
        description={[session.mcp && "MCP", updated(session.updatedAt)].filter(Boolean).join(" · ")}
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

/** The account's Chats under date headings, in the desktop sidebar and the phone Drawer. */
export function SessionList({ close = () => {} }: { close?: () => void }) {
  const id = useMatch("/chat/:id")?.params.id;
  const sessions = useQuery(sessionsQuery);
  const groups = new Map<string, Session[]>();
  for (const session of sessions.data?.sessions || []) {
    const key = period(session.updatedAt);
    groups.set(key, [...(groups.get(key) || []), session]);
  }
  return (
    <Stack gap={4} flex={1} mih={0}>
      {sessions.error ? (
        <Alert color="red">{sessions.error.message}</Alert>
      ) : sessions.data?.sessions.length === 0 ? (
        <EmptyState fill>No Chats</EmptyState>
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
              />
            ))}
          </Stack>
        ))
      )}
    </Stack>
  );
}

/**
 * The open chat's title with Rename and Delete, and a close cross back to No Chat Selected;
 * follows the list so generated titles arrive.
 */
function ChatHeading({ session }: { session: Session }) {
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

export function ChatWorkspace({ children, session }: { children: ReactNode; session?: Session }) {
  return (
    <div className={classes.workspace} data-chat-workspace>
      <aside className={classes.sidebar} aria-label="Chats">
        <Group justify="space-between" wrap="nowrap" className={classes.sidebarHeading}>
          <SectionHeading>Chats</SectionHeading>
          <NewChatAction />
        </Group>
        <SessionList />
      </aside>
      <div className={classes.main}>
        {session && <ChatHeading session={session} />}
        {children}
      </div>
    </div>
  );
}
