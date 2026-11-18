import type { ReactNode } from 'react';

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** A tooltip positioned inside a `position: relative` chart container, kept within its width. */
export function ChartTooltip({ state, width }: { state: TooltipState | null; width: number }) {
  if (!state) return null;
  const flip = state.x > width * 0.6;
  return (
    <div
      className="chart-tooltip"
      role="status"
      style={{
        top: state.y,
        left: flip ? undefined : state.x + 12,
        right: flip ? width - state.x + 12 : undefined,
      }}
    >
      {state.content}
    </div>
  );
}
