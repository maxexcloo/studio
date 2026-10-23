import {
  alpha,
  Button,
  createTheme,
  Input,
  NavLink,
  ScrollArea,
  Modal,
  Drawer,
  Select,
  Switch,
  Popover,
  Menu,
  Tooltip,
  ActionBar,
  type CSSVariablesResolver,
} from "@mantine/core";

// Adapted from MantineHub's exported Shadcn theme (MIT, RubixCube Innovations).
// https://github.com/RubixCube-Innovations/mantine-theme-builder/tree/main/src/themes/shadcn
// Retain keyboard focus, standard Mantine palette lengths and Studio's amber accent.
export const theme = createTheme({
  primaryColor: "studio",
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
  spacing: { xs: ".625rem", sm: ".75rem", md: "1rem", lg: "1.25rem", xl: "1.5rem" },
  shadows: {
    xs: "0 1px 2px rgb(0 0 0 / .05)",
    sm: "0 1px 3px rgb(0 0 0 / .1), 0 1px 2px rgb(0 0 0 / .06)",
    md: "0 4px 6px rgb(0 0 0 / .1), 0 2px 4px rgb(0 0 0 / .06)",
  },
  cursorType: "pointer",
  activeClassName: "",
  components: {
    Modal: Modal.extend({
      defaultProps: {
        overlayProps: { blur: 6, backgroundOpacity: 0.4 },
        transitionProps: { transition: "fade", duration: 180 },
        radius: "lg",
      },
    }),
    Drawer: Drawer.extend({
      defaultProps: {
        overlayProps: { blur: 6, backgroundOpacity: 0.4 },
        transitionProps: { duration: 180 },
      },
    }),
    Button: Button.extend({ defaultProps: { size: "md", fw: 500, autoContrast: true } }),
    // Vertical panels must shrink to their viewport instead of long labels’ min-content width.
    ScrollAreaAutosize: ScrollArea.Autosize.extend({
      defaultProps: { scrollbars: "y", type: "hover" },
    }),
    ScrollArea: ScrollArea.extend({
      styles: (_theme, props) => ({
        content: { minWidth: props.scrollbars === "y" ? 0 : undefined },
      }),
    }),
    NavLink: NavLink.extend({ styles: { root: { borderRadius: "var(--mantine-radius-md)" } } }),
    Input: Input.extend({ defaultProps: { size: "md" } }),
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
  },
});
export const backgrounds = {
  default: { label: "Default", light: "#ffffff", dark: "#09090b" },
  neutral: { label: "Neutral", light: "#f4f4f5", dark: "#111113" },
  warm: { label: "Warm", light: "#faf6ef", dark: "#17130f" },
  cool: { label: "Cool", light: "#f1f5f9", dark: "#0f1720" },
} as const;
export type Background = keyof typeof backgrounds;
export const motionSpeeds = { off: 0, fast: 100, standard: 160, relaxed: 260 } as const;
export type MotionSpeed = keyof typeof motionSpeeds;
export function studioTheme(
  primaryColor: string,
  rounding: "square" | "soft" | "round",
  background: Background,
  motionDuration: number,
) {
  const radius = rounding === "square" ? 0 : rounding === "round" ? 0.75 : 0.5;
  return createTheme({
    ...theme,
    primaryColor,
    other: { studioBackground: background, studioMotionDuration: motionDuration },
    components: {
      ...theme.components,
      Modal: Modal.extend({
        defaultProps: {
          ...theme.components?.Modal?.defaultProps,
          transitionProps: { transition: "fade", duration: motionDuration },
        },
      }),
      Drawer: Drawer.extend({
        defaultProps: {
          ...theme.components?.Drawer?.defaultProps,
          transitionProps: { duration: motionDuration },
        },
      }),
      Popover: Popover.extend({
        defaultProps: {
          middlewares: { flip: true, shift: { padding: 12, crossAxis: true } },
          transitionProps: { duration: motionDuration },
        },
      }),
      Menu: Menu.extend({ defaultProps: { transitionProps: { duration: motionDuration } } }),
      Tooltip: Tooltip.extend({ defaultProps: { transitionProps: { duration: motionDuration } } }),
      ActionBar: ActionBar.extend({
        defaultProps: { transitionProps: { duration: motionDuration } },
      }),
    },
    radius: {
      xs: `${radius / 2}rem`,
      sm: `${radius}rem`,
      md: `${radius * 1.5}rem`,
      lg: `${radius * 2}rem`,
      xl: `${radius * 3}rem`,
    },
  });
}
export const cssVariablesResolver: CSSVariablesResolver = (theme) => ({
  variables: {
    "--studio-workspace-width": "1600px",
    "--studio-motion-duration": `${theme.other.studioMotionDuration}ms`,
    "--mantine-primary-color-filled-hover": alpha("var(--mantine-primary-color-filled)", 0.9),
  },
  dark: {
    "--mantine-color-body": backgrounds[theme.other.studioBackground as Background].dark,
    "--mantine-color-default": "#18181b",
    "--mantine-color-default-hover": "#27272a",
    "--mantine-color-default-border": "#27272a",
  },
  light: {
    "--mantine-color-body": backgrounds[theme.other.studioBackground as Background].light,
    "--mantine-color-default": "#ffffff",
    "--mantine-color-default-hover": "#f4f4f5",
    "--mantine-color-default-border": "#e4e4e7",
  },
});
