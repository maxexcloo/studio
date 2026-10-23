import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { api } from "../../api";
import type { MediaItem, QueueJob, Session } from "../../types";
import { useGeneration, initialInput } from "../generation/GenerationProvider";
import { ComposerDock } from "../generation/ComposerDock";
import { SessionIteration } from "./SessionIteration";

import { MediaViewer } from "../gallery/MediaViewer";
import { ChatWorkspace } from "./ChatWorkspace";
import { useChatMessages } from "./ChatProvider";
import { ChatTurn } from "./ChatTurn";
export function ChatPage() {
  const { id } = useParams();
  return id ? <SessionPage /> : <SessionsPage />;
}
export function SessionsPage() {
  const { setDraft } = useGeneration();
  useEffect(() => {
    setDraft({ input: initialInput, sessionId: "", references: [], operation: "image" });
  }, [setDraft]);
  return (
    <ChatWorkspace>
      <Stack align="center" justify="center" className="studio-chat-empty">
        <Text size="xs" c="dimmed">
          STUDIO CHAT
        </Text>
        <Title order={1} ta="center">
          Where should we take it?
        </Title>
        <Text c="dimmed" ta="center" maw={420}>
          Talk through an idea, create an image, then refine it together. Your conversation,
          generation inputs and results stay together as it evolves.
        </Text>
      </Stack>
      <ComposerDock chat />
    </ChatWorkspace>
  );
}
export function SessionPage() {
  const { id } = useParams();
  const { draft, setDraft } = useGeneration();
  const thread = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const chat = useChatMessages(id);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const session = useQuery({
    queryKey: ["session", id],
    queryFn: () => api<{ session: Session; jobs: QueueJob[] }>(`/api/sessions/${id}`),
    refetchInterval: 1500,
  });
  useLayoutEffect(() => {
    if (thread.current && atBottom.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [
    session.data?.jobs.length,
    chat.data?.messages?.length,
    chat.data?.messages?.at(-1)?.content,
  ]);
  useEffect(() => {
    atBottom.current = true;
  }, [id]);
  useEffect(() => {
    if (!session.data || draft.sessionId === id) return;
    const jobs = session.data.jobs,
      latest =
        [...jobs].reverse().find((job) => job.operation !== "upscale")?.input ||
        session.data.session.inputs;
    const references = Array.isArray(latest.referenceDetails) ? latest.referenceDetails : [];
    setDraft({
      input: { ...initialInput, ...latest },
      sessionId: id!,
      references,
      operation: "image",
    });
  }, [id, session.data, draft.sessionId, setDraft]);
  if (session.isPending) return <Loader aria-label="Loading Session" />;
  if (session.error) return <Alert color="red">{session.error.message}</Alert>;
  const jobs = session.data.jobs;
  const messages = chat.data?.messages || [];
  const timeline = [
    ...messages.map((message) => ({
      type: "chat" as const,
      message,
      createdAt: message.createdAt,
    })),
    ...jobs.map((job, index) => ({
      type: "generation" as const,
      job,
      index,
      createdAt: job.createdAt,
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <ChatWorkspace>
      <Stack gap="xl" className="studio-session-page">
        <Group justify="space-between" align="start">
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              CREATIVE SESSION
            </Text>
            <Title order={2}>{session.data.session.title || "Untitled Session"}</Title>
            <Text c="dimmed" size="sm">
              Every direction, in one place.
            </Text>
          </Stack>
        </Group>
        <div
          className="studio-thread"
          ref={thread}
          onScroll={() => {
            const element = thread.current!;
            atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
          }}
        >
          {timeline.map((entry) =>
            entry.type === "chat" ? (
              <ChatTurn key={entry.message.id} message={entry.message} />
            ) : (
              <SessionIteration
                key={entry.job.id}
                job={entry.job}
                index={entry.index}
                parentIndex={jobs.findIndex((parent) => parent.id === entry.job.parentJobId)}
                open={setSelected}
              />
            ),
          )}
          {timeline.length === 0 && (
            <Text c="dimmed">
              Start a conversation below. Ask Studio to create when you’re ready.
            </Text>
          )}
        </div>
        <ComposerDock chat />
        {selected && <MediaViewer item={selected} sessionId={id} close={() => setSelected(null)} />}
      </Stack>
    </ChatWorkspace>
  );
}
