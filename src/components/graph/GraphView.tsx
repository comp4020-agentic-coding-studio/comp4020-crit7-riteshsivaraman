// Graph view island (PLAN.md §3.4, §4.4). Planned courses are full nodes;
// the unplanned courses their rules reference (and their incompatibles) are
// faded ghosts. Preact renders the SVG; d3-force computes positions and
// d3-zoom handles wheel/pinch/pan. Node drag is plain pointer events
// (pins while dragging, releases on drop). Add/move go through D's
// onAddEntry/onMoveEntry; the new state comes back as the `state` prop.
// Browser code, loaded lazily by Planner.tsx --- reads no environment variables.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { GraphViewProps, MutationOutcome, PlanPeriod } from "../../lib/contracts";
import "../../styles/graph.css";
import { Button, IconButton, IconFit, IconList, IconGraph, IconPlus, IconSearch, IconZoomIn, IconZoomOut, Popover, Sheet } from "../ui";
import Legend from "./Legend";
import { loadOf } from "../../lib/engine";
import { buildGraph, courseSentence, layoutColumns, neighbourhood, pickerTerms, termLabel, type Columns, type GraphEdge, type GraphLayout, type GraphNode } from "./model";
import { SemesterPicker } from "./SemesterPicker";
import TextView from "./TextView";

type SimNode = GraphNode & SimulationNodeDatum & { w: number; h: number };
type SimLink = SimulationLinkDatum<SimNode> & { edge: GraphEdge };

const LEVEL_X = 120; // px between level bands for the weak forceX
const sizeOf = (n: GraphNode): { w: number; h: number } => {
  if (n.kind === "course") return { w: Math.round(n.label.length * 7.3 + 20 + (n.badge ? 14 : 0)), h: 28 };
  if (n.kind === "units") return { w: Math.round(n.label.length * 6.3 + 14), h: 20 };
  if (n.kind === "and") return { w: 28, h: 18 };
  return { w: 18, h: 18 };
};
const levelX = (level: number) => (level / 1000 - 2.5) * LEVEL_X;

