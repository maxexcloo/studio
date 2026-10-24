import { Anchor, Group, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api } from "../../api";
import { StudioLogo } from "../../ui/StudioLogo";
import { SettingGroup, SettingRow } from "./SettingRows";

const repository = "https://github.com/maxexcloo/studio";
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
const link = (href: string, label: string) => (
  <Anchor href={href} target="_blank" rel="noopener noreferrer" size="sm">
    <Group gap={4} wrap="nowrap" component="span">
      {label}
      <ExternalLink size={14} aria-hidden />
    </Group>
  </Anchor>
);

/** Settings › About: the running release, its notes, licences and credits. */
export function AboutStudio() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<{ stats?: { outputs?: number } }>("/api/stats"),
  });
  const outputs = stats.data?.stats?.outputs;
  return (
    <Stack gap="lg">
      <Stack align="center" gap={6} py="md">
        <StudioLogo order={2} />
        <Text size="sm" c="dimmed" ta="center">
          An image, video and chat studio for your own models.
          {outputs ? ` ${outputs.toLocaleString()} results made here · no telemetry.` : ""}
        </Text>
      </Stack>
      <SettingGroup title="Release">
        <SettingRow label="Version" description="The release running here.">
          <Text size="sm" fw={500}>
            v{__STUDIO_VERSION__}
          </Text>
        </SettingRow>
        <SettingRow label="Changelog" description="What’s new in each release.">
          {link(`${repository}/blob/main/CHANGELOG.md`, "Changelog")}
        </SettingRow>
        <SettingRow
          label="Licence"
          description="MIT, keeping the HEISS UI, J-AI Studio and MantineHub notices. Native MCP modules are AGPL-3.0."
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
    </Stack>
  );
}
