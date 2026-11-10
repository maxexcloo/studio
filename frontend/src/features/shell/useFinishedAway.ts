import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queueQuery } from "../generation/Queue";
import { terminalStatuses } from "../../../../shared/queue";

const title = "Studio";

/**
 * Counts the account's own work that finishes while Studio is hidden or in the background, as
 * "(2) Studio" in the tab title and the installed app's badge; both clear on return. Active work
 * keeps the queue checked while hidden so the count can rise; Dream's background work is left out.
 */
export function useFinishedAway() {
  const queue = useQuery({
    ...queueQuery,
    refetchIntervalInBackground: true,
    refetchInterval: (query) =>
      document.hidden && query.state.data?.jobs.some((job) => !terminalStatuses.has(job.status))
        ? 3000
        : false,
  }).data;
  const running = useRef<Set<string> | null>(null);
  const count = useRef(0);
  useEffect(() => {
    if (!queue) return;
    const mine = queue.jobs.filter((job) => !job.dream);
    const active = new Set(
      mine.filter((job) => !terminalStatuses.has(job.status)).map((job) => job.id),
    );
    const finished = running.current
      ? mine.filter((job) => job.status === "completed" && running.current!.has(job.id)).length
      : 0;
    running.current = active;
    if (!finished || !document.hidden) return;
    count.current += finished;
    document.title = `(${count.current}) ${title}`;
    void navigator.setAppBadge?.(count.current).catch(() => undefined);
  }, [queue]);
  useEffect(() => {
    const returned = () => {
      if (document.hidden || !count.current) return;
      count.current = 0;
      document.title = title;
      void navigator.clearAppBadge?.().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", returned);
    return () => document.removeEventListener("visibilitychange", returned);
  }, []);
}
