import { useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

/** True below the theme's `sm` breakpoint, where Studio switches to its phone layout. */
export function usePhone() {
  const { breakpoints } = useMantineTheme();
  return useMediaQuery(`(max-width: ${breakpoints.sm})`, false, { getInitialValueInEffect: false });
}
