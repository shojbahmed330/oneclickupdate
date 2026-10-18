import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface State { error: Error | null }

/**
 * Catches render-time errors inside the agent workspace so a failed stream /
 * malformed message part doesn't unmount the whole app (which previously sent
 * users back to /projects with a hard reload).
 */
export class AgentErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("[AgentErrorBoundary]", error); }
  reset = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="max-w-md text-center space-y-3">
          <div className="mx-auto size-10 rounded-full bg-destructive/10 grid place-items-center">
            <AlertTriangle className="size-5 text-destructive" />
          </div>
          <h2 className="font-display text-lg">Something went wrong</h2>
          <p className="text-sm text-muted-foreground break-words">
            {this.state.error.message || "Agent run failed unexpectedly."}
          </p>
          <div className="flex gap-2 justify-center">
            <Button size="sm" onClick={this.reset}>Try again</Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </div>
      </div>
    );
  }
}
