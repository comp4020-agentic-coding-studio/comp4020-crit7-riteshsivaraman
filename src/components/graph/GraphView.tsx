// Graph view island (PLAN.md §3.4, §4.4). WAVE 0 STUB: renders a placeholder
// against the GraphViewProps contract; track E owns this file from Wave 1.
// Browser code --- must not read environment variables or import server modules.

import type { GraphViewProps } from "../../lib/contracts";

export default function GraphView(props: GraphViewProps) {
  const planned = props.state.plan.entries.length;
  return (
    <section class="graph-view" aria-label="Requisite graph">
      <p>
        Graph view is not built yet ({planned} planned course{planned === 1 ? "" : "s"}).
      </p>
      {props.focusCode !== null && props.renderDetail(props.focusCode)}
    </section>
  );
}
