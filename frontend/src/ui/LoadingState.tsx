import { Center, Loader, Stack, Text } from "@mantine/core";
export function LoadingState({ label, fill = false }: { label: string; fill?: boolean }) {
  return (
    // Grows to centre in any flex or sized container; the minimum keeps it clear of the top elsewhere.
    <Center
      flex={1}
      h="100%"
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
