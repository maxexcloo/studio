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
} from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, MessagesSquare } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useIsAdmin } from "../auth/AccountGate";
import { Queue, QueueActions, useQueue } from "../generation/Queue";
import { ServiceHealthSummary, serviceSummary, servicesStatusQuery } from "../runtime/RuntimePanel";
import { SessionList } from "../sessions/ChatWorkspace";
import { closeWhenTop, layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { useSwipeClose } from "../../ui/useSwipeClose";
import classes from "./ServiceStatus.module.css";
import { terminalStatuses } from "../../../../shared/queue";

/**
 * The one header entry to work in progress, Chats and service health on every breakpoint. Desktop
 * opens the queue as a dropdown under the icon, also in Chat, whose sidebar lists the Chats; phones
 * slide in a drawer, with the Chats in Chat.
 */
export function StatusAction({ chat }: { chat: boolean }) {
  const [opened, setOpened] = useState(false);
  const close = () => setOpened(false);
  const phone = usePhone();
  const admin = useIsAdmin();
  const location = useLocation();
  const queue = useQueue();
  const summary = serviceSummary(useQuery(servicesStatusQuery));
  const generating = queue.data?.jobs.some((job) => !terminalStatuses.has(job.status));
  const chats = chat && phone;
  const title = chats ? "Chats" : "Generations";
  // In Chat on phones it is plainly the Chats list, still coloured by service health.
  const Icon = chats ? MessagesSquare : Activity;
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
      aria-label={chats ? "Open Chats" : "Open Status"}
      aria-description={generating ? "Generating" : summary.label}
      aria-haspopup="dialog"
      aria-expanded={opened}
      variant="subtle"
      color={generating ? "gray" : summary.colour}
      onClick={() => setOpened(!opened)}
    >
      {generating ? <Loader size={18} color="gray" /> : <Icon size={19} />}
    </ActionIcon>
  );
  const tooltip = [chats && "Chats", generating ? "Generating" : summary.label]
    .filter(Boolean)
    .join(" · ");
  // For administrators the whole status block opens Settings › Workers.
  const status = (
    <div className={classes.status}>
      {admin && (
        <Link
          to="/settings#workers"
          state={{ backgroundLocation: location }}
          className={classes.statusLink}
          aria-label="Open Workers"
          onClick={close}
        />
      )}
      <ServiceHealthSummary />
    </div>
  );
  if (!phone)
    return (
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
            <Drawer.Title>{title}</Drawer.Title>
            <Group gap="xs" wrap="nowrap">
              {!chats && <QueueActions />}
              <Drawer.CloseButton aria-label={`Close ${title}`} />
            </Group>
          </Drawer.Header>
          <Drawer.Body className={classes.body}>
            <FocusTrap.InitialFocus />
            <div className={classes.list}>{chats ? <SessionList close={close} /> : <Queue />}</div>
            <Divider />
            {status}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
