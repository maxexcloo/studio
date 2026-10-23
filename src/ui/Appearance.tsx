import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  ActionIcon,
  ColorSwatch,
  Group,
  MantineProvider,
  Popover,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  localStorageColorSchemeManager,
  useMantineColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { Check, Maximize2, Minimize2, Palette } from "lucide-react";
import { cssVariablesResolver, studioTheme } from "../theme";

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
  rounding: "square" | "soft" | "round";
  layout: "fixed" | "full";
}
const defaults: Appearance = { colour: "studio", rounding: "soft", layout: "full" };
const Context = createContext<{
  appearance: Appearance;
  setAppearance: (next: Appearance | ((previous: Appearance) => Appearance)) => void;
}>(null!);
const colourSchemeManager = localStorageColorSchemeManager({ key: "studio-colour-scheme" });
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useLocalStorage<Appearance>({
    key: "studio-appearance",
    defaultValue: defaults,
    getInitialValueInEffect: false,
  });
  const configured = useMemo(
    () => studioTheme(appearance.colour, appearance.rounding),
    [appearance.colour, appearance.rounding],
  );
  return (
    <Context.Provider value={{ appearance, setAppearance }}>
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
export function AppearanceControls() {
  const { appearance, setAppearance } = useAppearance();
  const palette = useMantineTheme();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text size="sm" fw={500}>
          Colour
        </Text>
        <Group gap="xs">
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
        </Group>
      </Stack>
      <Stack gap="xs">
        <Text size="sm" fw={500}>
          Corners
        </Text>
        <SegmentedControl
          aria-label="Corner Radius"
          fullWidth
          value={appearance.rounding}
          onChange={(rounding) =>
            setAppearance((previous) => ({
              ...previous,
              rounding: rounding as Appearance["rounding"],
            }))
          }
          data={[
            { value: "square", label: "Square" },
            { value: "soft", label: "Soft" },
            { value: "round", label: "Round" },
          ]}
        />
      </Stack>
      <Stack gap="xs">
        <Text size="sm" fw={500}>
          Layout
        </Text>
        <SegmentedControl
          aria-label="Page Width"
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
      <Stack gap="xs">
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
    </Stack>
  );
}
export function AppearanceMenu() {
  return (
    <Popover width={300} position="bottom-end" shadow="md" withArrow trapFocus>
      <Popover.Target>
        <ActionIcon aria-label="Change Theme" variant="subtle" color="gray" size="lg" radius="xl">
          <Palette size={19} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown data-composer-layer>
        <AppearanceControls />
      </Popover.Dropdown>
    </Popover>
  );
}
export function LayoutToggle() {
  const { appearance, setAppearance } = useAppearance();
  const label = appearance.layout === "full" ? "Use Fixed Width" : "Use Full Width";
  return (
    <Tooltip label={label}>
      <ActionIcon
        aria-label={label}
        aria-pressed={appearance.layout === "full"}
        onClick={() =>
          setAppearance((previous) => ({
            ...previous,
            layout: previous.layout === "full" ? "fixed" : "full",
          }))
        }
        variant="subtle"
        color="gray"
        size="lg"
        radius="xl"
      >
        {appearance.layout === "full" ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
      </ActionIcon>
    </Tooltip>
  );
}
