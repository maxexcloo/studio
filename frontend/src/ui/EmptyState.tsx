import type { ReactNode } from "react";
import { Center, Stack, Text } from "@mantine/core";

/** One short, centred Title Case line such as No Images, with an optional action beneath. */
export function EmptyState({
  children,
  action,
  fill = false,
}: {
  children: ReactNode;
  /** A button beneath the line, such as New Chat. */
  action?: ReactNode;
  fill?: boolean;
}) {
  return (
    <Center flex={fill ? 1 : undefined} mih={fill ? 0 : { base: "12rem", sm: "24rem" }} px="md">
      <Stack align="center" gap="sm" c="dimmed" ta="center" maw={520}>
        <Text size="sm">{children}</Text>
        {action}
      </Stack>
    </Center>
  );
}
