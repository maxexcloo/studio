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
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useIsAdmin } from "../auth/AccountGate";
import { Queue, QueueActions, useQueue } from "../generation/Queue";
import { SwapNotice } from "../runtime/JobSwap";
import { ServiceHealthSummary, serviceSummary, servicesStatusQuery } from "../runtime/RuntimePanel";
import { closeWhenTop, layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { useSwipeClose } from "../../ui/useSwipeClose";
import classes from "./ServiceStatus.module.css";
import { terminalStatuses } from "../../../../shared/queue";

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
  const generating = queue.data?.jobs.some((job) => !terminalStatuses.has(job.status));
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
  const trigger = (
    <ActionIcon
      ref={target}
      aria-label="Open Status"
      aria-description={generating ? "Generating" : summary.label}
      aria-haspopup="dialog"
      aria-expanded={opened}
      variant="subtle"
      color={generating ? "gray" : summary.colour}
      onClick={() => setOpened(!opened)}
    >
      {generating ? <Loader size={18} color="gray" /> : <Activity size={19} />}
    </ActionIcon>
  );
  const tooltip = generating ? "Generating" : summary.label;
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
          <Tooltip label={tooltip} disabled={opened}>
            <Popover.Target>{trigger}</Popover.Target>
          </Tooltip>
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
            <Drawer.CloseButton aria-label={`Close ${title}`} />
          </Drawer.Header>
          <Drawer.Body className={classes.body}>
            <FocusTrap.InitialFocus />
            {/* The queue's actions have a row of their own, as the drawer is too narrow beside the title. */}
            <Group justify="flex-end">
              <QueueActions />
            </Group>
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
