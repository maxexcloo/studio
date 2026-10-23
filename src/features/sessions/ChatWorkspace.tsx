import type { ReactNode } from "react";
import { Alert, Button, Drawer, Group, NavLink, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api } from "../../api";
import type { Session } from "../../types";
import { initialInput, useGeneration } from "../generation/GenerationProvider";
export function ChatWorkspace({ children }: { children: ReactNode }) {
  const { id } = useParams(),
    { setDraft } = useGeneration();
  const [opened, { open, close }] = useDisclosure(false);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ sessions: Session[] }>("/api/sessions"),
    refetchInterval: 5000,
  });
  const list = (
    <Stack gap="xs">
      <Button
        component={Link}
        to="/sessions"
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
        <Text c="dimmed" size="sm">
          Your creative sessions will appear here.
        </Text>
      ) : (
        sessions.data?.sessions.map((session) => (
          <NavLink
            key={session.id}
            component={Link}
            to={`/sessions/${session.id}`}
            label={session.title || "Untitled Session"}
            description={new Date(session.updatedAt).toLocaleDateString()}
            active={session.id === id}
            onClick={close}
            styles={{
              root: { borderRadius: "var(--mantine-radius-md)" },
              label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            }}
          />
        ))
      )}
    </Stack>
  );
  return (
    <div className="studio-chat-workspace">
      <aside className="studio-session-sidebar">{list}</aside>
      <div className="studio-chat-main">
        <Group hiddenFrom="sm" mb="lg">
          <Button variant="subtle" color="gray" size="sm" onClick={open}>
            Sessions
          </Button>
        </Group>
        {children}
      </div>
      <Drawer
        opened={opened}
        onClose={close}
        title="Sessions"
        closeButtonProps={{ "aria-label": "Close Sessions" }}
        size="85%"
      >
        {list}
      </Drawer>
    </div>
  );
}
