import { Title } from "@mantine/core";
import type { ReactNode } from "react";

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <Title order={3} size="h4">
      {children}
    </Title>
  );
}
