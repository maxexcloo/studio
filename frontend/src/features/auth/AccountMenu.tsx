import { Menu } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

import { post } from "../../api";
import { ownAccountQuery, useAccount } from "./AccountGate";

/** The account heading and Account, then workspace links and the final Sign Out action. */
export function AccountMenuContent({ children }: { children?: ReactNode }) {
  const location = useLocation(),
    client = useQueryClient();
  const account = useAccount(),
    multi = account.data?.mode === "multi-user";
  const own = useQuery({ ...ownAccountQuery, enabled: multi });
  const signOut = useMutation({
    mutationFn: () => post("/api/accounts/sign-out"),
    onSuccess: () => {
      client.clear();
      window.location.assign("/?sign-in=signed-out");
    },
  });
  const name = multi ? own.data?.account.username || "Your Account" : "Single-User Development";
  return (
    <>
      <Menu.Label>{name}</Menu.Label>
      <Menu.Item
        component={Link}
        to="/settings#account"
        state={{ backgroundLocation: location }}
        leftSection={<UserRound size={16} />}
      >
        Account
      </Menu.Item>
      {children}
      {multi && (
        <>
          <Menu.Divider />
          <Menu.Item
            leftSection={<LogOut size={16} />}
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            Sign Out
          </Menu.Item>
        </>
      )}
    </>
  );
}
