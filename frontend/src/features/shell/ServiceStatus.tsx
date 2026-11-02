import {
  ActionIcon,
  Button,
  Divider,
  Drawer,
  FocusTrap,
  Group,
  Loader,
  Stack,
  Tooltip,
} from "@mantine/core";
import { useDisclosure, useWindowEvent } from "@mantine/hooks";
import { useRef, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, MessagesSquare, Server } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useIsAdmin } from "../auth/AccountGate";
import { Queue, terminal, useQueue } from "../generation/Queue";
import { ServiceHealthSummary, serviceSummary, servicesStatusQuery } from "../runtime/RuntimePanel";
import { NewChatAction, openChatsEvent, SessionList } from "../sessions/ChatWorkspace";
import { usePhone } from "../../ui/usePhone";
import classes from "./ServiceStatus.module.css";

/** The one header entry to work in progress, Chats and service health on every breakpoint. */
export function StatusAction({ chat }: { chat: boolean }) {
  const [opened, { open, close }] = useDisclosure(false);
  // The phone's No Chat Selected view opens the Chats list too.
  useWindowEvent(openChatsEvent, open);
  const phone = usePhone();
  const admin = useIsAdmin();
  const location = useLocation();
  const queue = useQueue();
  const summary = serviceSummary(useQuery(servicesStatusQuery));
  const generating = queue.data?.jobs.some((job) => !terminal.has(job.status));
  const title = chat ? "Chats" : "Generations";
  // In Chat it is plainly the Chats list, still coloured by service health.
  const Icon = chat ? MessagesSquare : Activity;
  // A sideways touch drag pulls the drawer with the finger; far enough, and it closes.
  const drag = useRef<{ id: number; x: number; y: number; dx: number } | null>(null);
  function release(event: PointerEvent<HTMLElement>) {
    const start = drag.current;
    drag.current = null;
    if (!start?.dx) return;
    event.currentTarget.style.transition = "";
    if (start.dx < -80 && event.type === "pointerup") close();
    else event.currentTarget.style.transform = "";
  }
  return (
    <>
      <Tooltip
        label={[chat && "Chats", generating ? "Generating" : summary.label]
          .filter(Boolean)
          .join(" · ")}
      >
        <ActionIcon
          aria-label={chat ? "Open Chats" : "Open Status"}
          aria-description={generating ? "Generating" : summary.label}
          aria-haspopup="dialog"
          aria-expanded={opened}
          variant="subtle"
          color={generating ? "gray" : summary.colour}
          onClick={open}
        >
          {generating ? <Loader size={18} color="gray" /> : <Icon size={19} />}
        </ActionIcon>
      </Tooltip>
      <Drawer.Root
        opened={opened}
        onClose={close}
        position="left"
        size={phone ? "85%" : 400}
        classNames={{ content: classes.content }}
      >
        <Drawer.Overlay />
        <Drawer.Content
          onPointerDown={(event) => {
            drag.current =
              event.pointerType === "touch"
                ? { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0 }
                : null;
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start?.id !== event.pointerId) return;
            const dx = Math.min(0, event.clientX - start.x);
            if (!start.dx && Math.abs(event.clientY - start.y) > Math.abs(dx)) {
              drag.current = null;
              return;
            }
            start.dx = dx;
            event.currentTarget.style.transition = "none";
            event.currentTarget.style.transform = `translateX(${dx}px)`;
          }}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <Drawer.Header>
            <Drawer.Title>{title}</Drawer.Title>
            <Group gap="xs" wrap="nowrap">
              {chat && <NewChatAction onDone={close} />}
              <Drawer.CloseButton aria-label={`Close ${title}`} />
            </Group>
          </Drawer.Header>
          <Drawer.Body className={classes.body}>
            <FocusTrap.InitialFocus />
            <div className={classes.list}>{chat ? <SessionList close={close} /> : <Queue />}</div>
            <Divider />
            <Stack gap="xs" pt="md">
              <ServiceHealthSummary />
              {admin && (
                <Group justify="end">
                  <Button
                    component={Link}
                    to="/settings#workers"
                    state={{ backgroundLocation: location }}
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    leftSection={<Server size={14} />}
                    onClick={close}
                  >
                    Workers
                  </Button>
                </Group>
              )}
            </Stack>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
