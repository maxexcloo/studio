import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  ActionIcon,
  Button,
  DEFAULT_THEME,
  SimpleGrid,
  ColorSwatch,
  Group,
  MantineProvider,
  Popover,
  SegmentedControl,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  localStorageColorSchemeManager,
  useMantineColorScheme,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useLocalStorage, useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { Check, Palette } from "lucide-react";
import {
  backgrounds,
  motionSpeeds,
  type MotionSpeed,
  type Background,
  type Rounding,
  cssVariablesResolver,
  studioTheme,
} from "../theme";

const colours = [
  "studio",
  "blue",
  "cyan",
  "grape",
  "green",
  "orange",
  "pink",
  "red",
  "teal",
  "violet",
] as const;
interface Appearance {
  colour: (typeof colours)[number];
  background: Background;
  motion: MotionSpeed;
  rounding: Rounding;
  layout: "fixed" | "full";
}
const defaults: Appearance = {
  colour: "studio",
  rounding: "soft",
  layout: "full",
  background: "default",
  motion: "standard",
};
const Context = createContext<{
  appearance: Appearance;
  setAppearance: (next: Appearance | ((previous: Appearance) => Appearance)) => void;
}>(null!);
const colourSchemeManager = localStorageColorSchemeManager({ key: "studio-colour-scheme" });
// Glass needs backdrop blur; without it, translucent surfaces would show the page through text.
const blurs =
  CSS.supports("backdrop-filter", "blur(1px)") ||
  CSS.supports("-webkit-backdrop-filter", "blur(1px)");
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useLocalStorage<Appearance>({
    key: "studio-appearance",
    defaultValue: defaults,
    getInitialValueInEffect: false,
  });
  const resolved = { ...defaults, ...appearance };
  const reduced = useReducedMotion();
  const duration = reduced ? 0 : motionSpeeds[resolved.motion];
  const opaque = useMediaQuery("(prefers-reduced-transparency: reduce)", false, {
    getInitialValueInEffect: false,
  });
  // usePhone() needs the provider below; the theme keeps Mantine's default breakpoints.
  const phone = useMediaQuery(`(max-width: ${DEFAULT_THEME.breakpoints.sm})`, false, {
    getInitialValueInEffect: false,
  });
  const configured = useMemo(
    () =>
      studioTheme({
        primaryColor: resolved.colour,
        rounding: resolved.rounding,
        background: resolved.background,
        motionDuration: duration,
        phone,
        transparency: blurs && !opaque,
      }),
    [resolved.colour, resolved.rounding, resolved.background, duration, phone, opaque],
  );
  return (
    <Context.Provider value={{ appearance: resolved, setAppearance }}>
      <MantineProvider
        theme={configured}
        cssVariablesResolver={cssVariablesResolver}
        defaultColorScheme="auto"
        colorSchemeManager={colourSchemeManager}
      >
        {children}
      </MantineProvider>
    </Context.Provider>
  );
}
export const useAppearance = () => useContext(Context);
export function useMotionDuration() {
  return useMantineTheme().other.motionDuration as number;
}
export function AppearanceControls() {
  const { appearance, setAppearance } = useAppearance();
  const palette = useMantineTheme();
  const scheme = useComputedColorScheme("light");
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <ScrollArea.Autosize mah="calc(100dvh - 105px)">
      <Stack gap="sm">
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Animations
          </Text>
          <SegmentedControl
            aria-label="Animations"
            fullWidth
            value={appearance.motion}
            onChange={(motion) =>
              setAppearance((previous) => ({ ...previous, motion: motion as MotionSpeed }))
            }
            data={[
              { value: "off", label: "Off" },
              { value: "fast", label: "Fast" },
              { value: "standard", label: "Standard" },
              { value: "relaxed", label: "Relaxed" },
            ]}
          />
        </Stack>
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Background
          </Text>
          <SimpleGrid cols={2} spacing="xs">
            {(Object.keys(backgrounds) as Background[]).map((background) => {
              const chosen = appearance.background === background;
              return (
                <Button
                  key={background}
                  variant="default"
                  aria-label={`Use ${backgrounds[background].label} Background`}
                  aria-pressed={chosen}
                  onClick={() => setAppearance((previous) => ({ ...previous, background }))}
                  size="sm"
                  px="xs"
                  justify="flex-start"
                  // Every tile keeps one bordered style; the chosen one's border takes the colour.
                  style={
                    chosen ? { borderColor: "var(--mantine-primary-color-filled)" } : undefined
                  }
                >
                  <Group gap="xs" wrap="nowrap">
                    <ColorSwatch
                      color={backgrounds[background][scheme]}
                      size={20}
                      withShadow={false}
                      style={{ border: "1px solid var(--mantine-color-default-border)" }}
                    />
                    <Text size="sm">{backgrounds[background].label}</Text>
                    {chosen && <Check size={14} />}
                  </Group>
                </Button>
              );
            })}
          </SimpleGrid>
        </Stack>

        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Colour
          </Text>
          {/* Two even rows of five, spread across the popover's width. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 30px)",
              justifyContent: "space-between",
              rowGap: "var(--mantine-spacing-xs)",
            }}
          >
            {colours.map((colour) => (
              <Tooltip
                key={colour}
                label={colour === "studio" ? "Amber" : colour[0].toUpperCase() + colour.slice(1)}
              >
                <ActionIcon
                  variant="transparent"
                  radius="xl"
                  size={30}
                  aria-label={`Use ${colour === "studio" ? "Amber" : colour[0].toUpperCase() + colour.slice(1)} Colour`}
                  aria-pressed={appearance.colour === colour}
                  onClick={() => setAppearance((previous) => ({ ...previous, colour }))}
                >
                  <ColorSwatch color={palette.colors[colour][5]} size={26}>
                    {appearance.colour === colour && <Check size={15} color="black" />}
                  </ColorSwatch>
                </ActionIcon>
              </Tooltip>
            ))}
          </div>
        </Stack>
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Colour Scheme
          </Text>
          <SegmentedControl
            aria-label="Colour Scheme"
            fullWidth
            value={colorScheme}
            onChange={(value) => setColorScheme(value as "auto" | "light" | "dark")}
            data={[
              { value: "auto", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Stack>

        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Corners
          </Text>
          <SegmentedControl
            aria-label="Corners"
            fullWidth
            value={appearance.rounding}
            onChange={(rounding) =>
              setAppearance((previous) => ({
                ...previous,
                rounding: rounding as Rounding,
              }))
            }
            data={[
              { value: "square", label: "Square" },
              { value: "soft", label: "Soft" },
              { value: "round", label: "Round" },
            ]}
          />
        </Stack>
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Layout
          </Text>
          <SegmentedControl
            aria-label="Layout"
            fullWidth
            value={appearance.layout}
            onChange={(layout) =>
              setAppearance((previous) => ({ ...previous, layout: layout as Appearance["layout"] }))
            }
            data={[
              { value: "full", label: "Full Width" },
              { value: "fixed", label: "Fixed Width" },
            ]}
          />
        </Stack>
      </Stack>
    </ScrollArea.Autosize>
  );
}
export function AppearanceMenu() {
  return (
    <Popover width={300} position="bottom-end" offset={18} shadow="md" withArrow trapFocus>
      <Tooltip label="Appearance">
        <Popover.Target>
          <ActionIcon aria-label="Appearance" variant="subtle" color="gray" size="lg" radius="xl">
            <Palette size={19} />
          </ActionIcon>
        </Popover.Target>
      </Tooltip>
      <Popover.Dropdown data-composer-layer>
        <AppearanceControls />
      </Popover.Dropdown>
    </Popover>
  );
}
