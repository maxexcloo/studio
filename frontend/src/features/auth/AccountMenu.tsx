import { Menu } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

import { post } from "../../api";
import { icons } from "../../ui/icons";

/** The account heading and Account (multi-user), then workspace links and the final Sign Out action. */
export function AccountMenuContent({
  name,
  multi,
  children,
}: {
  name: string;
  multi: boolean;
  children?: ReactNode;
}) {
  const location = useLocation(),
    client = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => post("/api/accounts/sign-out"),
    onSuccess: () => {
      client.clear();
      window.location.assign("/?sign-in=signed-out");
    },
  });
  return (
    <>
      <Menu.Label>{name}</Menu.Label>
      {multi && (
        <Menu.Item
          component={Link}
          to="/settings#account"
          state={{ backgroundLocation: location }}
          leftSection={<icons.account size={16} />}
        >
          Account
        </Menu.Item>
      )}
      {children}
      {multi && (
        <>
          <Menu.Divider />
          <Menu.Item
            leftSection={<icons.signOut size={16} />}
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
