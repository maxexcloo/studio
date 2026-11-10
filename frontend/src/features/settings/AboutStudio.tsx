import { Fragment } from "react";
import { Anchor, Button, Group, Kbd, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink } from "lucide-react";
import { api } from "../../api";
import { useCopy } from "../../ui/clipboard";
import { icons } from "../../ui/icons";
import { StudioLogo } from "../../ui/StudioLogo";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { usePhone } from "../../ui/usePhone";

const repository = "https://github.com/maxexcloo/studio";
// Studio's lineage first, then what it runs on.
const credits = [
  {
    name: "HEISS UI",
    what: "Studio is a hard fork of HEISS UI, which built much of its foundation (MIT).",
    url: "https://github.com/tristmeister/HEISS-UI",
  },
  {
    name: "J-AI Studio",
    what: "HEISS UI began as a fork of Jasper’s J-AI Studio and its prompt-first idea (MIT).",
    url: "https://github.com/jasperdevs/J-AI-Studio",
  },
  {
    name: "MantineHub",
    what: "The theme is adapted from RubixCube Innovations’ MantineHub (MIT).",
    url: "https://mantinehub.com",
  },
  {
    name: "ComfyUI",
    what: "Renders every local image and video.",
    url: "https://github.com/comfyanonymous/ComfyUI",
  },
  {
    name: "Radiance",
    what: "The fast runtime behind the Radiance models.",
    url: "https://hub.docker.com/r/stilldeadcode/radiance",
  },
];
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
// Grouped by where each key works: the gallery, composer, Chat, the viewer, then Dream and Compare.
const shortcuts: { keys: string[][]; action: string }[] = [
  { keys: [["/"], [mod, "F"]], action: "Search the Gallery" },
  { keys: [[mod, "Enter"]], action: "Generate" },
  { keys: [["Enter"]], action: "Send a Chat Message" },
  { keys: [["Shift", "Enter"]], action: "New Line in Chat" },
  { keys: [["←"], ["→"]], action: "Previous or Next in the Viewer" },
  { keys: [["F"]], action: "Star the Viewed Item" },
  { keys: [["E"]], action: "Edit the Viewed Image" },
  { keys: [["U"]], action: "Upscale, or Show the Original" },
  { keys: [["P"]], action: "Open the Prompt in the Composer" },
  { keys: [["R"]], action: "Run Again" },
  { keys: [["Delete"]], action: "Delete the Viewed Item" },
  { keys: [["+"], ["−"], ["0"]], action: "Zoom In, Out or Fit" },
  { keys: [["Esc"]], action: "Close Search, Panels and the Viewer" },
  { keys: [["←"], ["→"]], action: "Pass or Like in Dream, or Choose A or B" },
  { keys: [["↑"]], action: "Variations in Dream, or Both in a Comparison" },
  { keys: [["↓"]], action: "Neither in a Dream Comparison" },
  { keys: [["1"], ["2"], ["3"], ["4"]], action: "Star a Compare Winner" },
];
const link = (href: string, label: string) => (
  <Anchor href={href} target="_blank" rel="noopener noreferrer" size="sm">
    <Group gap={4} wrap="nowrap" component="span">
      {label}
      <ExternalLink size={14} aria-hidden />
    </Group>
  </Anchor>
);

/** Bug-report help, and on desktop the keyboard shortcuts; phones have no keyboard to use them with. */
function Help() {
  const phone = usePhone();
  const { copied, copy } = useCopy();
  // Read ahead so copying stays inside the tap, which Safari requires for the clipboard.
  const diagnostics = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => api<{ text: string }>("/api/diagnostics"),
    staleTime: 60_000,
  });
  return (
    <>
      <SettingGroup title="Help">
        <SettingRow
          label="Copy Diagnostics"
          description="Versions, system and GPU for a bug report; no prompts, images or file names."
        >
          <Button
            size="compact-sm"
            variant="default"
            leftSection={copied ? <Check size={16} /> : <icons.copy size={16} />}
            loading={diagnostics.isPending}
            disabled={!diagnostics.data}
            onClick={() => diagnostics.data && copy(diagnostics.data.text)}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </SettingRow>
        <SettingRow label="Troubleshooting" description="Common errors and how to fix them.">
          {link(`${repository}/blob/main/TROUBLESHOOTING.md`, "Troubleshooting")}
        </SettingRow>
      </SettingGroup>
      {phone || (
        <SettingGroup title="Keyboard Shortcuts">
          {shortcuts.map((shortcut) => (
            <SettingRow key={shortcut.action} label={shortcut.action}>
              {shortcut.keys.map((combo, index) => (
                <Fragment key={combo.join("+")}>
                  {index > 0 && (
                    <Text span size="xs" c="dimmed">
                      or
                    </Text>
                  )}
                  <Group gap={2} wrap="nowrap">
                    {combo.map((key) => (
                      <Kbd key={key} size="xs">
                        {key}
                      </Kbd>
                    ))}
                  </Group>
                </Fragment>
              ))}
            </SettingRow>
          ))}
        </SettingGroup>
      )}
    </>
  );
}

/** Settings › About: the running commit, releases, licences, help and credits. */
export function AboutStudio() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<{ stats?: { outputs?: number }; version: string }>("/api/stats"),
  });
  const outputs = stats.data?.stats?.outputs;
  const commit = stats.data?.version;
  return (
    <Stack gap="lg">
      <Stack align="center" gap={6} py="md">
        <StudioLogo order={2} />
        <Text size="sm" c="dimmed" ta="center">
          An image, video and chat studio for your own models.
          {outputs ? ` ${outputs.toLocaleString()} results made here · no telemetry.` : ""}
        </Text>
      </Stack>
      {/* What is running leads; the other groups follow A–Z. */}
      <SettingGroup title="Release">
        <SettingRow label="Commit" description="The commit running here.">
          {commit ? (
            link(`${repository}/commit/${commit}`, commit)
          ) : (
            <Text size="sm" fw={500}>
              Development
            </Text>
          )}
        </SettingRow>
        <SettingRow label="Releases" description="What changed in each release.">
          {link(`${repository}/releases`, "Releases")}
        </SettingRow>
        <SettingRow
          label="Licence"
          description="AGPL-3.0, keeping the HEISS UI, J-AI Studio and MantineHub MIT notices."
        >
          {link(`${repository}/blob/main/LICENSE`, "Licence")}
        </SettingRow>
        <SettingRow label="Source" description="Studio’s code on GitHub.">
          {link(repository, "GitHub")}
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Credits">
        {credits.map((credit) => (
          <SettingRow key={credit.name} label={credit.name} description={credit.what}>
            {link(credit.url, credit.name)}
          </SettingRow>
        ))}
      </SettingGroup>
      <Help />
    </Stack>
  );
}
