import { Alert, Button, FocusTrap, Modal, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";

import {
  type Change,
  type Suggestions,
  type VariationDirection,
  variationDirections,
} from "../../../../shared/suggestions";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { closeWhenTop } from "../../ui/popupClicks";
import { useGroupFeature } from "../auth/AccountGate";
import { charactersQuery } from "../characters/queries";
import { showVariant } from "../compare/variants";
import {
  type Draft,
  defaultProfile,
  initialInput,
  inputForProfile,
  useGeneration,
} from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { generationInput, profileForBackend } from "../generation/payload";
import { presetsQuery } from "../generation/PresetPicker";
import { presetReplacesUnsaved } from "../generation/presets";
import { mediaDraft } from "./useMediaAction";
import { directionLabels, variationVariants } from "./variationDraft";

export function keepAndVaryAction(
  choose: (direction: VariationDirection | "explore") => void,
): Action {
  return {
    id: "keep-and-vary",
    label: "Keep & Vary",
    icon: icons.assistant,
    menu: [
      variationDirections.map((direction) => ({
        id: `vary-${direction}`,
        label: `Vary ${directionLabels[direction]}`,
        onClick: () => choose(direction),
      })),
      [
        {
          id: "explore-three-directions",
          label: "Explore Three Directions",
          icon: icons.compare,
          onClick: () => choose("explore"),
        },
      ],
    ],
  };
}

export function VariationDialog({
  item,
  direction,
  prompt,
  onClose,
  onApplied,
}: {
  item: MediaItem;
  direction: VariationDirection | "explore";
  prompt: string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const id = useId();
  const client = useQueryClient();
  const openComposer = useOpenComposer();
  const { draftForKind, models, profiles, setDraft } = useGeneration();
  const characters = useGroupFeature("characters");
  const current = draftForKind("image");
  const preferred = defaultProfile(models.data, "image");
  const profile = profiles.find(({ id }) => id === current.input.profileId) ?? preferred;
  const defaults = generationInput(
    preferred ? inputForProfile(initialInput, preferred) : initialInput,
    preferred,
    [],
  );
  const presets = useQuery({ ...presetsQuery, enabled: Boolean(current.presetId) });
  const selected = presets.data?.presets.find(({ id }) => id === current.presetId);
  const replace =
    Boolean(current.compare) ||
    presetReplacesUnsaved(
      generationInput(current.input, profile, current.references),
      defaults,
      defaults,
      selected,
    );
  const exploring = direction === "explore";
  const variation = useMutation({
    meta: { inlineError: true },
    mutationFn: async (): Promise<Draft> => {
      const { draft, profile, seed } = await mediaDraft(item, "image", client);
      const cards =
        characters && (draft.references.length || item.resultSet?.character || item.identity)
          ? await client.ensureQueryData(charactersQuery)
          : [];
      const answer = await post<Suggestions<Change>>("/api/suggestions", {
        surface: "change",
        jobId: item.jobId,
        itemId: item.id,
        prompt,
        actions: ["recreate"],
        directions: exploring ? variationDirections : [direction],
      });
      if (answer.reason) throw new Error(answer.reason);
      const runProfile = profileForBackend(
        profile,
        draft.input.profileBackend,
        draft.references.length > 0,
        draft.input.loras.some((lora) => lora.enabled !== false),
      );
      const base = { ...draft, input: { ...draft.input, prompt } };
      const variants = variationVariants(base, runProfile, seed, item, cards, answer.suggestions);
      return showVariant(draft, variants, 0);
    },
    onSuccess: (draft) => {
      setDraft(draft);
      onClose();
      onApplied?.();
      openComposer("image");
    },
  });
  const close = closeWhenTop(id, () => {
    if (!variation.isPending) onClose();
  });
  return (
    <Modal
      id={id}
      opened
      onClose={close}
      closeOnEscape={!variation.isPending}
      closeOnClickOutside={!variation.isPending}
      closeButtonProps={{ "aria-label": "Close", disabled: variation.isPending }}
      title={exploring ? "Explore Three Directions" : `Vary ${directionLabels[direction]}`}
    >
      <FocusTrap.InitialFocus />
      <Stack>
        <Text size="sm">
          {exploring
            ? "Review three prompts in the composer, each changing the scene, outfit or style."
            : `Review a new ${direction} in the composer.`}{" "}
          Studio carries over the character and identity references.
        </Text>
        {replace && <Text size="sm">This replaces your current image draft.</Text>}
        {variation.error && <Alert color="red">{variation.error.message}</Alert>}
        <DialogFooter pending={variation.isPending} onCancel={close}>
          <Button loading={variation.isPending} onClick={() => variation.mutate()}>
            {replace ? "Replace Draft" : "Open Composer"}
          </Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}
