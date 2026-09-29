// Slot (PLAN.md §4.4): an empty place in a term row. A <button> that opens
// the SearchPopover for its term; picking a course places it here.
// Browser + SSR safe: no environment variables.
import { useRef, useState } from "preact/hooks";
import type { MutationOutcome, PlanPeriod } from "../../lib/contracts";
import { IconPlus } from "../ui";
import { DRAG_ENTRY, errorText, termLabel } from "./api";
import { SearchPopover } from "./SearchPopover";

export interface SlotProps {
  year: number;
  period: PlanPeriod;
  slot: number;
  hint: boolean; // first-run: "Click to add your first course" + one pulse
  onAdd(code: string, year: number, period: PlanPeriod, slot: number): Promise<MutationOutcome>;
  /** a planned course dragged from another slot and dropped here */
  onMove(entryId: number, year: number, period: PlanPeriod, slot: number): Promise<MutationOutcome>;
}

export function Slot({ year, period, slot, hint, onAdd, onMove }: SlotProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => !!e.dataTransfer?.types.includes(DRAG_ENTRY);
  const term = { year, period };

  const pick = async (code: string) => {
    setBusy(true);
    setMessage(`Adding ${code}…`);
    const out = await onAdd(code, year, period, slot);
    setBusy(false);
    if (out.ok) {
      setMessage(null);
      setOpen(false); // Planner moves focus to the new card
    } else {
      setMessage(errorText("add", code, out.error));
    }
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        class={["slot", hint && "slot--hint", over && "slot--drop"].filter(Boolean).join(" ")}
        data-slot={`${year}-${period}-${slot}`}
        aria-label={`Add course to ${termLabel(year, period)}, slot ${slot + 1}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setMessage(null); setOpen((o) => !o); }}
        onDragOver={(e) => {
          if (!accepts(e)) return;
          e.preventDefault(); // marks this slot as a drop target
          e.dataTransfer!.dropEffect = "move";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const id = Number(e.dataTransfer?.getData(DRAG_ENTRY));
          if (!accepts(e) || !Number.isInteger(id) || id <= 0) return;
          e.preventDefault();
          void onMove(id, year, period, slot);
        }}
      >
        <IconPlus size={14} />
        <span>{hint ? "Click to add your first course" : "Add course"}</span>
      </button>
      <SearchPopover
        open={open}
        anchor={ref}
        term={term}
        busy={busy}
        message={message}
        onPick={pick}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
