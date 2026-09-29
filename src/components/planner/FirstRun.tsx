// FirstRun (PLAN.md §4.4): the empty-plan guide above Year 1. Its id is the
// target of Base.astro's "How it works" link (#how-it-works); once the plan
// has entries the same content opens as a popover from that link.
// Browser + SSR safe: no environment variables.
import { CAREERS, type Career } from "../../lib/career";
import { Button, IconPlus } from "../ui";

export function Guide() {
  return (
    <ol class="guide">
      <li><span class="guide__n" aria-hidden="true">1</span><span><strong>Click any empty slot</strong> and search for a course by code or name.</span></li>
      <li><span class="guide__n" aria-hidden="true">2</span><span><strong>Cards flag problems as you go</strong>: missing prerequisites, clashes, and semesters a course isn't offered in. Red needs fixing; amber means check it.</span></li>
      <li><span class="guide__n" aria-hidden="true">3</span><span><strong>Hover a course</strong> to see what it needs and what it unlocks. Switch to <strong>Graph</strong> to see the whole web.</span></li>
    </ol>
  );
}

/** Entry step: the plan has no career yet. Picking one stores it on the plan
 *  and limits search and placement to that career's courses. */
export function CareerChoice({ onChoose }: { onChoose(c: Career): void }) {
  return (
    <section class="first-run career-choice" aria-labelledby="career-choice-title">
      <h2 class="first-run__title" id="career-choice-title">Are you an undergraduate or a postgraduate student?</h2>
      <p class="career-choice__text">
        Undergraduate plans use 1000 to 4000-level courses; postgraduate plans use 5000-level and above. You can switch later,
        but switching clears your plan.
      </p>
      <div class="first-run__foot">
        {CAREERS.map((c) => (
          <Button key={c.id} variant={c.id === "ug" ? "primary" : "secondary"} onClick={() => onChoose(c.id)}>
            I'm {c.id === "ug" ? "an undergraduate" : "a postgraduate"}
          </Button>
        ))}
      </div>
    </section>
  );
}

export function FirstRun({ onStart, busy, career }: { onStart(): void; busy: boolean; career?: Career | null }) {
  return (
    <section class="first-run" id="how-it-works" aria-labelledby="first-run-title">
      <h2 class="first-run__title" id="first-run-title">Plan your degree one semester at a time.</h2>
      <Guide />
      <div class="first-run__foot">
        <Button variant="primary" icon={<IconPlus size={14} />} onClick={onStart} aria-disabled={busy ? "true" : undefined}>
          Start with {career === "pg" ? "COMP6710" : "COMP1100"} in Year 1, Semester 1
        </Button>
        <span class="muted first-run__saved">Your plan is saved in this browser. No account needed.</span>
      </div>
    </section>
  );
}
