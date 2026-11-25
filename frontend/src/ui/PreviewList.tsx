import { Button, Stack } from "@mantine/core";
import { type ReactNode, useState } from "react";

export function PreviewList<T>({
  items,
  inline = false,
  children,
}: {
  items: T[];
  inline?: boolean;
  children: (shown: T[]) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  return (
    <Stack component={inline ? "span" : "div"} gap={4}>
      {children(all ? items : items.slice(0, 3))}
      {items.length > 3 && (
        <Button
          variant="subtle"
          size="compact-sm"
          aria-expanded={all}
          style={{ alignSelf: "flex-start" }}
          onClick={() => setAll(!all)}
        >
          {all ? "Show Less" : "Show All"}
        </Button>
      )}
    </Stack>
  );
}
