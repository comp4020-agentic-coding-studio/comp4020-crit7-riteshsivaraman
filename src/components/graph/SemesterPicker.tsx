// SemesterPicker (PLAN.md §3.4, §4.4, §4.7): a listbox of the plan's terms
// for the graph's add/move flows. Full terms (and, for a move, the entry's
// own term) are aria-disabled with the reason shown. The consumer's
// onChoose performs the mutation (through D's onAddEntry/onMoveEntry); a
// failed MutationOutcome shows inline and the picker stays open.
// Browser code --- reads no environment variables.

import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ApiError, MutationOutcome, PlanPeriod } from "../../lib/contracts";
import { Popover } from "../ui";
import type { PickerTerm } from "./model";

export interface SemesterPickerProps {
  open: boolean;
  anchor: RefObject<HTMLElement>;
  code: string;
  verb: "Add" | "Move";
  terms: PickerTerm[];
  onChoose(year: number, period: PlanPeriod): Promise<MutationOutcome>;
  onClose(): void;
}

export function errorReason(error: ApiError): string {
  switch (error.error) {
    case "SLOT_TAKEN":
      return "that semester is full.";
    case "ALREADY_PLANNED":
      return "it's already in your plan.";
    case "NOT_FOUND":
      return "it's no longer in your plan.";
    case "UNKNOWN_COURSE":
      return "it isn't in the catalogue.";
    default:
      return error.message || "something went wrong.";
  }
}

export function SemesterPicker(props: SemesterPickerProps) {
  const { terms } = props;
  const listRef = useRef<HTMLUListElement>(null);
  const firstEnabled = Math.max(0, terms.findIndex((t) => !t.disabled));
  const [active, setActive] = useState(firstEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) {
      setActive(firstEnabled);
      setError(null);
      setBusy(false);
    }
  }, [props.open, props.code]);

  const choose = async (t: PickerTerm | undefined) => {
    if (!t || t.disabled || busy) return;
    setBusy(true);
    setError(null);
    const out = await props.onChoose(t.year, t.period);
    setBusy(false);
    if (out.ok) props.onClose();
    else setError(`Couldn't ${props.verb.toLowerCase()} ${props.code}: ${errorReason(out.error)}`);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(terms.length - 1, Math.max(0, i + d)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : terms.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void choose(terms[active]);
    }
  };

  const id = `sp-${props.code}`;
  return (
    <Popover
      open={props.open}
      anchor={props.anchor}
      onClose={() => props.onClose()}
      labelledBy={`${id}-title`}
      initialFocus={listRef}
      width={260}
      class="semester-picker"
    >
      <div class="popover__header">
        <h2 id={`${id}-title`} class="semester-picker__title">
          {props.verb} <span class="code">{props.code}</span> to…
        </h2>
      </div>
      <div class="popover__body">
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-labelledby={`${id}-title`}
          aria-activedescendant={terms[active] ? `${id}-${terms[active].key}` : undefined}
          aria-busy={busy}
          class="semester-picker__list"
          onKeyDown={onKeyDown}
        >
          {terms.map((t, i) => (
            <li
              key={t.key}
              id={`${id}-${t.key}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={t.disabled}
              data-term={t.key}
              class={["semester-picker__option", i === active && "is-active", t.disabled && "is-disabled"].filter(Boolean).join(" ")}
              onPointerEnter={() => setActive(i)}
              onClick={() => void choose(t)}
            >
              <span>{t.label}</span>
              <span class="semester-picker__meta">
                {t.reason === "full" ? "Full" : t.reason === "current" ? "Current" : `${t.free} free`}
              </span>
            </li>
          ))}
        </ul>
        {error && (
          <p class="semester-picker__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Popover>
  );
}
