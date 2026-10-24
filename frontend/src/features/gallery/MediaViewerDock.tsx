import {
  ActionIcon,
  Group,
  Image,
  Loader,
  Paper,
  ScrollArea,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Play } from "lucide-react";
import type { MediaItem, QueueJob } from "../../types";
import { useGeneration } from "../generation/GenerationProvider";
import { PromptHistory } from "../generation/PromptHistory";
import { queueQuery, terminal } from "../generation/Queue";
import { usePhone } from "../../ui/usePhone";
import classes from "./MediaViewer.module.css";

interface Entry {
  key: string;
  item?: MediaItem;
}

/**
 * Every result of the item's run family, oldest first: the root run, the runs iterated from it
 * (`parentJobId`) and runs this viewer queued without a parent. Queued work shows placeholders.
 */
export function useRunFamily(item: MediaItem, extra: string[]): Entry[] {
  const queue = useQuery(queueQuery);
  const jobs = queue.data?.jobs ?? [];
  const byId = new Map(jobs.map((job) => [job.id, job]));
  let root: QueueJob | undefined = item.jobId ? byId.get(item.jobId) : undefined;
  while (root?.parentJobId && byId.has(root.parentJobId)) root = byId.get(root.parentJobId);
  const members = new Set([root?.id, ...extra].filter(Boolean) as string[]);
  for (let grew = true; grew;) {
    grew = false;
    for (const job of jobs)
      if (job.parentJobId && members.has(job.parentJobId) && !members.has(job.id)) {
        members.add(job.id);
        grew = true;
      }
  }
  const entries = jobs
    .filter((job) => members.has(job.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((job): Entry[] => {
      const media = job.items?.length ? job.items : job.outputs || [];
      if (media.length) return media.map((result) => ({ key: result.id, item: result }));
      if (terminal.has(job.status)) return [];
      return Array.from({ length: Number(job.input.count) || 1 }, (_, index) => ({
        key: `${job.id}:${index}`,
      }));
    });
  if (!entries.some((entry) => entry.item?.id === item.id)) entries.unshift({ key: item.id, item });
  return entries;
}

/** The variation strip and the prefilled prompt bar under the viewer image. */
export function MediaViewerDock({
  item,
  family,
  choose,
  prompt,
  onPromptChange,
  onSubmit,
  pending,
  actions,
}: {
  item: MediaItem;
  family: Entry[];
  choose?: (item: MediaItem) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  pending: boolean;
  actions: React.ReactNode;
}) {
  const phone = usePhone();
  const { input } = useGeneration();
  const ready = item.status === "done" && Boolean(item.url);
  const label = `Generate ${input.count} Variation${input.count === 1 ? "" : "s"}`;
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
            aria-label="Variations"
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
                  aria-current={current || undefined}
                  aria-label={
                    result
                      ? `Show Variation ${family.findIndex((entry) => entry.key === key) + 1}`
                      : "Variation in Progress"
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
      {ready && (
        <form
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            if (prompt.trim() && !pending) onSubmit();
          }}
        >
          <Paper withBorder radius="xl" p={6} shadow="lg" className={classes.prompt}>
            <Group gap={4} wrap="nowrap" align="flex-end">
              <Textarea
                aria-label="Variation Prompt"
                placeholder="Describe a variation…"
                variant="unstyled"
                autosize
                minRows={1}
                maxRows={phone ? 3 : 4}
                flex={1}
                px="sm"
                value={prompt}
                onChange={(event) => onPromptChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                    return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
              <PromptHistory kind="positive" value={prompt} onPick={onPromptChange} />
              <Tooltip label={label} disabled={phone}>
                <ActionIcon
                  type="submit"
                  variant="filled"
                  size={phone ? 42 : undefined}
                  aria-label="Generate Variations"
                  aria-description={label}
                  loading={pending}
                  disabled={!prompt.trim()}
                >
                  <ArrowUp size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Paper>
        </form>
      )}
    </div>
  );
}
