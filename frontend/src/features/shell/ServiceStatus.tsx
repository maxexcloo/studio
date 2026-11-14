import {
  ActionIcon,
  Divider,
  Drawer,
  FocusTrap,
  Group,
  Loader,
  Popover,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import { pausedReason, terminalStatuses } from "../../../../shared/queue";
import { icons } from "../../ui/icons";
import { closeWhenTop, layerAbove } from "../../ui/popupClicks";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { usePhone } from "../../ui/usePhone";
import { useSwipeClose } from "../../ui/useSwipeClose";
import { useIsAdmin } from "../auth/AccountGate";
import { Queue, QueueActions, useQueue } from "../generation/Queue";
import { SwapNotice } from "../runtime/JobSwap";
import { ServiceHealthSummary, serviceSummary, servicesStatusQuery } from "../runtime/RuntimePanel";

import classes from "./ServiceStatus.module.css";

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
  // Work a paused queue holds is waiting, not generating.
  const unfinished = queue.data?.jobs.filter((job) => !terminalStatuses.has(job.status)) ?? [];
  const generating = unfinished.some((job) => job.reason !== pausedReason);
  const held = !generating && unfinished.length > 0;
  const title = "Generations";
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
  const tooltip = generating ? "Generating" : held ? "Queue Paused" : summary.label;
  const trigger = (
    <ActionIcon
      ref={target}
      aria-label="Open Status"
      aria-description={tooltip}
      aria-haspopup="dialog"
      aria-expanded={opened}
      variant="subtle"
      color={generating || held ? "gray" : summary.colour}
      onClick={() => setOpened(!opened)}
    >
      {generating ? (
        <Loader size={18} color="gray" />
      ) : held ? (
        <icons.pause size={19} />
      ) : (
        <Activity size={19} />
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
  const notice = <SwapNotice jobs={queue.data?.jobs} />;
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
            ref={dropdown}
            aria-label={title}
            aria-labelledby=""
            className={classes.dropdown}
          >
            <Group justify="space-between" wrap="nowrap" mih={28}>
              <Text fw={500}>{title}</Text>
              <QueueActions />
            </Group>
            <div className={classes.list}>
              <Queue />
            </div>
            <Divider />
            {status}
          </Popover.Dropdown>
        </Popover>
        {notice}
      </>
    );
  return (
    <>
      <Tooltip label={tooltip}>{trigger}</Tooltip>
      {notice}
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
            <Drawer.Title>{title}</Drawer.Title>
            {/* The queue's actions sit beside Close, as on desktop beside the title. */}
            <Group gap="xs" wrap="nowrap">
              <QueueActions />
              <Drawer.CloseButton aria-label={`Close ${title}`} />
            </Group>
          </Drawer.Header>
          <Drawer.Body className={classes.body}>
            <FocusTrap.InitialFocus />
            <div className={classes.list}>
              <Queue />
            </div>
            <Divider />
            {status}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
