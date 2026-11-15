import { Group, Image, Loader, ScrollArea, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

type StripEntry = Entry & { label: string; version?: boolean };

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

/**
 * The strip and the actions under the viewer image. In a set the strip holds the set's results, the
 * shown result's versions standing in its place; outside one it holds the versions.
 */
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
  const root = family.at(-1)?.key;
  // Depth marks only a tree that branches: in a single line the order alone shows it.
  const sources = family.flatMap(({ source }) => (source ? [source] : []));
  const branched = new Set(sources).size < sources.length;
  const [shown, setShown] = useState(() => ({ root, keys: new Set(family.map(({ key }) => key)) }));
  if (shown.root !== root) setShown({ root, keys: new Set(family.map(({ key }) => key)) });
  // Versions count from the original, at the end; a branch names the version it came from.
  const versions: StripEntry[] =
    family.length > 1
      ? family.map((entry, index) => {
          const from = family.findIndex(({ key }) => key === entry.source);
          return {
            ...entry,
            label: entry.item
              ? `Show Version ${family.length - index}${
                  from > index + 1 ? `, from Version ${family.length - from}` : ""
                }`
              : "Version in Progress",
          };
        })
      : [];
  const versionKeys = new Set(versions.map(({ key }) => key));
  const entries: StripEntry[] =
    set.length > 1
      ? set.flatMap<StripEntry>((result, index) =>
          result.id === item.id && versions.length
            ? versions.map((entry) => ({ ...entry, version: true }))
            : versionKeys.has(result.id)
              ? []
              : [
                  {
                    key: result.id,
                    item: result,
                    label: `Show ${mediaTitle(result)} (${index + 1} of ${set.length})`,
                  },
                ],
        )
      : versions;
  return (
    <div className={classes.dock} data-chrome>
      {entries.length > 1 && (
        <ResultStrip
          label={set.length > 1 ? `Set: ${item.resultSet?.title}` : "Versions"}
          entries={entries}
          current={item}
          depths={branched}
          entering={(key) => versionKeys.has(key) && shown.root === root && !shown.keys.has(key)}
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
  entering,
  depths,
  choose,
}: {
  label: string;
  entries: StripEntry[];
  current: MediaItem;
  entering?: (key: string) => boolean;
  /** Marks each version's generations from the original. */
  depths?: boolean;
  choose?: (item: MediaItem) => void;
}) {
  // The shown result stays centred in the strip as the viewer moves, scrolling only the strip:
  // at once on opening, smoothly after unless motion is reduced.
  const viewport = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  useEffect(() => {
    const element = viewport.current;
    const shown = element?.querySelector<HTMLElement>("[data-current]");
    if (!element || !shown) return;
    const still = !placed.current || matchMedia("(prefers-reduced-motion: reduce)").matches;
    placed.current = true;
    element.scrollTo({
      left: shown.offsetLeft - (element.clientWidth - shown.offsetWidth) / 2,
      behavior: still ? "instant" : "smooth",
    });
  }, [current.id]);
  return (
    <ScrollArea
      className={classes.strip}
      viewportRef={viewport}
      onClick={(event) => event.stopPropagation()}
    >
      {/* Centred while it fits; wider, it starts at the edge so every thumbnail scrolls into reach. */}
      <Group
        gap={6}
        wrap="nowrap"
        role="list"
        aria-label={label}
        w="max-content"
        mx="auto"
        px={2}
        py={2}
      >
        {entries.map(({ key, item: result, depth, label, version }) => {
          const shown = result?.id === current.id;
          return (
            <Thumbnail
              key={key}
              result={result}
              shown={shown}
              entering={entering?.(key)}
              version={version}
              depth={depths ? depth : undefined}
              label={label}
              onClick={() => result && !shown && choose?.(result)}
            />
          );
        })}
      </Group>
    </ScrollArea>
  );
}

function Thumbnail({
  result,
  shown,
  entering,
  version,
  depth,
  label,
  onClick,
}: {
  result?: MediaItem;
  shown?: boolean;
  entering?: boolean;
  /** A version standing in a set result's place. */
  version?: boolean;
  depth?: number;
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
      data-version={version || undefined}
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
