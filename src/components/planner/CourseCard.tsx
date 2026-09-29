// CourseCard (PLAN.md §4.4): one planned course. Red solid border + bar for
// errors, amber dashed border for warnings (shape differs, so colour is never
// the only signal); the first problem's `short` is real text on the card.
// Hover (300ms) or focus opens CourseDetail; hovering also drives the
// requisite trace through onTrace. Browser + SSR safe: no environment variables.
import { useEffect, useRef, useState } from "preact/hooks";
import type { CatalogueCourse, CatalogueIndex, EntryStatus, PlanEntry } from "../../lib/contracts";
import { IconButton, IconInfo, IconX, Popover } from "../ui";
import { termLabel } from "./api";
import { CourseDetail, IssueIcon } from "./CourseDetail";

export type Trace = "self" | "needs" | "unlocks" | "clashes" | "dim" | null;

export interface CourseCardProps {
  entry: PlanEntry;
  course: CatalogueCourse | undefined;
  status: EntryStatus | undefined;
  cat: CatalogueIndex;
  trace: Trace;
  fresh: boolean;
  onTrace(code: string | null): void;
  onRemove(entry: PlanEntry): void;
}

const TRACE_TAG: Partial<Record<NonNullable<Trace>, string>> = { needs: "needed", unlocks: "unlocks", clashes: "clashes" };

export function CourseCard({ entry, course, status, cat, trace, fresh, onTrace, onRemove }: CourseCardProps) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  // pinned = opened on purpose (Enter/Space or a tap): a focus-trapping dialog,
  // so keyboard users can reach the P&C link inside it
  const [pinned, setPinned] = useState(false);
  const justClosed = useRef(false); // focus returning from a pinned dialog must not reopen the hover card
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current); }, []);

  const issues = status?.issues ?? [];
  const problems = issues.filter((i) => i.severity !== "info");
  const infos = issues.filter((i) => i.severity === "info");
  const state = status?.state ?? "ok";
  const titleId = `card-${entry.id}-title`;
  const issuesId = `card-${entry.id}-issues`;
  const detailId = `card-${entry.id}-detail`;
  const where = termLabel(entry.year, entry.period);

  const show = (delay: number) => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(openTimer.current);
    if (delay === 0) setOpen(true);
    else openTimer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = (delay = 120) => {
    if (pinned) return;
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), delay);
  };

  const classes = ["card", state !== "ok" && `card--${state}`, fresh && "card--fresh"].filter(Boolean).join(" ");
  const inPeriod = entry.period;
  return (
    <article
      ref={ref}
      class={classes}
      data-entry-id={entry.id}
      data-code={entry.code}
      data-trace={trace ?? undefined}
      aria-labelledby={titleId}
      aria-describedby={problems.length + infos.length > 0 ? issuesId : undefined}
      tabIndex={0}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        onTrace(entry.code);
        // at phone width the detail is a modal sheet: only a tap opens it
        if (!window.matchMedia("(max-width: 640px)").matches) show(300);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        onTrace(null);
        hide();
      }}
      onFocus={(e) => {
        if (e.target !== e.currentTarget) return;
        onTrace(entry.code);
        if (justClosed.current) { justClosed.current = false; return; }
        // keyboard focus opens the hover card; on phones (sheet mode) and
        // after a mouse click only a tap opens it, so a sheet never ambushes
        if (e.currentTarget.matches(":focus-visible") && !window.matchMedia("(max-width: 640px)").matches) show(0);
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && (ref.current?.contains(next) || document.getElementById(detailId)?.contains(next))) return;
        onTrace(null);
        hide(0);
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a")) return;
        window.clearTimeout(openTimer.current);
        setPinned(!(open && pinned));
        setOpen(!(open && pinned));
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        setOpen(false);
        window.setTimeout(() => { setPinned(true); setOpen(true); }, 0);
      }}
    >
      <div class="card__row1">
        <span class="code card__code" id={titleId}>
          {entry.code}
          <span class="visually-hidden">, {course?.title ?? ""}, {where}</span>
        </span>
        <span class="num card__units" aria-hidden="true">{course?.units ?? 6}u</span>
      </div>
      <p class="card__title" aria-hidden="true">{course?.title ?? "Course details unavailable"}</p>
      {course && course.offered.length > 0 && (
        <div class="card__offer" aria-hidden="true">
          {course.offered.filter((p) => p === "S1" || p === "S2" || p === "SUMMER").map((p) => (
            <span key={p} class={p === inPeriod ? "chip chip--gold" : "chip"}>{p === "SUMMER" ? "Sum" : p}</span>
          ))}
        </div>
      )}
      {(problems.length > 0 || infos.length > 0) && (
        <div class="card__issues" id={issuesId}>
          {problems.length > 0 && (
            <p class={`card__strip card__strip--${problems[0].severity}`}>
              <IssueIcon issue={problems[0]} />
              <span class="card__strip-text">{problems[0].short}</span>
              {problems.length > 1 && <span class="card__more">+{problems.length - 1} more</span>}
              <span class="visually-hidden">{problems.slice(1).map((p) => `. ${p.short}`).join("")}</span>
            </p>
          )}
          {infos.length > 0 && problems.length === 0 && (
            <p class="card__strip card__strip--info">
              <IconInfo size={12} />
              <span class="card__strip-text">{infos[0].short}</span>
            </p>
          )}
        </div>
      )}
      {trace && TRACE_TAG[trace] && <span class={`card__tag card__tag--${trace}`} aria-hidden="true">{TRACE_TAG[trace]}</span>}
      <IconButton
        class="card__remove"
        size="sm"
        tone="danger"
        label={`Remove ${entry.code} from ${where}`}
        icon={<IconX size={14} />}
        onClick={() => onRemove(entry)}
      />
      {course && (
        <Popover
          open={open}
          anchor={ref}
          onClose={() => { if (pinned) justClosed.current = true; setOpen(false); setPinned(false); }}
          role={pinned ? "dialog" : "none"}
          id={detailId}
          initialFocus={pinned ? "first" : "none"}
          returnFocus={pinned ? ref : false}
          placement="bottom-start"
          width={340}
          label={`${entry.code} details`}
          class="detail-popover"
          onPointerEnter={() => window.clearTimeout(closeTimer.current)}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(); }}
        >
          <div class="popover__body">
            <CourseDetail course={course} status={status ?? null} cat={cat} />
          </div>
        </Popover>
      )}
    </article>
  );
}
