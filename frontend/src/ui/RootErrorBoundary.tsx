import { Button, Stack, Text } from "@mantine/core";
import { Component, type ReactNode } from "react";

/** The last resort: a plain message and Reload when the whole app fails to render. */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Stack align="center" justify="center" gap="sm" h="100dvh" p="md">
        <Text>Something went wrong.</Text>
        <Button onClick={() => location.reload()}>Reload</Button>
      </Stack>
    );
  }
}
