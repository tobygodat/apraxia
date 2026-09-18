/**
 * The last line of defence for a render-time throw. Without one, a single bad
 * cached row or an unhandled edge in the week grid unmounts the whole tree and
 * leaves a blank page with nothing to click.
 *
 * `resetKey` clears a caught error when it changes, so navigating away from a
 * page that threw shows the new page instead of the error card.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface WorkspaceErrorBoundaryProps {
  readonly children: ReactNode;
  /** Changing this value clears a caught error. */
  readonly resetKey?: string;
  /** Sentence shown above the reload control. */
  readonly message?: string;
}

interface WorkspaceErrorBoundaryState {
  readonly failed: boolean;
}

const DEFAULT_MESSAGE = "Something went wrong on this page. Reload to start again.";

export class WorkspaceErrorBoundary extends Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  override state: WorkspaceErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): WorkspaceErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Personal records never belong in a log. The component stack does not
    // carry any, and it is the only thing that makes these reports actionable.
    console.error("Workspace render failed.", error.message, info.componentStack);
  }

  override componentDidUpdate(previous: WorkspaceErrorBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="workspace-error">
        <p role="alert">{this.props.message ?? DEFAULT_MESSAGE}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
