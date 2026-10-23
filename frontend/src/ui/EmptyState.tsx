import type { ReactNode } from "react";
import { Center, Stack, Text, Title } from "@mantine/core";

export function EmptyState({
  children,
  title,
  fill = false,
}: {
  children?: ReactNode;
  title?: string;
  fill?: boolean;
}) {
  return (
    <Center flex={fill ? 1 : undefined} mih={fill ? 0 : { base: "12rem", sm: "24rem" }} px="md">
      <Stack align="center" gap="xs" c="dimmed" ta="center" maw={520}>
        {title && (
          <Title order={3} fw={450}>
            {title}
          </Title>
        )}
        {children && <Text size="sm">{children}</Text>}
      </Stack>
    </Center>
  );
}
