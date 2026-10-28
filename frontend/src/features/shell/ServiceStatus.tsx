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
      <Drawer.Root opened={opened} onClose={close} position="left" size={phone ? "85%" : 400}>
        <Drawer.Overlay />
        <Drawer.Content className={classes.content}>
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
                    size="compact-xs"
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
