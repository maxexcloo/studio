import { useState } from "react";
import {
  AspectRatio,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { ChevronDown } from "lucide-react";
import type { DigestGroup } from "../../../../shared/projects";
import { usePhone, useSideways } from "../../ui/usePhone";
import { MediaViewer } from "../gallery/MediaViewer";
import { dreamChoices, viewerChoices, type Verdict } from "./choices";
import { Thumbnail } from "./DiscardedDreams";
import { useJudge } from "./DreamDeck";
import type { DreamItem } from "./queries";

const sinceFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function DigestCard({
  item,
  fresh,
  onView,
  onJudge,
}: {
  item: DreamItem;
  fresh: boolean;
  onView(): void;
  onJudge(verdict: Verdict): void;
}) {
  const { review } = item;
  const name = item.title || item.prompt || "Dream Result";
  return (
    <Card withBorder padding={0} radius="md">
      <UnstyledButton aria-label={`View ${name}`} onClick={onView}>
        <AspectRatio ratio={1}>
          <Thumbnail item={item} />
        </AspectRatio>
      </UnstyledButton>
      <Stack gap={4} px="xs" pt={6}>
        <Group gap={6} wrap="nowrap">
          {fresh && (
            <Badge size="sm" variant="light">
              New
            </Badge>
          )}
          {review && (
            <Badge size="sm" variant="default" aria-label={`Fits the brief ${review.score} of 10`}>
              {review.score}/10
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed" lineClamp={2} mih={36}>
          {review?.miss || item.dream?.why || item.prompt}
        </Text>
      </Stack>
      <Group gap="xs" p="xs" grow wrap="nowrap">
        {/* The deck bar's large choices; Like is light here, as every card has one. */}
        {dreamChoices({ kind: "dream", key: item.id, item })
          .flat()
          .filter((choice) => choice.main)
          .map(({ choice, label, icon: Icon, primary }) => (
            <Button
              key={choice}
              px={4}
              variant={primary ? "light" : "default"}
              leftSection={<Icon size={16} />}
              aria-label={`${label} ${name}`}
              onClick={() => onJudge(choice as Verdict)}
            >
              {label}
            </Button>
          ))}
      </Group>
    </Card>
  );
}

/**
 * Ranked results as they show: a series' results gathered as one set where its best one ranks, in
 * the set's order, and the others in runs between.
 */
function withSets(items: DreamItem[]) {
  const blocks: { set?: NonNullable<DreamItem["resultSet"]>; items: DreamItem[] }[] = [];
  const sets = new Map<string, DreamItem[]>();
  for (const item of items) {
    const set = item.resultSet;
    const members = set && sets.get(set.id);
    if (members) members.push(item);
    else if (set) {
      sets.set(set.id, [item]);
      blocks.push({ set, items: sets.get(set.id)! });
    } else if (blocks.length && !blocks.at(-1)!.set) blocks.at(-1)!.items.push(item);
    else blocks.push({ items: [item] });
  }
  for (const members of sets.values())
    members.sort((a, b) => (a.resultSet?.index ?? 0) - (b.resultSet?.index ?? 0));
  return blocks;
}

/**
 * While You Were Away: each project's unseen Dream results, best fit to its brief first, with
 * those that miss it collapsed under Misses, and each series as one set. Pass, Super Like and Like
 * judge a card in place;
 * opening one shows the viewer with every choice, moving on to the next result after each.
 */
export function DreamDigest({
  groups,
  since,
}: {
  groups: DigestGroup<DreamItem>[];
  since: string | null;
}) {
  const phone = usePhone();
  const sideways = useSideways();
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const forget = (id: string) =>
    setDecided((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  const judge = useJudge((card) => card.kind === "dream" && forget(card.item.id));
  const shown = groups
    .map((group) => ({
      ...group,
      key: group.projectId || "",
      items: group.items.filter((item) => !decided.has(item.id)),
      misses: group.misses.filter((item) => !decided.has(item.id)),
    }))
    .filter((group) => group.items.length + group.misses.length);
  // The viewer flips through what is on screen, in its order, collapsed misses left out.
  const order = shown.flatMap((group) =>
    [group.items, open.has(group.key) ? group.misses : []].flatMap((items) =>
      withSets(items).flatMap((block) => block.items),
    ),
  );
  const fresh = (item: DreamItem) => !since || String(item.createdAt || "") > since;
  const count = shown.reduce(
    (sum, group) => sum + [...group.items, ...group.misses].filter(fresh).length,
    0,
  );
  function act(item: DreamItem, verdict: Verdict) {
    const index = order.findIndex((entry) => entry.id === item.id);
    const next = order[index + 1] || order[index - 1];
    setDecided((previous) => new Set(previous).add(item.id));
    if (viewing === item.id) setViewing(next?.id ?? null);
    judge.mutate({ card: { kind: "dream", key: item.id, item }, verdict });
  }
  const current = viewing ? order.find((item) => item.id === viewing) : undefined;
  if (viewing && !current) setViewing(null);
  const cards = (items: DreamItem[]) => (
    <SimpleGrid cols={phone ? (sideways ? 2 : 1) : { base: 2, md: 3, lg: 4 }} spacing="sm">
      {items.map((item) => (
        <DigestCard
          key={item.id}
          item={item}
          fresh={fresh(item)}
          onView={() => setViewing(item.id)}
          onJudge={(verdict) => act(item, verdict)}
        />
      ))}
    </SimpleGrid>
  );
  const grid = (items: DreamItem[]) => (
    <Stack gap="sm">
      {withSets(items).map(({ set, items: members }) =>
        set ? (
          <Stack key={set.id} gap={6} role="group" aria-label={`Series: ${set.title}`}>
            <Title order={4} size="h6">
              {set.title}
              <Text span size="sm" c="dimmed" fw={400}>
                {` · Series of ${members.length}`}
              </Text>
            </Title>
            {cards(members)}
          </Stack>
        ) : (
          <div key={members[0].id}>{cards(members)}</div>
        ),
      )}
    </Stack>
  );
  return (
    <ScrollArea flex={1} mih={0}>
      <Stack gap="lg" pb="md" maw={1200} mx="auto">
        <div>
          <Title order={2}>While You Were Away</Title>
          <Text size="sm" c="dimmed">
            {count
              ? `${count} new${since ? ` since ${sinceFormat.format(new Date(since))}` : ""}`
              : "Nothing new since your last visit"}
          </Text>
        </div>
        {shown.map((group) => (
          <Stack key={group.key} gap="sm" component="section" aria-label={group.name}>
            <Title order={3} size="h4">
              {group.name}
            </Title>
            {group.items.length > 0 && grid(group.items)}
            {group.misses.length > 0 && (
              <>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  w="fit-content"
                  aria-expanded={open.has(group.key)}
                  rightSection={<ChevronDown size={14} />}
                  onClick={() =>
                    setOpen((previous) => {
                      const next = new Set(previous);
                      if (!next.delete(group.key)) next.add(group.key);
                      return next;
                    })
                  }
                >
                  Misses ({group.misses.length})
                </Button>
                <Collapse expanded={open.has(group.key)} keepMounted={false}>
                  {grid(group.misses)}
                </Collapse>
              </>
            )}
          </Stack>
        ))}
      </Stack>
      {current && (
        <MediaViewer
          item={current}
          items={order}
          navigate={(item) => setViewing(item.id)}
          close={() => setViewing(null)}
          actions={viewerChoices(
            { kind: "dream", key: current.id, item: current },
            (choice) => act(current, choice as Verdict),
            phone,
          )}
        />
      )}
    </ScrollArea>
  );
}
