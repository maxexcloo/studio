import {
  ActionBar,
  ActionIcon,
  alpha,
  AppShell,
  Badge,
  Button,
  CloseButton,
  Collapse,
  Combobox,
  createTheme,
  Drawer,
  FloatingIndicator,
  Input,
  Menu,
  Modal,
  MultiSelect,
  NavLink,
  Notification,
  Paper,
  Popover,
  rem,
  ScrollArea,
  SegmentedControl,
  Select,
  Spoiler,
  Switch,
  Tooltip,
  type CSSProperties,
  type CSSVariablesResolver,
} from "@mantine/core";
import { createElement } from "react";
import { ChevronDown } from "lucide-react";
import classes from "./theme.module.css";

const chevron = createElement(ChevronDown, { size: 16 });

// Adapted from MantineHub's exported Shadcn theme (MIT, RubixCube Innovations).
// https://github.com/RubixCube-Innovations/mantine-theme-builder/tree/main/src/themes/shadcn
// Retain keyboard focus, standard Mantine palette lengths and Studio's amber accent.

export const backgrounds = {
  default: { label: "Default", light: "#ffffff", dark: "#09090b" },
  neutral: { label: "Neutral", light: "#f4f4f5", dark: "#111113" },
  warm: { label: "Warm", light: "#faf6ef", dark: "#17130f" },
  cool: { label: "Cool", light: "#f1f5f9", dark: "#0f1720" },
} as const;
export type Background = keyof typeof backgrounds;
/** Every action and row menu's width; their icons are 16px. */
export const menuWidth = 220;
/** Popups flip and shift to stay 12 px inside the screen. */
export const popupMiddlewares = { flip: true, shift: { padding: 12, crossAxis: true } };
export const motionSpeeds = { off: 0, fast: 100, standard: 160, relaxed: 260 } as const;
export type MotionSpeed = keyof typeof motionSpeeds;
// Entrances ease out over the motion duration; exits are quicker and accelerate away. Neither
// overshoots. CSS reads the same values as --studio-ease-enter/-exit and --studio-motion-exit.
export const easing = {
  enter: "cubic-bezier(0.2, 0, 0, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;
const exitDuration = (duration: number) => Math.round(duration * 0.7);
// Popups and dialogs grow slightly from their trigger side instead of fading in place.
const raise = {
  in: { opacity: 1, transform: "scale(1)" },
  out: { opacity: 0, transform: "scale(0.98)" },
  transitionProperty: "transform, opacity",
};
export type Rounding = "square" | "soft" | "round";

// Translucent blurred surface for custom chrome (viewer controls, docks) that is not a Mantine
// surface. Mantine surfaces receive it through the component defaults below.
export const glass = {
  background: "var(--studio-glass-raised)",
  backdropFilter: "var(--studio-glass-filter)",
  WebkitBackdropFilter: "var(--studio-glass-filter)",
  borderColor: "var(--studio-glass-border)",
} satisfies CSSProperties;
// Header and navigation bars sit directly on the page background.
const chrome = { ...glass, background: "var(--studio-glass-chrome)" } satisfies CSSProperties;
const dropdown = {
  ...glass,
  "--popover-border-color": "var(--studio-glass-border)",
  boxShadow: "var(--mantine-shadow-lg)",
} as CSSProperties;
// Translucent sticky headers would show scrolled content through the title.
const overlayHeader = { background: "transparent" } satisfies CSSProperties;
const overlayTitle = { fontWeight: 600 } satisfies CSSProperties;

export function studioTheme({
  primaryColor,
  rounding,
  background,
  motionDuration,
  phone,
  transparency,
}: {
  primaryColor: string;
  rounding: Rounding;
  background: Background;
  motionDuration: number;
  phone: boolean;
  transparency: boolean;
}) {
  // Two control densities: form controls (standard Button and inputs) and bars (icons, and the
  // stepped-down compact sizes); phones raise both to 44 px touch targets.
  const form = rem(phone ? 44 : 36);
  const bar = phone ? 44 : 32;
  const touch = phone ? { minHeight: bar } : {};
  const height = (size: unknown) =>
    size === "md"
      ? form
      : size === "xs" || size === "sm" || String(size).startsWith("compact")
        ? rem(bar)
        : undefined;
  const radius = rounding === "square" ? 0 : rounding === "round" ? 0.75 : 0.5;
  const transitionProps = {
    duration: motionDuration,
    exitDuration: exitDuration(motionDuration),
    timingFunction: easing.enter,
  };
  const popupTransition = { ...transitionProps, transition: raise };
  return createTheme({
    primaryColor,
    // Match both schemes so contrast resolves against the displayed amber shade.
    primaryShade: 5,
    autoContrast: true,
    respectReducedMotion: true,
    luminanceThreshold: 0.179,
    focusRing: "auto",
    colors: {
      studio: [
        "#fff7e6",
        "#ffebc2",
        "#ffdd8f",
        "#ffce5c",
        "#ffc13d",
        "#ffb31a",
        "#e59b09",
        "#bd7d05",
        "#946003",
        "#704802",
      ],
      dark: [
        "#fafafa",
        "#a1a1aa",
        "#71717a",
        "#52525b",
        "#3f3f46",
        "#27272a",
        "#18181b",
        "#111113",
        "#09090b",
        "#050506",
      ],
    },
    fontFamily: "Geist Variable, system-ui, sans-serif",
    headings: {
      fontFamily: "Geist Variable, system-ui, sans-serif",
      fontWeight: "600",
      sizes: {
        h1: { fontSize: "2.25rem", lineHeight: "2.75rem" },
        h2: { fontSize: "1.875rem", lineHeight: "2.375rem" },
        h3: { fontSize: "1.5rem", lineHeight: "2rem" },
        h4: { fontSize: "1.25rem", lineHeight: "1.875rem" },
      },
    },
    defaultRadius: "sm",
    radius: {
      xs: `${radius / 2}rem`,
      sm: `${radius}rem`,
      md: `${radius * 1.5}rem`,
      lg: `${radius * 2}rem`,
      xl: `${radius * 3}rem`,
    },
    spacing: { xs: ".625rem", sm: ".75rem", md: "1rem", lg: "1.25rem", xl: "1.5rem" },
    shadows: {
      xs: "0 1px 2px rgb(0 0 0 / .05)",
      sm: "0 1px 3px rgb(0 0 0 / .1), 0 1px 2px rgb(0 0 0 / .06)",
      md: "0 4px 6px rgb(0 0 0 / .1), 0 2px 4px rgb(0 0 0 / .06)",
      lg: "0 12px 32px rgb(0 0 0 / .18), 0 2px 6px rgb(0 0 0 / .08)",
      xl: "0 24px 64px rgb(0 0 0 / .28), 0 4px 12px rgb(0 0 0 / .1)",
    },
    cursorType: "pointer",
    activeClassName: "",
    other: { background, motionDuration, transparency },
    // One size and emphasis scale (UI-PATTERNS › Theme & Layout). Standard controls take these
    // defaults; compact surfaces (rows, toolbars, chip rails, popover forms) step down one tier.
    components: {
      ActionBar: ActionBar.extend({ defaultProps: { transitionProps } }),
      // Icons take the bar density; the radius follows the Corners setting. Default
      // icons take the glass fill without a backdrop blur of their own: tiles and the viewer show
      // dozens at once, and each blur layer stalls rendering on slow phones.
      ActionIcon: ActionIcon.extend({
        classNames: (_theme, props) => ({
          root: `${classes.actionIcon} ${phone && props.size === bar ? classes.phoneIcons : ""}`,
        }),
        defaultProps: { size: bar, radius: "xl" },
        vars: (_theme, props) => ({
          root: {
            // Phones raise the compact icon sizes to the touch target too.
            ...(phone && (props.size === "xs" || props.size === "sm") && { "--ai-size": rem(bar) }),
            ...(props.variant === "default" && {
              "--ai-bg": "var(--studio-glass-raised)",
              "--ai-hover": "var(--studio-glass-raised-hover)",
              "--ai-bd": "1px solid var(--studio-glass-border)",
            }),
          },
        }),
      }),
      AppShell: AppShell.extend({
        styles: {
          root: { "--app-shell-border-color": "var(--studio-glass-border)" } as CSSProperties,
          aside: chrome,
          footer: chrome,
          header: chrome,
          navbar: chrome,
        },
      }),
      // Status pills are light; filled colour is for the one primary action in a view. Labels keep
      // their Title Case instead of Mantine's upper case.
      Badge: Badge.extend({ defaultProps: { variant: "light", tt: "none" } }),
      Button: Button.extend({
        classNames: (_theme, props) => ({
          root: `${classes.button} ${phone && height(props.size) ? classes.phoneIcons : ""}`,
        }),
        defaultProps: { size: "md", fw: 500, autoContrast: true },
        // A phone button is at least as wide as it is tall (All, Clear).
        styles: (_theme, props) => ({ root: phone && height(props.size) ? { minWidth: bar } : {} }),
        vars: (_theme, props) => ({ root: { "--button-height": height(props.size) } }),
      }),
      // Close buttons of dialogs, drawers and sheets are touch targets on phones.
      CloseButton: CloseButton.extend({
        vars: () => ({ root: phone ? { "--cb-size": rem(bar), "--cb-icon-size": rem(20) } : {} }),
      }),
      // Expanding sections share the motion setting.
      Collapse: Collapse.extend({
        defaultProps: {
          transitionDuration: motionDuration,
          transitionTimingFunction: easing.enter,
        },
      }),
      // Option rows (here the chips' lists; Select and MultiSelect below) are touch targets on phones.
      Combobox: Combobox.extend({ styles: { option: touch } }),
      Drawer: Drawer.extend({ styles: { header: overlayHeader, title: overlayTitle } }),
      // On the parts, so a compound Drawer (a header with its own actions) shares them.
      DrawerOverlay: { defaultProps: { blur: 6, backgroundOpacity: 0.4 } },
      DrawerRoot: { defaultProps: { transitionProps } },
      // Selection indicators slide between items with the shared motion.
      FloatingIndicator: FloatingIndicator.extend({
        defaultProps: { transitionDuration: motionDuration },
        styles: { root: { transitionTimingFunction: easing.enter } },
      }),
      Input: Input.extend({
        classNames: { input: classes.input },
        defaultProps: { size: "md" },
        vars: (_theme, props) => ({ wrapper: { "--input-height": height(props.size) } }),
      }),
      // One row height for every menu's items. Phones expand options in place, so a menu stays
      // within the screen and scrolls when they outgrow it.
      Menu: Menu.extend({
        defaultProps: {
          transitionProps: popupTransition,
          ...(phone && { middlewares: { ...popupMiddlewares, size: { padding: 12 } } }),
        },
        styles: {
          dropdown: phone
            ? { ...dropdown, overflowY: "auto", overscrollBehavior: "contain" }
            : dropdown,
          item: { minHeight: phone ? bar : 36 },
        },
      }),
      // Dialogs sit centred on a raised plane: a dimmed, blurred backdrop, a clear border and a
      // deep shadow. Full-screen dialogs (the viewer, phone panels) fill the viewport instead.
      Modal: Modal.extend({
        defaultProps: {
          centered: true,
          overlayProps: { blur: 8, backgroundOpacity: 0.55 },
          transitionProps: popupTransition,
          radius: "lg",
          size: "lg",
        },
        classNames: { inner: classes.dialogInner, content: classes.dialogContent },
        styles: (_theme, props) => ({
          content: props.fullScreen
            ? {}
            : {
                border: "1px solid var(--mantine-color-default-border)",
                boxShadow: "var(--mantine-shadow-xl)",
              },
          header: overlayHeader,
          title: overlayTitle,
        }),
      }),
      // Compound modals (phone chip popups) skip the Modal defaults above.
      ModalRoot: { defaultProps: { transitionProps: popupTransition } },
      NavLink: NavLink.extend({ styles: { root: { borderRadius: "var(--mantine-radius-md)" } } }),
      Notification: Notification.extend({ styles: { root: glass } }),
      // Paper also renders Card, Dialog, ActionBar and Modal/Drawer content.
      Paper: Paper.extend({
        styles: { root: { ...glass, "--paper-border-color": "var(--studio-glass-border)" } },
      }),
      // Popover also renders Menu and Combobox dropdowns (Select, Autocomplete and similar).
      // Fixed positioning keeps a popup anchored to fixed chrome (header, composer) still while the
      // page scrolls, instead of scrolling away and being pulled back a frame later.
      Popover: Popover.extend({
        defaultProps: {
          floatingStrategy: "fixed",
          middlewares: popupMiddlewares,
          transitionProps: popupTransition,
        },
        styles: { dropdown },
      }),
      // Every popover, menu and combobox dropdown renders PopoverDropdown; `data-popup` marks them
      // for the shared outside-click rule (ui/popupClicks.ts) and their transform origin.
      PopoverDropdown: Popover.Dropdown.extend({
        defaultProps: { "data-popup": true } as Record<string, unknown>,
      }),
      ScrollArea: ScrollArea.extend({
        defaultProps: { type: "never" },
        styles: (_theme, props) => ({
          content: { minWidth: props.scrollbars === "y" ? 0 : undefined },
        }),
      }),
      // Vertical panels must shrink to their viewport instead of long labels’ min-content width.
      ScrollAreaAutosize: ScrollArea.Autosize.extend({
        defaultProps: { scrollbars: "y", type: "never" },
      }),
      // The sliding indicator alone marks the choice; separators between items flicker and fade
      // unevenly beside it.
      SegmentedControl: SegmentedControl.extend({
        defaultProps: {
          size: "sm",
          withItemsBorders: false,
          transitionDuration: motionDuration,
          transitionTimingFunction: easing.enter,
        },
      }),
      // Every control that opens a picker shows ▾, as the chips do (UI-PATTERNS.md).
      MultiSelect: MultiSelect.extend({
        defaultProps: { rightSection: chevron },
        styles: { option: touch },
      }),
      Select: Select.extend({
        defaultProps: { checkIconPosition: "right", rightSection: chevron },
        styles: { option: touch },
      }),
      Spoiler: Spoiler.extend({ defaultProps: { transitionDuration: motionDuration } }),
      Switch: Switch.extend({
        styles: {
          thumb: {
            backgroundColor: "var(--mantine-color-default)",
            borderColor: "var(--mantine-color-default-border)",
          },
          track: { borderColor: "var(--mantine-color-default-border)" },
        },
      }),
      // A tapped tooltip lingers on touch, so phones show none unless a call enables its own.
      Tooltip: Tooltip.extend({
        defaultProps: { transitionProps, disabled: phone },
        styles: {
          tooltip: {
            ...glass,
            "--tooltip-bg": "var(--studio-glass-raised)",
            "--tooltip-color": "var(--mantine-color-text)",
            border: "1px solid var(--studio-glass-border)",
            boxShadow: "var(--mantine-shadow-md)",
          } as CSSProperties,
        },
      }),
    },
  });
}

// Glass mixes the selected background so surfaces keep its tint; opacity stays high enough for
// body text over bright or busy media.
const glassTokens = (scheme: "light" | "dark", transparency: boolean) => {
  const opacity = transparency ? (scheme === "dark" ? "80%" : "78%") : "100%";
  const lift = scheme === "dark" ? "white 7%" : "white 60%";
  const hover = scheme === "dark" ? "white 13%" : "black 5%";
  const translucent = (colour: string) => `color-mix(in srgb, ${colour} ${opacity}, transparent)`;
  return {
    "--studio-glass-chrome": translucent("var(--mantine-color-body)"),
    "--studio-glass-raised": translucent(`color-mix(in srgb, var(--mantine-color-body), ${lift})`),
    "--studio-glass-raised-hover": translucent(
      `color-mix(in srgb, var(--mantine-color-body), ${hover})`,
    ),
    "--studio-glass-border": scheme === "dark" ? "rgb(255 255 255 / .1)" : "rgb(0 0 0 / .09)",
  };
};

export const cssVariablesResolver: CSSVariablesResolver = (theme) => {
  const background = backgrounds[theme.other.background as Background];
  const transparency = theme.other.transparency as boolean;
  return {
    variables: {
      "--studio-workspace-width": "1600px",
      "--studio-composer-width": "820px",
      "--studio-motion-duration": `${theme.other.motionDuration}ms`,
      "--studio-motion-exit": `${exitDuration(theme.other.motionDuration)}ms`,
      "--studio-ease-enter": easing.enter,
      "--studio-ease-exit": easing.exit,
      "--studio-glass-filter": transparency ? "blur(24px) saturate(1.5)" : "none",
      "--mantine-primary-color-filled-hover": alpha("var(--mantine-primary-color-filled)", 0.9),
    },
    dark: {
      "--mantine-color-body": background.dark,
      "--mantine-color-default": "#18181b",
      "--mantine-color-default-hover": "#27272a",
      "--mantine-color-default-border": "#27272a",
      // Mantine's dark placeholder is too faint over translucent surfaces.
      "--mantine-color-placeholder": "var(--mantine-color-dark-2)",
      ...glassTokens("dark", transparency),
    },
    light: {
      "--mantine-color-body": background.light,
      "--mantine-color-default": "#ffffff",
      "--mantine-color-default-hover": "#f4f4f5",
      "--mantine-color-default-border": "#e4e4e7",
      ...glassTokens("light", transparency),
    },
  };
};
