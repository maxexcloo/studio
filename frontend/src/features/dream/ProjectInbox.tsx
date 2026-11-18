import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Image,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { maxCardDescription, maxCardName } from "../../../../shared/characters";
import {
  type Accepted,
  type Inbox,
  type Proposal,
  type ProposalChange,
  maxDismissReason,
} from "../../../../shared/inbox";
import type { Project } from "../../../../shared/projects";
import { maxTasteRule } from "../../../../shared/taste";
import { post } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { closeWhenTop } from "../../ui/popupClicks";
import { SettingGroup } from "../../ui/SettingRows";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { CardDialog, CardForm, CardThumbnails } from "../characters/CardImages";
import { useMediaPreview } from "../gallery/MediaPreview";
import { tasteQuery } from "../taste/TasteProfile";
import { type BriefText, ProjectForm, briefFields } from "./ProjectForm";
import { type DreamItem, inboxQuery, proposalPath } from "./queries";
import { wordDiff } from "./wordDiff";

type Shown = Proposal<DreamItem>;
const cardIcons = { characters: icons.character, outfits: icons.outfit, scenes: icons.scene };
const kindIcon = (proposal: Shown) =>
  proposal.change.card
    ? cardIcons[proposal.change.card.kind]
    : {
        project: icons.project,
        brief: icons.edit,
        rule: icons.rule,
        pacing: icons.pacing,
        card: icons.character,
      }[proposal.kind];
const briefLabel = (key: string) => briefFields.find(([field]) => field === key)?.[1] ?? key;
/** Whether Edit then Accept has anything to edit: pausing or giving turns has not. */
const editable = ({ change }: Shown) =>
  Boolean(change.project || change.brief || change.rule !== undefined || change.card);

/** Everything a settled proposal changes: the Inbox, projects, the deck, rules and cards. */
function useSettled() {
  const client = useQueryClient();
  return (inbox: Inbox<DreamItem>, proposal?: Shown) => {
    client.setQueryData(inboxQuery.queryKey, inbox);
    void client.invalidateQueries({ queryKey: ["dream"] });
    if (proposal?.kind === "rule") void client.invalidateQueries({ queryKey: tasteQuery.queryKey });
    if (proposal?.change.card)
      void client.invalidateQueries({ queryKey: [proposal.change.card.kind] });
  };
}

/** Accepts a proposal, as proposed or with the person's edits, then offers Undo. */
function useAccept() {
  const settled = useSettled();
  const undo = useMutation({
    mutationFn: (proposal: Shown) => post<Inbox<DreamItem>>(proposalPath(proposal, "undo"), {}),
    onSuccess: (inbox, proposal) => settled(inbox, proposal),
  });
  return useMutation({
    meta: { inlineError: true },
    mutationFn: ({ proposal, change }: { proposal: Shown; change?: ProposalChange }) =>
      post<Accepted<DreamItem>>(proposalPath(proposal, "accept"), change ? { change } : {}),
    onSuccess: ({ accepted, ...inbox }, { proposal }) => {
      settled(inbox, proposal);
      const notification = notifications.show({
        autoClose: 10000,
        message: (
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">Accepted {accepted.title}</Text>
            <Button
              size="compact-sm"
              variant="subtle"
              onClick={() => {
                notifications.hide(notification);
                undo.mutate(proposal);
              }}
            >
              Undo
            </Button>
          </Group>
        ),
      });
    },
  });
}

/** Dismissing one proposal, or Clearing the Inbox, with an optional reason that teaches Dream. */
function DismissDialog({
  title,
  opened,
  pending,
  error,
  onDismiss,
  onClose,
}: {
  title: string;
  opened: boolean;
  pending: boolean;
  error?: string;
  onDismiss: (reason: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const phone = usePhone();
  const [reason, setReason] = useState("");
  return (
    <Modal
      id={id}
      opened={opened}
      onClose={closeWhenTop(id, () => !pending && onClose())}
      title={title}
      fullScreen={phone}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onDismiss(reason.trim());
        }}
      >
        <Stack>
          <TextBox
            label="Reason"
            description="Optional: what Dream should learn from it."
            value={reason}
            onChange={setReason}
            autosize
            minRows={2}
            maxLength={maxDismissReason}
          />
          {error && <Alert color="red">{error}</Alert>}
          <DialogFooter pending={pending} onCancel={onClose}>
            <Button type="submit" loading={pending}>
              {title === "Clear Inbox" ? "Clear" : "Dismiss"}
            </Button>
          </DialogFooter>
        </Stack>
      </form>
    </Modal>
  );
}

