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
          Create an image, refine the details and bring it to life. Your prompts and results stay
          together as the idea evolves.
        </Text>
      </Stack>
      <ComposerDock />
    </ChatWorkspace>
  );
}
export function SessionPage() {
  const { id } = useParams();
  const { draft, setDraft } = useGeneration();
  const thread = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const session = useQuery({
    queryKey: ["session", id],
    queryFn: () => api<{ session: Session; jobs: QueueJob[] }>(`/api/sessions/${id}`),
    refetchInterval: 1500,
  });
  useLayoutEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [session.data?.jobs.length]);
  useEffect(() => {
    if (!session.data || draft.sessionId === id) return;
    const jobs = session.data.jobs,
      latest = jobs.at(-1)?.input || session.data.session.inputs;
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
        <div className="studio-thread" ref={thread}>
          {jobs.map((job, index) => (
            <SessionIteration
              key={job.id}
              job={job}
              index={index}
              parentIndex={jobs.findIndex((parent) => parent.id === job.parentJobId)}
              open={setSelected}
            />
          ))}
          {jobs.length === 0 && (
            <Text c="dimmed">
              Start with a prompt below. Your iterations will stay together here.
            </Text>
          )}
        </div>
        <ComposerDock />
        {selected && <MediaViewer item={selected} sessionId={id} close={() => setSelected(null)} />}
      </Stack>
    </ChatWorkspace>
  );
}
