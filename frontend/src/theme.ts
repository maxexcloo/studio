import {
  ActionBar,
  ActionIcon,
  alpha,
  AppShell,
  Button,
  createTheme,
  Drawer,
  Input,
  Menu,
  Modal,
  NavLink,
  Notification,
  Paper,
  Popover,
  ScrollArea,
  Select,
  Switch,
  Tooltip,
  type CSSProperties,
  type CSSVariablesResolver,
} from "@mantine/core";

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
export const motionSpeeds = { off: 0, fast: 100, standard: 160, relaxed: 260 } as const;
export type MotionSpeed = keyof typeof motionSpeeds;
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

export function studioTheme({
  primaryColor,
  rounding,
  background,
  motionDuration,
  transparency,
}: {
  primaryColor: string;
  rounding: Rounding;
  background: Background;
  motionDuration: number;
  transparency: boolean;
}) {
  const radius = rounding === "square" ? 0 : rounding === "round" ? 0.75 : 0.5;
  const transitionProps = { duration: motionDuration };
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
    components: {
      ActionBar: ActionBar.extend({ defaultProps: { transitionProps } }),
      // One size for header and toolbar icons; the radius follows the Corners setting.
      ActionIcon: ActionIcon.extend({
        defaultProps: { size: 36, radius: "xl" },
        vars: (_theme, props) => ({
          root:
            props.variant === "default"
              ? {
                  "--ai-bg": "var(--studio-glass-raised)",
                  "--ai-hover": "var(--studio-glass-raised-hover)",
                  "--ai-bd": "1px solid var(--studio-glass-border)",
                }
              : {},
        }),
        styles: (_theme, props) => ({
          root:
            props.variant === "default"
              ? {
                  backdropFilter: "var(--studio-glass-filter)",
                  WebkitBackdropFilter: "var(--studio-glass-filter)",
                }
              : {},
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
      Button: Button.extend({ defaultProps: { size: "md", fw: 500, autoContrast: true } }),
      Drawer: Drawer.extend({
        defaultProps: { overlayProps: { blur: 6, backgroundOpacity: 0.4 }, transitionProps },
        styles: { header: overlayHeader },
      }),
      Input: Input.extend({ defaultProps: { size: "md" } }),
      Menu: Menu.extend({ defaultProps: { transitionProps }, styles: { dropdown } }),
      Modal: Modal.extend({
        defaultProps: {
          overlayProps: { blur: 6, backgroundOpacity: 0.4 },
          transitionProps: { transition: "fade", ...transitionProps },
          radius: "lg",
        },
        styles: { header: overlayHeader },
      }),
      NavLink: NavLink.extend({ styles: { root: { borderRadius: "var(--mantine-radius-md)" } } }),
      Notification: Notification.extend({ styles: { root: glass } }),
      // Paper also renders Card, Dialog, ActionBar and Modal/Drawer content.
      Paper: Paper.extend({
        styles: { root: { ...glass, "--paper-border-color": "var(--studio-glass-border)" } },
      }),
      // Popover also renders Combobox dropdowns (Select, Autocomplete and similar).
      Popover: Popover.extend({
        defaultProps: {
          middlewares: { flip: true, shift: { padding: 12, crossAxis: true } },
          transitionProps,
        },
        styles: { dropdown },
      }),
      ScrollArea: ScrollArea.extend({
        styles: (_theme, props) => ({
          content: { minWidth: props.scrollbars === "y" ? 0 : undefined },
        }),
      }),
      // Vertical panels must shrink to their viewport instead of long labels’ min-content width.
      ScrollAreaAutosize: ScrollArea.Autosize.extend({
        defaultProps: { scrollbars: "y", type: "hover" },
      }),
      Select: Select.extend({ defaultProps: { checkIconPosition: "right" } }),
      Switch: Switch.extend({
        styles: {
          thumb: {
            backgroundColor: "var(--mantine-color-default)",
            borderColor: "var(--mantine-color-default-border)",
          },
          track: { borderColor: "var(--mantine-color-default-border)" },
        },
      }),
      Tooltip: Tooltip.extend({
        defaultProps: { transitionProps },
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
      "--studio-composer-width": "780px",
      "--studio-motion-duration": `${theme.other.motionDuration}ms`,
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
