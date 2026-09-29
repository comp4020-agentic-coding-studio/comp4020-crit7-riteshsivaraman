// CourseDetail (PLAN.md §4.4): the plain-English body shown in the grid
// card's hover card AND in the graph's side panel (E renders it through
// GraphViewProps.renderDetail). Browser + SSR safe: no environment
// variables, no server imports, no fetches.
import type { ClauseResult, CourseDetailProps, Issue } from "../../lib/contracts";
import { describeRule } from "../../lib/engine/index";
import { inCareer, levelOfCode, type Career } from "../../lib/career";
import { IconCheck, IconError, IconExternal, IconInfo, IconQuestion, IconWarn } from "../ui";

const PERIOD_NAME: Record<string, string> = { S1: "Sem 1", S2: "Sem 2", SUMMER: "Summer", WINTER: "Winter", AUTUMN: "Autumn", SPRING: "Spring" };

export function offeredText(offered: string[]): string {
  return offered.length === 0 ? "No offering listed" : `Offered ${offered.map((p) => PERIOD_NAME[p] ?? p).join(", ")}`;
}

export function IssueIcon({ issue }: { issue: Pick<Issue, "severity"> }) {
  return issue.severity === "error" ? <IconError size={12} /> : issue.severity === "warning" ? <IconWarn size={12} /> : <IconInfo size={12} />;
}

function Clause({ node, top }: { node: ClauseResult; top?: boolean }) {
  const group = node.rule.kind === "AND" || node.rule.kind === "OR";
  const mark =
    node.state === "met" ? (
      <span class="clause__mark clause__mark--met" aria-label="met"><IconCheck size={12} /></span>
    ) : node.state === "unmet" ? (
      <span class="clause__mark clause__mark--unmet" aria-label="missing"><IconError size={12} /></span>
    ) : (
      <span class="clause__mark clause__mark--unknown" aria-label="not checked"><IconQuestion size={12} /></span>
    );
  if (group && node.children) {
    return (
      <li class={top ? "clause clause--top" : "clause"}>
        <span class="clause__row">
          {mark}
          <span class="clause__group">{node.rule.kind === "AND" ? "All of" : "One of"}</span>
        </span>
        <ul class="clause__children">
          {node.children.map((c, i) => <Clause key={i} node={c} />)}
        </ul>
      </li>
    );
  }
  return (
    <li class="clause">
      <span class="clause__row">
        {mark}
        <span class={`clause__text clause__text--${node.state}`}>{node.english}</span>
      </span>
    </li>
  );
}

export function CourseDetail({ course, status, cat, career }: CourseDetailProps & { career?: Career | null }) {
  const placedClash = new Set(status?.issues.flatMap((i) => (i.kind === "INCOMPATIBLE" ? [i.with] : [])) ?? []);
  // the other career's incompatibles are noise; a live clash always shows
  const shownIncompat = course.incompatible.filter((c) => placedClash.has(c) || inCareer(levelOfCode(c), career));
  const problems = status?.issues.filter((i) => i.severity !== "info") ?? [];
  const infos = status?.issues.filter((i) => i.severity === "info") ?? [];
  const showOfficial = course.requisiteText && (course.parseStatus === "partial" || course.parseStatus === "unparsed" || problems.some((i) => i.kind === "UNVERIFIED_REQUISITE" || i.kind === "UNMODELLED"));
  let english: string | null = null;
  if (!status?.clauses && course.rule) {
    try {
      english = describeRule(course.rule, cat);
    } catch {
      english = course.requisiteText;
    }
  }
  return (
    <div class="detail">
      <div class="detail__head">
        <span class="code detail__code">{course.code}</span>
        <span class="detail__title">{course.title}</span>
      </div>
      <p class="detail__meta">
        <span class="num">{course.units} units</span> · {course.level}-level · {offeredText(course.offered)}
        {course.retired && " · No longer in catalogue"}
      </p>

      {problems.length > 0 && (
        <ul class="detail__issues" aria-label="Problems">
          {problems.map((i, n) => (
            <li key={n} class={`detail__issue detail__issue--${i.severity}`}>
              <IssueIcon issue={i} />
              <span>
                <strong>{i.short}</strong>
                {i.kind === "UNVERIFIED_REQUISITE" && <span class="detail__issue-more">{i.detail} The planner can't check this, so confirm it with the official wording.</span>}
                {i.kind === "NOT_OFFERED" && <span class="detail__issue-more">Move it to a semester it runs in.</span>}
                {i.kind === "MISSING_REQUISITE" && <span class="detail__issue-more">Place the missing course in an earlier semester.</span>}
                {i.kind === "INCOMPATIBLE" && <span class="detail__issue-more">You can only count one of these two courses.</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <section class="detail__section">
        <h3 class="detail__label">Requisites</h3>
        {status?.clauses ? (
          <ul class="clauses">
            <Clause node={status.clauses} top />
          </ul>
        ) : english ? (
          <p class="detail__text">{english}</p>
        ) : !course.rule && course.parseStatus !== "unparsed" && course.parseStatus !== "partial" ? (
          <p class="detail__text muted">No prerequisites.</p>
        ) : (
          <p class="detail__text">{course.requisiteText}</p>
        )}
      </section>

      {shownIncompat.length > 0 && (
        <section class="detail__section">
          <h3 class="detail__label">Can't be taken with</h3>
          <div class="detail__chips">
            {shownIncompat.map((c) => (
              <span key={c} class={placedClash.has(c) ? "chip chip--danger" : "chip chip--outline"}>
                {placedClash.has(c) && <IconError size={12} />}
                <span class="code">{c}</span>
                {placedClash.has(c) && <span class="visually-hidden"> (in your plan)</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {infos.length > 0 && (
        <div class="detail__chips">
          {infos.map((i, n) => (
            <span key={n} class="chip chip--info"><IconInfo size={12} />{i.short}</span>
          ))}
        </div>
      )}

      {course.summary && <p class="detail__summary">{course.summary}</p>}

      {showOfficial && (
        <details class="detail__official">
          <summary>Official wording</summary>
          <p>{course.requisiteText}</p>
        </details>
      )}
      <a class="detail__link" href={course.sourceUrl} target="_blank" rel="noopener noreferrer">
        Full description on Programs &amp; Courses <IconExternal size={12} />
        <span class="visually-hidden"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

