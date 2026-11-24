import {
  Alert,
  AspectRatio,
  Badge,
  Button,
  Center,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import type { ChangeBy, Project, ProjectChange } from "../../../../shared/projects";
import { api, post } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { formatDateTime } from "../../ui/dates";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useLastWhileClosing } from "../../ui/useLastWhileClosing";
import { usePhone } from "../../ui/usePhone";
import { MediaViewer } from "../gallery/MediaViewer";
import { type Verdict, viewerChoices } from "./choices";
import { Thumbnail } from "./DiscardedDreams";
import { useJudge } from "./DreamDeck";
import {
  ProjectEnabled,
  ProjectMoreTurns,
  ProjectStatsLine,
  constraintBadges,
} from "./ProjectCard";
import { ProjectPins, briefFields } from "./ProjectForm";
import { BriefDiff, ProposalList } from "./ProjectInbox";
import {
  type DreamItem,
  chatChoicesQuery,
  inboxQuery,
  projectPath,
  projectResultsQuery,
  projectsQuery,
} from "./queries";

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

/**
 * One change: who made it and when, why Dream proposed it, the words it changed, and Undo on the
 * latest.
 */
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
        {Object.entries(change.text || {}).map(([field, { before, after }]) => (
          <BriefDiff key={field} label={fieldNames[field] ?? field} before={before} after={after} />
        ))}
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

/**
 * The project's results, newest first, a page at a time, each opening the viewer: one still waiting
 * for a verdict offers Dream's, the rest their item actions.
 */
function Results({ projectId }: { projectId: string }) {
  const results = useInfiniteQuery(projectResultsQuery(projectId));
  const [viewing, setViewing] = useState<string | null>(null);
  const judge = useJudge(() => undefined);
  if (results.isPending) return <LoadingState label="Loading Results" />;
  if (results.isError) return <Alert color="red">{results.error.message}</Alert>;
  const items = results.data.pages.flatMap((page) => page.items);
  if (!items.length) return <EmptyState fill>No Results</EmptyState>;
  const current = viewing ? items.find((item) => item.id === viewing) : undefined;
  if (viewing && !current) setViewing(null);
  function act(item: DreamItem, verdict: Verdict) {
    // A disliked result leaves the project's results, so the viewer moves on.
    if (verdict === "discard") {
      const index = items.indexOf(item);
      setViewing((items[index + 1] || items[index - 1])?.id ?? null);
    }
    judge.mutate({ card: { kind: "dream", key: item.id, item }, verdict });
  }
  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 3, sm: 4 }} spacing={6}>
        {items.map((item) => (
          <UnstyledButton
            key={item.id}
            aria-label={`View ${item.title || item.prompt || "Dream Result"}`}
            style={{ borderRadius: "var(--mantine-radius-md)", overflow: "hidden" }}
            onClick={() => setViewing(item.id)}
          >
            <AspectRatio ratio={1}>
              <Thumbnail item={item} />
            </AspectRatio>
          </UnstyledButton>
        ))}
      </SimpleGrid>
      {results.hasNextPage && (
        <Center>
          <Button
            variant="default"
            size="compact-sm"
            loading={results.isFetchingNextPage}
            onClick={() => void results.fetchNextPage()}
          >
            {results.isFetchNextPageError ? "Retry Loading" : "Load More"}
          </Button>
        </Center>
      )}
      {current && (
        <MediaViewer
          item={current}
          items={items}
          navigate={(item) => setViewing(item.id)}
          close={() => setViewing(null)}
          actions={
            current.dream?.state === "unseen"
              ? viewerChoices({ kind: "dream", key: current.id, item: current }, (choice) =>
                  act(current, choice as Verdict),
                )
              : undefined
          }
        />
      )}
    </Stack>
  );
}

/** The chats attached to the project, named as their chats named their work, each with Detach. */
function Chats({ project }: { project: Project }) {
  const client = useQueryClient();
  const attached = (useQuery(projectsQuery).data?.chats || []).filter(
    (entry) => entry.projectId === project.id,
  );
  const named = useQuery({ ...chatChoicesQuery, enabled: attached.length > 0 });
  const detach = useMutation({
    mutationFn: (chat: string) => post("/api/dream/projects/attach", { chat, projectId: null }),
    onSettled: () => client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  });
  return (
    <SettingGroup title="Chats">
      {attached.length ? (
        attached.map(({ chat, at }) => (
          <SettingRow
            key={chat}
            label={
              <span style={{ overflowWrap: "anywhere" }}>
                {named.data?.chats.find((entry) => entry.chat === chat)?.title ||
                  `Chat ${chat.slice(0, 8)}`}
              </span>
            }
            description={`Last used ${formatDateTime(at)}`}
          >
            <Button
              size="compact-sm"
              variant="default"
              loading={detach.isPending && detach.variables === chat}
              onClick={() => detach.mutate(chat)}
            >
              Detach
            </Button>
          </SettingRow>
        ))
      ) : (
        <EmptyState fill>No Chats</EmptyState>
      )}
    </SettingGroup>
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
      <Chats project={project} />
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
          <EmptyState fill>No Changes</EmptyState>
        )}
      </SettingGroup>
      <SettingGroup danger>
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
 * proposals, results, chats, changes with Undo and Delete; Edit opens the project's editor. Once
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
