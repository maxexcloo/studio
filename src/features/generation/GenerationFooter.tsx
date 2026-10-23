import type { ReactNode } from "react";
import { Button, Group, SegmentedControl } from "@mantine/core";
import type { MediaKind } from "../../types";
export function GenerationFooter({
  kind,
  onKindChange,
  onClear,
  children,
}: {
  kind: MediaKind;
  onKindChange: (kind: MediaKind) => void;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <Group justify="space-between" gap="xs" wrap="wrap">
      <SegmentedControl
        aria-label="Generation Output"
        size="xs"
        value={kind}
        onChange={(value) => onKindChange(value as MediaKind)}
        data={[
          { value: "image", label: "Image" },
          { value: "video", label: "Video" },
        ]}
      />
      <Group gap="xs">
        <Button variant="subtle" color="gray" size="sm" onClick={onClear}>
          Clear
        </Button>
        {children}
      </Group>
    </Group>
  );
}
