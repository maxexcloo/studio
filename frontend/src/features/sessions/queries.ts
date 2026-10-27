import { queryOptions } from "@tanstack/react-query";
import { api } from "../../api";
import type { QueueJob, Session } from "../../types";
import { terminal } from "../generation/Queue";

/** A new chat whose generated title may still arrive (titling runs after its first reply). */
const awaitingTitle = (session: Session) =>
  !session.titleSource && Date.now() - Date.parse(session.updatedAt) < 60_000;

/** The account's Chats, newest first; polls only while a new chat's title is pending. */
export const sessionsQuery = queryOptions({
  queryKey: ["sessions"],
  queryFn: () => api<{ sessions: Session[] }>("/api/sessions"),
  refetchInterval: (query) => (query.state.data?.sessions.some(awaitingTitle) ? 2000 : false),
});

/** One Chat with its generations; polls while one is in progress, and an MCP Chat for its client's next turn. */
export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id],
    queryFn: () => api<{ session: Session; jobs: QueueJob[] }>(`/api/sessions/${id}`),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => !terminal.has(job.status))
        ? 1500
        : query.state.data?.session.mcp
          ? 5000
          : false,
  });

/** Saved and in-progress results of one generation, without repeats. */
export function jobResults(job: QueueJob) {
  return job.items?.length ? job.items : job.outputs || [];
}
