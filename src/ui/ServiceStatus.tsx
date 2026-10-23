import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  Indicator,
  Loader,
  Popover,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { CircleDot, Image, MessageCircle, ListTodo, Video } from "lucide-react";
import { useGeneration } from "../features/generation/GenerationProvider";
import { Queue, terminal, useQueue } from "../features/generation/Queue";
import { useChat } from "../features/sessions/ChatProvider";
import { SessionList } from "../features/sessions/ChatWorkspace";

type Health = {
  label: string;
  state: "Available" | "Unavailable" | "Unverified" | "Checking";
  reason?: string;
};
const colour = (state: Health["state"]) =>
  state === "Available"
    ? "green"
    : state === "Unavailable"
      ? "red"
      : state === "Unverified"
        ? "yellow"
        : "gray";
export function ServiceStatus({ chat, kind }: { chat: boolean; kind: "image" | "video" }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [queueOpened, queuePanel] = useDisclosure(false);
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  const { models, profiles } = useGeneration(),
    { status, sendingSession } = useChat(),
    queue = useQueue();
  const services: Health[] = [
    {
      label: "Chat",
      state: status.isPending ? "Checking" : status.data?.available ? "Available" : "Unavailable",
      reason: status.error?.message || status.data?.reason,
    },
    ...(["image", "video"] as const).map((kind) => {
      const selected = profiles.filter(
          (profile) => profile.kind === kind && profile.ready !== false,
        ),
        ids = new Set(selected.flatMap((profile) => profile.workerIds || []));
      const workers =
        models.data?.workers?.filter(
          (worker) => ids.has(worker.id) || worker.capabilities.includes(kind),
        ) || [];
      const online =
          workers.some((worker) => worker.available) &&
          selected.some((profile) => !profile.provider),
        cloud = selected.some((profile) => profile.provider === "cliproxyapi"),
        count = workers.filter((worker) => worker.available).length;
      return {
        label: kind === "image" ? "Images" : "Videos",
        state: models.isPending
          ? "Checking"
          : online
            ? "Available"
            : cloud
              ? "Unverified"
              : "Unavailable",
        reason:
          models.error?.message ||
          (online
            ? `${count} ${count === 1 ? "worker" : "workers"} available.`
            : cloud
              ? "Cloud profiles are configured. Provider health has not been verified."
              : selected.length
                ? "Waiting for a compatible worker."
                : "No compatible profiles are available."),
      } as Health;
    }),
  ];
  const current = services[chat ? 0 : kind === "image" ? 1 : 2];
  const isBusy = (index: number) =>
    index === 0
      ? !!sendingSession
      : queue.data?.jobs.some(
          (job) =>
            !terminal.has(job.status) && job.input.kind === (index === 1 ? "image" : "video"),
        );
  const summary = (
    <Stack component="section" gap={4} mt="auto" aria-label="Service Status">
      {services.map((service) => (
        <Tooltip
          key={service.label}
          label={service.reason || service.state}
          position="top-end"
          events={{ hover: true, focus: true, touch: true }}
        >
          <Group
            justify="space-between"
            tabIndex={0}
            aria-label={`${service.label}: ${service.state}`}
            aria-description={service.reason}
          >
            <Group gap="xs">
              <CircleDot size={12} color={`var(--mantine-color-${colour(service.state)}-6)`} />
              <Text size="xs">{service.label}</Text>
            </Group>
            <Text size="xs" c="dimmed">
              {service.state}
            </Text>
          </Group>
        </Tooltip>
      ))}
    </Stack>
  );
  const body = (context: boolean) => (
    <Stack gap="md" flex={1} mih={0} h="100%">
      {context && (
        <>
          <Text size="sm" fw={600}>
            {narrow && chat ? "Sessions" : "Queue"}
          </Text>
          <Box
            flex={1}
            mih={0}
            style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}
          >
            {narrow && chat ? <SessionList close={close} /> : <Queue compact />}
          </Box>
          <Divider />
        </>
      )}
      {summary}
    </Stack>
  );
  if (narrow)
    return (
      <>
        <Tooltip label={`${current.label}: ${current.state}`}>
          <ActionIcon
            aria-label="Open Status"
            aria-expanded={opened}
            variant="subtle"
            color={colour(current.state)}
            onClick={open}
            size={36}
          >
            {isBusy(chat ? 0 : kind === "image" ? 1 : 2) || current.state === "Checking" ? (
              <Loader size={19} color={colour(current.state)} />
            ) : (
              <CircleDot size={21} />
            )}
          </ActionIcon>
        </Tooltip>
        <Drawer
          opened={opened}
          onClose={close}
          title="Status"
          closeButtonProps={{ "aria-label": "Close Status" }}
          size="85%"
          styles={{
            content: { display: "flex", flexDirection: "column" },
            body: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
          }}
        >
          {body(true)}
        </Drawer>
      </>
    );
  const icons = [MessageCircle, Image, Video];
  const activeCount = queue.data?.jobs.filter((job) => !terminal.has(job.status)).length || 0;
  return (
    <Group gap={8} wrap="nowrap">
      <Popover
        opened={opened}
        onChange={(value) => (value ? open() : close())}
        position="bottom-start"
        width={360}
        shadow="md"
        trapFocus
      >
        <Popover.Target>
          <Button.Group>
            {services.map((service, index) => {
              const Icon = icons[index];
              return (
                <Tooltip key={service.label} label={`${service.label}: ${service.state}`}>
                  <Button
                    aria-label={`${service.label} Status`}
                    aria-description={service.state}
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    px={8}
                    h={32}
                    onClick={() => {
                      queuePanel.close();
                      open();
                    }}
                  >
                    <Group gap={6} wrap="nowrap">
                      {isBusy(index) || service.state === "Checking" ? (
                        <Loader size={16} color={colour(service.state)} />
                      ) : (
                        <Indicator
                          color={colour(service.state)}
                          size={6}
                          offset={-1}
                          position="bottom-end"
                          withBorder
                        >
                          <Icon size={16} />
                        </Indicator>
                      )}
                      <Text component="span" visibleFrom="lg" size="xs">
                        {service.label}
                      </Text>
                    </Group>
                  </Button>
                </Tooltip>
              );
            })}
          </Button.Group>
        </Popover.Target>
        <Popover.Dropdown aria-labelledby="" aria-label="Service Status">
          {body(false)}
        </Popover.Dropdown>
      </Popover>
      <Popover
        opened={queueOpened}
        onChange={(value) => (value ? queuePanel.open() : queuePanel.close())}
        position="bottom-start"
        width={360}
        shadow="md"
        trapFocus
      >
        <Popover.Target>
          <Button
            aria-label="Open Queue"
            variant="default"
            color="gray"
            size="compact-sm"
            h={32}
            leftSection={<ListTodo size={16} />}
            rightSection={
              activeCount ? (
                <Badge size="xs" variant="light" color="gray">
                  {activeCount}
                </Badge>
              ) : undefined
            }
            onClick={() => {
              close();
              queuePanel.toggle();
            }}
          >
            Queue
          </Button>
        </Popover.Target>
        <Popover.Dropdown aria-labelledby="" aria-label="Queue" h="min(65dvh, 600px)">
          {body(true)}
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}
