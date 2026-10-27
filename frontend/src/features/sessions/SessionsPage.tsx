import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Paper, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router";
import type { ChatMessage } from "../../../../shared/chat";
import { LoadingState } from "../../ui/LoadingState";
import { EmptyState } from "../../ui/EmptyState";
import { usePhone } from "../../ui/usePhone";
import type { MediaItem, QueueJob } from "../../types";
import { useGeneration, initialInput } from "../generation/GenerationProvider";
import { MediaViewer } from "../gallery/MediaViewer";
import { currentMedia } from "../gallery/mediaSource";
import { ChatDock } from "./ChatComposer";
import { useChatController, useChatMessages } from "./ChatProvider";
import { ChatTurn } from "./ChatTurn";
import { ChatWorkspace, NewChatButton } from "./ChatWorkspace";
import { GenerationCard } from "./GenerationCard";
import { sessionQuery } from "./queries";
import { iterationTiles, SessionIteration } from "./SessionIteration";
import classes from "./SessionsPage.module.css";

export function ChatPage() {
  const { id } = useParams();
  return id ? <SessionPage /> : <SessionsPage />;
}
export function SessionsPage() {
  const { draft } = useGeneration();
  const phone = usePhone();
  if (draft.sessionId) return <Navigate to={`/chat/${draft.sessionId}`} replace />;
  return (
    <ChatWorkspace>
      <EmptyState
        fill
        action={
          // Phones have no Chats sidebar, so the empty state offers New Chat.
          phone && (
            <NewChatButton
              onClick={() =>
                document.querySelector<HTMLElement>('textarea[aria-label="Message"]')?.focus()
              }
            />
          )
        }
      >
        No Chat Selected
      </EmptyState>
      <ChatDock />
    </ChatWorkspace>
  );
}

const pastTense: Record<string, string> = {
  Edit: "Edited",
  Refine: "Refined",
  Animate: "Animated",
  Extend: "Extended",
  Recreate: "Recreated",
};
/** A card request's quiet line; older records sent the whole prompt, so derive theirs. */
function quietLine(message: ChatMessage, jobIndex: Map<string, number>) {
  if (message.role !== "user" || !message.revision) return undefined;
  const [verb, ...rest] = message.content.split(" ");
  if (pastTense[verb] && /^iteration \d+$/.test(rest.join(" ")))
    return `${pastTense[verb]} ${rest.join(" ")}`;
  const source = jobIndex.get(message.revision.sourceJobId);
  return source === undefined ? "Edited an iteration" : `Edited iteration ${source + 1}`;
}

/** What a staged card does to its source, as its heading and the request it records. */
function stagedAction(operation: string, source: QueueJob | undefined, number: number) {
  const verb =
    operation === "refine"
      ? "Refine"
      : operation === "animate"
        ? source?.input.kind === "video"
          ? "Extend"
          : "Animate"
        : "Recreate";
  return number
    ? { title: `${verb} Iteration ${number}`, request: `${verb} iteration ${number}` }
    : { title: `${verb} Result`, request: `${verb} this result` };
}

