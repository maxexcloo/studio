import { useMemo, useState } from "react";
import { Group, Image, Loader, ScrollArea, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import type { MediaItem, QueueJob } from "../../types";
import { queueQuery } from "../generation/Queue";
import { derivation, knownResults, versionGroups } from "./versions";
import { mediaTitle } from "./mediaLabels";
import classes from "./MediaViewer.module.css";
import { terminalStatuses } from "../../../../shared/queue";

interface Entry {
  key: string;
  item?: MediaItem;
}

/**
 * The item's versions, oldest first: its version group (`versionGroups`, as the grid groups them)
 * among the owner's jobs' results and the `related` items loaded with it, and the runs this viewer
 * queued without a parent. Work still queued from one of them shows as placeholders.
 */
export function useRunFamily(item: MediaItem, extra: string[], related: MediaItem[]): Entry[] {
  const jobs = useQuery(queueQuery).data?.jobs;
  return useMemo(() => {
    const all = [...(jobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const results = (job: QueueJob) => (job.items?.length ? job.items : job.outputs || []);
    const known = knownResults([...related, item], all);
    // Newest first, as versionGroups takes them; work without a time yet is the newest.
    const loaded = [...known.values()].sort((a, b) =>
      (b.createdAt || "~").localeCompare(a.createdAt || "~"),
    );
    const group = versionGroups(loaded, all).find((versions) =>
      versions.some((version) => version.id === item.id),
    )!;
    const queued = all.filter((job) => extra.includes(job.id)).reverse();
    const versions = [
      ...group,
      ...queued.flatMap(results).filter((result) => !group.some(({ id }) => id === result.id)),
    ];
    const ids = new Set(versions.map((version) => version.id));
    const byJob = new Map(all.map((job) => [job.id, job]));
    const from = (job: QueueJob) => {
      const made = derivation(job, byJob, known);
      return Boolean(made?.version && ids.has(made.source));
    };
    const waiting = all
      .filter(
        (job) =>
          !terminalStatuses.has(job.status) &&
          !results(job).length &&
          (extra.includes(job.id) || from(job)),
      )
      .reverse()
      .flatMap((job) =>
        Array.from({ length: Number(job.input.count) || 1 }, (_, index) => ({
          key: `${job.id}:${index}`,
        })),
      );
    return [...versions.map((version) => ({ key: version.id, item: version })), ...waiting];
  }, [jobs, item, extra, related]);
}

/** The set strip, the version strip and the actions under the viewer image. */
export function MediaViewerDock({
  item,
  family,
  set,
  choose,
  actions,
}: {
  item: MediaItem;
  family: Entry[];
  /** The MCP result set's loaded results, in order (`setMembers`). */
  set: MediaItem[];
  choose?: (item: MediaItem) => void;
  actions: React.ReactNode;
}) {
  // Only variations that arrive while this family is shown animate in, not those present on open.
  const root = family[0]?.key;
  const [shown, setShown] = useState(() => ({ root, keys: new Set(family.map(({ key }) => key)) }));
  if (shown.root !== root) setShown({ root, keys: new Set(family.map(({ key }) => key)) });
  return (
    <div className={classes.dock}>
      {set.length > 1 && (
        <ResultStrip
          label={`Set: ${item.resultSet?.title}`}
          entries={set.map((result) => ({ key: result.id, item: result }))}
          current={item}
          name={(result, position) => `Show ${mediaTitle(result!)} (${position} of ${set.length})`}
          choose={choose}
        />
      )}
      {family.length > 1 && (
        <ResultStrip
          label="Versions"
          entries={family}
          current={item}
          name={(result, position) => (result ? `Show Version ${position}` : "Version in Progress")}
          entering={(key) => shown.root === root && !shown.keys.has(key)}
          choose={choose}
        />
      )}
      {actions}
    </div>
  );
}

/** A row of result thumbnails to jump between; it scrolls sideways when wider than the dock. */
function ResultStrip({
  label,
  entries,
  current,
  name,
  entering,
  choose,
}: {
  label: string;
  entries: Entry[];
  current: MediaItem;
  name: (result: MediaItem | undefined, position: number) => string;
  entering?: (key: string) => boolean;
  choose?: (item: MediaItem) => void;
}) {
  return (
    <ScrollArea type="never" className={classes.strip} onClick={(event) => event.stopPropagation()}>
      <Group gap={6} wrap="nowrap" role="list" aria-label={label} justify="center" px={2} py={2}>
        {entries.map(({ key, item: result }, index) => {
          const shown = result?.id === current.id;
          const thumbnail = result?.thumbnailUrl || (result?.type === "image" ? result.url : "");
          return (
            <UnstyledButton
              key={key}
              role="listitem"
              className={classes.variation}
              data-current={shown || undefined}
              data-entering={entering?.(key) || undefined}
              aria-current={shown || undefined}
              aria-label={name(result, index + 1)}
              disabled={!result}
              onClick={() => result && !shown && choose?.(result)}
            >
              {thumbnail && result?.status === "done" ? (
                <Image src={thumbnail} alt="" fallbackSrc="" w="100%" h="100%" />
              ) : (
                <Loader size="xs" color="gray" />
              )}
              {result?.type === "video" && result.status === "done" && (
                <Play size={14} className={classes.variationBadge} fill="currentColor" />
              )}
            </UnstyledButton>
          );
        })}
      </Group>
    </ScrollArea>
  );
}
