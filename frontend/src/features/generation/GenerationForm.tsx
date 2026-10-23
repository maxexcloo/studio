import { lazy, Suspense, useEffect, useState } from "react";
import {
  ActionIcon,
  Avatar,
  Tooltip,
  Alert,
  AspectRatio,
  Button,
  Group,
  Image,
  Paper,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ArrowUp } from "lucide-react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { failure, post } from "../../api";
import type { GenerationInput, Session } from "../../types";
import { useGeneration } from "./GenerationProvider";
import { LoadingState } from "../../ui/LoadingState";
import { ProfilePicker } from "./ProfilePicker";
import { PromptAssistant } from "./PromptAssistant";
import { GenerationSettingsFields } from "./GenerationSettingsFields";
import { PromptHistory } from "./PromptHistory";
import { PresetEditor } from "./PresetEditor";
import { GenerationFooter } from "./GenerationFooter";
import { SizePicker } from "./SizePicker";
import { generationInput, referenceDetails, primaryReference, referencePatch } from "./payload";
import { ReferenceRoleControl } from "./ReferenceRoleControl";
import { ReferencePicker } from "./ReferencePicker";
const MaskEditor = lazy(() => import("./MaskEditor"));

export function GenerationForm({
  onSubmitted,
  compact = false,
  autoFocusPrompt = false,
}: {
  onSubmitted?: () => void;
  compact?: boolean;
  autoFocusPrompt?: boolean;
}) {
  const { form, draft, setDraft, input, update, profile, profiles, selectProfile, models } =
    useGeneration();
  const client = useQueryClient();
  const uploadingReferences = useIsMutating({ mutationKey: ["reference-upload"] }) > 0;
  const assisting = useIsMutating({ mutationKey: ["prompt-assistance"] }) > 0;
  const navigate = useNavigate();
  const location = useLocation();
  const [maskOpen, setMaskOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  useEffect(() => {
    if (!input.profileId && profile) selectProfile(profile);
  }, [input.profileId, profile]);
  const submit = useMutation({
    mutationFn: async () => {
      if (form.validate().hasErrors) throw new Error("Describe what you want to create.");
      if (!profile) throw new Error("Choose an available model first.");
      const payload = {
        ...generationInput(input, profile, draft.references),
        operation: draft.operation,
        parentJobId: draft.parentJobId,
      };
      let sessionId = draft.sessionId;
      if (!sessionId) {
        const result = await post<{ session: Session }>("/api/sessions", {
          title: input.prompt.slice(0, 80),
          inputs: payload,
        });
        sessionId = result.session.id;
        setDraft((value) => ({ ...value, sessionId }));
      }
      await post(`/api/sessions/${sessionId}/generations`, payload);
      return sessionId;
    },
    onSuccess: (sessionId) => {
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["sessions"] });
      void client.invalidateQueries({ queryKey: ["session", sessionId] });
      onSubmitted?.();
      if (!["/images", "/video"].includes(location.pathname)) navigate(`/chat/${sessionId}`);
    },
    onError: failure,
  });
  const requiredReference = profile?.mediaInputs?.some(
    (slot) =>
      slot.required &&
      !referenceDetails(draft.references, input, profile).some((asset) => asset.slot === slot.id) &&
      !input.referenceAssets.some((asset) => asset.slot === slot.id),
  );
  function keyboardSubmit(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing)
      return;
    event.preventDefault();
    if (
      submit.isPending ||
      uploadingReferences ||
      assisting ||
      !profile ||
      profile.ready === false ||
      !input.prompt.trim() ||
      requiredReference
    )
      return;
    event.currentTarget.requestSubmit();
  }
  const primary = primaryReference(referenceDetails(draft.references, input, profile), profile);
  const inpaint = input.inpaint as
    | { assetId?: string; mask?: string; strength?: number; feather?: number }
    | undefined;
  const submitLabel =
    draft.operation === "refine"
      ? "Refine Image"
      : input.kind === "video"
        ? "Generate Video"
        : "Generate Image";
  if (!compact && narrow && referenceOpen)
    return <ReferencePicker inline opened onOpenedChange={setReferenceOpen} />;
  if (compact)
    return (
      <form
        onKeyDown={keyboardSubmit}
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        <Group wrap="nowrap" gap="xs" className="studio-compact-composer">
          <Textarea
            data-composer-prompt
            aria-label="Prompt"
            placeholder={input.kind === "video" ? "Describe the motion…" : "Describe your image…"}
            autosize
            minRows={1}
            maxRows={1}
            variant="unstyled"
            className="studio-compact-prompt"
            value={input.prompt}
            onChange={(event) => update({ prompt: event.currentTarget.value })}
            required
          />
          {!!draft.references.length && (
            <Avatar.Group aria-label="Selected References" spacing={8}>
              {draft.references.slice(0, 3).map((asset) => (
                <Avatar
                  key={`${asset.slot}:${asset.id}`}
                  src={asset.thumbnailUrl || asset.url}
                  alt={asset.name || "Reference"}
                  size={28}
                  radius="sm"
                />
              ))}
              {draft.references.length > 3 && (
                <Avatar
                  size={28}
                  radius="sm"
                  aria-label={`${draft.references.length - 3} More References`}
                >
                  +{draft.references.length - 3}
                </Avatar>
              )}
            </Avatar.Group>
          )}
          <Tooltip label={submitLabel}>
            <ActionIcon
              type="submit"
              aria-label={submitLabel}
              className="studio-generate-button"
              size={44}
              radius="xl"
              variant="filled"
              loading={submit.isPending}
              disabled={
                !profile ||
                profile.ready === false ||
                !input.prompt.trim() ||
                requiredReference ||
                assisting ||
                uploadingReferences
              }
            >
              <ArrowUp size={20} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {!!submit.error && (
          <Text c="red" size="xs">
            {submit.error instanceof Error ? submit.error.message : String(submit.error)}
          </Text>
        )}
      </form>
    );
  if (models.isPending) return <LoadingState label="Loading Profiles" />;
  return (
    <form
      onKeyDown={keyboardSubmit}
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <Stack gap="md">
        <ProfilePicker />
        {profile?.ready === false && (
          <Alert color="yellow">
            This model needs additional files or worker nodes before it can run.
          </Alert>
        )}
        {!models.isPending && !profile && (
          <Alert color="yellow">
            {input.profileId && profiles.length
              ? "The selected profile is unavailable. Choose another model explicitly."
              : "No models are available. Check your worker and mounted configuration."}
          </Alert>
        )}
        {models.error && <Alert color="red">{models.error.message}</Alert>}
        <Textarea
          data-expanded-prompt
          variant="unstyled"
          rightSection={
            <PromptHistory
              kind="positive"
              value={input.prompt}
              onPick={(prompt) => update({ prompt })}
            />
          }
          rightSectionPointerEvents="all"
          rightSectionProps={{ style: { alignItems: "flex-start", paddingTop: 8 } }}
          data-autofocus={autoFocusPrompt || undefined}
          label="Prompt"
          placeholder={
            input.kind === "image"
              ? "Describe the image you want to create…"
              : "Describe the motion and camera…"
          }
          autosize
          minRows={3}
          maxRows={10}
          value={input.prompt}
          onChange={(event) => update({ prompt: event.currentTarget.value })}
          required
        />
        <PromptAssistant
          input={input}
          profile={profile}
          references={draft.references}
          onChange={update}
        />
        {profile?.mediaInputs?.length ||
        profile?.capabilities?.img2img ||
        profile?.capabilities?.imageInput ? (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                References
              </Text>
              <ReferencePicker opened={referenceOpen} onOpenedChange={setReferenceOpen} />
            </Group>
            {!!draft.references.length && (
              <ReferenceRoleControl
                value={input.referenceRole}
                onChange={(referenceRole) => update({ referenceRole })}
              />
            )}
            {draft.references.map((asset) => (
              <Paper withBorder key={`${asset.slot}:${asset.id}`} p="xs">
                <Group wrap="nowrap">
                  <AspectRatio ratio={1} w={52}>
                    <Image src={asset.thumbnailUrl} alt={asset.name} fallbackSrc="" />
                  </AspectRatio>
                  <Text size="sm" lineClamp={1} flex={1}>
                    {asset.name}
                    {asset.slot
                      ? ` · ${profile?.mediaInputs?.find((slot) => slot.id === asset.slot)?.label || asset.slot}`
                      : ""}
                  </Text>
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() =>
                      setDraft((value) => {
                        const references = value.references.filter(
                          (a) => a.id !== asset.id || a.slot !== asset.slot,
                        );
                        return {
                          ...value,
                          references,
                          input: {
                            ...value.input,
                            ...referencePatch(value.input, value.references, references, profile),
                          },
                        };
                      })
                    }
                  >
                    Remove
                  </Button>
                </Group>
              </Paper>
            ))}
            {requiredReference && (
              <Text size="xs" c="dimmed">
                This workflow requires a reference image.
              </Text>
            )}
            {primary && profile?.capabilities?.inpaint && (
              <Group>
                <Button variant="default" size="compact-sm" onClick={() => setMaskOpen(true)}>
                  {input.inpaint ? "Edit Mask" : "Paint Mask"}
                </Button>
                {!!input.inpaint && (
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => update({ inpaint: null })}
                  >
                    Remove Mask
                  </Button>
                )}
              </Group>
            )}
          </Stack>
        ) : null}
        <SizePicker input={input} profile={profile} onChange={update} />
        <GenerationSettingsFields
          input={input}
          profile={profile}
          onChange={update}
          presets={<PresetEditor />}
        />
        {!!submit.error && (
          <Alert color="red">
            {submit.error instanceof Error ? submit.error.message : String(submit.error)}
          </Alert>
        )}
        <GenerationFooter
          kind={input.kind}
          onKindChange={(kind) => {
            const next = profiles.find((profile) => profile.kind === kind);
            if (next) selectProfile(next);
            else update({ kind, profileId: "" });
          }}
          onClear={() =>
            setDraft((previous) => ({
              ...previous,
              references: [],
              input: {
                ...previous.input,
                prompt: "",
                negative: "",
                referenceAssets: [],
                referenceDetails: [],
                inpaint: undefined,
              },
            }))
          }
        >
          <Button
            type="submit"
            rightSection={<ArrowUp size={18} />}
            size="sm"
            loading={submit.isPending}
            disabled={
              !profile ||
              profile.ready === false ||
              !input.prompt.trim() ||
              requiredReference ||
              uploadingReferences ||
              assisting
            }
          >
            {draft.operation === "refine"
              ? "Refine Image"
              : input.kind === "video"
                ? "Generate Video"
                : "Generate Image"}
          </Button>
        </GenerationFooter>
        {maskOpen && primary && (
          <Suspense fallback={null}>
            <MaskEditor
              key={primary.id}
              asset={primary}
              initialMask={
                !inpaint?.assetId || inpaint.assetId === primary.id ? inpaint?.mask : undefined
              }
              close={() => setMaskOpen(false)}
              save={(mask) =>
                update({
                  inpaint: {
                    ...inpaint,
                    mask,
                    assetId: primary.id,
                    strength: inpaint?.strength ?? 1,
                    feather: inpaint?.feather ?? 0.4,
                  },
                })
              }
            />
          </Suspense>
        )}
      </Stack>
    </form>
  );
}