function SessionPage() {
  const { id } = useParams();
  const { draft, setDraft, staged, setStaged } = useGeneration();
  const thread = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const followedScrollHeight = useRef(0);
  function followLatest() {
    if (!thread.current || !atBottom.current) return;
    thread.current.scrollTop = thread.current.scrollHeight;
    followedScrollHeight.current = thread.current.scrollHeight;
  }
  const feed = useRef<HTMLDivElement>(null);
  const chat = useChatMessages(id);
  const { sendingSession } = useChatController();
  useLayoutEffect(() => {
    if (sendingSession === id) {
      atBottom.current = true;
      followLatest();
    }
  }, [sendingSession, id]);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const session = useQuery(sessionQuery(id!));
  // Each staging (Refine, Animate, Recreate) starts a fresh card form.
  const stagings = useRef(0);
  const stagedKey = useMemo(() => (staged ? ++stagings.current : 0), [staged]);
  useEffect(() => {
    if (!feed.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        followLatest();
      });
    });
    observer.observe(feed.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [id, session.isPending]);
  useLayoutEffect(() => {
    followLatest();
  }, [
    session.data?.jobs
      .map((job) => `${job.id}:${job.status}:${job.items?.length || job.outputs?.length || 0}`)
      .join("|"),
    chat.data?.messages?.length,
    chat.data?.messages?.at(-1)?.content,
    staged,
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
        <LoadingState fill label="Loading Chat" />
        <ChatDock />
      </ChatWorkspace>
    );
  if (session.error)
    return (
      <ChatWorkspace>
        <Alert color="red">{session.error.message}</Alert>
        <ChatDock />
      </ChatWorkspace>
    );
  const jobs = session.data.jobs;
  const messages = chat.data?.messages || [];
  const jobIndex = new Map(jobs.map((job, index) => [job.id, index]));
  // Running and failed work opens too, showing its status and the prompt once written.
  const tiles = jobs.flatMap(iterationTiles);
  // A reply that started a generation shows its card directly below its text.
  const replies = new Map(
    messages.flatMap((message) =>
      message.jobId && jobIndex.has(message.jobId) ? [[message.jobId, message.id]] : [],
    ),
  );
  const iteration = (job: QueueJob) => (
    <SessionIteration
      key={`job:${job.id}`}
      job={job}
      index={jobIndex.get(job.id)!}
      parentIndex={job.parentJobId ? (jobIndex.get(job.parentJobId) ?? -1) : -1}
      open={setSelected}
    />
  );
  const timeline = [
    ...messages.map((message) => ({ key: `chat:${message.id}`, message, at: message.createdAt })),
    ...jobs
      .filter((job) => !replies.has(job.id))
      .map((job) => ({ key: `job:${job.id}`, job, at: job.createdAt })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const stagedHere = staged && staged.sessionId === id ? staged : null;
  const stagedSource = stagedHere?.parentJobId ? jobIndex.get(stagedHere.parentJobId) : undefined;
  const action =
    stagedHere &&
    stagedAction(
      stagedHere.operation,
      stagedSource === undefined ? undefined : jobs[stagedSource],
      stagedSource === undefined ? 0 : stagedSource + 1,
    );
  return (
    <ChatWorkspace session={session.data.session}>
      <Stack gap="xl" className={classes.page}>
        <div
          className={classes.thread}
          ref={thread}
          onFocusCapture={(event) => {
            if ((event.target as HTMLElement).closest("[data-generation-editor]"))
              atBottom.current = false;
          }}
          onScroll={() => {
            const element = thread.current!;
            // Image layout can trigger native anchoring before ResizeObserver follows the new bottom.
            if (atBottom.current && element.scrollHeight !== followedScrollHeight.current) return;
            atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
          }}
        >
          <Stack ref={feed} gap="xl" className={classes.feed}>
            {timeline.map((entry) =>
              "message" in entry ? (
                <Fragment key={entry.key}>
                  <ChatTurn message={entry.message} quiet={quietLine(entry.message, jobIndex)} />
                  {entry.message.jobId &&
                    replies.get(entry.message.jobId) === entry.message.id &&
                    iteration(jobs[jobIndex.get(entry.message.jobId)!])}
                </Fragment>
              ) : (
                iteration(entry.job)
              ),
            )}
            {stagedHere && action && (
              <Paper
                ref={(element) => {
                  // A new staged card comes into view whole, below the result it came from.
                  if (element && element.dataset.shown !== String(stagedKey)) {
                    element.dataset.shown = String(stagedKey);
                    element.scrollIntoView({ block: "nearest" });
                  }
                }}
                component="section"
                withBorder
                radius="lg"
                p={{ base: "sm", sm: "md" }}
                aria-label={action.title}
                className={classes.staged}
              >
                <GenerationCard
                  key={stagedKey}
                  draft={{
                    input: stagedHere.input,
                    operation: stagedHere.operation,
                    parentJobId: stagedHere.parentJobId,
                  }}
                  sessionId={id!}
                  title={action.title}
                  request={action.request}
                  onClose={() => setStaged(null)}
                />
              </Paper>
            )}
          </Stack>
          {timeline.length === 0 && !stagedHere && chat.isSuccess && sendingSession !== id && (
            <EmptyState fill>No Messages</EmptyState>
          )}
        </div>
        <ChatDock />
        {selected && (
          <MediaViewer
            item={currentMedia(tiles, selected)}
            items={tiles}
            navigate={setSelected}
            sessionId={id}
            close={() => setSelected(null)}
          />
        )}
      </Stack>
    </ChatWorkspace>
  );
}
