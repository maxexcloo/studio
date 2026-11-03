import { Component, type ReactNode } from "react";
import { Alert } from "@mantine/core";

/** Keeps a section that fails to render to an inline alert, so the rest of the app stays up. */
export class SectionErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert color="red" title={`Couldn’t Show ${this.props.label}`}>
        {this.state.error.message}
      </Alert>
    );
  }
}
