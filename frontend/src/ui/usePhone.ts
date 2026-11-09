import { useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

/** True below the theme's `sm` breakpoint, where Studio switches to its phone layout. */
export function usePhone() {
  const { breakpoints } = useMantineTheme();
  return useMediaQuery(`(max-width: ${breakpoints.sm})`, false, { getInitialValueInEffect: false });
}

/** True with a coarse pointer (phones and tablets), where focusing a text field raises the keyboard. */
export function useTouch() {
  return useMediaQuery("(pointer: coarse)", false, { getInitialValueInEffect: false });
}
