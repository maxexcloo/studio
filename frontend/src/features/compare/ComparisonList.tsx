import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Menu,
  SimpleGrid,
  Stack,
  Text,
  VisuallyHidden,
} from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { menuWidth } from "../../theme";
import { ActionMenuItems, useActionMenuBounds } from "../../ui/ActionBar";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { ViewMenu } from "../../ui/ViewMenu";
import { itemAction } from "../gallery/itemActions";
import { mediaTitle } from "../gallery/mediaLabels";
import { MediaTile } from "../gallery/MediaTile";
import { useGalleryColumns, useHoldToSelect } from "../gallery/useGalleryLayout";
import { ComparisonRatingButtons, useRateComparison } from "./ComparisonRatingButtons";
import { type Comparison, againItems, comparisonTitle, comparisonsQuery } from "./queries";
import { useStageComparison } from "./variants";

import toolbarClasses from "../../ui/PageToolbar.module.css";
import filterClasses from "../gallery/GalleryFilters.module.css";
import galleryClasses from "../gallery/GalleryPage.module.css";
import tileClasses from "../gallery/MediaTileActions.module.css";

// Disliked comparisons stay out of the default view.
const ratings = [
  { value: "kept", label: "Liked & Unrated" },
  { value: "liked", label: "Liked" },
  { value: "unrated", label: "Unrated" },
  { value: "disliked", label: "Disliked" },
  { value: "all", label: "All" },
] as const;
type Rating = (typeof ratings)[number]["value"];

/**
 * The gallery's Comparisons view: a card per comparison or kept Dream comparison, newest first,
 * opening all its variants.
 */
export function ComparisonList({ view }: { view: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requested = params.get("rating");
  const rating: Rating =
    ratings.find(({ value }) => value === requested && value !== "kept")?.value ?? "kept";
  const { columns } = useGalleryColumns();
  const comparisons = useQuery(comparisonsQuery);
  // The winner, else the first variant with media, else the first still in the gallery, is the cover.
  const cards = (comparisons.data?.comparisons || []).flatMap((comparison) => {
    const rated = comparison.rating || "unrated";
    if (rating === "kept" ? rated === "disliked" : rating !== "all" && rated !== rating) return [];
    const items = comparison.variants.flatMap(({ item }) => (item ? [item] : []));
    const cover =
      items.find((item) => item.id === comparison.winnerItemId) ||
      items.find((item) => item.url) ||
      items[0];
    if (!cover) return [];
    // A run's variants are named by their labels as given, which their set titles title-case.
    const title =
      comparison.axis || comparison.dream
        ? comparisonTitle(comparison)
        : cover.resultSet?.id === comparison.id
          ? comparison.variants.find(({ item }) => item === cover)!.label
          : mediaTitle(cover);
    return [{ comparison, cover, title }];
  });
  // Holding a card's tile opens its menu, which is keyed by the cover's ID.
  const [menu, setMenu] = useState<string | null>(null);
  const hold = useHoldToSelect(
    cards.map(({ cover }) => cover),
    undefined,
    setMenu,
  );
  const open = (comparison: Comparison) =>
    void navigate(`/compare/${encodeURIComponent(comparison.id)}`, {
      state: { comparisonSearch: location.search },
    });
  return (
    <Stack gap="sm" className={galleryClasses.page}>
      <VisuallyHidden component="h1">Comparisons</VisuallyHidden>
      <div className={toolbarClasses.band}>
        <Group gap="xs" mih={44} wrap="nowrap" className={filterClasses.mode}>
          {view}
          <div className={filterClasses.chips} />
          <ViewMenu
            label="Rating"
            value={rating}
            groups={[ratings]}
            onChange={(value) =>
              setParams(value === "kept" ? {} : { rating: value }, {
                replace: true,
                state: location.state,
              })
            }
          />
        </Group>
      </div>
      {comparisons.isPending ? (
        <LoadingState fill label="Loading Comparisons" />
      ) : comparisons.error ? (
        <Alert color="red" title="Couldn't Load Comparisons">
          <Stack gap="sm" align="flex-start">
            {comparisons.error.message}
            <Button size="compact-sm" variant="default" onClick={() => void comparisons.refetch()}>
              Retry
            </Button>
          </Stack>
        </Alert>
      ) : cards.length ? (
        <SimpleGrid cols={columns} spacing="sm" style={{ alignItems: "start" }} {...hold.handlers}>
          {cards.map(({ comparison, cover, title }) => (
            <Stack key={comparison.id} gap={4} miw={0}>
              <MediaTile
                item={cover}
                hold={hold}
                caption="none"
                label={`Open Comparison: ${title}`}
                style={{ aspectRatio: `${cover.width || 1} / ${cover.height || 1}` }}
                onOpen={() => open(comparison)}
                onMenu={() => setMenu(cover.id)}
                actions={
                  <ComparisonActions
                    comparison={comparison}
                    title={title}
                    opened={menu === cover.id}
                    onOpenedChange={(opened) => setMenu(opened ? cover.id : null)}
                    onOpen={() => open(comparison)}
                  />
                }
              />
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Stack gap={0} miw={0}>
                  <Text size="sm" fw={500} truncate title={title}>
                    {title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {plural(comparison.variants.length, "Variant")}
                    {comparison.winnerItemId && " · Winner Picked"}
                  </Text>
                </Stack>
                <ComparisonRatingButtons comparison={comparison} />
              </Group>
            </Stack>
          ))}
        </SimpleGrid>
      ) : (
        <EmptyState fill>
          {rating === "liked"
            ? "No Liked Comparisons"
            : rating === "disliked"
              ? "No Disliked Comparisons"
              : rating === "unrated"
                ? "No Unrated Comparisons"
                : "No Comparisons"}
        </EmptyState>
      )}
    </Stack>
  );
}

/** A comparison tile's menu: More on hover, right-click, the Menu key or holding opens it. */
function ComparisonActions({
  comparison,
  title,
  opened,
  onOpenedChange,
  onOpen,
}: {
  comparison: Comparison;
  title: string;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
  onOpen: () => void;
}) {
  const bounds = useActionMenuBounds(opened);
  const rate = useRateComparison(comparison);
  const stage = useStageComparison();
  const again = useMutation({ mutationFn: () => stage.again(againItems(comparison)) });
  const rating = (id: "like" | "dislike") => {
    const value = id === "like" ? "liked" : "disliked";
    const pressed = comparison.rating === value;
    return itemAction(id, {
      pressed,
      disabled: rate.isPending,
      onClick: () => rate.mutate(pressed ? null : value),
    });
  };
  return (
    <Group
      className={tileClasses.actions}
      data-opened={opened || undefined}
      justify="flex-end"
      align="flex-start"
      wrap="nowrap"
    >
      <Menu
        {...bounds}
        opened={opened}
        onChange={onOpenedChange}
        position="bottom-end"
        width={menuWidth}
      >
        <Menu.Target>
          <ActionIcon
            className={`${tileClasses.control} ${tileClasses.more}`}
            aria-label={`More Actions for ${title}`}
            variant="default"
            size={28}
          >
            <icons.more size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <ActionMenuItems
            groups={[
              [
                { id: "open", label: "Open", icon: icons.compareSideBySide, onClick: onOpen },
                ...(againItems(comparison).length > 1
                  ? [
                      {
                        id: "again",
                        label: "Compare Again",
                        icon: icons.compare,
                        loading: again.isPending,
                        onClick: () => again.mutate(),
                      },
                    ]
                  : []),
              ],
              [rating("like"), rating("dislike")],
            ]}
          />
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
