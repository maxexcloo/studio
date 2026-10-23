import { lazy, Suspense } from "react";
import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  Loader,
  NavLink,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router";
import { GalleryHorizontalEnd, Layers, Library, Settings, Sparkles } from "lucide-react";
import { AccountGate } from "./features/auth/AccountGate";
import { GenerationProvider } from "./features/generation/GenerationProvider";
import { GalleryPage } from "./features/gallery/GalleryPage";
const SessionsPage = lazy(() =>
  import("./features/sessions/SessionsPage").then((module) => ({ default: module.SessionsPage })),
);
const SessionPage = lazy(() =>
  import("./features/sessions/SessionsPage").then((module) => ({ default: module.SessionPage })),
);
const LibraryPage = lazy(() =>
  import("./features/library/LibraryPage").then((module) => ({ default: module.LibraryPage })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const navigation = [
  { to: "/", label: "Image", icon: GalleryHorizontalEnd },
  { to: "/?type=video", label: "Video", icon: Sparkles },
  { to: "/sessions", label: "Chat", icon: Layers },
  { to: "/library", label: "Library", icon: Library },
  { to: "/settings", label: "Settings", icon: Settings },
];
function Workspace() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const location = useLocation();
  const [params] = useSearchParams();
  const active = (to: string) =>
    to === "/"
      ? location.pathname === "/" && params.get("type") !== "video"
      : to === "/?type=video"
        ? location.pathname === "/" && params.get("type") === "video"
        : location.pathname.startsWith(to);
  return (
    <GenerationProvider>
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
            <Group gap={4} component="nav" aria-label="Creative Modes" className="studio-mode-tabs">
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
              {navigation.slice(3).map((item) => (
                <Tooltip key={item.to} label={item.label}>
                  <ActionIcon
                    component={Link}
                    to={item.to}
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
            <div className="studio-phone-header-space" />
          </Group>
        </AppShell.Header>
        <AppShell.Navbar p="sm" hiddenFrom="sm" aria-hidden={!opened} inert={!opened}>
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
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
          <div className="studio-page studio-content">
            <Suspense fallback={<Loader aria-label="Loading Page" />}>
              <Routes>
                <Route path="/" element={<GalleryPage />} />
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/sessions/:id" element={<SessionPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </div>
        </AppShell.Main>
      </AppShell>
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
