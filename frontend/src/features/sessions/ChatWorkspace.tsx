import type { ReactNode } from "react";
import { Alert, Button, NavLink, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatch } from "react-router";
import { EmptyState } from "../../ui/EmptyState";
import { api } from "../../api";
import type { Session } from "../../types";
import { initialInput, useGeneration } from "../generation/GenerationProvider";
export function SessionList({ close = () => {} }: { close?: () => void }) {
  const id = useMatch("/chat/:id")?.params.id,
    { setDraft } = useGeneration();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ sessions: Session[] }>("/api/sessions"),
    refetchInterval: 5000,
  });
  return (
    <Stack gap="xs" flex={1} mih={0}>
      <Button
        component={Link}
        to="/chat"
        variant="default"
        onClick={() => {
          setDraft({ input: initialInput, sessionId: "", references: [], operation: "image" });
          close();
        }}
      >
        New Session
      </Button>
      <Text size="xs" fw={600} c="dimmed" mt="md">
        YOUR SESSIONS
      </Text>
      {sessions.error ? (
        <Alert color="red">{sessions.error.message}</Alert>
      ) : sessions.data?.sessions.length === 0 ? (
        <EmptyState fill>No Chats</EmptyState>
      ) : (
        sessions.data?.sessions.map((session) => (
          <NavLink
            key={session.id}
            component={Link}
            to={`/chat/${session.id}`}
            label={session.title || "Untitled Session"}
            description={new Date(session.updatedAt).toLocaleDateString()}
            active={session.id === id}
            onClick={close}
            styles={{
              label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            }}
          />
        ))
      )}
    </Stack>
  );
}
export function ChatWorkspace({
  children,
  sessionTitle,
}: {
  children: ReactNode;
  sessionTitle?: string;
}) {
  return (
    <div className="studio-chat-workspace">
      <aside className="studio-session-sidebar">
        <SessionList />
      </aside>
      <div className="studio-chat-main">
        {sessionTitle && (
          <Title
            order={2}
            size="h4"
            mb="sm"
            title={sessionTitle}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {sessionTitle}
          </Title>
        )}
        {children}
      </div>
    </div>
  );
}
