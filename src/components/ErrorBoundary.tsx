// Keeps one view's render error from blanking the whole app. All four tabs stay
// mounted, so without a boundary a throw in History (say, from a malformed restored
// row) unmounted the live workout too — and did it again on every launch.
import { Component, type ReactNode } from "react";

type Props = { name: string; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pad" role="alert">
        <h2>{this.props.name} couldn't load</h2>
        <p className="muted">
          Your saved data isn't affected and the other tabs still work. Try again, restart the app, or export a backup from
          Settings → Backup &amp; data.
        </p>
        <p className="tiny muted">{this.state.error.message}</p>
        <button className="mini" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
