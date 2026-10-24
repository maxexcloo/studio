import { Title, type TitleOrder } from "@mantine/core";
import classes from "./StudioLogo.module.css";

export function StudioLogo({ order }: { order: TitleOrder }) {
  return (
    <Title className={classes.logo} order={order}>
      Studio<span style={{ color: "var(--mantine-primary-color-filled)" }}>.</span>
    </Title>
  );
}
