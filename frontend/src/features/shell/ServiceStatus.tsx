import {
  ActionIcon,
  Divider,
  Drawer,
  FocusTrap,
  Group,
  Popover,
  Progress,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import { activeStatuses, pausedReason, terminalStatuses } from "../../../../shared/queue";
import type { QueueJob } from "../../types";
import { icons } from "../../ui/icons";
import { closeWhenTop, layerAbove } from "../../ui/popupClicks";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { usePhone } from "../../ui/usePhone";
import { useSwipeClose } from "../../ui/useSwipeClose";
import { useIsAdmin } from "../auth/AccountGate";
import { Queue, QueueActions, queueEntries, useQueue } from "../generation/Queue";
import { useModelDownloads } from "../library/useModelDownloads";
import { ServiceHealthSummary, serviceSummary, servicesStatusQuery } from "../runtime/RuntimePanel";

import classes from "./ServiceStatus.module.css";

/** Include finished jobs whose lifetimes overlap the current uninterrupted stretch of work. */
function queueProgress(jobs: QueueJob[], unfinished: QueueJob[]) {
  if (!unfinished.length) return;
  let start = unfinished.reduce(
    (earliest, job) => (job.createdAt < earliest ? job.createdAt : earliest),
    unfinished[0].createdAt,
  );
  const history = jobs
    .filter((job) => terminalStatuses.has(job.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  let finished = 0;
  let failed = 0;
  for (const job of history) {
    if (job.updatedAt < start) break;
    if (job.createdAt < start) start = job.createdAt;
    if (job.status === "cancelled") continue;
    finished++;
    if (job.status === "failed") failed++;
  }
  return { finished, failed, total: finished + unfinished.length };
}

/**
 * The one header entry to work in progress and service health on every breakpoint. Desktop opens
 * the queue as a dropdown under the icon; phones slide in a drawer.
 */
export function StatusAction() {
  const [opened, setOpened] = useState(false);
  const close = () => setOpened(false);
  const phone = usePhone();
  const queue = useQueue();
  const summary = serviceSummary(useQuery(servicesStatusQuery));
  const jobs = queue.data?.jobs ?? [];
  // Work a paused queue holds is waiting, not generating.
  const unfinished = jobs.filter((job) => !terminalStatuses.has(job.status));
  const progress = queueProgress(jobs, unfinished);
  const progressLabel =
    progress &&
    [
      `${progress.finished} of ${progress.total} Finished`,
      progress.failed && `${progress.failed} Failed`,
    ]
      .filter(Boolean)
      .join(" · ");
  const generating = unfinished.some((job) => job.reason !== pausedReason);
  const held = !generating && unfinished.length > 0;
  // The summary counts running work too, so it reads again as soon as the account's own starts or ends.
  const client = useQueryClient();
  const running = unfinished.filter((job) => activeStatuses.has(job.status));
  const runningKey = running.map((job) => job.id).join();
  useEffect(() => {
    void client.invalidateQueries({ queryKey: servicesStatusQuery.queryKey });
  }, [client, runningKey]);
  const title = "Queue";
  const downloads = useModelDownloads();
  const count = queueEntries(jobs).length + downloads.length;
  const heading = count ? `${title} (${count})` : title;
  // A sideways touch drag pulls the drawer with the finger; far enough, and it closes.
  const swipe = useSwipeClose("left", close);
  const target = useRef<HTMLButtonElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  // The dropdown closes on Escape or a press outside it, but not in a menu or confirmation it opened.
  // Escape is caught on the way down: an open tooltip stops it on its focused button to close itself.
  useEffect(() => {
    if (phone || !opened) return;
    const away = (event: globalThis.PointerEvent) => {
      const pressed = event.target as Element;
      if (target.current?.contains(pressed) || dropdown.current?.contains(pressed)) return;
      if (!layerAbove(dropdown.current)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !layerAbove(dropdown.current, event))
        close();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [phone, opened]);
  const tooltip = [generating ? "Generating" : held ? "Queue Paused" : summary.label, progressLabel]
    .filter(Boolean)
    .join(" · ");
  const overall = progress && (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        {progressLabel}
      </Text>
      <Progress
        aria-label="Overall Queue Progress"
        size="xs"
        value={(progress.finished * 100) / progress.total}
      />
    </Stack>
  );
  const trigger = (
    <ActionIcon
      ref={target}
      aria-label="Open Status"
      aria-description={tooltip}
      aria-haspopup="dialog"
      aria-expanded={opened}
      variant="subtle"
      color={generating || held ? "gray" : summary.colour}
      className={progress ? classes.counted : undefined}
      onClick={() => setOpened(!opened)}
    >
      <icons.queue size={19} />
      {progress && (
        <span aria-hidden className={classes.progress}>
          {progress.finished}/{progress.total}
        </span>
      )}
    </ActionIcon>
  );
  // Administrators open Settings › Workers from the summary; it stays read-only for others.
  const admin = useIsAdmin();
  const location = useLocation();
  const status = admin ? (
    <UnstyledButton
      component={Link}
      to="/settings#workers"
      state={{ backgroundLocation: location }}
      aria-label="Open Workers"
      className={classes.summary}
      onClick={close}
    >
      <ServiceHealthSummary />
    </UnstyledButton>
  ) : (
    <ServiceHealthSummary />
  );
  if (!phone)
    return (
      <>
        <Popover
          opened={opened}
          onChange={setOpened}
          position="bottom-start"
          width={400}
          closeOnClickOutside={false}
          closeOnEscape={false}
          returnFocus
          shadow="md"
        >
          <PopupTooltip label={tooltip}>
            <Popover.Target>{trigger}</Popover.Target>
          </PopupTooltip>
          <Popover.Dropdown
            data-popup-outside={false}
            ref={dropdown}
            aria-label={title}
            aria-labelledby=""
            className={classes.dropdown}
          >
            <Group justify="space-between" wrap="nowrap" mih={28}>
              <Text fw={500}>{heading}</Text>
              <QueueActions />
            </Group>
            {overall}
            <div className={classes.list}>
              <Queue downloads={downloads} />
            </div>
            <Divider />
            {status}
          </Popover.Dropdown>
        </Popover>
      </>
    );
  return (
    <>
      <Tooltip label={tooltip}>{trigger}</Tooltip>
      <Drawer.Root
        id="status"
        opened={opened}
        onClose={closeWhenTop("status", close)}
        position="left"
        size="85%"
        classNames={{ content: classes.content }}
      >
        <Drawer.Overlay />
        <Drawer.Content {...swipe}>
          <Drawer.Header>
            <Drawer.Title aria-label={title}>{heading}</Drawer.Title>
            {/* The queue's actions sit beside Close, as on desktop beside the title. */}
            <Group gap="xs" wrap="nowrap">
              <QueueActions />
              <Drawer.CloseButton aria-label={`Close ${title}`} />
            </Group>
          </Drawer.Header>
          <Drawer.Body className={classes.body}>
            <FocusTrap.InitialFocus />
            {overall}
            <div className={classes.list}>
              <Queue downloads={downloads} />
            </div>
            <Divider />
            {status}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
