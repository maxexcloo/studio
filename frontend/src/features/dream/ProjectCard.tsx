import {
  ActionIcon,
  Badge,
  Group,
  Image,
  Menu,
  Paper,
  Progress,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useNavigate } from "react-router";

import type { Project, ProjectStats } from "../../../../shared/projects";
import { menuWidth } from "../../theme";
import { icons } from "../../ui/icons";
import { Thumbnail } from "./DiscardedDreams";
import { aspectLabel, briefFields, useSaveProject } from "./ProjectForm";
import type { DreamItem } from "./queries";

const resultsShown = 8;

/** A project's results so far, as chips, and its share of Dream's turns, or Paused. */
export function ProjectStatsLine({
  project,
  stats,
}: {
  project: Project;
  stats?: ProjectStats<DreamItem>;
}) {
  const share = Math.round((stats?.share ?? 0) * 100);
  const chips = stats
    ? [
        `Kept ${stats.kept}`,
        `Liked ${stats.liked}`,
        `Missed ${stats.missed}`,
        ...(stats.review === null ? [] : [`Review ${stats.review.toFixed(1)}`]),
      ]
    : [];
  return (
    <Stack gap={6}>
      {(chips.length > 0 || project.paused) && (
        <Group gap={6}>
          {project.paused && <Badge color="yellow">Paused</Badge>}
          {chips.map((chip) => (
            <Badge key={chip} color="gray">
              {chip}
            </Badge>
          ))}
        </Group>
      )}
      {!project.paused && stats && (
        <Group gap="xs" wrap="nowrap">
          <Progress.Root flex={1} size="sm">
            <Progress.Section value={share} aria-label={`${share}% of turns`} />
          </Progress.Root>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {share}% of turns
          </Text>
        </Group>
      )}
    </Stack>
  );
}

/** A project's constraints as badges: profiles, No LoRAs, aspect and resolution. */
export function constraintBadges(project: Project, profileLabel: (id: string) => string) {
  const { constraints } = project;
  return [
    ...constraints.profiles.map(profileLabel),
    ...(constraints.loras ? [] : ["No LoRAs"]),
    ...(constraints.aspect ? [aspectLabel(constraints.aspect)] : []),
    ...(constraints.resolution ? [constraints.resolution] : []),
  ];
}

/**
 * A project in Dream › Projects: its brief in a line, a strip of its newest results, how they fare
 * and its share of turns, with Edit, Pause and Delete in its ⋯ menu. Its name opens it; while it
 * has results waiting for a verdict (`unseen`, newest first), the strip shows those, each opening
 * the viewer (`onView`), and otherwise opens it too. `fresh` counts those new since the last visit.
 */
export function ProjectCard({
  project,
  stats,
  unseen,
  fresh,
  profileLabel,
  onView,
  onEdit,
  onDelete,
}: {
  project: Project;
  stats?: ProjectStats<DreamItem>;
  unseen: DreamItem[];
  fresh: number;
  profileLabel: (id: string) => string;
  onView: (item: DreamItem) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const pause = useSaveProject(project.id);
  const open = () =>
    navigate(`/dream/projects/${encodeURIComponent(project.id)}`, {
      state: { fromProjects: true },
    });
  const summary = briefFields
    .filter(([key]) => key !== "avoid" && project.brief[key])
    .map(([key, label]) => `${label}: ${project.brief[key]}`)
    .join(" · ");
  const badges = constraintBadges(project, profileLabel);
  const results = (stats?.results || []).slice(0, resultsShown);
  return (
    <Paper withBorder p="sm" radius="md" component="section" aria-label={project.name}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="xs" wrap="nowrap" miw={0}>
            <UnstyledButton onClick={open} miw={0} aria-label={`Open ${project.name}`}>
              <Text fw={600} truncate>
                {project.name}
              </Text>
            </UnstyledButton>
            {fresh > 0 && <Badge style={{ flexShrink: 0 }}>{fresh} New</Badge>}
          </Group>
          <Menu position="bottom-end" width={menuWidth}>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${project.name}`}>
                <icons.more size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<icons.edit size={16} />} onClick={onEdit}>
                Edit
              </Menu.Item>
              <Menu.Item
                leftSection={
                  project.paused ? <icons.resume size={16} /> : <icons.pause size={16} />
                }
                onClick={() => pause.mutate({ paused: !project.paused })}
              >
                {project.paused ? "Resume" : "Pause"}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<icons.delete size={16} />} onClick={onDelete}>
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
        {summary && (
          <Text size="sm" c="dimmed" lineClamp={2}>
            {summary}
          </Text>
        )}
        {unseen.length > 0 ? (
          <Group gap={6} wrap="nowrap" style={{ overflow: "hidden" }}>
            {unseen.slice(0, resultsShown).map((item) => (
              <UnstyledButton
                key={item.id}
                aria-label={`View ${item.title || item.prompt || "Dream Result"}`}
                w={56}
                h={56}
                style={{
                  flexShrink: 0,
                  borderRadius: "var(--mantine-radius-md)",
                  overflow: "hidden",
                }}
                onClick={() => onView(item)}
              >
                <Thumbnail item={item} />
              </UnstyledButton>
            ))}
          </Group>
        ) : (
          results.length > 0 && (
            <UnstyledButton onClick={open} tabIndex={-1} aria-hidden>
              <Group gap={6} wrap="nowrap" style={{ overflow: "hidden" }}>
                {results.map((item) => (
                  <Image
                    key={item.id}
                    src={item.thumbnailUrl || item.url}
                    alt=""
                    h={56}
                    w={56}
                    radius="md"
                    loading="lazy"
                    style={{ flexShrink: 0 }}
                  />
                ))}
              </Group>
            </UnstyledButton>
          )
        )}
        {badges.length > 0 && (
          <Group gap={6}>
            {badges.map((badge) => (
              <Badge key={badge} color="gray">
                {badge}
              </Badge>
            ))}
          </Group>
        )}
        <ProjectStatsLine project={project} stats={stats} />
      </Stack>
    </Paper>
  );
}
