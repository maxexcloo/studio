import type { ReactNode } from "react";
import { ActionIcon, Menu } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import { Link, useLocation } from "react-router";
import { post } from "../../api";
import { ownAccountQuery, useAccount } from "./AccountGate";

export function AccountMenuContent({
  accountFirst = false,
  children,
}: {
  accountFirst?: boolean;
  children?: ReactNode;
}) {
  const location = useLocation(),
    client = useQueryClient();
  const account = useAccount(),
    multi = account.data?.mode === "multi-user";
  const own = useQuery({ ...ownAccountQuery, enabled: multi });
  const signOut = useMutation({
    mutationFn: () => post("/api/accounts/sign-out"),
    onSuccess: () => {
      client.clear();
      window.location.assign("/");
    },
  });
  const name = multi ? own.data?.account.username || "Your Account" : "Single-User Development";
  const label = <Menu.Label>{name}</Menu.Label>;
  return (
    <>
      {!accountFirst && label}
      <Menu.Item
        component={Link}
        to="/settings#account"
        state={{ backgroundLocation: location }}
        leftSection={<UserRound size={16} />}
      >
        Account
      </Menu.Item>
      {children}
      {(multi || accountFirst) && <Menu.Divider />}
      {accountFirst && label}
      {multi && (
        <Menu.Item
          leftSection={<LogOut size={16} />}
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          Sign Out
        </Menu.Item>
      )}
    </>
  );
}
export function AccountMenu() {
  return (
    <Menu position="bottom-end" shadow="md" width={240}>
      <Menu.Target>
        <ActionIcon aria-label="Your Account" variant="subtle" color="gray">
          <UserRound size={19} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <AccountMenuContent />
      </Menu.Dropdown>
    </Menu>
  );
}
