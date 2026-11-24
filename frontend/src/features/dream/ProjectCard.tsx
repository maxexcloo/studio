import {
  ActionIcon,
  Badge,
  Group,
  Menu,
  Paper,
  Progress,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import type { Project, ProjectStats } from "../../../../shared/projects";
import { api } from "../../api";
import { menuWidth } from "../../theme";
import { icons } from "../../ui/icons";
import { Thumbnail } from "./DiscardedDreams";
import { aspectLabel, briefFields } from "./ProjectForm";
import { type DreamItem, projectPath, projectsQuery } from "./queries";

const resultsShown = 8;

/**
 * A project's results so far, as chips, and its share of Dream's project turns while another
 * project shares them, or Disabled; More Turns where set.
 */
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
  const favoured = project.favoured && !project.paused;
  return (
    <Stack gap={6}>
      {(chips.length > 0 || project.paused || favoured) && (
        <Group gap={6}>
          {project.paused && <Badge color="yellow">Disabled</Badge>}
          {favoured && <Badge variant="light">More Turns</Badge>}
          {chips.map((chip) => (
            <Badge key={chip} color="gray">
              {chip}
            </Badge>
          ))}
        </Group>
      )}
      {!project.paused && stats && stats.share < 1 && (
        <Group gap="xs" wrap="nowrap">
          <Progress.Root flex={1} size="sm">
            <Progress.Section value={share} aria-label={`${share}% of project turns`} />
          </Progress.Root>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {share}% of project turns
          </Text>
        </Group>
      )}
    </Stack>
  );
}

/**
 * A project's on/off settings, switched at once; the reply, or a refetch after a failure, settles
 * them. A disabled project (`paused`) keeps its brief, results and chats; More Turns (`favoured`)
 * doubles its share of Dream's turns.
 */
export function useProjectSwitch(project: Project) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Pick<Project, "paused"> | Pick<Project, "favoured">) =>
      api<{ project: Project }>(projectPath(project), {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    onMutate: (patch) =>
      client.setQueryData(
        projectsQuery.queryKey,
        (data) =>
          data && {
            ...data,
            projects: data.projects.map((entry) =>
              entry.id === project.id ? { ...entry, ...patch } : entry,
            ),
          },
      ),
    onSettled: () => client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  });
}

export function ProjectEnabled({ project, label }: { project: Project; label: string }) {
  const save = useProjectSwitch(project);
  return (
    <Switch
      aria-label={label}
      checked={!project.paused}
      onChange={(event) => save.mutate({ paused: !event.currentTarget.checked })}
    />
  );
}

export function ProjectMoreTurns({ project }: { project: Project }) {
  const save = useProjectSwitch(project);
  return (
    <Switch
      aria-label="More Turns"
      checked={Boolean(project.favoured)}
      onChange={(event) => save.mutate({ favoured: event.currentTarget.checked })}
    />
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
 * and its share of turns, with its Enabled switch and More Turns, Edit and Delete in its ⋯ menu.
 * Its name opens it; while it has results waiting for a verdict (`unseen`, newest first), the strip shows those, each opening
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
  const favour = useProjectSwitch(project);
  const open = () =>
    navigate(`/dream/projects/${encodeURIComponent(project.id)}`, {
      state: { fromProjects: true },
    });
  const summary = briefFields
    .filter(([key]) => key !== "avoid" && project.brief[key])
    .map(([key, label]) => `${label}: ${project.brief[key]}`)
    .join(" · ");
  const badges = constraintBadges(project, profileLabel);
  const waiting = unseen.length > 0;
  const strip = (waiting ? unseen : stats?.results || []).slice(0, resultsShown);
  return (
    <Paper withBorder p="md" radius="md" component="section" aria-label={project.name}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="xs" wrap="nowrap" miw={0}>
            <UnstyledButton onClick={open} miw={0} aria-label={`Open ${project.name}`}>
              <Text size="sm" fw={600} truncate>
                {project.name}
              </Text>
            </UnstyledButton>
            {fresh > 0 && (
              <Badge variant="light" style={{ flexShrink: 0 }}>
                {fresh} New
              </Badge>
            )}
          </Group>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <ProjectEnabled project={project} label={`Enable ${project.name}`} />
            <Menu position="bottom-end" width={menuWidth}>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={`Actions for ${project.name}`}
                >
                  <icons.more size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  renderRoot={(props) => <button {...props} role="menuitemcheckbox" />}
                  aria-checked={Boolean(project.favoured)}
                  closeMenuOnClick={false}
                  leftSection={<icons.pacing size={16} />}
                  rightSection={
                    // The row is the control; the switch only shows its state.
                    <Switch
                      size="xs"
                      checked={Boolean(project.favoured)}
                      readOnly
                      tabIndex={-1}
                      aria-hidden
                      style={{ pointerEvents: "none" }}
                    />
                  }
                  onClick={() => favour.mutate({ favoured: !project.favoured })}
                >
                  More Turns
                </Menu.Item>
                <Menu.Item leftSection={<icons.edit size={16} />} onClick={onEdit}>
                  Edit
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<icons.delete size={16} />} onClick={onDelete}>
                  Delete
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
        {summary && (
          <Text size="sm" c="dimmed" lineClamp={2}>
            {summary}
          </Text>
        )}
        {strip.length > 0 && (
          <Group gap={6} wrap="nowrap" style={{ overflow: "hidden" }}>
            {strip.map((item) => (
              <UnstyledButton
                key={item.id}
                aria-label={
                  waiting ? `View ${item.title || item.prompt || "Dream Result"}` : undefined
                }
                aria-hidden={!waiting || undefined}
                tabIndex={waiting ? undefined : -1}
                w={56}
                h={56}
                style={{
                  flexShrink: 0,
                  borderRadius: "var(--mantine-radius-md)",
                  overflow: "hidden",
                }}
                onClick={() => (waiting ? onView(item) : open())}
              >
                <Thumbnail item={item} />
              </UnstyledButton>
            ))}
          </Group>
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
