import { Text } from "@mantine/core";

import { formatDate, formatDateTime } from "../../ui/dates";

export function LibraryDate({ value, phone }: { value?: string | number; phone: boolean }) {
  if (value == null || value === "") return null;
  return (
    <Text
      size={phone ? "xs" : "sm"}
      c={phone ? "dimmed" : undefined}
      title={formatDateTime(value)}
      style={{ whiteSpace: "nowrap" }}
    >
      {formatDate(value)}
    </Text>
  );
}