/** Edit then Accept: the proposal's change as the person wants it. */
function ProposalEditor({
  proposal,
  pending,
  error,
  onAccept,
  onClose,
}: {
  proposal: Shown;
  pending: boolean;
  error?: string;
  onAccept: (change: ProposalChange) => void;
  onClose: () => void;
}) {
  const [change, setChange] = useState<ProposalChange>(() => structuredClone(proposal.change));
  if (change.project)
    return (
      <ProjectForm
        initial={change.project}
        action="Accept"
        pending={pending}
        error={error}
        onSubmit={(project) => onAccept({ ...change, project })}
        onClose={onClose}
      />
    );
  const { brief, rule, card } = change;
  return (
    <CardForm onSubmit={() => onAccept(change)}>
      {brief &&
        (Object.keys(brief) as BriefText[]).map((key) => (
          <TextBox
            key={key}
            label={briefLabel(key)}
            autosize
            minRows={2}
            value={String(brief[key] ?? "")}
            onChange={(value) => setChange({ ...change, brief: { ...brief, [key]: value } })}
          />
        ))}
      {rule !== undefined && (
        <TextBox
          label="Rule"
          description="A limit every prompt keeps in Dream and chats, never a look to aim for."
          autosize
          minRows={2}
          maxLength={maxTasteRule}
          value={rule}
          onChange={(value) => setChange({ ...change, rule: value })}
        />
      )}
      {card && (
        <>
          <TextInput
            label="Name"
            required
            maxLength={maxCardName}
            value={card.name}
            onChange={(event) =>
              setChange({ ...change, card: { ...card, name: event.currentTarget.value } })
            }
          />
          <TextBox
            label="Description"
            autosize
            minRows={3}
            maxLength={maxCardDescription}
            value={card.description}
            onChange={(description) => setChange({ ...change, card: { ...card, description } })}
          />
        </>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <DialogFooter pending={pending} onCancel={onClose}>
        <Button
          type="submit"
          loading={pending}
          disabled={(rule !== undefined && !rule.trim()) || (card && !card.name.trim())}
        >
          Accept
        </Button>
      </DialogFooter>
    </CardForm>
  );
}

/** A brief field's proposed text against its current text, removed words struck. */
function BriefDiff({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <Text size="sm">
      <Text span c="dimmed" size="sm">
        {label}:{" "}
      </Text>
      {wordDiff(before, after).map((part, index) =>
        part.change === "removed" ? (
          <Text key={index} span size="sm" c="red" td="line-through">
            {part.text}
          </Text>
        ) : part.change === "added" ? (
          <Text key={index} span size="sm" c="green">
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

/** A new project's sample results, larger than evidence and marked Draft. */
function Drafts({ items, label }: { items: DreamItem[]; label: string }) {
  const preview = useMediaPreview();
  return (
    <Group gap={6} role="group" aria-label={label}>
      {items.map((item, index) => (
        <Stack key={item.id} gap={2} align="center">
          <UnstyledButton
            aria-label={`Preview Draft ${index + 1}`}
            onClick={() => preview.open(items, index)}
          >
            <Image
              src={item.thumbnailUrl || item.url}
              alt=""
              h={96}
              w={96}
              radius="md"
              loading="lazy"
            />
          </UnstyledButton>
          <Badge size="xs" color="gray">
            Draft
          </Badge>
        </Stack>
      ))}
      {preview.element}
    </Group>
  );
}

function ProposalCard({
  proposal,
  project,
  accepting,
  onAccept,
  onEdit,
  onDismiss,
}: {
  proposal: Shown;
  project?: Project;
  accepting: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  const Icon = kindIcon(proposal);
  const { change } = proposal;
  const pictures = (items: DreamItem[]) =>
    items.map((item, index) => ({
      key: item.id,
      src: item.url,
      thumbnailUrl: item.thumbnailUrl,
      alt: `${proposal.title} ${index + 1}`,
    }));
  return (
    <Paper withBorder p="sm" radius="md" component="article" aria-label={proposal.title}>
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Icon size={18} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <Stack gap={2} flex={1} miw={0}>
            <Text size="sm" fw={600}>
              {proposal.title}
            </Text>
            <Text size="sm" c="dimmed">
              {proposal.why}
            </Text>
          </Stack>
          <Tooltip label="Dismiss">
            <ActionIcon variant="subtle" color="gray" aria-label="Dismiss" onClick={onDismiss}>
              <icons.clear size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {change.brief &&
          Object.entries(change.brief).map(([key, value]) => (
            <BriefDiff
              key={key}
              label={briefLabel(key)}
              before={String(project?.brief[key as BriefText] ?? "")}
              after={String(value ?? "")}
            />
          ))}
        {change.rule && <Text size="sm">{change.rule}</Text>}
        {change.card && (
          <Text size="sm">
            <Text span size="sm" fw={500}>
              {change.card.name}:{" "}
            </Text>
            {change.card.description}
          </Text>
        )}
        {change.project &&
          (["subjects", "styles"] as const).map(
            (key) =>
              change.project?.brief[key] && (
                <Text key={key} size="sm">
                  <Text span c="dimmed" size="sm">
                    {briefLabel(key)}:{" "}
                  </Text>
                  {change.project.brief[key]}
                </Text>
              ),
          )}
        {proposal.drafts && proposal.drafts.length > 0 && (
          <Drafts items={proposal.drafts} label={`${proposal.title} Drafts`} />
        )}
        {proposal.evidence.length > 0 && (
          <CardThumbnails
            label={`${proposal.title} Evidence`}
            images={pictures(proposal.evidence)}
          />
        )}
        <Group gap="xs" justify="flex-end">
          {editable(proposal) && (
            <Button size="compact-sm" variant="subtle" disabled={accepting} onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button size="compact-sm" variant="default" loading={accepting} onClick={onAccept}>
            Accept
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/**
 * Proposals as cards, each accepted as proposed, edited then accepted, or dismissed with an
 * optional reason. `projects` give brief edits their current text to compare with.
 */
export function ProposalList({ proposals, projects }: { proposals: Shown[]; projects: Project[] }) {
  const accept = useAccept();
  const settled = useSettled();
  const [editing, setEditing] = useState<Shown | null>(null);
  const [dismissing, setDismissing] = useState<Shown | null>(null);
  const dismiss = useMutation({
    meta: { inlineError: true },
    mutationFn: ({ proposal, reason }: { proposal: Shown; reason: string }) =>
      post<Inbox<DreamItem>>(proposalPath(proposal, "dismiss"), reason ? { reason } : {}),
    onSuccess: (inbox, { proposal }) => {
      settled(inbox, proposal);
      setDismissing(null);
    },
  });
  return (
    <>
      <Stack gap="sm">
        {proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            project={projects.find((project) => project.id === proposal.projectId)}
            accepting={accept.isPending && accept.variables?.proposal.id === proposal.id}
            onAccept={() => accept.mutate({ proposal })}
            onEdit={() => {
              accept.reset();
              setEditing(proposal);
            }}
            onDismiss={() => {
              dismiss.reset();
              setDismissing(proposal);
            }}
          />
        ))}
      </Stack>
      {!editing && accept.error && <Alert color="red">{accept.error.message}</Alert>}
      <CardDialog
        opened={editing !== null}
        title={editing?.title ?? ""}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <ProposalEditor
            key={editing.id}
            proposal={editing}
            pending={accept.isPending}
            error={accept.error?.message}
            onAccept={(change) =>
              accept.mutate({ proposal: editing, change }, { onSuccess: () => setEditing(null) })
            }
            onClose={() => setEditing(null)}
          />
        )}
      </CardDialog>
      <DismissDialog
        key={dismissing?.id ?? "none"}
        title="Dismiss"
        opened={dismissing !== null}
        pending={dismiss.isPending}
        error={dismiss.error?.message}
        onDismiss={(reason) => dismissing && dismiss.mutate({ proposal: dismissing, reason })}
        onClose={() => setDismissing(null)}
      />
    </>
  );
}

/** Dream › Projects' Inbox: what Dream proposes, above the projects; nothing shows when empty. */
export function ProjectInbox({ projects }: { projects: Project[] }) {
  const inbox = useQuery(inboxQuery);
  const settled = useSettled();
  const [clearing, setClearing] = useState(false);
  const clear = useMutation({
    meta: { inlineError: true },
    mutationFn: (reason: string) =>
      post<Inbox<DreamItem>>("/api/dream/inbox/clear", reason ? { reason } : {}),
    onSuccess: (next) => {
      settled(next);
      setClearing(false);
    },
  });
  const proposals = inbox.data?.proposals || [];
  if (inbox.isError) return <Alert color="red">{inbox.error.message}</Alert>;
  if (!proposals.length) return null;
  return (
    <SettingGroup
      title={`Inbox (${proposals.length})`}
      toolbar={
        <Button
          size="compact-sm"
          variant="default"
          onClick={() => {
            clear.reset();
            setClearing(true);
          }}
        >
          Clear Inbox
        </Button>
      }
    >
      <ProposalList proposals={proposals} projects={projects} />
      <DismissDialog
        key={String(clearing)}
        title="Clear Inbox"
        opened={clearing}
        pending={clear.isPending}
        error={clear.error?.message}
        onDismiss={(reason) => clear.mutate(reason)}
        onClose={() => setClearing(false)}
      />
    </SettingGroup>
  );
}
