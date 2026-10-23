import {
  ActionIcon,
  Box,
  Divider,
  Drawer,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  Button,
} from "@mantine/core";
import { Link } from "react-router";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { Image, MessageCircle, ListTodo, Video } from "lucide-react";
import { Queue, terminal, useQueue } from "../features/generation/Queue";
import { SessionList } from "../features/sessions/ChatWorkspace";
import {
  RuntimePanel,
  ServiceHealthSummary,
  healthColour,
  summaryHealth,
  useServicesStatus,
} from "../features/runtime/RuntimePanel";

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
          <Box w={12} h={12} bg={`${healthColour(state)}.6`} style={{ borderRadius: "50%" }} />
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
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  const [opened, handlers] = useDisclosure(false);
  const queue = useQueue(),
    status = useServicesStatus();
  const activeCount = queue.data?.jobs.filter((job) => !terminal.has(job.status)).length || 0;
  const current = status.data?.services[chat ? "text" : kind];
  const state = status.error ? "unknown" : current?.state || "unknown";
  const panel = (
    <Stack gap="md" flex={1} mih={0} h="100%">
      <Text size="sm" fw={600}>
        {narrow && chat ? "Sessions" : "Queue"}
      </Text>
      <Box flex={1} mih={0} style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {narrow && chat ? <SessionList close={handlers.close} /> : <Queue />}
      </Box>
      {narrow && (
        <>
          <Divider />
          <ServiceHealthSummary />
          <Button
            component={Link}
            to="/settings#workers"
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
  if (narrow)
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
            <Box w={12} h={12} bg={`${healthColour(state)}.6`} style={{ borderRadius: "50%" }} />
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
const modes = [
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/images", label: "Images", icon: Image },
  { to: "/video", label: "Videos", icon: Video },
];
function ModeTab({ index, active, narrow }: { index: number; active: boolean; narrow: boolean }) {
  const mode = modes[index];
  return (
    <Tooltip label={mode.label} disabled={!narrow}>
      <Box component="span" style={{ display: "inline-flex" }}>
        <Button
          component={Link}
          to={mode.to}
          aria-label={mode.label}
          aria-current={active ? "page" : undefined}
          variant={active ? "light" : "subtle"}
          color={active ? undefined : "gray"}
          px={{ base: 8, sm: 12 }}
          size="sm"
          radius="xl"
        >
          {narrow ? <mode.icon size={20} /> : mode.label}
        </Button>
      </Box>
    </Tooltip>
  );
}
export function ModeSwitcher({ active }: { active: (to: string) => boolean }) {
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  return (
    <Group
      gap={2}
      component="nav"
      aria-label="Creative Modes"
      className="studio-mode-tabs"
      wrap="nowrap"
    >
      {modes.map((mode, index) => (
        <ModeTab key={mode.to} index={index} active={active(mode.to)} narrow={narrow} />
      ))}
    </Group>
  );
}
