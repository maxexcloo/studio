import { lazy, Suspense } from "react";
import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  Loader,
  Modal,
  NavLink,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { useEffect, useState } from "react";
import { GalleryHorizontalEnd, Layers, Library, Settings, Sparkles } from "lucide-react";
import { AccountGate } from "./features/auth/AccountGate";
import { GenerationProvider } from "./features/generation/GenerationProvider";
import { GalleryPage } from "./features/gallery/GalleryPage";
import { ChatProvider } from "./features/sessions/ChatProvider";
import { AppearanceMenu, LayoutToggle, useAppearance } from "./ui/Appearance";
const ChatPage = lazy(() =>
  import("./features/sessions/SessionsPage").then((module) => ({ default: module.ChatPage })),
);
const LibraryPage = lazy(() =>
  import("./features/library/LibraryPage").then((module) => ({ default: module.LibraryPage })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const navigation = [
  { to: "/", label: "Images", icon: GalleryHorizontalEnd },
  { to: "/?type=video", label: "Videos", icon: Sparkles },
  { to: "/sessions", label: "Chat", icon: Layers },
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
];
function Workspace() {
  const { appearance } = useAppearance();
  const [opened, { toggle, close }] = useDisclosure(false);
  const location = useLocation();
  const navigate = useNavigate();
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  const overlay =
    location.pathname === "/library"
      ? "library"
      : location.pathname === "/settings"
        ? "settings"
        : null;
  const [lastPanel, setLastPanel] = useState<"library" | "settings">(overlay || "settings");
  useEffect(() => {
    if (overlay) setLastPanel(overlay);
  }, [overlay]);
  const background = location.state?.backgroundLocation || { pathname: "/", search: "", hash: "" };
  const panel = overlay || lastPanel;
  const [params] = useSearchParams();
  const active = (to: string) =>
    to === "/"
      ? location.pathname === "/" && params.get("type") !== "video"
      : to === "/?type=video"
        ? location.pathname === "/" && params.get("type") === "video"
        : location.pathname.startsWith(to);
  return (
    <GenerationProvider>
      <ChatProvider>
        <AppShell
          header={{ height: 68 }}
          navbar={{ width: 208, breakpoint: "sm", collapsed: { mobile: !opened, desktop: true } }}
          padding={{ base: "sm", md: "lg" }}
        >
          <AppShell.Header>
            <Group h="100%" px={{ base: "sm", sm: "lg" }} justify="space-between" wrap="nowrap">
              <Group gap="sm">
                <Burger
                  opened={opened}
                  onClick={toggle}
                  hiddenFrom="sm"
                  size="sm"
                  aria-label="Toggle Navigation"
                />
                <Link to="/" className="studio-home-link" style={{ textDecoration: "none" }}>
                  <Title className="studio-logo" order={2}>
                    Studio<span style={{ color: "var(--mantine-primary-color-filled)" }}>.</span>
                  </Title>
                </Link>
              </Group>
              <Group
                gap={4}
                component="nav"
                aria-label="Creative Modes"
                className="studio-mode-tabs"
              >
                {navigation.slice(0, 3).map((item) => (
                  <Button
                    key={item.to}
                    component={Link}
                    to={item.to}
                    aria-current={active(item.to) ? "page" : undefined}
                    variant={active(item.to) ? "light" : "subtle"}
                    color={active(item.to) ? undefined : "gray"}
                    size="sm"
                    radius="xl"
                  >
                    {item.label}
                  </Button>
                ))}
              </Group>
              <Group gap="xs" visibleFrom="sm">
                <LayoutToggle />
                <AppearanceMenu />
                {navigation.slice(3).map((item) => (
                  <Tooltip key={item.to} label={item.label}>
                    <ActionIcon
                      component={Link}
                      to={item.to}
                      state={{ backgroundLocation: location }}
                      variant={active(item.to) ? "light" : "subtle"}
                      color={active(item.to) ? undefined : "gray"}
                      aria-label={item.label}
                      size="lg"
                      radius="xl"
                    >
                      <item.icon size={19} />
                    </ActionIcon>
                  </Tooltip>
                ))}
              </Group>
              <Group hiddenFrom="sm">
                <AppearanceMenu />
              </Group>
            </Group>
          </AppShell.Header>
          <AppShell.Navbar p="sm" hiddenFrom="sm" aria-hidden={!opened} inert={!opened}>
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                component={Link}
                to={item.to}
                state={
                  item.to === "/library" || item.to === "/settings"
                    ? { backgroundLocation: location }
                    : undefined
                }
                label={item.label}
                leftSection={<item.icon size={18} />}
                active={active(item.to)}
                onClick={close}
                mb={4}
                style={{ borderRadius: "var(--mantine-radius-md)", minHeight: 44 }}
              />
            ))}
            <Text size="xs" c="dimmed" mt="auto" p="sm">
              Image → Refine → Animate
            </Text>
          </AppShell.Navbar>
          <AppShell.Main>
            <div
              className="studio-page studio-content"
              style={{ maxWidth: appearance.layout === "fixed" ? 1600 : undefined }}
            >
              <Suspense fallback={<Loader aria-label="Loading Page" />}>
                <Routes location={overlay ? background : location}>
                  <Route path="/" element={<GalleryPage />} />
                  <Route path="/sessions/:id?" element={<ChatPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </div>
          </AppShell.Main>
          <Modal
            opened={!!overlay}
            onClose={() =>
              location.state?.backgroundLocation ? navigate(-1) : navigate("/", { replace: true })
            }
            title={panel === "library" ? "Library" : "Settings"}
            closeButtonProps={{
              "aria-label": `Close ${panel === "library" ? "Library" : "Settings"}`,
            }}
            size={1200}
            fullScreen={narrow}
          >
            <Suspense fallback={<Loader aria-label="Loading Workspace" />}>
              {panel === "library" ? <LibraryPage /> : <SettingsPage />}
            </Suspense>
          </Modal>
        </AppShell>
      </ChatProvider>
    </GenerationProvider>
  );
}
export function App() {
  return (
    <AccountGate>
      <Workspace />
    </AccountGate>
  );
}
