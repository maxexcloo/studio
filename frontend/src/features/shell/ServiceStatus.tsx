import {
  ActionIcon,
  Box,
  Divider,
  Drawer,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  Button,
} from "@mantine/core";
import { Link, useLocation } from "react-router";
import { useDisclosure } from "@mantine/hooks";
import { ListTodo } from "lucide-react";
import type { ServiceHealth } from "../../../../shared/services";
import { Queue, terminal, useQueue } from "../generation/Queue";
import { SessionList } from "../sessions/ChatWorkspace";
import {
  RuntimePanel,
  ServiceHealthSummary,
  healthColour,
  summaryHealth,
  useServicesStatus,
} from "../runtime/RuntimePanel";
import { usePhone } from "../../ui/usePhone";

function StatusDot({ state }: { state: ServiceHealth }) {
  return <Box w={12} h={12} bg={`${healthColour(state)}.6`} style={{ borderRadius: "50%" }} />;
}

export function RuntimeStatusAction() {
  const status = useServicesStatus();
  const state = status.error ? "unknown" : summaryHealth(status.data);
  const [opened, handlers] = useDisclosure(false);
  return (
    <Popover
      opened={opened}
      onChange={(value) => (value ? handlers.open() : handlers.close())}
      width={380}
      position="bottom-end"
      shadow="md"
      trapFocus
      returnFocus
    >
      <Popover.Target>
        <ActionIcon
          aria-label="Runtime Status"
          aria-description={state}
          aria-expanded={opened}
          variant="subtle"
          color={healthColour(state)}
          size="lg"
          onClick={handlers.toggle}
        >
          <StatusDot state={state} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown aria-labelledby="" aria-label="Runtime Status">
        <ScrollArea.Autosize mah="min(70dvh, 640px)">
          <RuntimePanel compact />
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
export function ServiceStatus({ chat, kind }: { chat: boolean; kind: "image" | "video" }) {
  const phone = usePhone();
  const [opened, handlers] = useDisclosure(false);
  const location = useLocation();
  const queue = useQueue(),
    status = useServicesStatus();
  const activeCount = queue.data?.jobs.filter((job) => !terminal.has(job.status)).length || 0;
  const current = status.data?.services[chat ? "text" : kind];
  const state = status.error ? "unknown" : current?.state || "unknown";
  const panel = (
    <Stack gap="md" flex={1} mih={0} h="100%">
      <Text size="sm" fw={600}>
        {phone && chat ? "Sessions" : "Queue"}
      </Text>
      <Box flex={1} mih={0} style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {phone && chat ? <SessionList close={handlers.close} /> : <Queue />}
      </Box>
      {phone && (
        <>
          <Divider />
          <ServiceHealthSummary />
          <Button
            component={Link}
            to="/settings#workers"
            state={{ backgroundLocation: location }}
            variant="subtle"
            size="compact-sm"
            onClick={handlers.close}
          >
            Settings
          </Button>
        </>
      )}
    </Stack>
  );
  if (phone)
    return (
      <>
        <Tooltip label={current?.reason || "Service Status"}>
          <ActionIcon
            aria-label="Open Status"
            aria-expanded={opened}
            variant="subtle"
            color={healthColour(state)}
            onClick={handlers.open}
            size={36}
          >
            <StatusDot state={state} />
          </ActionIcon>
        </Tooltip>
        <Drawer
          opened={opened}
          onClose={handlers.close}
          title="Status"
          closeButtonProps={{ "aria-label": "Close Status" }}
          size="85%"
          styles={{
            content: { display: "flex", flexDirection: "column" },
            body: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
          }}
        >
          {panel}
        </Drawer>
      </>
    );
  return (
    <Popover
      opened={opened}
      onChange={(value) => (value ? handlers.open() : handlers.close())}
      position="bottom-start"
      width={360}
      shadow="md"
      trapFocus
    >
      <Popover.Target>
        <ActionIcon
          aria-label="Open Queue"
          variant="subtle"
          color="gray"
          size={36}
          title="Queue"
          onClick={handlers.toggle}
        >
          <Indicator label={activeCount} disabled={!activeCount} size={14} color="gray">
            <ListTodo size={19} />
          </Indicator>
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown
        aria-labelledby=""
        aria-label="Queue"
        h={activeCount ? "min(65dvh, 600px)" : "min(50dvh, 320px)"}
      >
        {panel}
      </Popover.Dropdown>
    </Popover>
  );
}
