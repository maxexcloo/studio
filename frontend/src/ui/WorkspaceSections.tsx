import { Suspense, useState, type ReactNode } from "react";
import {
  Box,
  Divider,
  Grid,
  Group,
  NavLink,
  Select,
  Stack,
  Text,
  type ComboboxData,
} from "@mantine/core";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { LoadingState } from "./LoadingState";
import { SectionErrorBoundary } from "./SectionErrorBoundary";
import { SectionHeading } from "./SectionHeading";
import classes from "./WorkspaceSections.module.css";

/**
 * One Library or Settings section; `admin` sections are hidden from other accounts, `group` names the
 * run of sections it belongs to (Personal, Administration), `apart` sections (About) follow a
 * divider in the desktop navigation and the `initial` one opens first instead of the first listed.
 */
interface SectionDefinition {
  label: string;
  description: string;
  icon: LucideIcon;
  admin?: boolean;
  apart?: boolean;
  group?: string;
  initial?: boolean;
}
type WorkspaceSection = SectionDefinition & { value: string };

/** Lists the sections the account may open, in definition order. */
export function visibleSections<Key extends string>(
  sections: Record<Key, SectionDefinition>,
  admin: boolean,
  available: (key: Key) => boolean = () => true,
): WorkspaceSection[] {
  return (Object.entries(sections) as [Key, SectionDefinition][])
    .filter(([key, section]) => (admin || !section.admin) && available(key))
    .map(([value, section]) => ({ value, ...section }));
}
/** The section open in the current route; an unknown or missing hash opens the initial one. */
export function useWorkspaceSection(sections: WorkspaceSection[]) {
  const location = useLocation();
  const active = (
    sections.find((section) => `#${section.value}` === location.hash) ||
    sections.find((section) => section.initial) ||
    sections[0]
  ).value;
  return { location, active };
}

/** Consecutive sections by their group; ungrouped ones form their own run. */
function groupSections(sections: WorkspaceSection[]) {
  const runs: [string, WorkspaceSection[]][] = [];
  for (const section of sections) {
    const group = section.group || "";
    const last = runs.at(-1);
    if (last && last[0] === group) last[1].push(section);
    else runs.push([group, [section]]);
  }
  return runs;
}

/** On phones the section selector replaces extra navigation below the modal title. */
export function WorkspaceSectionSelect({
  label,
  sections,
}: {
  label: string;
  sections: WorkspaceSection[];
}) {
  const { location, active } = useWorkspaceSection(sections);
  const navigate = useNavigate();
  const option = ({ value, label }: WorkspaceSection) => ({ value, label });
  const data = groupSections(sections).flatMap<ComboboxData[number]>(([group, items]) =>
    group ? [{ group, items: items.map(option) }] : items.map(option),
  );
  return (
    <Group gap="xs" wrap="nowrap">
      <Text component="span" size="xl" fw={600}>
        {label}
      </Text>
      <Select
        aria-label={`${label} Section`}
        size="xs"
        w={180}
        miw={0}
        flex={1}
        // One size in Library and Settings: the trigger at 16 px (iOS zooms below that) rather than
        // the modal title's, options at body size, and every section listed without scrolling.
        styles={{
          input: { fontSize: "var(--mantine-font-size-md)" },
          option: { fontSize: "var(--mantine-font-size-sm)" },
        }}
        maxDropdownHeight={420}
        data={data}
        value={active}
        allowDeselect={false}
        onChange={(value) => {
          if (value)
            navigate(
              { pathname: location.pathname, search: location.search, hash: `#${value}` },
              { replace: true, state: location.state },
            );
        }}
      />
    </Group>
  );
}

/**
 * Desktop navigation and mounted panes share the route-backed workspace modal. A section given as
 * a function places its heading itself, so its toolbar can sit beside it.
 */
export function WorkspaceSections({
  label,
  sections,
  content,
}: {
  label: string;
  sections: WorkspaceSection[];
  content: Record<string, ReactNode | ((heading: ReactNode) => ReactNode)>;
}) {
  const { location, active } = useWorkspaceSection(sections);
  const [visited, setVisited] = useState(() => new Set([active]));
  if (!visited.has(active)) setVisited(new Set([...visited, active]));
  const link = (section: WorkspaceSection) => (
    <NavLink
      key={section.value}
      component={Link}
      to={{ pathname: location.pathname, search: location.search, hash: `#${section.value}` }}
      replace
      state={location.state}
      label={section.label}
      leftSection={<section.icon size={16} />}
      active={section.value === active}
      aria-current={section.value === active ? "page" : undefined}
    />
  );
  const apart = sections.filter((section) => section.apart);
  return (
    // Fills the modal body, so a section's loading and empty states centre in what it leaves.
    <Grid gap="xl" classNames={{ root: classes.grid, inner: classes.inner }}>
      <Grid.Col span={3} visibleFrom="sm">
        <Stack component="nav" aria-label={`${label} Sections`} gap={4} className={classes.nav}>
          {groupSections(sections.filter((section) => !section.apart)).map(([group, items]) => (
            <Stack
              key={group || items[0].value}
              gap={4}
              role={group ? "group" : undefined}
              aria-label={group || undefined}
            >
              {group && (
                <Text size="xs" fw={600} c="dimmed" px="sm" pt="xs">
                  {group}
                </Text>
              )}
              {items.map(link)}
            </Stack>
          ))}
          {apart.length > 0 && (
            <>
              <Divider my="xs" />
              {apart.map(link)}
            </>
          )}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 9 }} className={classes.body}>
        {sections.map((section) => {
          const body = content[section.value];
          const heading = (
            <div>
              {/* Phones name the section in the header's Section Select already. */}
              <Box visibleFrom="sm">
                <SectionHeading>{section.label}</SectionHeading>
              </Box>
              <Text size="sm" c="dimmed">
                {section.description}
              </Text>
            </div>
          );
          return (
            <Box
              key={section.value}
              component="section"
              aria-label={`${label}: ${section.label}`}
              hidden={section.value !== active}
              className={classes.section}
            >
              <Stack flex={1}>
                {typeof body !== "function" && heading}
                {visited.has(section.value) && (
                  <SectionErrorBoundary label={section.label}>
                    <Suspense fallback={<LoadingState label={`Loading ${section.label}`} fill />}>
                      {typeof body === "function" ? body(heading) : body}
                    </Suspense>
                  </SectionErrorBoundary>
                )}
              </Stack>
            </Box>
          );
        })}
      </Grid.Col>
    </Grid>
  );
}
