import { Center, Loader, Stack, Text } from "@mantine/core";
export function LoadingState({ label, fill = false }: { label: string; fill?: boolean }) {
  return (
    <Center
      flex={fill ? 1 : undefined}
      h={fill ? "100%" : undefined}
      mih={fill ? 0 : { base: "12rem", sm: "24rem" }}
      px="md"
    >
      <Stack align="center" gap="sm">
        <Loader size="sm" color="gray" aria-label={label} />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}
