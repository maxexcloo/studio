import { Group, Image, Loader, ScrollArea, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Play } from "lucide-react";
import { useMemo, useState } from "react";

import { terminalStatuses } from "../../../../shared/queue";
import type { MediaItem, QueueJob } from "../../types";
import { queueQuery } from "../generation/Queue";
import { mediaTitle } from "./mediaLabels";
import { derivation, knownResults, versionGroups, versionSources, versionTree } from "./versions";

import classes from "./MediaViewer.module.css";

interface Entry {
  key: string;
  item?: MediaItem;
  /** The key of the entry it was made from. */
  source?: string;
  depth?: number;
}

/** A run the viewer queued, and the item it was started on. */
export interface QueuedRun {
  job: string;
  from: string;
}

/**
 * The item's version tree, newest first (`versionTree` reversed): its version group among the
 * owner's jobs' results and the `related` items loaded with it, and the results of runs this viewer
 * queued from one of them or that made one of them. Work still queued from one of them shows as
 * placeholders before them.
 */
export function useRunFamily(item: MediaItem, runs: QueuedRun[], related: MediaItem[]): Entry[] {
  const jobs = useQuery(queueQuery).data?.jobs;
  return useMemo(() => {
    const all = [...(jobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const results = (job?: QueueJob) => (job?.items?.length ? job.items : job?.outputs || []);
    const known = knownResults([...related, item], all);
    // Newest first, as versionTree takes them; work without a time yet is the newest.
    const newestFirst = (items: MediaItem[]) =>
      items.sort((a, b) => (b.createdAt || "~").localeCompare(a.createdAt || "~"));
    const loaded = newestFirst([...known.values()]);
    const sources = versionSources(loaded, all);
    const group = versionGroups(loaded, all).find((versions) =>
      versions.some((version) => version.id === item.id),
    )!;
    const members = new Set(group.map(({ id }) => id));
    // A run started on another item joins only that item's strip, or the strip of what it made.
    const byJob = new Map(all.map((job) => [job.id, job]));
    const made = (job: string) => results(byJob.get(job));
    const extra = runs.filter(
      ({ job, from }) => members.has(from) || made(job).some(({ id }) => members.has(id)),
    );
    // Its results that are not versions of what it started on still branch from it here.
    for (const { job, from } of extra)
      for (const result of made(job))
        if (!members.has(result.id)) {
          members.add(result.id);
          group.push(result);
          sources.set(result.id, from);
        }
    const from = (job: QueueJob) => {
      const made = derivation(job, byJob, known);
      return Boolean(made?.version && members.has(made.source));
    };
    const waiting = all
      .filter(
        (job) =>
          !terminalStatuses.has(job.status) &&
          !results(job).length &&
          (extra.some((run) => run.job === job.id) || from(job)),
      )
      .flatMap((job) =>
        Array.from({ length: Number(job.input.count) || 1 }, (_, index) => ({
          key: `${job.id}:${index}`,
        })),
      );
    return [
      ...waiting,
      ...versionTree(newestFirst(group), sources)
        .reverse()
        .map(({ item: version, source, depth }) => ({
          key: version.id,
          item: version,
          source,
          depth,
        })),
    ];
  }, [jobs, item, runs, related]);
}

/** The set strip, the version strip and the actions under the viewer image. */
export function MediaViewerDock({
  item,
  family,
  set,
  neighbours,
  choose,
  actions,
}: {
  item: MediaItem;
  family: Entry[];
  /** The MCP result set's loaded results, in order (`setMembers`). */
  set: MediaItem[];
  /** The first results of the sets before and after it in the gallery (`neighbourSets`). */
  neighbours: { previous?: MediaItem; next?: MediaItem };
  choose?: (item: MediaItem) => void;
  actions: React.ReactNode;
}) {
  // Only variations that arrive while this family is shown animate in, not those present on open.
  const root = family.at(-1)?.key;
  // Depth marks only a tree that branches: in a single line the order alone shows it.
  const sources = family.flatMap(({ source }) => (source ? [source] : []));
  const branched = new Set(sources).size < sources.length;
  const [shown, setShown] = useState(() => ({ root, keys: new Set(family.map(({ key }) => key)) }));
  if (shown.root !== root) setShown({ root, keys: new Set(family.map(({ key }) => key)) });
  return (
    <div className={classes.dock} data-chrome>
      {(set.length > 1 || neighbours.previous || neighbours.next) && (
        <ResultStrip
          label={`Set: ${item.resultSet?.title}`}
          entries={set.map((result) => ({ key: result.id, item: result }))}
          current={item}
          name={(result, position) => `Show ${mediaTitle(result!)} (${position} of ${set.length})`}
          neighbours={neighbours}
          choose={choose}
        />
      )}
      {family.length > 1 && (
        <ResultStrip
          label="Versions"
          entries={family}
          current={item}
          // Versions count from the original, at the end; a branch names the version it came from.
          name={(result, position) => {
            if (!result) return "Version in Progress";
            const { source } = family[position - 1];
            const from = family.findIndex(({ key }) => key === source);
            return `Show Version ${family.length + 1 - position}${
              from > position ? `, from Version ${family.length - from}` : ""
            }`;
          }}
          depths={branched}
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
  depths,
  neighbours,
  choose,
}: {
  label: string;
  entries: Entry[];
  current: MediaItem;
  name: (result: MediaItem | undefined, position: number) => string;
  entering?: (key: string) => boolean;
  /** Marks each entry's generations from the original. */
  depths?: boolean;
  /** Faded at either end, each moving to its own set. */
  neighbours?: { previous?: MediaItem; next?: MediaItem };
  choose?: (item: MediaItem) => void;
}) {
  const neighbour = (result: MediaItem | undefined, side: "Previous" | "Next") =>
    result && (
      <Thumbnail
        result={result}
        neighbour
        label={`${side} Set: ${result.resultSet?.title}`}
        onClick={() => choose?.(result)}
      />
    );
  return (
    <ScrollArea className={classes.strip} onClick={(event) => event.stopPropagation()}>
      <Group gap={6} wrap="nowrap" role="list" aria-label={label} justify="center" px={2} py={2}>
        {neighbour(neighbours?.previous, "Previous")}
        {entries.map(({ key, item: result, depth }, index) => {
          const shown = result?.id === current.id;
          return (
            <Thumbnail
              key={key}
              result={result}
              shown={shown}
              entering={entering?.(key)}
              depth={depths ? depth : undefined}
              label={name(result, index + 1)}
              onClick={() => result && !shown && choose?.(result)}
            />
          );
        })}
        {neighbour(neighbours?.next, "Next")}
      </Group>
    </ScrollArea>
  );
}

function Thumbnail({
  result,
  shown,
  entering,
  depth,
  neighbour,
  label,
  onClick,
}: {
  result?: MediaItem;
  shown?: boolean;
  entering?: boolean;
  depth?: number;
  neighbour?: boolean;
  label: string;
  onClick: () => void;
}) {
  const thumbnail = result?.thumbnailUrl || (result?.type === "image" ? result.url : "");
  return (
    <UnstyledButton
      role="listitem"
      className={classes.variation}
      data-current={shown || undefined}
      data-entering={entering || undefined}
      data-neighbour={neighbour || undefined}
      aria-current={shown || undefined}
      aria-label={label}
      disabled={!result}
      onClick={onClick}
    >
      {thumbnail && result?.status === "done" ? (
        <Image src={thumbnail} alt="" fallbackSrc="" w="100%" h="100%" />
      ) : result?.status === "failed" || result?.status === "cancelled" ? (
        <CircleAlert size={16} color="var(--mantine-color-dimmed)" />
      ) : (
        <Loader size="xs" color="gray" />
      )}
      {!!depth && (
        <span
          className={classes.variationDepth}
          style={{ "--depth": Math.min(depth, 3) } as React.CSSProperties}
          aria-hidden
        />
      )}
      {result?.type === "video" && result.status === "done" && (
        <Play size={14} className={classes.variationBadge} fill="currentColor" />
      )}
    </UnstyledButton>
  );
}
