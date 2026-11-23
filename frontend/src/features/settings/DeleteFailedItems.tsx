import { Button, Select } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { compareNames } from "../../ui/DataTable";
import { SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { galleryKey } from "../gallery/queries";
import { queueQuery } from "../generation/Queue";
import { accountAdminQuery } from "./AccountAdmin";

/**
 * Settings › Studio › Delete Failed Items: removes failed and cancelled items, which the gallery
 * hides, for one account or every account in a multi-user Studio. An account deletes its own
 * failed items in the gallery, through its Failed quick select.
 */
export function DeleteFailedItems() {
  const client = useQueryClient();
  const multiUser = useAccount().data?.mode === "multi-user";
  const accounts = useQuery({ ...accountAdminQuery, enabled: multiUser });
  const [owner, setOwner] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const owners = [
    { value: "all", label: "All Accounts" },
    ...(accounts.data?.accounts || [])
      .map((entry) => ({ value: entry.id, label: entry.username }))
      .sort((a, b) => compareNames(a.label, b.label)),
  ];
  const whose = !multiUser
    ? "all"
    : owner === "all"
      ? "every account's"
      : `${owners.find((entry) => entry.value === owner)?.label}'s`;
  const remove = useMutation({
    mutationFn: () =>
      post<{ cleared: number }>("/api/gallery/errors/clear", multiUser ? { owner } : undefined),
    onSuccess: () => {
      for (const queryKey of [galleryKey, ["gallery-filters"], queueQuery.queryKey])
        void client.invalidateQueries({ queryKey });
      setConfirming(false);
    },
  });
  return (
    <SettingRow
      wide={multiUser}
      label="Delete Failed Items"
      description={
        remove.data
          ? `${remove.data.cleared.toLocaleString()} deleted.`
          : multiUser
            ? "Remove failed and cancelled items from one account's gallery, or every account's."
            : "Remove failed and cancelled items from the gallery."
      }
    >
      {multiUser && (
        <Select
          aria-label="Whose Failed Items"
          data={owners}
          value={owner}
          allowDeselect={false}
          searchable={owners.length > 8}
          onChange={(value) => value && setOwner(value)}
        />
      )}
      <Button size="compact-sm" color="red" variant="light" onClick={() => setConfirming(true)}>
        Delete
      </Button>
      <ConfirmDialog
        opened={confirming}
        title="Delete Failed Items"
        action="Delete"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirming(false)}
      >
        Remove {whose} failed and cancelled items from the gallery?
      </ConfirmDialog>
    </SettingRow>
  );
}
