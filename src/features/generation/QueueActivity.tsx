import { Badge, Button, Drawer, Group, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Queue, terminal, useQueue } from "./Queue";
export function QueueActivity() {
  const queue = useQueue(),
    [opened, { open, close }] = useDisclosure(false);
  const active = queue.data?.jobs.filter((job) => !terminal.has(job.status)).length || 0;
  return (
    <>
      <Button variant="subtle" color="gray" size="sm" onClick={open}>
        <Group gap="xs">Queue{active > 0 && <Badge size="xs">{active}</Badge>}</Group>
      </Button>
      <Drawer
        opened={opened}
        onClose={close}
        title="Generation Queue"
        closeButtonProps={{ "aria-label": "Close Generation Queue" }}
        size="lg"
      >
        <Stack>
          <Queue />
        </Stack>
      </Drawer>
    </>
  );
}
