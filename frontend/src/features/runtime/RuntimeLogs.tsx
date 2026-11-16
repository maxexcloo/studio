import { Alert, Code, Group, Modal, ScrollArea, Select, Stack, Tabs } from "@mantine/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { RuntimePodLog } from "../../../../shared/runtime";
import { api } from "../../api";
import { CopyButton } from "../../ui/CopyButton";
import { dateFormat } from "../../ui/dates";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import { accountAdminQuery } from "../settings/AccountAdmin";

export const logTime = dateFormat({ timeStyle: "medium", hourCycle: "h23" });

/** Monospace log text, oldest first, wrapping long lines and kept scrolled to the newest. */
export function LogText({
  text,
  empty,
  label,
  controls,
}: {
  text: string;
  empty: string;
  label: string;
  controls?: ReactNode;
}) {
  const phone = usePhone();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [text]);
  return (
    <>
      <ScrollArea.Autosize mah={phone ? "calc(100dvh - 14rem)" : "60vh"} viewportRef={viewport}>
        <Code block aria-label={label} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {text || empty}
        </Code>
      </ScrollArea.Autosize>
      <Group justify="space-between" wrap="nowrap">
        {controls ?? <span />}
        <CopyButton size="compact-sm" text={text} />
      </Group>
    </>
  );
}

/** A pod line's RFC 3339 timestamp as local time, the rest as logged. */
const podLine = (line: string) => {
  const [stamp, ...rest] = line.split(" ");
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? line : `${logTime.format(at)}  ${rest.join(" ")}`;
};

/** Each pod's tail under a heading line. */
const podText = (pods: RuntimePodLog[]) =>
  pods
    .map((pod) =>
      [
        `# ${pod.name} · ${pod.container} · ${pod.phase} · ${pod.restarts} ${pod.restarts === 1 ? "restart" : "restarts"}${pod.previous ? " · last run" : ""}`,
        ...(pod.lines.length ? pod.lines.map(podLine) : ["No log yet."]),
      ].join("\n"),
    )
    .join("\n\n");

/** The tail of the pods `path` names, with a line count, refreshed every 3 seconds while shown. */
export function PodLog({ path }: { path: string }) {
  const [lines, setLines] = useState("200");
  const logs = useQuery({
    queryKey: ["runtime-logs", path, lines],
    queryFn: () => api<{ pods: RuntimePodLog[] }>(`${path}?lines=${lines}`),
    refetchInterval: 3000,
    retry: false,
    // Keep showing the last tail while another line count loads, but never another source's.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === path ? keepPreviousData(previous) : undefined,
  });
  return (
    <Stack gap="sm">
      {logs.error && <Alert color="yellow">{logs.error.message}</Alert>}
      {!logs.data ? (
        !logs.error && <LoadingState label="Loading Pod Log" />
      ) : (
        <LogText
          text={podText(logs.data.pods)}
          empty="No pods are running."
          label="Pod Log"
          controls={
            <Select
              aria-label="Lines"
              w={150}
              size="xs"
              data={["200", "500", "1000"].map((value) => ({ value, label: `${value} Lines` }))}
              value={lines}
              allowDeselect={false}
              onChange={(value) => value && setLines(value)}
            />
          }
        />
      )}
    </Stack>
  );
}

/** A log dialog, full screen on phones, with a tab per part when it has several, `initial` first. */
export function LogDialog({
  title,
  opened,
  onClose,
  parts,
  initial,
}: {
  title: string;
  opened: boolean;
  onClose: () => void;
  parts: { value: string; label: string; content: ReactNode }[];
  initial?: string;
}) {
  const phone = usePhone();
  const [tab, setTab] = useState<string | null>(null);
  const shown = parts.some((part) => part.value === tab) ? tab : (initial ?? parts[0]?.value);
  return (
    <Modal
      opened={opened}
      onClose={() => {
        setTab(null);
        onClose();
      }}
      title={title}
      size="xl"
      fullScreen={phone}
    >
      {parts.length === 1 ? (
        parts[0].content
      ) : (
        <Tabs value={shown} onChange={setTab} keepMounted={false}>
          <Tabs.List>
            {parts.map((part) => (
              <Tabs.Tab key={part.value} value={part.value}>
                {part.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {parts.map((part) => (
            <Tabs.Panel key={part.value} value={part.value} pt="sm">
              {part.content}
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </Modal>
  );
}

/** Who asked for a runtime change or benchmark: an account by name, Studio itself, or as recorded. */
export function useRequester() {
  const accounts = useQuery(accountAdminQuery).data?.accounts;
  return (requestedBy: string) =>
    requestedBy.startsWith("account:")
      ? (accounts?.find((account) => `account:${account.id}` === requestedBy)?.username ??
        "an account")
      : requestedBy === "local"
        ? "Studio"
        : requestedBy;
}
