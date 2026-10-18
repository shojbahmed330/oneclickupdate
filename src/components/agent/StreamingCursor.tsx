// Blinking caret shown at end of an assistant message while it's streaming.
// Tiny presentational component — keeps AgentMessage thin.
export const StreamingCursor = () => (
  <span
    aria-hidden="true"
    className="inline-block w-[2px] h-[1em] bg-foreground/80 align-text-bottom ml-0.5 animate-[blink_1s_steps(1)_infinite]"
  />
);
