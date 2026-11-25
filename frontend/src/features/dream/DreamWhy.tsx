import { Anchor, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

import type { MediaKind } from "../../types";
import { galleryItemQuery } from "../gallery/queries";
import { followed, viewerPath } from "../gallery/viewerLink";
import type { DreamItem } from "./queries";

/** How Dream came to make a result, from its arm (backend `DreamOrigin.arm`). */
function source(arm = "") {
  const [kind, axis] = arm.split(":");
  if (kind === "explore")
    return axis === "profile"
      ? "New ground, trying a model"
      : axis === "lora"
        ? "New ground, trying a LoRA"
        : "New ground";
  if (kind === "continue") return `Varies a liked image's ${axis}`;
  const kinds: Record<string, string> = {
    exploit: "Familiar ground from your taste",
    series: "Series from a liked image",
    recreate: "Recreates a liked image",
    animate: "Animates an image",
    extend: "Extends a clip",
    remaster: "Remasters a kept or liked clip",
  };
  return kinds[kind] ?? "";
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Text size="xs">
      <Text span inherit fw={600}>
        {label}:
      </Text>{" "}
      {children}
    </Text>
  );
}

/** Details › Why Dream Made This: its reason and what fed it, as recorded when it was made. */
export function DreamWhy({ item, question }: { item: DreamItem; question?: string }) {
  const { dream } = item;
  const inputs = dream?.inputs ?? {};
  const recorded = inputs.prompts?.find((liked) => liked.id === item.parentItemId);
  const parent = useQuery({
    ...galleryItemQuery(item.parentItemId ?? ""),
    enabled: Boolean(dream && item.parentItemId && !recorded),
  }).data?.item;
  if (!dream) return null;
  const from = dream.pair ? "Comparison" : source(dream.arm);
  const sourceResult = recorded ?? parent;
  const sourceLink = sourceResult
    ? {
        to: viewerPath({ ...sourceResult, type: sourceResult.type as MediaKind }),
        label: "View Source",
      }
    : dream.projectId
      ? { to: `/dream/projects/${encodeURIComponent(dream.projectId)}`, label: "View Project" }
      : dream.arm === "exploit" || dream.arm?.startsWith("explore")
        ? { to: "/settings#taste", label: "View Taste" }
        : null;
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>
        Why Dream Made This
      </Text>
      {(from || sourceLink) && (
        <Row label="Source">
          {[from || "Previous Result", dream.uncensored && "Uncensored"]
            .filter(Boolean)
            .join(" · ")}
          {sourceLink && (
            <>
              {" · "}
              <Anchor component={Link} to={sourceLink.to} state={followed} inherit>
                {sourceLink.label}
              </Anchor>
            </>
          )}
        </Row>
      )}
      {dream.brief && <Text size="sm">{dream.brief}</Text>}
      {question && <Text size="sm">{question}</Text>}
      {dream.why && (
        <Text size="sm" c="dimmed">
          {dream.why}
        </Text>
      )}
      {inputs.project && <Row label="Project">{inputs.project}</Row>}
      {inputs.likes && <Row label="Likes">{inputs.likes.join(", ")}</Row>}
      {inputs.styles && <Row label="Styles">{inputs.styles.join(", ")}</Row>}
      {inputs.feature && <Row label="Featured Tag">{inputs.feature}</Row>}
      {inputs.prompts && (
        <Row label="Liked Prompts">
          {inputs.prompts.map((liked, index) => (
            <Fragment key={liked.id}>
              {index > 0 && " · "}
              <Anchor
                component={Link}
                to={viewerPath({ ...liked, type: liked.type as MediaKind })}
                state={followed}
                inherit
              >
                {liked.title}
              </Anchor>
            </Fragment>
          ))}
        </Row>
      )}
      {inputs.notes && <Row label="Chat Notes">{inputs.notes.join(" · ")}</Row>}
      {inputs.guidance && <Row label="Guidance">{inputs.guidance}</Row>}
      {(inputs.preferences || inputs.rules) && (
        <Row label="My Preferences">{inputs.preferences ?? inputs.rules!.join(" · ")}</Row>
      )}
      {inputs.choice && <Row label="Model">{inputs.choice}</Row>}
      {inputs.seed && <Row label="Seed">{inputs.seed}</Row>}
    </Stack>
  );
}
