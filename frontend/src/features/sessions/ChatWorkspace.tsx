import { useState, type ReactNode } from "react";
import { Alert, Button, Group, NavLink, Stack, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Link, useMatch } from "react-router";
import { EmptyState } from "../../ui/EmptyState";
import type { Session } from "../../types";
import { initialInput, useGenerationActions } from "../generation/GenerationProvider";
import { ChatMenu, ChatRename, chatTitle } from "./ChatActions";
import { sessionsQuery } from "./queries";
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
        description={updated(session.updatedAt)}
        active={active}
        aria-current={active ? "page" : undefined}
        onClick={close}
        classNames={{ root: classes.link, label: classes.label }}
      />
      <ChatMenu session={session} onRename={() => setRenaming(true)} className={classes.menu} />
    </div>
  );
}

/** New Chat and the account's Chats, in the desktop sidebar and the phone status Drawer. */
export function SessionList({ close = () => {} }: { close?: () => void }) {
  const id = useMatch("/chat/:id")?.params.id,
    { setDraft } = useGenerationActions();
  const sessions = useQuery(sessionsQuery);
  return (
    <Stack gap={4} flex={1} mih={0}>
      <Button
        component={Link}
        to="/chat"
        variant="default"
        leftSection={<Plus size={16} />}
        mb="sm"
        onClick={() => {
          setDraft({ input: initialInput, sessionId: "", references: [], operation: "image" });
          close();
        }}
      >
        New Chat
      </Button>
      {sessions.error ? (
        <Alert color="red">{sessions.error.message}</Alert>
      ) : sessions.data?.sessions.length === 0 ? (
        <EmptyState fill>No Chats</EmptyState>
      ) : (
        sessions.data?.sessions.map((session) => (
          <ChatRow key={session.id} session={session} active={session.id === id} close={close} />
        ))
      )}
    </Stack>
  );
}

/** The open chat's title with Rename and Delete; follows the list so generated titles arrive. */
function ChatHeading({ session }: { session: Session }) {
  const listed = useQuery({
    ...sessionsQuery,
    select: (data) => data.sessions.find((entry) => entry.id === session.id),
  }).data;
  const current = listed || session;
  const [renaming, setRenaming] = useState(false);
  return (
    <Group gap={4} wrap="nowrap" mb="sm" mih={36} className={classes.heading}>
      {renaming ? (
        <ChatRename session={current} onDone={() => setRenaming(false)} />
      ) : (
        <>
          <Title order={2} size="h4" lineClamp={1} title={chatTitle(current)} miw={0}>
            {chatTitle(current)}
          </Title>
          <ChatMenu session={current} onRename={() => setRenaming(true)} />
        </>
      )}
    </Group>
  );
}

export function ChatWorkspace({ children, session }: { children: ReactNode; session?: Session }) {
  return (
    <div className={classes.workspace} data-chat-workspace>
      <aside className={classes.sidebar} aria-label="Chats">
        <SessionList />
      </aside>
      <div className={classes.main}>
        {session && <ChatHeading session={session} />}
        {children}
      </div>
    </div>
  );
}
