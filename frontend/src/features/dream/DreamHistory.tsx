import { Alert, Anchor, ScrollArea, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import type { DreamActivity } from "../../../../shared/taste";
import { DataTable } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { viewerItemId } from "../gallery/viewerLink";
import { type DreamMedia, historyQuery } from "./queries";

function Result({ item }: { item: DreamActivity["item"] }) {
  return item.id ? (
    <Anchor
      component={Link}
      to={`${item.media === "video" ? "/video" : "/images"}?${new URLSearchParams({ item: viewerItemId({ ...item, id: item.id }) })}`}
      size="sm"
      truncate
      display="block"
    >
      {item.title}
    </Anchor>
  ) : (
    <Text size="sm" truncate>
      {item.title}
    </Text>
  );
}

export function DreamHistory({ media }: { media: DreamMedia }) {
  const history = useQuery(historyQuery(media));
  if (history.isError)
    return (
      <Alert color="red" title="Couldn't Load History">
        {history.error.message}
      </Alert>
    );
  return (
    <ScrollArea flex={1} mih={0}>
      <Text size="xs" c="dimmed" mb="sm">
        Retained Dream activity, newest first. Older activity may no longer be available.
      </Text>
      <DataTable
        label="Dream History"
        rows={(history.data?.items || []).map((item, index) => ({ ...item, key: String(index) }))}
        rowKey={(item) => item.key}
        rowName={(item) => item.action}
        loading={history.isPending && "Loading History"}
        empty="No Retained Activity"
        columns={[
          {
            key: "action",
            header: "Action",
            cell: (item) => (
              <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                {item.action}
              </Text>
            ),
          },
          {
            key: "result",
            header: "Result",
            main: true,
            cell: (item) => (
              <Stack gap={2}>
                <Result item={item.item} />
                {item.other && <Result item={item.other} />}
                {item.question && (
                  <Text size="xs" c="dimmed" truncate>
                    {item.question}
                  </Text>
                )}
                {item.answer && (
                  <Text size="xs" c="dimmed" truncate>
                    {item.answer}
                  </Text>
                )}
              </Stack>
            ),
          },
          {
            key: "at",
            header: "Time",
            cell: (item) => (
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {formatDateTime(item.at)}
              </Text>
            ),
          },
        ]}
      />
    </ScrollArea>
  );
}
