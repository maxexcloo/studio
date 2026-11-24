import { Center, Loader, Stack, Text } from "@mantine/core";

import classes from "./LoadingState.module.css";

export function LoadingState({
  label,
  fill = false,
  view = false,
}: {
  label: string;
  fill?: boolean;
  /** Takes a whole view's room and centres as its EmptyState does, so content doesn't jump. */
  view?: boolean;
}) {
  return (
    // Grows to centre in any flex or sized container; elsewhere a panel's small minimum keeps it
    // clear of the top without leaving a gap for the content that replaces it.
    <Center
      flex={1}
      h="100%"
      mih={fill ? 0 : view ? { base: "12rem", sm: "24rem" } : "var(--studio-panel-min-height)"}
      px="md"
      data-empty-state={view ? "view" : undefined}
    >
      <Stack className={classes.indicator} align="center" gap="sm" role="status">
        <Loader size="sm" color="gray" aria-hidden />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}
