import type { ReactNode } from "react";
import { Box, Grid, Group, NavLink, Select, Stack, Text } from "@mantine/core";
import { Link, useLocation, useNavigate } from "react-router";

interface SectionOption {
  value: string;
  label: string;
}
function useWorkspaceSection(sections: SectionOption[]) {
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
  sections: SectionOption[];
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
}: {
  label: string;
  sections: (SectionOption & { content: ReactNode })[];
}) {
  const { location, active } = useWorkspaceSection(sections);
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
            {section.content}
          </Box>
        ))}
      </Grid.Col>
    </Grid>
  );
}
