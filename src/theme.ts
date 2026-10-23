import {
  alpha,
  Button,
  createTheme,
  Input,
  Paper,
  Select,
  Switch,
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
  luminanceThreshold: 0.3,
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
  radius: { xs: ".375rem", sm: ".5rem", md: ".75rem", lg: "1rem", xl: "1.5rem" },
  spacing: { xs: ".625rem", sm: ".75rem", md: "1rem", lg: "1.25rem", xl: "1.5rem" },
  shadows: {
    xs: "0 1px 2px rgb(0 0 0 / .05)",
    sm: "0 1px 3px rgb(0 0 0 / .1), 0 1px 2px rgb(0 0 0 / .06)",
    md: "0 4px 6px rgb(0 0 0 / .1), 0 2px 4px rgb(0 0 0 / .06)",
  },
  cursorType: "pointer",
  components: {
    Button: Button.extend({ defaultProps: { size: "md", fw: 500, autoContrast: true } }),
    Input: Input.extend({ defaultProps: { size: "md" } }),
    Paper: Paper.extend({ defaultProps: { withBorder: true, p: "lg" } }),
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
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    "--mantine-primary-color-filled-hover": alpha("var(--mantine-primary-color-filled)", 0.9),
  },
  dark: {
    "--mantine-color-body": "#09090b",
    "--mantine-color-default": "#18181b",
    "--mantine-color-default-hover": "#27272a",
    "--mantine-color-default-border": "#27272a",
  },
  light: {
    "--mantine-color-body": "#ffffff",
    "--mantine-color-default": "#ffffff",
    "--mantine-color-default-hover": "#f4f4f5",
    "--mantine-color-default-border": "#e4e4e7",
  },
});
