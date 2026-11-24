import {
  Alert,
  Badge,
  Button,
  Group,
  Image,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";

import type { ChangeBy, Project, ProjectChange } from "../../../../shared/projects";
import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { formatDateTime } from "../../ui/dates";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useLastWhileClosing } from "../../ui/useLastWhileClosing";
import { usePhone } from "../../ui/usePhone";
import { useMediaPreview } from "../gallery/MediaPreview";
import {
  ProjectEnabled,
  ProjectMoreTurns,
  ProjectStatsLine,
  constraintBadges,
} from "./ProjectCard";
import { ProjectPins, briefFields } from "./ProjectForm";
import { ProposalList } from "./ProjectInbox";
import { inboxQuery, projectPath, projectResultsQuery, projectsQuery } from "./queries";

const byNames: Record<ChangeBy, string> = { you: "You", chat: "Chat", dream: "Dream" };
const fieldNames: Record<string, string> = {
  ...Object.fromEntries(briefFields.map(([key, label]) => [key, label])),
  name: "Name",
  loras: "Favourite LoRAs",
  cards: "Pinned Cards",
  constraints: "Constraints",
  paused: "Status",
  favoured: "More Turns",
  created: "Created",
};

/** One change: who made it, when and to what, why Dream proposed it, and Undo on the latest. */
function ChangeRow({
  change,
  undo,
}: {
  change: ProjectChange;
  undo?: { pending: boolean; run: () => void };
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start" role="listitem">
      <Stack gap={0} miw={0}>
        <Text size="sm">
          {[
            byNames[change.by],
            change.fields.map((field) => fieldNames[field] ?? field).join(", "),
            ...(change.undone ? ["Undone"] : []),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <Text size="xs" c="dimmed">
          {[formatDateTime(change.at), change.why].filter(Boolean).join(" · ")}
        </Text>
      </Stack>
      {undo && (
        <Button
          size="compact-sm"
          variant="subtle"
          leftSection={<icons.undo size={14} />}
          loading={undo.pending}
          onClick={undo.run}
        >
          Undo
        </Button>
      )}
    </Group>
  );
}

/** The project's results, newest first, each opening full size. */
function Results({ projectId }: { projectId: string }) {
  const results = useQuery(projectResultsQuery(projectId));
  const preview = useMediaPreview();
  if (results.isPending) return <LoadingState label="Loading Results" />;
  if (results.isError) return <Alert color="red">{results.error.message}</Alert>;
  const items = results.data.items;
  if (!items.length)
    return (
      <Text size="sm" c="dimmed">
        No results yet.
      </Text>
    );
  return (
    <SimpleGrid cols={{ base: 3, sm: 4 }} spacing={6}>
      {items.map((item, index) => (
        <UnstyledButton
          key={item.id}
          aria-label={`Preview ${item.title || `Result ${index + 1}`}`}
          onClick={() => preview.open(items, index)}
        >
          <Image
            src={item.thumbnailUrl || item.url}
            alt=""
            radius="md"
            loading="lazy"
            style={{ aspectRatio: "1", objectFit: "cover" }}
          />
        </UnstyledButton>
      ))}
      {preview.element}
    </SimpleGrid>
  );
}

function ProjectDetail({
  project,
  projects,
  profileLabel,
  onDelete,
}: {
  project: Project;
  projects: Project[];
  profileLabel: (id: string) => string;
  onDelete: () => void;
}) {
  const client = useQueryClient();
  const stats = useQuery(projectsQuery).data?.stats[project.id];
  const proposals = (useQuery(inboxQuery).data?.proposals || []).filter(
    (proposal) => proposal.projectId === project.id,
  );
  const undo = useMutation({
    mutationFn: () => api<{ project: Project }>(projectPath(project, "undo"), { method: "POST" }),
    onSettled: () => client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  });
  const badges = constraintBadges(project, profileLabel);
  const changes = project.changes || [];
  const brief = briefFields.filter(([key]) => project.brief[key]);
  return (
    <Stack gap="lg">
      <ProjectStatsLine project={project} stats={stats} />
      <SettingGroup title="Status">
        <SettingRow label="Enabled" description="Dream draws ideas from it.">
          <ProjectEnabled project={project} label="Enabled" />
        </SettingRow>
        <SettingRow label="More Turns" description="Doubles its share of Dream's turns.">
          <ProjectMoreTurns project={project} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Brief">
        <Stack gap={4}>
          {brief.map(([key, label]) => (
            <Text key={key} size="sm">
              <Text span c="dimmed" size="sm">
                {label}:{" "}
              </Text>
              {project.brief[key]}
            </Text>
          ))}
          {project.brief.loras?.length ? (
            <Text size="sm">
              <Text span c="dimmed" size="sm">
                Favourite LoRAs:{" "}
              </Text>
              {project.brief.loras.join(", ")}
            </Text>
          ) : null}
          {!brief.length && !project.brief.loras?.length && (
            <Text size="sm" c="dimmed">
              No brief yet.
            </Text>
          )}
        </Stack>
      </SettingGroup>
      <ProjectPins cards={project.cards} />
      <SettingGroup title="Constraints">
        <Group gap={6}>
          {badges.length ? (
            badges.map((badge) => (
              <Badge key={badge} color="gray">
                {badge}
              </Badge>
            ))
          ) : (
            <Text size="sm" c="dimmed">
              Any profile, aspect and resolution, with LoRAs.
            </Text>
          )}
        </Group>
      </SettingGroup>
      {proposals.length > 0 && (
        <SettingGroup title={`Proposals (${proposals.length})`}>
          <ProposalList proposals={proposals} projects={projects} />
        </SettingGroup>
      )}
      <SettingGroup title="Results">
        <Results projectId={project.id} />
      </SettingGroup>
      <SettingGroup title="Changes">
        {changes.length ? (
          <Stack gap="xs" role="list" aria-label="Changes">
            {changes.map((change, index) => (
              <ChangeRow
                key={change.id}
                change={change}
                undo={
                  index === 0 && project.previous?.change === change.id && !change.undone
                    ? { pending: undo.isPending, run: () => undo.mutate() }
                    : undefined
                }
              />
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            No changes yet.
          </Text>
        )}
      </SettingGroup>
      <SettingGroup title="Danger Zone" danger>
        <SettingRow label="Delete Project" description="Chats using it keep going without it.">
          <Button size="compact-sm" color="red" variant="light" onClick={onDelete}>
            Delete
          </Button>
        </SettingRow>
      </SettingGroup>
    </Stack>
  );
}

/**
 * A project's detail view at /dream/projects/:projectId: its switches, brief, constraints, pending
 * proposals, results, changes with Undo and Delete; Edit opens the project's editor. Once
 * `projects` load, an id none of them has says so.
 */
export function ProjectSheet({
  projectId,
  projects,
  profileLabel,
  onEdit,
  onDelete,
  onClose,
}: {
  projectId?: string;
  projects?: Project[];
  profileLabel: (id: string) => string;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
  onClose: () => void;
}) {
  const id = useId();
  const phone = usePhone();
  const found = projects?.find((entry) => entry.id === projectId);
  const missing = Boolean(projectId && projects && !found);
  const shown = useLastWhileClosing<Project | "missing">(missing ? "missing" : found);
  return (
    <Modal
      id={id}
      opened={Boolean(found) || missing}
      onClose={closeWhenTop(id, onClose)}
      title={shown === "missing" ? "Project" : shown?.name}
      size="lg"
      fullScreen={phone}
    >
      <Stack gap="lg">
        {shown === "missing" ? (
          <EmptyState fill>That project no longer exists.</EmptyState>
        ) : (
          shown && (
            <ProjectDetail
              project={shown}
              projects={projects || []}
              profileLabel={profileLabel}
              onDelete={() => onDelete(shown)}
            />
          )
        )}
        <DialogFooter
          secondary={
            shown && shown !== "missing" ? [{ label: "Edit", onClick: () => onEdit(shown) }] : []
          }
        >
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}
