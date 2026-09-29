// Planner island (PLAN.md §3.4): owns PlannerState, the view toggle, the
// shared focusCode (requisite trace), every plan mutation, and the polite
// live region. The only component that calls the plan API; the graph (E)
// mutates through onAddEntry/onMoveEntry and gets new state back as a prop.
// Browser + SSR safe: no environment variables, no server imports.
import type { ComponentType } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  CatalogueCourse,
  GraphSearchProps,
  GraphViewProps,
  MutationOutcome,
  PlanEntry,
  PlannerBootstrap,
  PlannerState,
  PlanPeriod,
  Rule,
} from "../../lib/contracts";
import { dependentsOf, firstFreeSlot, indexCatalogue, loadOf } from "../../lib/engine/index";
import { Popover } from "../ui";
import { addToTerm, api, errorText, moveToTerm, termLabel, type ApiResult } from "./api";
import type { Career } from "../../lib/career";
import { CareerChoice } from "./FirstRun";
import type { Trace } from "./CourseCard";
import { CourseDetail } from "./CourseDetail";
import { FirstRun, Guide } from "./FirstRun";
import { GridView, type ShapeChange } from "./GridView";
import { SearchPanel } from "./SearchPopover";
import { Toolbar, type View } from "./Toolbar";

export interface PlannerProps {
  bootstrap: PlannerBootstrap;
  initialView: View;
}

function ruleCodes(rule: Rule | null, out = new Set<string>()): Set<string> {
  if (!rule) return out;
  if (rule.kind === "AND" || rule.kind === "OR") rule.children.forEach((c) => ruleCodes(c, out));
  else if (rule.kind === "COURSE") out.add(rule.code);
  else if (rule.kind === "UNITS") (rule.from ?? []).forEach((c) => out.add(c));
  return out;
}

