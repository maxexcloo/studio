import { ActionIcon, Button, Divider, Drawer, Group, Loader, Stack, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { Activity, Server } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useIsAdmin } from "../auth/AccountGate";
import { Queue, terminal, useQueue } from "../generation/Queue";
import { ServiceHealthSummary, serviceSummary, servicesStatusQuery } from "../runtime/RuntimePanel";
import { SessionList } from "../sessions/ChatWorkspace";
import { usePhone } from "../../ui/usePhone";
import classes from "./ServiceStatus.module.css";

/** The one header entry to work in progress, Chats and service health on every breakpoint. */
export function StatusAction({ chat }: { chat: boolean }) {
  const [opened, { open, close }] = useDisclosure(false);
  const phone = usePhone();
  const admin = useIsAdmin();
  const location = useLocation();
  const queue = useQueue();
  const summary = serviceSummary(useQuery(servicesStatusQuery));
  const generating = queue.data?.jobs.some((job) => !terminal.has(job.status));
  const title = chat ? "Chats" : "Generations";
  return (
    <>
      <Tooltip label={generating ? "Generating" : summary.label}>
        <ActionIcon
          aria-label="Open Status"
          aria-description={generating ? "Generating" : summary.label}
          aria-haspopup="dialog"
          aria-expanded={opened}
          variant="subtle"
          color={generating ? "gray" : summary.colour}
          onClick={open}
        >
          {generating ? <Loader size={18} color="gray" /> : <Activity size={19} />}
        </ActionIcon>
      </Tooltip>
      <Drawer
        opened={opened}
        onClose={close}
        position="left"
        size={phone ? "85%" : 400}
        title={title}
        closeButtonProps={{ "aria-label": `Close ${title}` }}
        classNames={{ content: classes.content, body: classes.body }}
      >
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
      </Drawer>
    </>
  );
}
