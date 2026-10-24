import { Suspense, useState, type ReactNode } from "react";
import { Box, Grid, Group, NavLink, Select, Stack, Text } from "@mantine/core";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { LoadingState } from "./LoadingState";
import { SectionHeading } from "./SectionHeading";

/** One Library or Settings section; `admin` sections are hidden from other accounts. */
export interface SectionDefinition {
  label: string;
  description: string;
  icon: LucideIcon;
  admin?: boolean;
}
export type WorkspaceSection = SectionDefinition & { value: string };

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
function useWorkspaceSection(sections: WorkspaceSection[]) {
  const location = useLocation();
  const active =
    sections.find((section) => `#${section.value}` === location.hash)?.value || sections[0].value;
  return { location, active };
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
  return (
    <Group gap="xs" wrap="nowrap">
      <Text component="span" size="xl" fw={600}>
        {label}
      </Text>
      <Select
        aria-label={`${label} Section`}
        size="xs"
        w={160}
        miw={0}
        flex={1}
        data={sections}
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

/** Desktop navigation and mounted panes share the route-backed workspace modal. */
export function WorkspaceSections({
  label,
  sections,
  content,
}: {
  label: string;
  sections: WorkspaceSection[];
  content: Record<string, ReactNode>;
}) {
  const { location, active } = useWorkspaceSection(sections);
  const [visited, setVisited] = useState(() => new Set([active]));
  if (!visited.has(active)) setVisited(new Set([...visited, active]));
  return (
    <Grid gap="xl" mih={{ base: 0, sm: "24rem" }}>
      <Grid.Col span={3} visibleFrom="sm">
        <Stack component="nav" aria-label={`${label} Sections`} gap={4}>
          {sections.map((section) => (
            <NavLink
              key={section.value}
              component={Link}
              to={{
                pathname: location.pathname,
                search: location.search,
                hash: `#${section.value}`,
              }}
              replace
              state={location.state}
              label={section.label}
              leftSection={<section.icon size={16} />}
              active={section.value === active}
              aria-current={section.value === active ? "page" : undefined}
            />
          ))}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 9 }} style={{ minWidth: 0 }}>
        {sections.map((section) => (
          <Box
            key={section.value}
            component="section"
            aria-label={`${label}: ${section.label}`}
            hidden={section.value !== active}
          >
            <Stack>
              <div>
                <SectionHeading>{section.label}</SectionHeading>
                <Text size="sm" c="dimmed">
                  {section.description}
                </Text>
              </div>
              {visited.has(section.value) && (
                <Suspense fallback={<LoadingState label={`Loading ${section.label}`} />}>
                  {content[section.value]}
                </Suspense>
              )}
            </Stack>
          </Box>
        ))}
      </Grid.Col>
    </Grid>
  );
}
