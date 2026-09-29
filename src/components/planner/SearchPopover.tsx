// SearchPopover (PLAN.md §4.4, §4.7): ARIA 1.2 combobox over GET
// /api/courses/search. With a term (grid slot) each row shows a placement
// preview pill; without one (graph "Add course", GraphSearchProps) there are
// no pills and SearchPanel renders inline wherever E puts it.
// Browser code: no environment variables, no server imports.
import type { RefObject } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { PlanPeriod, SearchResult } from "../../lib/contracts";
import { IconCheck, IconError, IconSearch, IconWarn, Popover } from "../ui";
import { api, termLabel, termShort } from "./api";

export interface SearchPanelProps {
  term: { year: number; period: PlanPeriod } | null;
  onPick(code: string): void;
  onClose(): void;
  /** shown under the input while a pick is being saved, or after it failed */
  message?: string | null;
  busy?: boolean;
}

type Load = { kind: "idle" } | { kind: "error" };

function Pill({ r }: { r: SearchResult }) {
  if (r.inPlan) {
    const [y, p] = r.inPlan.split("-");
    return <span class="chip chip--outline">In plan · {termShort(Number(y.slice(1)), p as PlanPeriod)}</span>;
  }
  if (!r.preview) return null;
  if (r.preview.state === "ok") return <span class="chip"><IconCheck size={12} />Ready</span>;
  const first = r.preview.issues.find((i) => i.severity !== "info") ?? r.preview.issues[0];
  if (!first) return <span class="chip"><IconCheck size={12} />Ready</span>;
  const error = first.severity === "error";
  return (
    <span class={error ? "chip chip--danger" : "chip chip--warn"}>
      {error ? <IconError size={12} /> : <IconWarn size={12} />}
      {first.short}
    </span>
  );
}

export function SearchPanel({ term, onPick, onClose, message, busy }: SearchPanelProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showBar, setShowBar] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [lastQ, setLastQ] = useState("");

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const bar = window.setTimeout(() => setShowBar(true), 200);
    const t = window.setTimeout(async () => {
      try {
        const res = await api.search(q.trim(), term, ctrl.signal);
        if (res.ok) {
          setResults(res.data.results);
          setLoad({ kind: "idle" });
          setLastQ(q.trim());
          const firstPickable = res.data.results.findIndex((r) => !r.inPlan);
          setActive(firstPickable < 0 ? 0 : firstPickable);
        } else {
          setLoad({ kind: "error" });
        }
      } catch {
        return; // aborted: a newer query owns the state
      }
      setLoading(false);
      window.clearTimeout(bar);
      setShowBar(false);
    }, q ? 120 : 0);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
      window.clearTimeout(bar);
    };
  }, [q, attempt, term?.year, term?.period]);

  const list = results ?? [];
  const move = (d: number) => {
    if (list.length === 0) return;
    let i = active;
    for (let n = 0; n < list.length; n++) {
      i = (i + d + list.length) % list.length;
      if (!list[i].inPlan) break;
    }
    setActive(i);
    document.getElementById(`${id}-opt-${i}`)?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      // never place a row from a stale result list (typed faster than search)
      if (loading || q.trim() !== lastQ) return;
      const r = list[active];
      if (r && !r.inPlan && !busy) onPick(r.course.code);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const heading = lastQ === "" ? (term ? `Suggested for ${termLabel(term.year, term.period)}` : "Suggested from your subjects") : null;
  const listId = `${id}-list`;
  return (
    <div class="search">
      <div class="search__field">
        <IconSearch class="search__icon" />
        <input
          ref={inputRef}
          class="input search__input"
          type="text"
          role="combobox"
          aria-label={term ? `Search courses to add to ${termLabel(term.year, term.period)}` : "Search courses"}
          aria-expanded={list.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={list.length > 0 ? `${id}-opt-${active}` : undefined}
          placeholder="Search code or name, e.g. COMP2100 or algorithms"
          autocomplete="off"
          spellcheck={false}
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
        />
        {showBar && loading && <span class="search__progress" aria-hidden="true" />}
      </div>
      {message && <p class="search__message" role="alert">{message}</p>}
      {load.kind === "error" ? (
        <div class="search__empty">
          <p>Search is unavailable. Check your connection and try again.</p>
          <button type="button" class="btn btn--secondary btn--sm" onClick={() => setAttempt((a) => a + 1)}>Retry</button>
        </div>
      ) : results && list.length === 0 && !loading ? (
        <p class="search__empty">
          No ANU course matches '{lastQ}'. Try a code like MATH1013 or a word from the title.
        </p>
      ) : (
        <>
          {heading && <p class="search__heading" id={`${id}-heading`}>{heading}</p>}
          <ul class="search__list" id={listId} role="listbox" aria-label={heading ?? "Matching courses"}>
            {list.map((r, i) => (
              <li
                key={r.course.code}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={r.inPlan ? true : undefined}
                class="search__option"
                data-active={i === active ? "" : undefined}
                onPointerMove={() => !r.inPlan && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !r.inPlan && !busy && onPick(r.course.code)}
              >
                <span class="search__row1">
                  <span class="code search__code">{r.course.code}</span>
                  <span class="num search__units">{r.course.units}u</span>
                </span>
                <span class="search__title">{r.course.title}</span>
                <span class="search__pill"><Pill r={r} /></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export interface SearchPopoverProps extends SearchPanelProps {
  open: boolean;
  anchor: RefObject<HTMLElement>;
}

/** The grid-slot variant: SearchPanel in a Popover (bottom sheet on phones). */
export function SearchPopover({ open, anchor, ...panel }: SearchPopoverProps) {
  return (
    <Popover
      open={open}
      anchor={anchor}
      onClose={() => panel.onClose()}
      closeOnTab
      initialFocus="none"
      width={400}
      label={panel.term ? `Add a course to ${termLabel(panel.term.year, panel.term.period)}` : "Add a course"}
      class="search-popover"
    >
      {open && <SearchPanel {...panel} />}
    </Popover>
  );
}
