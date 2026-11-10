import { useMutation, useMutationState, type UseMutationOptions } from "@tanstack/react-query";

/**
 * A media action's mutation, kept with the item it started on rather than with the component that
 * ran it. The viewer and a tile's menu reuse or remount their actions as items change, so the
 * pending state and its variables come from the mutation cache under the item's key: another item
 * shows its own state, and coming back shows the run still going. The options' callbacks stay with
 * the item they started on; those passed to `mutate` stop once the item changes, so follow-ups that
 * must happen anyway take `mutateAsync`.
 */
export function useItemMutation<TData = unknown, TVariables = void>(
  itemId: string,
  action: string,
  options: Omit<UseMutationOptions<TData, Error, TVariables>, "mutationKey">,
) {
  const mutationKey = ["item-action", action, itemId];
  const mutation = useMutation({ ...options, mutationKey });
  const running = useMutationState({
    filters: { mutationKey, exact: true, status: "pending" },
    select: (pending) => pending.state.variables as TVariables,
  });
  return { ...mutation, isPending: running.length > 0, variables: running.at(-1) };
}
