import { Group, SegmentedControl, Stack, Text } from "@mantine/core";
export function ReferenceRoleControl({
  value,
  onChange,
  locked = false,
}: {
  value: unknown;
  locked?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Stack gap={4}>
      <Group gap="sm">
        <Text size="xs" c="dimmed">
          Reference Role
        </Text>
        <SegmentedControl
          aria-label="Reference Role"
          size="xs"
          value={!locked && value === "reference" ? "reference" : "edit"}
          onChange={onChange}
          data={[
            { value: "edit", label: "Edit" },
            { value: "reference", label: "Reference", disabled: locked },
          ]}
        />
      </Group>
      {locked && (
        <Text size="xs" c="dimmed">
          Remove the mask to use Reference mode.
        </Text>
      )}
    </Stack>
  );
}
