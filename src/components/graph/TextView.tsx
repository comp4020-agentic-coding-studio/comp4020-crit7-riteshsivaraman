// Text view (PLAN.md §4.4, §4.7): the graph as sentences --- the full
// non-visual equivalent, and safe to SSR (no d3, no window). D may import
// it statically as the `?view=graph` fallback before GraphView hydrates.
// Browser + SSR safe --- reads no environment variables.

import type { CatalogueIndex, PlannerState } from "../../lib/contracts";
import { buildGraph, courseSentence, termLabel } from "./model";

export interface TextViewProps {
  catalogue: CatalogueIndex;
  state: PlannerState;
}

export default function TextView({ catalogue, state }: TextViewProps) {
  const entries = [...state.plan.entries].sort((a, b) => a.year - b.year || a.period.localeCompare(b.period) || a.code.localeCompare(b.code));
  if (entries.length === 0) {
    return <p class="graph-text__empty muted">Your plan is empty. Add a course to see what it needs and what it clashes with.</p>;
  }
  const ghosts = buildGraph(catalogue, state).nodes.filter((n) => n.kind === "course" && !n.planned).map((n) => n.id).sort();
  return (
    <div class="graph-text">
      <ul class="graph-text__list">
        {entries.map((e) => (
          <li key={e.id} data-code={e.code}>
            <span class="code">{e.code}</span> <span class="muted">({termLabel(e.year, e.period)})</span>{" "}
            {courseSentence(e.code, catalogue, state).replace(new RegExp(`^${e.code} `), "")}
          </li>
        ))}
      </ul>
      {ghosts.length > 0 && (
        <p class="graph-text__ghosts muted">
          Referenced but not in your plan: {ghosts.join(", ")}.
        </p>
      )}
    </div>
  );
}
