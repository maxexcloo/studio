import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Image,
  Loader,
  Paper,
  ScrollArea,
  Skeleton,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Play, RefreshCw } from "lucide-react";
import type { MediaItem, QueueJob } from "../../types";
import { useGeneration } from "../generation/GenerationProvider";
import { assistantQuery } from "../generation/PromptAssistant";
import { PromptHistory } from "../generation/PromptHistory";
import { queueQuery, terminal } from "../generation/Queue";
import { usePhone } from "../../ui/usePhone";
import { askNextSteps, nextStepsQuery } from "../taste/suggestions";
import { versionGroups } from "./versions";
import classes from "./MediaViewer.module.css";

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
    const runs = new Set(versions.map((version) => version.jobId));
    const from = (job: QueueJob) =>
      job.parentItemId
        ? ids.has(job.parentItemId)
        : Boolean(job.parentJobId) && runs.has(job.parentJobId);
    const waiting = all
      .filter(
        (job) =>
          !terminal.has(job.status) &&
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

/** Whether the viewer offers next steps for this item: a finished image, with the prompt assistant. */
const steppable = (item: MediaItem | undefined, assistant: boolean): item is MediaItem =>
  Boolean(assistant && item?.type === "image" && item.status === "done" && item.url && item.jobId);

/**
 * Taste-led next steps for a finished image. Placeholder chips hold the row while they load; a
 * chip puts its rewritten prompt in the prompt bar and generates it at once, and More Next Steps
 * asks for different ones. The neighbour's steps are fetched once these have arrived.
 */
function NextSteps({
  item,
  neighbour,
  prompt,
  pending,
  apply,
}: {
  item: MediaItem;
  neighbour?: MediaItem;
  prompt: string;
  pending: boolean;
  apply: (prompt: string) => void;
}) {
  const client = useQueryClient();
  const query = nextStepsQuery(item.jobId!);
  const steps = useQuery(query);
  const more = useMutation({
    mutationFn: () => askNextSteps(item.jobId!, true),
    onSuccess: (fresh) => client.setQueryData(query.queryKey, fresh),
  });
  const ready = steps.isSuccess;
  const next = steppable(neighbour, true) ? neighbour.jobId! : "";
  useEffect(() => {
    if (ready && next) void client.prefetchQuery(nextStepsQuery(next));
  }, [ready, next]);
  const loading = steps.isPending || more.isPending;
  const list = steps.data?.suggestions ?? [];
  if (steps.isError || (!loading && !list.length)) return null;
  return (
    <ScrollArea type="never" className={classes.steps} onClick={(event) => event.stopPropagation()}>
      <Group
        role="group"
        aria-label="Next Steps"
        aria-busy={loading || undefined}
        gap={6}
        wrap="nowrap"
        className={classes.stepRow}
      >
        {loading
          ? [0, 1, 2].map((index) => (
              <Skeleton key={index} radius="xl" className={classes.stepSkeleton} />
            ))
          : list.map((step) => (
              <Button
                key={step.label}
                size="compact-sm"
                radius="xl"
                variant={prompt === step.prompt ? "light" : "default"}
                title={step.request}
                className={classes.step}
                loading={pending && prompt === step.prompt}
                disabled={pending}
                onClick={() => apply(step.prompt)}
              >
                {step.label}
              </Button>
            ))}
        <Tooltip label="More Next Steps">
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label="More Next Steps"
            disabled={loading}
            onClick={() => more.mutate()}
          >
            <RefreshCw size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </ScrollArea>
  );
}

/** The variation strip and the prefilled prompt bar under the viewer image. */
export function MediaViewerDock({
  item,
  neighbour,
  family,
  choose,
  prompt,
  onPromptChange,
  onSubmit,
  onApply,
  pending,
  actions,
}: {
  item: MediaItem;
  /** The next item, whose next steps load once this item's have. */
  neighbour?: MediaItem;
  family: Entry[];
  choose?: (item: MediaItem) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  /** Generates variations with this prompt, which the prompt bar shows. */
  onApply: (prompt: string) => void;
  pending: boolean;
  actions: React.ReactNode;
}) {
  const phone = usePhone();
  const { input } = useGeneration();
  const ready = item.status === "done" && Boolean(item.url);
  const assistant = useQuery(assistantQuery);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const label = `Generate ${input.count} Variation${input.count === 1 ? "" : "s"}`;
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
      {steppable(item, Boolean(assistant.data?.available)) && (
        <NextSteps
          key={item.jobId}
          item={item}
          neighbour={neighbour}
          prompt={prompt}
          pending={pending}
          apply={onApply}
        />
      )}
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
                ref={promptField}
                aria-label="Variation Prompt"
                placeholder="Describe a variation…"
                variant="unstyled"
                autosize
                minRows={1}
                maxRows={phone ? 4 : 6}
                flex={1}
                px="sm"
                classNames={{ wrapper: classes.promptWrapper, input: classes.promptInput }}
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
