import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { LoadingState } from "../../ui/LoadingState";
import { EmptyState } from "../../ui/EmptyState";
import { api } from "../../api";
import type { MediaItem, QueueJob, Session } from "../../types";
import { useGeneration, initialInput } from "../generation/GenerationProvider";
import { ComposerDock } from "../generation/ComposerDock";
import { SessionIteration } from "./SessionIteration";

import { MediaViewer } from "../gallery/MediaViewer";
import { ChatWorkspace } from "./ChatWorkspace";
import { useChat, useChatMessages } from "./ChatProvider";
import { ChatTurn } from "./ChatTurn";
import { GenerationCard } from "./GenerationCard";
import { generationInput } from "../generation/payload";
export function ChatPage() {
  const { id } = useParams();
  return id ? <SessionPage /> : <SessionsPage />;
}
export function SessionsPage() {
  const { setDraft, setPrepared } = useGeneration();
  useEffect(() => {
    setDraft({ input: initialInput, sessionId: "", references: [], operation: "image" });
    setPrepared(false);
  }, [setDraft]);
  return (
    <ChatWorkspace>
      <EmptyState fill>No Chat Selected</EmptyState>
      <ComposerDock chat />
    </ChatWorkspace>
  );
}
export function SessionPage() {
  const { id } = useParams();
  const { draft, setDraft, profile, prepared, setPrepared } = useGeneration();
  const thread = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const feed = useRef<HTMLDivElement>(null);
  const chat = useChatMessages(id);
  const { sendingSession } = useChat();
  useLayoutEffect(() => {
    if (sendingSession === id) {
      atBottom.current = true;
      if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    }
  }, [sendingSession, id]);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const session = useQuery({
    queryKey: ["session", id],
    queryFn: () => api<{ session: Session; jobs: QueueJob[] }>(`/api/sessions/${id}`),
    refetchInterval: 1500,
  });
  useEffect(() => {
    if (!feed.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (thread.current && atBottom.current)
          thread.current.scrollTop = thread.current.scrollHeight;
      });
    });
    observer.observe(feed.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [id, session.isPending]);
  useLayoutEffect(() => {
    if (thread.current && atBottom.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [
    session.data?.jobs
      .map((job) => `${job.id}:${job.status}:${job.items?.length || job.outputs?.length || 0}`)
      .join("|"),
    chat.data?.messages?.length,
    chat.data?.messages?.at(-1)?.content,
    prepared,
  ]);
  useLayoutEffect(() => {
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
  if (session.isPending)
    return (
      <ChatWorkspace>
        <LoadingState fill label="Loading Session" />
        <ComposerDock chat />
      </ChatWorkspace>
    );
  if (session.error)
    return (
      <ChatWorkspace>
        <Alert color="red">{session.error.message}</Alert>
        <ComposerDock chat />
      </ChatWorkspace>
    );
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
    <ChatWorkspace sessionTitle={session.data.session.title || "Untitled Session"}>
      <Stack gap="xl" className="studio-session-page">
        <div
          className="studio-thread"
          ref={thread}
          onFocusCapture={(event) => {
            if ((event.target as HTMLElement).closest("[data-generation-editor]"))
              atBottom.current = false;
          }}
          onScroll={() => {
            const element = thread.current!;
            atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
          }}
        >
          <Stack ref={feed} gap="xl">
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
            {prepared && draft.sessionId === id && (
              <GenerationCard
                key={`${draft.parentJobId}:${draft.operation}`}
                draft={{
                  input: generationInput(draft.input, profile, draft.references),
                  operation: draft.operation,
                  parentJobId: draft.parentJobId,
                }}
                sessionId={id}
                onDismiss={() => setPrepared(false)}
              />
            )}
          </Stack>
          {timeline.length === 0 && !prepared && <EmptyState fill>No Chats</EmptyState>}
        </div>
        <ComposerDock chat />
        {selected && (
          <MediaViewer
            item={selected}
            items={jobs.flatMap((job) => (job.items?.length ? job.items : job.outputs || []))}
            navigate={setSelected}
            sessionId={id}
            close={() => setSelected(null)}
          />
        )}
      </Stack>
    </ChatWorkspace>
  );
}
