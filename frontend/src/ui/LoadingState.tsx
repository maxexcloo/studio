import { Center, Loader, Stack, Text } from "@mantine/core";

import classes from "./LoadingState.module.css";

export function LoadingState({ label, fill = false }: { label: string; fill?: boolean }) {
  return (
    // Grows to centre in any flex or sized container; the minimum keeps it clear of the top elsewhere.
    <Center flex={1} h="100%" mih={fill ? 0 : { base: "12rem", sm: "24rem" }} px="md">
      <Stack className={classes.indicator} align="center" gap="sm" role="status">
        <Loader size="sm" color="gray" aria-hidden />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}
