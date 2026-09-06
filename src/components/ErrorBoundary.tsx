import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

// Stops a render error in one view from unmounting the whole app (white screen).
// `resetKey` — when it changes (e.g. the active view or process), the boundary
// clears its error and retries, so navigating away recovers automatically.
type Props = { children: ReactNode; resetKey?: unknown };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="pane-empty" style={{ margin: "auto", maxWidth: 480, textAlign: "center" }}>
          <AlertTriangle style={{ color: "var(--err)" }} strokeWidth={1.5} />
          <div className="t">Something went wrong rendering this view</div>
          <div className="s">{this.state.error.message}</div>
          <div className="s" style={{ marginTop: 8, opacity: 0.7 }}>
            Switch to another view or process and back to retry.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