function useMedia(query: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/** Point where the segment from (fx,fy) toward the node centre crosses its border. */
function clip(n: SimNode, fx: number, fy: number, gap: number): [number, number] {
  const x = n.x ?? 0, y = n.y ?? 0;
  const dx = fx - x, dy = fy - y;
  const len = Math.hypot(dx, dy) || 1;
  let t: number;
  if (n.kind === "or") t = n.w / 2 / len;
  else t = Math.min(n.w / 2 / (Math.abs(dx) || 1e-6), n.h / 2 / (Math.abs(dy) || 1e-6));
  t = Math.min(t, 1);
  return [x + dx * t + (dx / len) * gap, y + dy * t + (dy / len) * gap];
}

function edgeGeometry(s: SimNode, t: SimNode, bend: number) {
  const sx = s.x ?? 0, sy = s.y ?? 0, tx = t.x ?? 0, ty = t.y ?? 0;
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  const dx = tx - sx, dy = ty - sy;
  const cx = mx - dy * bend, cy = my + dx * bend;
  const [ax, ay] = clip(s, cx, cy, 1);
  const [bx, by] = clip(t, cx, cy, 2);
  // midpoint of the quadratic curve
  const qx = 0.25 * ax + 0.5 * cx + 0.25 * bx, qy = 0.25 * ay + 0.5 * cy + 0.25 * by;
  return { d: `M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`, qx, qy };
}

/**
 * Right-angle connector (the "Elbow" edge style): leaves the source through
 * the side facing the target, turns once halfway, and enters the target the
 * same way. Mostly-horizontal pairs go H-V-H, mostly-vertical ones V-H-V.
 * (qx, qy) is the middle of the crossing segment, for the ⊘ marker.
 */
function elbowGeometry(s: SimNode, t: SimNode) {
  const sx = s.x ?? 0, sy = s.y ?? 0, tx = t.x ?? 0, ty = t.y ?? 0;
  const f = (v: number) => v.toFixed(1);
  if (Math.abs(tx - sx) >= Math.abs(ty - sy)) {
    const dir = tx >= sx ? 1 : -1;
    const ax = sx + dir * (s.w / 2 + 1), bx = tx - dir * (t.w / 2 + 2);
    const mx = (ax + bx) / 2;
    return { d: `M${f(ax)},${f(sy)} H${f(mx)} V${f(ty)} H${f(bx)}`, qx: mx, qy: (sy + ty) / 2 };
  }
  const dir = ty >= sy ? 1 : -1;
  const ay = sy + dir * (s.h / 2 + 1), by = ty - dir * (t.h / 2 + 2);
  const my = (ay + by) / 2;
  return { d: `M${f(sx)},${f(ay)} V${f(my)} H${f(tx)} V${f(by)}`, qx: (sx + tx) / 2, qy: my };
}

type EdgeStyle = "curved" | "elbow";
const EDGE_KEY = "dp-graph-edges";

const INCOMPAT_KEY = "dp-graph-incompatible";
const LAYOUT_KEY = "dp-graph-layout";
const COL_W = 190; // px between columns in the layered layouts
const LAYOUTS: { id: GraphLayout; label: string }[] = [
  { id: "force", label: "Force" },
  { id: "semester", label: "By semester" },
  { id: "level", label: "By level" },
];

export default function GraphView(props: GraphViewProps) {
  const { catalogue, state, focusCode, onFocusCode } = props;
  // Per-browser display preference (localStorage), not plan state.
  const [showIncompat, setShowIncompat] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(INCOMPAT_KEY) === "hide") setShowIncompat(false);
    } catch {
      /* storage blocked: keep default */
    }
  }, []);
  const toggleIncompat = (on: boolean) => {
    setShowIncompat(on);
    try {
      localStorage.setItem(INCOMPAT_KEY, on ? "show" : "hide");
    } catch {
      /* ignore */
    }
  };
  const model = useMemo(() => buildGraph(catalogue, state, { incompatibleGhosts: showIncompat, career: props.career }), [catalogue, state, showIncompat, props.career]);
  // Edge style: a per-browser display preference (localStorage).
  const [edgeStyle, setEdgeStyleState] = useState<EdgeStyle>("curved");
  useEffect(() => {
    try {
      if (localStorage.getItem(EDGE_KEY) === "elbow") setEdgeStyleState("elbow");
    } catch {
      /* storage blocked: keep default */
    }
  }, []);
  const setEdgeStyle = (v: EdgeStyle) => {
    setEdgeStyleState(v);
    try {
      localStorage.setItem(EDGE_KEY, v);
    } catch {
      /* ignore */
    }
  };
  // Layout choice: a per-browser display preference (localStorage).
  const [layout, setLayoutState] = useState<GraphLayout>("force");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved === "semester" || saved === "level") setLayoutState(saved);
    } catch {
      /* storage blocked: keep default */
    }
  }, []);
  const setLayout = (l: GraphLayout) => {
    interacted.current = false; // refit to the new shape
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* ignore */
    }
  };
  const columns: Columns | null = useMemo(
    () => (layout === "force" ? null : layoutColumns(model, state.plan, layout)),
    [model, state.plan, layout],
  );
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const small = useMedia("(max-width: 767px)");

  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const interacted = useRef(false);
  const [, setFrame] = useState(0);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hovered, setHovered] = useState<string | null>(null);
  const [roving, setRoving] = useState<string | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [picking, setPicking] = useState<{ code: string; mode: "add" | "move"; from: "toolbar" | "panel" } | null>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const actionBtn = useRef<HTMLButtonElement>(null);

  // --- simulation -----------------------------------------------------------
  useEffect(() => {
    const prev = nodesRef.current;
    const next = new Map<string, SimNode>();
    for (const n of model.nodes) {
      const old = prev.get(n.id);
      const { w, h } = sizeOf(n);
      const sn: SimNode = { ...n, w, h, x: old?.x, y: old?.y, vx: old?.vx, vy: old?.vy };
      if (sn.x === undefined && prev.size > 0) {
        // (first layout: d3's deterministic phyllotaxis start, so it's the same on every load)
        // start new nodes near something they connect to, else in their level band
        const link = model.edges.find((e) => e.source === n.id || e.target === n.id);
        const other = link ? prev.get(link.source === n.id ? link.target : link.source) : undefined;
        sn.x = (other?.x ?? levelX(n.level)) + (Math.random() - 0.5) * 60;
        sn.y = (other?.y ?? 0) + (Math.random() - 0.5) * 60;
      }
      next.set(n.id, sn);
    }
    nodesRef.current = next;
    const nodes = [...next.values()];
    const links: SimLink[] = model.edges.map((e) => ({ source: e.source, target: e.target, edge: e }));
    const isHubLink = (l: SimLink) => l.edge.kind !== "incompatible" && (next.get(l.edge.source)?.kind !== "course" || next.get(l.edge.target)?.kind !== "course");

    simRef.current?.stop();
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => (isHubLink(l) ? 40 : l.edge.kind === "incompatible" ? 80 : 70)).strength((l) => (columns ? 0.05 : l.edge.kind === "incompatible" ? 0.25 : 0.7)))
      .force("charge", forceManyBody<SimNode>().strength(columns ? -120 : -260).distanceMax(320))
      .force("collide", forceCollide<SimNode>((d) => (columns ? d.h / 2 + 14 : d.w / 2 + 8)))
      // layered layouts pin x to the node's column; force keeps a weak level drift
      .force("x", columns ? forceX<SimNode>((d) => (columns.col.get(d.id) ?? 0) * COL_W).strength(1) : forceX<SimNode>((d) => levelX(d.level)).strength(0.06))
      .force("y", forceY<SimNode>(0).strength(columns ? 0.04 : 0.08))
      .stop();
    simRef.current = sim;

    const fresh = prev.size === 0;
    // Reduced motion, or a hidden tab (rAF paused, so d3's timer never fires):
    // settle synchronously and paint once.
    if (reduced || document.visibilityState === "hidden") {
      sim.tick(300);
      setFrame((f) => f + 1);
      if (fresh || !interacted.current) requestAnimationFrame(() => fit(false));
      return () => sim.stop();
    }
    sim.alpha(fresh ? 1 : 0.5);
    sim.tick(fresh ? 120 : 40); // most of the settling before first paint; the rest animates
    let raf = 0;
    sim.on("tick", () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setFrame((f) => f + 1); });
    });
    // after a plan change, refit so a new or moved node is never left off-screen
    sim.on("end", () => { if (!fresh || !interacted.current) fit(true); });
    sim.restart();
    setFrame((f) => f + 1);
    if (fresh) requestAnimationFrame(() => fit(false));
    return () => { sim.stop(); cancelAnimationFrame(raf); };
  }, [model, reduced, columns]);

  // --- zoom / pan -----------------------------------------------------------
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 3])
      .filter((ev: Event & { button?: number; ctrlKey?: boolean; type: string }) => {
        const t = ev.target as Element | null;
        if (t?.closest?.(".gnode")) return false; // node drag owns these
        return (!ev.ctrlKey || ev.type === "wheel") && !ev.button;
      })
      .on("zoom", (ev: { transform: ZoomTransform; sourceEvent: Event | null }) => {
        if (ev.sourceEvent) interacted.current = true;
        setTransform(ev.transform);
      });
    zoomRef.current = z;
    const sel = select(svg);
    sel.call(z).on("dblclick.zoom", null);
    return () => { sel.on(".zoom", null); };
  }, [textMode]);

  function fit(animate: boolean) {
    const svg = svgRef.current;
    const z = zoomRef.current;
    const nodes = [...nodesRef.current.values()];
    if (!svg || !z || nodes.length === 0) return;
    const W = svg.clientWidth, H = svg.clientHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, (n.x ?? 0) - n.w / 2); x1 = Math.max(x1, (n.x ?? 0) + n.w / 2);
      y0 = Math.min(y0, (n.y ?? 0) - n.h / 2); y1 = Math.max(y1, (n.y ?? 0) + n.h / 2);
    }
    // keep the fitted graph clear of the open legend (bottom-left) and the controls
    const legend = svg.parentElement?.querySelector<HTMLElement>(".legend.is-open");
    const padL = 40 + (legend && W > 640 ? legend.offsetWidth + 12 : 0), padR = 40, padT = 32, padB = 56;
    const aw = W - padL - padR, ah = H - padT - padB;
    const k = Math.min(1.4, aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0));
    const t = zoomIdentity.translate(padL + aw / 2 - ((x0 + x1) / 2) * k, padT + ah / 2 - ((y0 + y1) / 2) * k).scale(k);
    void animate;
    select(svg).call(z.transform, t);
  }
  const zoomBy = (f: number) => {
    const svg = svgRef.current;
    if (svg && zoomRef.current) { interacted.current = true; select(svg).call(zoomRef.current.scaleBy, f); }
  };
  const centreOn = (id: string) => {
    const svg = svgRef.current, z = zoomRef.current, n = nodesRef.current.get(id);
    if (!svg || !z || !n) return;
    interacted.current = true;
    select(svg).call(z.translateTo, n.x ?? 0, n.y ?? 0);
  };

  // --- node drag / click ------------------------------------------------------
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const toSim = (e: PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return transform.invert([e.clientX - r.left, e.clientY - r.top]);
  };
  const onNodeDown = (e: PointerEvent, n: SimNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id: n.id, x: e.clientX, y: e.clientY, moved: false };
  };
  const onNodeMove = (e: PointerEvent, n: SimNode) => {
    const d = drag.current;
    if (!d || d.id !== n.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    interacted.current = true;
    const [x, y] = toSim(e);
    n.fx = x; n.fy = y;
    if (reduced) { n.x = x; n.y = y; setFrame((f) => f + 1); }
    else simRef.current?.alphaTarget(0.3).restart();
  };
  const onNodeUp = (_e: PointerEvent, n: SimNode) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== n.id) return;
    if (d.moved) {
      if (!reduced) { n.fx = null; n.fy = null; simRef.current?.alphaTarget(0); }
      return;
    }
    if (n.kind === "course") onFocusCode(focusCode === n.id ? null : n.id);
  };

  // --- background: click clears the pinned focus ---------------------------------
  const bgDown = useRef<[number, number] | null>(null);

  // --- keyboard (roving tabindex over course nodes) ------------------------------
  const courseNodes = [...nodesRef.current.values()].filter((n) => n.kind === "course");
  const rovingId = roving && nodesRef.current.has(roving) ? roving : (focusCode && nodesRef.current.has(focusCode) ? focusCode : courseNodes[0]?.id ?? null);
  const onNodeKey = (e: KeyboardEvent, n: SimNode) => {
    const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    if (dirs[e.key]) {
      e.preventDefault();
      const [ux, uy] = dirs[e.key];
      let best: SimNode | null = null, bestScore = Infinity;
      for (const m of courseNodes) {
        if (m.id === n.id) continue;
        const dx = (m.x ?? 0) - (n.x ?? 0), dy = (m.y ?? 0) - (n.y ?? 0);
        const along = dx * ux + dy * uy;
        if (along <= 0) continue;
        const score = along + 2 * Math.abs(dx * uy - dy * ux);
        if (score < bestScore) { bestScore = score; best = m; }
      }
      if (best) {
        setRoving(best.id);
        requestAnimationFrame(() => svgRef.current?.querySelector<SVGGElement>(`[data-node="${best!.id}"]`)?.focus());
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onFocusCode(focusCode === n.id ? null : n.id);
    } else if (e.key === "Escape") {
      onFocusCode(null);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusCode && !searchOpen && !picking) onFocusCode(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusCode, searchOpen, picking]);

  // --- highlight ------------------------------------------------------------------
  const activeId = hovered ?? (focusCode && nodesRef.current.has(focusCode) ? focusCode : null);
  const nb = useMemo(() => (activeId ? neighbourhood(model, activeId) : null), [model, activeId]);

  // --- panel --------------------------------------------------------------------------
  const pinned = focusCode && nodesRef.current.has(focusCode) ? focusCode : null;
  const panelCode = pinned ?? (!small ? hovered : null);
  const panelNode = panelCode ? nodesRef.current.get(panelCode) : undefined;
  const entry = panelCode ? state.plan.entries.find((e) => e.code === panelCode) : undefined;

  const movingEntry = picking?.mode === "move" ? state.plan.entries.find((e) => e.code === picking.code) : undefined;
  const onChoose = async (year: number, period: PlanPeriod): Promise<MutationOutcome> => {
    if (!picking) return { ok: true };
    const code = picking.code;
    const out = movingEntry ? await props.onMoveEntry(movingEntry.id, year, period) : await props.onAddEntry(code, year, period);
    if (out.ok) onFocusCode(code); // keep the course you just placed traced
    return out;
  };

  const empty = state.plan.entries.length === 0;
  const nodes = [...nodesRef.current.values()];
  const plannedCount = nodes.filter((n) => n.kind === "course" && n.planned).length;
  const ghostCount = nodes.filter((n) => n.kind === "course" && !n.planned).length;

  const panelBody = panelNode && panelCode && (
    <div class="graph-panel__inner">
      <p class="graph-panel__status">
        {entry ? <>In your plan · <strong>{termLabel(entry.year, entry.period)}</strong></> : "Not in your plan"}
      </p>
      <p class="graph-panel__trace">{courseSentence(panelCode, catalogue, state)}</p>
      {catalogue.byCode.has(panelCode) ? (
        <div class="graph-panel__detail">{props.renderDetail(panelCode)}</div>
      ) : (
        <p class="muted graph-panel__detail">{panelCode} isn't in the loaded catalogue, so there's no detail to show.</p>
      )}
      {pinned === panelCode ? (
        <Button
          ref={actionBtn}
          variant={entry ? "secondary" : "primary"}
          block
          class="graph-panel__action"
          aria-haspopup="listbox"
          aria-expanded={picking?.from === "panel"}
          onClick={() => setPicking({ code: panelCode, mode: entry ? "move" : "add", from: "panel" })}
        >
          {entry ? "Move to semester…" : "Add to semester…"}
        </Button>
      ) : (
        <p class="graph-panel__hint muted">Click the node to pin it and {entry ? "move" : "add"} it.</p>
      )}
    </div>
  );

  return (
    <section class="graph" aria-label="Requisite graph">
      <div class="graph__toolbar">
        <form
          class="graph__find"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim().toUpperCase();
            const hit = q && courseNodes.find((n) => n.id === q) ? q : courseNodes.find((n) => n.id.startsWith(q))?.id;
            if (q && hit) { onFocusCode(hit); centreOn(hit); }
          }}
        >
          <IconSearch class="graph__find-icon" />
          <input
            class="input graph__find-input code"
            type="search"
            aria-label="Find a course in the graph"
            placeholder="Find in graph"
            value={query}
            list="graph-codes"
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          />
          <datalist id="graph-codes">
            {courseNodes.map((n) => <option key={n.id} value={n.id} />)}
          </datalist>
        </form>
        <Button ref={addBtn} variant="primary" icon={<IconPlus />} aria-haspopup="dialog" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}>
          Add course
        </Button>
        <span class="graph__count muted num">
          {plannedCount} planned · {ghostCount} referenced
        </span>
        <div class="graph__layouts" role="group" aria-label="Graph layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" class="graph__layout" aria-pressed={layout === l.id} onClick={() => setLayout(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <div class="graph__layouts" role="group" aria-label="Edge style">
          {(["curved", "elbow"] as const).map((v) => (
            <button key={v} type="button" class="graph__layout" aria-pressed={edgeStyle === v} onClick={() => setEdgeStyle(v)}>
              {v === "curved" ? "Curved" : "Elbow"}
            </button>
          ))}
        </div>
        <label class="graph__toggle">
          <input type="checkbox" checked={showIncompat} onChange={(e) => toggleIncompat((e.currentTarget as HTMLInputElement).checked)} />
          Incompatible courses
        </label>
        <Button variant="ghost" icon={textMode ? <IconGraph /> : <IconList />} aria-pressed={textMode} class="graph__mode" onClick={() => setTextMode((t) => !t)}>
          {textMode ? "Show as graph" : "Show as list"}
        </Button>
      </div>

      {textMode ? (
        <div class="graph__textview">
          <TextView catalogue={catalogue} state={state} />
        </div>
      ) : (
        <div class="graph__canvas">
          <svg
            ref={svgRef}
            class="graph__svg"
            role="application"
            aria-label={`Requisite graph: ${plannedCount} planned courses and ${ghostCount} referenced courses. Arrow keys move between courses, Enter pins one.`}
            aria-describedby="graph-howto"
            onPointerDown={(e) => { bgDown.current = [e.clientX, e.clientY]; }}
            onClick={(e) => {
              const d = bgDown.current;
              if (!(e.target as Element).closest(".gnode") && d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 4) onFocusCode(null);
            }}
          >
            <defs>
              {(["met", "unmet", "idle"] as const).map((s) => (
                <marker key={s} id={`gm-arrow-${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" class={`gm-arrow gm-arrow--${s}`} />
                </marker>
              ))}
            </defs>
            <g transform={transform.toString()}>
              {columns && (() => {
                const ys = [...nodesRef.current.values()].map((n) => (n.y ?? 0) - n.h / 2);
                const top = (ys.length ? Math.min(...ys) : 0) - 36;
                return (
                  <g class="gcols" aria-hidden="true">
                    {[...columns.labels].sort((a, b) => a[0] - b[0]).map(([c, text]) => (
                      <text key={c} class="gcols__label" x={c * COL_W} y={top} text-anchor="middle">{text}</text>
                    ))}
                  </g>
                );
              })()}
              <g class="graph__edges">
                {model.edges.map((e) => {
                  const s = nodesRef.current.get(e.source), t = nodesRef.current.get(e.target);
                  if (!s || !t || s.x === undefined || t.x === undefined) return null;
                  const g = edgeStyle === "elbow" ? elbowGeometry(s, t) : edgeGeometry(s, t, e.kind === "incompatible" ? 0 : 0.12);
                  const cls = ["gedge", `gedge--${e.kind}`, `gedge--${e.state}`, e.clash && "gedge--clash", nb && (nb.edges.has(e.id) ? "is-hot" : "is-faded")].filter(Boolean).join(" ");
                  return (
                    <g key={e.id} data-edge={e.id} class={cls}>
                      <path d={g.d} marker-end={e.kind === "incompatible" ? undefined : `url(#gm-arrow-${e.state})`} />
                      {e.kind === "incompatible" && (
                        <g class="gedge__ban" transform={`translate(${g.qx.toFixed(1)} ${g.qy.toFixed(1)})`}>
                          <title>{`${e.source} and ${e.target} can't both be taken`}</title>
                          <circle r="6" />
                          <path d="M-4,4 L4,-4" />
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
              <g class="graph__nodes">
                {nodes.map((n) => {
                  const x = n.x ?? 0, y = n.y ?? 0;
                  const faded = nb && !nb.nodes.has(n.id);
                  const common = {
                    key: n.id,
                    "data-node": n.id,
                    transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`,
                    onPointerDown: (e: PointerEvent) => onNodeDown(e, n),
                    onPointerMove: (e: PointerEvent) => onNodeMove(e, n),
                    onPointerUp: (e: PointerEvent) => onNodeUp(e, n),
                  };
                  if (n.kind !== "course") {
                    return (
                      <g {...common} class={`gnode gnode--hub gnode--${n.kind}${faded ? " is-faded" : ""}`}>
                        {n.kind === "or" ? <circle r={9} /> : <rect x={-n.w / 2} y={-n.h / 2} width={n.w} height={n.h} rx={n.kind === "and" ? 9 : 5} />}
                        <text dy="0.35em" text-anchor="middle">{n.label}</text>
                      </g>
                    );
                  }
                  const cls = ["gnode", "gnode--course", n.planned ? "gnode--planned" : "gnode--ghost", n.status && n.status !== "ok" && `gnode--${n.status}`,
                    faded && "is-faded", activeId === n.id && "is-active", pinned === n.id && "is-pinned"].filter(Boolean).join(" ");
                  const label = `${n.id}${n.title ? `, ${n.title}` : ""}. ${n.planned && n.term ? `In your plan, ${termLabel(Number(n.term.slice(1, n.term.indexOf("-"))), n.term.split("-")[1] as PlanPeriod)}` : "Not in your plan"}${n.status === "violation" ? ", has a problem" : n.status === "warning" ? ", has a warning" : ""}.`;
                  return (
                    <g
                      {...common}
                      class={cls}
                      tabIndex={n.id === rovingId ? 0 : -1}
                      role="button"
                      aria-label={label}
                      aria-pressed={pinned === n.id}
                      onPointerEnter={() => setHovered(n.id)}
                      onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
                      onFocus={() => { setRoving(n.id); setHovered(n.id); }}
                      onBlur={() => setHovered((h) => (h === n.id ? null : h))}
                      onKeyDown={(e: KeyboardEvent) => onNodeKey(e, n)}
                    >
                      <rect class="gnode__ring" x={-n.w / 2 - 3} y={-n.h / 2 - 3} width={n.w + 6} height={n.h + 6} rx={(n.h + 6) / 2} />
                      <rect class="gnode__pill" x={-n.w / 2} y={-n.h / 2} width={n.w} height={n.h} rx={n.h / 2} />
                      <text class="gnode__code" dy="0.35em" text-anchor="middle" x={n.badge ? -6 : 0}>{n.label}</text>
                      {n.badge && (
                        <text class="gnode__badge" dy="0.35em" x={n.w / 2 - 12} text-anchor="middle">{n.badge === "info" ? "ⓘ" : "?"}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
          <p id="graph-howto" class="visually-hidden">Drag to pan, scroll or pinch to zoom, drag a course to move it. Hover or focus a course to trace it. "Show as list" gives the same information as text.</p>

          {empty && (
            <div class="graph__empty">
              <p><strong>Nothing to draw yet.</strong></p>
              <p class="muted">Add a course and its requisites appear here, with anything it clashes with.</p>
            </div>
          )}

          <Legend />
          <div class="graph__controls">
            <IconButton tone="raised" label="Zoom in" icon={<IconZoomIn />} onClick={() => zoomBy(1.3)} />
            <IconButton tone="raised" label="Zoom out" icon={<IconZoomOut />} onClick={() => zoomBy(1 / 1.3)} />
            <IconButton tone="raised" label="Fit graph to view" icon={<IconFit />} onClick={() => { interacted.current = false; fit(true); }} />
          </div>

          {!small && panelBody && (
            <aside class="graph-panel" aria-label={`${panelCode} details`}>
              {panelBody}
            </aside>
          )}
        </div>
      )}

      {small && (
        <Sheet open={!!pinned && !textMode} onClose={() => onFocusCode(null)} label={`${pinned ?? ""} details`} class="graph-sheet">
          {panelBody}
        </Sheet>
      )}

      <Popover open={searchOpen} anchor={addBtn} onClose={() => setSearchOpen(false)} label="Search courses to add" width={380} class="graph-search">
        {searchOpen &&
          props.renderSearch({
            onPick: (code) => { setSearchOpen(false); setPicking({ code, mode: "add", from: "toolbar" }); },
            onClose: () => setSearchOpen(false),
          })}
      </Popover>

      <SemesterPicker
        open={!!picking}
        anchor={picking?.from === "panel" ? actionBtn : addBtn}
        code={picking?.code ?? ""}
        verb={picking?.mode === "move" ? "Move" : "Add"}
        terms={pickerTerms(state.plan, movingEntry, picking ? loadOf(catalogue.byCode.get(picking.code)) : undefined, (c) => loadOf(catalogue.byCode.get(c)))}
        onChoose={onChoose}
        onClose={() => setPicking(null)}
      />
    </section>
  );
}
