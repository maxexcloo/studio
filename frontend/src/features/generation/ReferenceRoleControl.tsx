import { Group, SegmentedControl, Text } from "@mantine/core";
export function ReferenceRoleControl({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string) => void;
}) {
  return (
    <Group gap="sm">
      <Text size="xs" c="dimmed">
        Reference Role
      </Text>
      <SegmentedControl
        aria-label="Reference Role"
        size="xs"
        value={value === "reference" ? "reference" : "edit"}
        onChange={onChange}
        data={[
          { value: "edit", label: "Edit" },
          { value: "reference", label: "Reference" },
        ]}
      />
    </Group>
  );
}