export default function Planner({ bootstrap, initialView }: PlannerProps) {
  const [state, setState] = useState<PlannerState>(bootstrap.state);
  const [courses, setCourses] = useState<CatalogueCourse[]>(bootstrap.catalogue);
  const [view, setView] = useState<View>(initialView);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [Graph, setGraph] = useState<ComponentType<GraphViewProps> | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  // Undergraduate/postgraduate: stored on the plan (plans.career). Chosen on
  // entry; switching clears the plan (the Toolbar confirms first).
  const career = state.plan.career ?? null;
  const setCareer = async (c: Career) => {
    const out = apply(await api.patchPlan({ career: c }));
    if (out.ok) { setFocusCode(null); setLive(`Showing ${c === "ug" ? "undergraduate" : "postgraduate"} courses. Plan cleared.`); }
  };
  const howAnchor = useRef<HTMLElement>(null);

  const cat = useMemo(() => indexCatalogue(courses, bootstrap.catalogueMeta.version), [courses]);

  // --- trace (signature) ------------------------------------------------
  const trace = useMemo(() => {
    const f = focusCode ? cat.byCode.get(focusCode) : undefined;
    if (!focusCode || !f) return null;
    return { needs: ruleCodes(f.rule), clashes: new Set(f.incompatible), unlocks: new Set(dependentsOf(focusCode, cat)) };
  }, [focusCode, cat]);
  const traceOf = useCallback(
    (code: string): Trace => {
      if (!trace) return null;
      if (code === focusCode) return "self";
      if (trace.clashes.has(code)) return "clashes";
      if (trace.needs.has(code)) return "needs";
      if (trace.unlocks.has(code)) return "unlocks";
      return "dim";
    },
    [trace, focusCode],
  );

  // --- state application ----------------------------------------------
  const apply = (res: ApiResult<PlannerState>): MutationOutcome => {
    if (!res.ok) return { ok: false, error: res.error };
    const next = res.data;
    if (next.catalogueAdditions?.length) {
      setCourses((prev) => {
        const have = new Set(prev.map((c) => c.code));
        return [...prev, ...next.catalogueAdditions!.filter((c) => !have.has(c.code))];
      });
    }
    setState({ plan: next.plan, evaluation: next.evaluation });
    return { ok: true };
  };

  const problemsOf = (s: PlannerState) =>
    new Set(Object.values(s.evaluation.entries).filter((e) => e.state !== "ok").map((e) => e.code));

  const focusCard = (id: number) =>
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)?.focus({ preventScroll: false }), 60);

  const add = async (code: string, year: number, period: PlanPeriod, slot: number): Promise<MutationOutcome> => {
    const res = await api.addEntry(code, year, period, slot);
    const out = apply(res);
    if (res.ok) {
      const entry = res.data.plan.entries.find((e) => e.code === code);
      if (entry) {
        const st = res.data.evaluation.entries[entry.id];
        const probs = st?.issues.filter((i) => i.severity !== "info") ?? [];
        setLive(`${code} added to ${termLabel(year, period)}. ${probs.length === 0 ? "No problems." : `${probs.length} problem${probs.length === 1 ? "" : "s"}: ${probs.map((p) => p.short).join("; ")}.`}`);
        setFresh(entry.id);
        if (view === "grid") focusCard(entry.id);
      }
    }
    return out;
  };

  const remove = async (entry: PlanEntry) => {
    const before = problemsOf(state);
    const res = await api.removeEntry(entry.id);
    if (!res.ok) {
      const msg = errorText("remove", entry.code, res.error);
      setLive(msg);
      setStartError(msg);
      return;
    }
    setStartError(null);
    apply(res);
    const newly = [...problemsOf(res.data)].filter((c) => !before.has(c));
    setLive(`${entry.code} removed.${newly.length ? ` ${newly.join(", ")} now ${newly.length === 1 ? "has a problem" : "have problems"}.` : ""}`);
    if (focusCode === entry.code) setFocusCode(null);
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-slot="${entry.year}-${entry.period}-${entry.slot}"]`)?.focus(), 60);
  };

  /** Grid drag and drop: move a planned course into a specific empty slot. */
  const moveTo = async (entryId: number, year: number, period: PlanPeriod, slot: number): Promise<MutationOutcome> => {
    const entry = state.plan.entries.find((e) => e.id === entryId);
    if (!entry) return { ok: false, error: { error: "NOT_FOUND", message: "That course is no longer in your plan." } };
    if (entry.year === year && entry.period === period && entry.slot === slot) return { ok: true };
    const res = await api.moveEntry(entryId, year, period, slot);
    const out = apply(res);
    if (!res.ok) {
      const msg = errorText("move", entry.code, res.error);
      setLive(msg);
      setStartError(msg);
      return out;
    }
    setStartError(null);
    const st = res.data.evaluation.entries[entryId];
    const probs = st?.issues.filter((i) => i.severity !== "info") ?? [];
    setLive(`${entry.code} moved to ${termLabel(year, period)}. ${probs.length === 0 ? "No problems." : `${probs.length} problem${probs.length === 1 ? "" : "s"}: ${probs.map((p) => p.short).join("; ")}.`}`);
    setFresh(entryId);
    focusCard(entryId);
    return out;
  };

  /** The card's pencil: swap the course in place (same term and slot). */
  const replace = async (entry: PlanEntry, code: string): Promise<MutationOutcome> => {
    const res = await api.replaceEntry(entry.id, code);
    const out = apply(res);
    if (res.ok) {
      const st = res.data.evaluation.entries[entry.id];
      const probs = st?.issues.filter((i) => i.severity !== "info") ?? [];
      setLive(`${entry.code} changed to ${code}. ${probs.length === 0 ? "No problems." : `${probs.length} problem${probs.length === 1 ? "" : "s"}: ${probs.map((p) => p.short).join("; ")}.`}`);
      if (focusCode === entry.code) setFocusCode(null);
      setFresh(entry.id);
      focusCard(entry.id);
    }
    return out;
  };

  const onShape = async (change: ShapeChange): Promise<MutationOutcome> => {
    const out = apply(await api.patchPlan(change));
    if (out.ok) setLive("Plan updated.");
    return out;
  };

  const onReset = async () => {
    const out = apply(await api.resetPlan());
    if (out.ok) { setFocusCode(null); setLive("Plan reset. All courses cleared."); }
  };

  // --- graph callbacks (GraphViewProps) -------------------------------
  const loads = (code: string) => loadOf(cat.byCode.get(code));
  const onAddEntry = async (code: string, year: number, period: PlanPeriod): Promise<MutationOutcome> => {
    const slot = firstFreeSlot(state.plan, year, period, loads(code), loads);
    if (slot === null) return apply(await addToTerm(state.plan, code, year, period, loads)); // SLOT_TAKEN, no request
    return add(code, year, period, slot);
  };
  const onMoveEntry = async (entryId: number, year: number, period: PlanPeriod): Promise<MutationOutcome> => {
    const entry = state.plan.entries.find((e) => e.id === entryId);
    const out = apply(await moveToTerm(state.plan, entryId, year, period, loads));
    if (out.ok && entry) setLive(`${entry.code} moved to ${termLabel(year, period)}.`);
    return out;
  };
  const renderDetail = (code: string) => {
    const course = cat.byCode.get(code);
    if (!course) return null;
    const entry = state.plan.entries.find((e) => e.code === code);
    return <CourseDetail course={course} status={entry ? (state.evaluation.entries[entry.id] ?? null) : null} cat={cat} career={career} />;
  };
  const renderSearch = (p: GraphSearchProps) => <SearchPanel term={null} onPick={p.onPick} onClose={p.onClose} />;

  // --- view toggle + lazy graph ----------------------------------------
  const changeView = (v: View) => {
    setView(v);
    const url = new URL(window.location.href);
    if (v === "graph") url.searchParams.set("view", "graph");
    else url.searchParams.delete("view");
    history.replaceState(null, "", url);
  };
  useEffect(() => {
    if (view !== "graph" || Graph) return;
    let live = true;
    import("../graph/GraphView").then((m) => { if (live) setGraph(() => m.default); });
    return () => { live = false; };
  }, [view]);

  const jump = (entryId: number) => {
    if (view !== "grid") changeView("grid");
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-entry-id="${entryId}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    }, 80);
  };

  // --- "How it works" in the app bar -----------------------------------
  const empty = state.plan.entries.length === 0;
  const emptyRef = useRef(empty);
  emptyRef.current = empty;
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest<HTMLElement>("[data-how-it-works]");
      if (!link) return;
      e.preventDefault();
      if (emptyRef.current && view === "grid") {
        const panel = document.getElementById("how-it-works");
        panel?.scrollIntoView({ behavior: "smooth", block: "center" });
        panel?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
        return;
      }
      (howAnchor as { current: HTMLElement | null }).current = link;
      setHowOpen((o) => !o);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [view]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setStartError(null);
    const first = career === "pg" ? "COMP6710" : "COMP1100";
    const out = await add(first, 1, "S1", 0);
    setBusy(false);
    if (!out.ok) setStartError(`Couldn't add ${first}: ${out.error.message}`);
  };

  return (
    <div class="planner" data-view={view}>
      <Toolbar state={state} cat={cat} view={view} onView={changeView} onJump={jump} onReset={onReset} career={career} onCareer={setCareer} />
      <div id="planner-panel" role="tabpanel" aria-label={view === "grid" ? "Semester grid" : "Requisite graph"}>
        {career === null ? (
          <CareerChoice onChoose={setCareer} />
        ) : <>
        {view === "grid" ? (
          <>
            {empty && <FirstRun onStart={start} busy={busy} career={career} />}
            {startError && <p class="grid-view__error" role="alert">{startError}</p>}
            <GridView
              state={state}
              cat={cat}
              traceOf={traceOf}
              fresh={fresh}
              onTrace={setFocusCode}
              onAdd={add}
              onMove={moveTo}
              onRemove={remove}
              onReplace={replace}
              onShape={onShape}
            />
          </>
        ) : Graph ? (
          <Graph
            catalogue={cat}
            state={state}
            focusCode={focusCode}
            onFocusCode={setFocusCode}
            renderDetail={renderDetail}
            renderSearch={renderSearch}
            onAddEntry={onAddEntry}
            onMoveEntry={onMoveEntry}
            career={career}
          />
        ) : (
          <p class="planner__loading">Loading the graph…</p>
        )}
        </>}
      </div>
      <Popover open={howOpen} anchor={howAnchor} onClose={() => setHowOpen(false)} label="How it works" width={400} placement="bottom-end">
        <div class="popover__header">How it works</div>
        <div class="popover__body"><Guide /></div>
      </Popover>
      <p class="visually-hidden" aria-live="polite" role="status">{live}</p>
    </div>
  );
}
