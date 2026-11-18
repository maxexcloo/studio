import { Alert, Button, Group, Image, Modal, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { maxTasteRule } from "../../../../shared/taste";
import { api, post } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { tasteQuery } from "./TasteProfile";

/** A recurring problem from Reports, review misses and chat requests (backend/domain/issues.ts). */
interface Issue {
  issue: string;
  rule: string;
  count: number;
  sources: { report: number; review: number; chat: number };
  examples: { id: string; thumbnailUrl?: string }[];
}
interface Issues {
  updatedAt: string;
  issues: Issue[];
  writer: boolean;
}
export const issuesQuery = queryOptions({
  queryKey: ["taste", "issues"],
  queryFn: () => api<Issues>("/api/taste/issues"),
});

const sourceNames = { chat: "Chats", report: "Reports", review: "Review" } as const;
/** Where an issue was seen, such as "3 times · Chats 2 · Reports 1". */
const seen = ({ count, sources }: Issue) =>
  [
    `${count} ${count === 1 ? "time" : "times"}`,
    ...(Object.keys(sourceNames) as (keyof typeof sourceNames)[])
      .filter((source) => sources[source])
      .map((source) => `${sourceNames[source]} ${sources[source]}`),
  ].join(" · ");

/** Adds an issue's suggested rule, worded as the person wants it. */
function RuleEditor({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const client = useQueryClient();
  const [rule, setRule] = useState(issue.rule);
  const add = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<Issues>("/api/taste/issues/accept", { rule: rule.trim() }),
    onSuccess: (next) => {
      client.setQueryData(issuesQuery.queryKey, next);
      void client.invalidateQueries({ queryKey: tasteQuery.queryKey, exact: true });
      onClose();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <Stack>
        <TextBox
          label="Rule"
          description="A limit every prompt keeps in Dream and chats, never a look to aim for."
          value={rule}
          onChange={setRule}
          autosize
          minRows={2}
          maxLength={maxTasteRule}
        />
        {add.error && <Alert color="red">{add.error.message}</Alert>}
        <DialogFooter pending={add.isPending} onCancel={onClose}>
          <Button type="submit" loading={add.isPending} disabled={!rule.trim()}>
            Add
          </Button>
        </DialogFooter>
      </Stack>
    </form>
  );
}

/** What keeps going wrong lately, each with its evidence and a rule that would prevent it. */
export function TasteIssues() {
  const phone = usePhone();
  const client = useQueryClient();
  const issues = useQuery(issuesQuery);
  const [adding, setAdding] = useState<Issue | null>(null);
  const saved = (next: Issues) => client.setQueryData(issuesQuery.queryKey, next);
  const refresh = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<Issues>("/api/taste/issues/refresh"),
    onSuccess: saved,
  });
  const dismiss = useMutation({
    mutationFn: (issue: string) => post<Issues>("/api/taste/issues/dismiss", { issue }),
    onSuccess: saved,
  });
  const data = issues.data;
  const error = refresh.error || issues.error;
  return (
    <>
      <SettingGroup
        title="Issues"
        toolbar={
          data?.writer && (
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<icons.refresh size={16} />}
              loading={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              Refresh
            </Button>
          )
        }
      >
        <Stack gap="xs">
          {issues.isPending && <LoadingState label="Loading Issues" />}
          {data && (
            <Text size="xs" c="dimmed">
              From your Reports, reviews against your rules and what you asked chats to change over
              the last two weeks.
              {data.updatedAt && ` Updated ${formatDateTime(data.updatedAt)}.`}
            </Text>
          )}
          {data && !data.issues.length && (
            <Text size="sm" c="dimmed">
              No recurring issues in the last two weeks.
            </Text>
          )}
          {data?.issues.map((issue) => (
            <SettingRow
              key={issue.issue}
              label={issue.issue}
              description={
                <Stack gap={4} component="span">
                  <span>{seen(issue)}</span>
                  {issue.rule && (
                    <Text span size="sm" c="text">
                      Suggested rule: {issue.rule}
                    </Text>
                  )}
                  <Group gap={4} component="span">
                    {issue.examples
                      .filter((example) => example.thumbnailUrl)
                      .map((example) => (
                        <Image
                          key={example.id}
                          src={example.thumbnailUrl}
                          alt=""
                          w={48}
                          h={48}
                          radius="sm"
                          loading="lazy"
                        />
                      ))}
                  </Group>
                </Stack>
              }
            >
              <Group gap="xs" wrap="nowrap">
                {issue.rule && (
                  <Button size="compact-sm" variant="default" onClick={() => setAdding(issue)}>
                    Add Rule
                  </Button>
                )}
                <Button
                  size="compact-sm"
                  variant="subtle"
                  loading={dismiss.isPending && dismiss.variables === issue.issue}
                  onClick={() => dismiss.mutate(issue.issue)}
                >
                  Dismiss
                </Button>
              </Group>
            </SettingRow>
          ))}
          {error && <Alert color="red">{error.message}</Alert>}
        </Stack>
      </SettingGroup>
      <Modal
        id="issue-rule"
        opened={Boolean(adding)}
        onClose={closeWhenTop("issue-rule", () => setAdding(null))}
        title="Add Rule"
        fullScreen={phone}
      >
        {adding && <RuleEditor issue={adding} onClose={() => setAdding(null)} />}
      </Modal>
    </>
  );
}
