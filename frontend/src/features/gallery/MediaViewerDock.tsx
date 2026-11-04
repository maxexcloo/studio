import { useMemo, useState } from "react";
import { Group, Image, Loader, ScrollArea, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import type { MediaItem, QueueJob } from "../../types";
import { queueQuery } from "../generation/Queue";
import { derivation, versionGroups } from "./versions";
import classes from "./MediaViewer.module.css";
import { terminalStatuses } from "../../../../shared/queue";

interface Entry {
  key: string;
  item?: MediaItem;
}

/**
 * The item's versions, oldest first: its version group (`versionGroups`, as the grid groups them)
 * and the runs this viewer queued without a parent. Work still queued from one of them shows as
 * placeholders.
 */
export function useRunFamily(item: MediaItem, extra: string[]): Entry[] {
  const jobs = useQuery(queueQuery).data?.jobs;
  return useMemo(() => {
    const all = [...(jobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const results = (job: QueueJob) => (job.items?.length ? job.items : job.outputs || []);
    const loaded = all.flatMap(results);
    if (!loaded.some((result) => result.id === item.id)) loaded.push(item);
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
      const made = derivation(job, byJob);
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
  }, [jobs, item, extra]);
}

/** The version strip and the actions under the viewer image. */
export function MediaViewerDock({
  item,
  family,
  choose,
  actions,
}: {
  item: MediaItem;
  family: Entry[];
  choose?: (item: MediaItem) => void;
  actions: React.ReactNode;
}) {
  // Only variations that arrive while this family is shown animate in, not those present on open.
  const root = family[0]?.key;
  const [shown, setShown] = useState(() => ({ root, keys: new Set(family.map(({ key }) => key)) }));
  if (shown.root !== root) setShown({ root, keys: new Set(family.map(({ key }) => key)) });
  return (
    <div className={classes.dock}>
      {family.length > 1 && (
        <ScrollArea
          type="never"
          className={classes.strip}
          onClick={(event) => event.stopPropagation()}
        >
          <Group
            gap={6}
            wrap="nowrap"
            role="list"
            aria-label="Versions"
            justify="center"
            px={2}
            py={2}
          >
            {family.map(({ key, item: result }) => {
              const current = result?.id === item.id;
              const thumbnail =
                result?.thumbnailUrl || (result?.type === "image" ? result.url : "");
              return (
                <UnstyledButton
                  key={key}
                  role="listitem"
                  className={classes.variation}
                  data-current={current || undefined}
                  data-entering={(shown.root === root && !shown.keys.has(key)) || undefined}
                  aria-current={current || undefined}
                  aria-label={
                    result
                      ? `Show Version ${family.findIndex((entry) => entry.key === key) + 1}`
                      : "Version in Progress"
                  }
                  disabled={!result}
                  onClick={() => result && !current && choose?.(result)}
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
      )}
      {actions}
    </div>
  );
}
