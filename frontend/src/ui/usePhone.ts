import { useMediaQuery } from "@mantine/hooks";

/** A phone held sideways: a short touch screen up to 1000 px wide. iPads in landscape are taller. */
const sidewaysQuery = "(pointer: coarse) and (max-height: 30em) and (max-width: 62.5em)";
/**
 * Studio's phone layout: below Mantine's `sm` breakpoint (48em, iPad mini portrait included) or a
 * phone held sideways. `Appearance` mirrors both on the root element as `data-phone` (`sideways`
 * for a phone held sideways), so CSS agrees with these hooks.
 */
const phoneQuery = `(max-width: 48em), ${sidewaysQuery}`;

const options = { getInitialValueInEffect: false };

export function usePhone() {
  return useMediaQuery(phoneQuery, false, options);
}

export function useSideways() {
  return useMediaQuery(sidewaysQuery, false, options);
}

/** True with a coarse pointer (phones and tablets), where focusing a text field raises the keyboard. */
export function useTouch() {
  return useMediaQuery("(pointer: coarse)", false, options);
}
