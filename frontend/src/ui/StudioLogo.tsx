import { Title, type TitleOrder } from "@mantine/core";

export function StudioLogo({ order }: { order: TitleOrder }) {
  return (
    <Title className="studio-logo" order={order}>
      Studio<span style={{ color: "var(--mantine-primary-color-filled)" }}>.</span>
    </Title>
  );
}
