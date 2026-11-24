import {
  Button,
  FloatingIndicator,
  Group,
  Indicator,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useLocation } from "react-router";

import { AppearanceMenu, useAppearance } from "../../ui/Appearance";
import { icons } from "../../ui/icons";
import { StudioLogo } from "../../ui/StudioLogo";
import { usePhone } from "../../ui/usePhone";
import { useAccount, useGroupFeature } from "../auth/AccountGate";
import { dreamCountQuery, dreamQuery } from "../dream/queries";
import { type GalleryState, galleryKind } from "../gallery/viewerLink";
import { FinishedAway } from "./FinishedAway";
import { HeaderOptions } from "./HeaderOptions";
import { StatusAction } from "./ServiceStatus";

import classes from "./AppHeader.module.css";

const modes = [
  { to: "/dream", label: "Dream", icon: icons.dream },
  { to: "/images", label: "Images", icon: icons.image },
  { to: "/videos", label: "Videos", icon: icons.video },
];
function ModeSwitcher({ mode }: { mode: string }) {
  const phone = usePhone();
  const location = useLocation();
  const { chat, turn, show, set } = (location.state as GalleryState | null) || {};
  const linkedGallery = galleryKind(location.pathname) && (chat || set);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<HTMLElement | null>(null);
  const shown = { "/dream": useGroupFeature("dream") };
  const chatUrl = useAccount().data?.chatUrl;
  // Dream's results waiting for a verdict, counted on its tab.
  const unseen =
    useQuery({
      ...dreamCountQuery,
      enabled: shown["/dream"] !== false,
      select: (count) => count.unseen,
    }).data || 0;
  const unseenId = useId();
  const client = useQueryClient();
  // Dream's deck starts loading as the pointer or focus reaches its tab.
  const prefetchDream = () => void client.prefetchQuery(dreamQuery);
  return (
    <Group
      ref={setRoot}
      gap={phone ? 0 : 2}
      component="nav"
      aria-label="Creative Modes"
      className={classes.modes}
      wrap="nowrap"
    >
      <FloatingIndicator target={selected} parent={root} className={classes.indicator} />
      {/* People chat on the deployment's chat site (LibreChat), which reaches Studio over MCP. */}
      {chatUrl && (
        <Tooltip label="Chat" disabled={!phone}>
          <Button
            component="a"
            href={chatUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Chat"
            aria-description="Opens in a new tab"
            variant="subtle"
            color="gray"
            className={classes.mode}
            px={phone ? 8 : 12}
            size="sm"
            radius="xl"
            rightSection={phone ? undefined : <icons.external size={12} aria-hidden />}
          >
            {phone ? <icons.chat size={20} /> : "Chat"}
          </Button>
        </Tooltip>
      )}
      {modes
        .filter((item) => shown[item.to as keyof typeof shown] !== false)
        .map((item) => {
          const active = mode.startsWith(item.to);
          const count = item.to === "/dream" ? unseen : 0;
          return (
            <Tooltip key={item.to} label={item.label} disabled={!phone}>
              <Indicator
                // The indicator tracks this wrapper: the Link inside merges refs anew each render,
                // so a ref there detaches and reattaches on every render and never settles.
                ref={active ? setSelected : undefined}
                component="span"
                display="inline-flex"
                disabled={!count}
                label={<span aria-hidden>{count > 99 ? "99+" : count}</span>}
                classNames={{ indicator: classes.count }}
                size={16}
                offset={4}
                zIndex={2}
              >
                {count > 0 && <VisuallyHidden id={unseenId}>{count} Unseen</VisuallyHidden>}
                <Button
                  aria-describedby={count ? unseenId : undefined}
                  component={Link}
                  to={item.to}
                  state={
                    galleryKind(item.to)
                      ? { ...(linkedGallery && { chat, turn, show, set }), home: !active }
                      : undefined
                  }
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  onPointerEnter={item.to === "/dream" && !active ? prefetchDream : undefined}
                  onFocus={item.to === "/dream" && !active ? prefetchDream : undefined}
                  variant="subtle"
                  color={active ? undefined : "gray"}
                  className={classes.mode}
                  // Phones size it to the 44 px touch target; wider screens pad its label.
                  px={phone ? 8 : 12}
                  size="sm"
                  radius="xl"
                >
                  {phone ? <item.icon size={20} /> : item.label}
                </Button>
              </Indicator>
            </Tooltip>
          );
        })}
    </Group>
  );
}
/** `mode` is the creative-mode path, which stays behind Library and Settings. */
export function AppHeader({ mode }: { mode: string }) {
  const { appearance } = useAppearance();
  const phone = usePhone();
  return (
    <Group
      h="100%"
      gap="xs"
      justify="space-between"
      wrap="nowrap"
      w="100%"
      className={`${classes.bar} ${classes.header}`}
      mx="auto"
      maw={appearance.layout === "fixed" ? "var(--studio-workspace-width)" : undefined}
    >
      <FinishedAway />
      <Group gap={phone ? 4 : "sm"} wrap="nowrap">
        <Link to="/images" replace={mode === "/images"} className={classes.home}>
          <StudioLogo order={2} />
        </Link>
        <StatusAction />
      </Group>
      <ModeSwitcher mode={mode} />
      <Group gap={phone ? 0 : "xs"} wrap="nowrap" className={classes.end}>
        <AppearanceMenu />
        <HeaderOptions />
      </Group>
    </Group>
  );
}
