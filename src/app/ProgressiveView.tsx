"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { RecipeFacts } from "../lib/convert-events";
import type { ArtifactCredit } from "../lib/schema/artifact";
import type { CanonicalRecipe } from "../lib/schema/canonical";
import { schedule } from "../lib/scheduler/schedule";
import AdjustPanel, { type AdjustChoices } from "./AdjustPanel";
import {
  BeforeYouStart,
  Credit,
  hasTaskNotes,
  IngredientsCard,
  OverviewCard,
  PrepSection,
  StepsSection,
  storeTipsMode,
  TipsToggle,
  type TipsMode,
} from "./ArtifactViewer";
import { conversionStage, type ConversionState } from "./conversion";
import CookingLine from "./CookingLine";
import { adjustedSections, sectionStates, type PendingChoices, type SectionKey } from "./section-states";
import { PreAdjustMark, ReadyMark, SectionPlaceholder, WorkingNote } from "./SectionStatus";

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "Posted: 12 muffins · 9 ingredients · Prep 15 min · Cook 25 min · Total 40 min". Pure. */
export function factsLine(facts: Pick<RecipeFacts, "servingsText" | "ingredientCount" | "minutes">): string {
  const parts: string[] = [];
  const posted = facts.servingsText?.trim();
  if (posted) parts.push(`Posted: ${/^\d+(\.\d+)?$/.test(posted) ? `serves ${posted}` : posted}`);
  if (facts.ingredientCount !== null && facts.ingredientCount > 0) {
    parts.push(`${facts.ingredientCount} ${facts.ingredientCount === 1 ? "ingredient" : "ingredients"}`);
  }
  const { prep, cook, total } = facts.minutes;
  if (prep !== null) parts.push(`Prep ${formatMinutes(prep)}`);
  if (cook !== null) parts.push(`Cook ${formatMinutes(cook)}`);
  if (total !== null) parts.push(`Total ${formatMinutes(total)}`);
  return parts.join(" · ");
}

/** Allergens found so far as chips. Never says "none": no tags means unknown. */
export function AllergenFacts({ allergens, traces }: { allergens: readonly string[]; traces: readonly string[] }) {
  return (
    <div className="notice allergen-facts" role="note" aria-label="Allergens">
      <p className="label">Allergens</p>
      {allergens.length > 0 ? (
        <div className="allergen-row">
          <strong>Contains:</strong>
          <ul className="chips">
            {allergens.map((a) => (
              <li key={a} className="chip chip-allergen">
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="allergen-row">Allergen information is unknown.</p>
      )}
      {traces.length > 0 ? (
        <div className="allergen-row">
          <strong>May contain:</strong>
          <ul className="chips">
            {traces.map((a) => (
              <li key={a} className="chip chip-allergen chip-trace">
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="allergen-check">This list can miss things. Check labels.</p>
    </div>
  );
}

/**
 * Title, credit, the posted servings, counts and times, and the allergens.
 * `mark` shows beside the title, `status` under the servings line.
 */
export function FactsCard({
  facts,
  recipe,
  mark,
  status,
}: {
  facts: RecipeFacts;
  recipe: CanonicalRecipe | null;
  mark?: ReactNode;
  status?: ReactNode;
}) {
  const line = factsLine(facts);
  const credit: ArtifactCredit = {
    kind: facts.source.kind,
    url: facts.source.url,
    site: facts.source.site,
    author: facts.source.author ?? recipe?.source.author ?? null,
    book: recipe?.source.book ?? null,
    page: recipe?.source.page ?? null,
    license: recipe?.source.license ?? null,
  };
  return (
    <section className="facts progressive-in" aria-label="About this recipe">
      <div className="recipe-head">
        <p className="label">Your Cook Along</p>
        <h2 className="recipe-title">
          {facts.title ?? recipe?.title ?? "Your recipe"}
          {mark}
        </h2>
        {line ? <p className="meta">{line}</p> : null}
        {status}
      </div>
      <Credit credit={credit} />
      <AllergenFacts allergens={facts.allergens} traces={facts.traces} />
    </section>
  );
}

/**
 * The cook along while it is written: the cooking line on top (it sticks to
 * the top of the screen), then every section of the finished page in its
 * order, each coming up, being written (a spinner), checked or ready (see
 * section-states.ts). Steps show as essentials first, with tips one tap
 * away once they exist. Adjustments chosen here wait for the finished cook
 * along (`onQueue`); until they apply, the sections they change say "Before
 * your changes". `requested` is an adjustment asked for before the recipe's
 * servings are known (the /embed address).
 */
export default function ProgressiveView({
  state,
  queued,
  onQueue,
  requested = null,
  adjustNote = null,
}: {
  state: ConversionState;
  queued: AdjustChoices | null;
  onQueue: (choices: AdjustChoices | null) => void;
  requested?: PendingChoices | null;
  /** Set, the adjust panel's Apply button is off with this line (a replay on /simulate). */
  adjustNote?: string | null;
}) {
  const { facts, overview, recipe, timeline } = state;
  // Essentials first; the cook can switch to With tips once tips exist.
  const [tipsMode, setTipsMode] = useState<TipsMode>("essentials");
  const totalMinutes = useMemo(() => {
    if (!timeline) return null;
    try {
      return schedule(timeline).totalMinutes;
    } catch {
      return null;
    }
  }, [timeline]);
  const withTips = timeline ? hasTaskNotes(timeline.tasks) : false;
  const mode: TipsMode = withTips ? tipsMode : "essentials";
  const sections = sectionStates(state);
  const base = recipe?.nativeServings ?? null;
  const changed = new Set<SectionKey>(adjustedSections(queued ?? (base === null ? requested : null), base));
  const before = (key: SectionKey) => (changed.has(key) ? <PreAdjustMark /> : null);
  const placeholder = (key: SectionKey, level: 2 | 3 = 3) => (
    <SectionPlaceholder section={key} state={sections[key]} level={level} mark={before(key)} />
  );

  function chooseTipsMode(next: TipsMode) {
    setTipsMode(next);
    storeTipsMode(next);
  }

  return (
    <article aria-label="Cook Along recipe, being written" className="progressive">
      <CookingLine status={conversionStage(state)} />
      {facts ? (
        <FactsCard facts={facts} recipe={recipe} mark={<ReadyMark />} status={before("facts")} />
      ) : (
        placeholder("facts", 2)
      )}
      {overview ? (
        <div className="progressive-in">
          <OverviewCard overview={overview} mark={<ReadyMark />} />
        </div>
      ) : (
        placeholder("overview")
      )}
      {recipe ? (
        <div className="progressive-in">
          <AdjustPanel
            artifact={null}
            pending={{ servings: recipe.nativeServings, queued, onQueue }}
            disabledNote={adjustNote}
          />
        </div>
      ) : (
        placeholder("adjust", 2)
      )}
      {recipe ? (
        <div className="progressive-in">
          <IngredientsCard ingredients={recipe.ingredients} mark={<ReadyMark />} status={before("ingredients")} />
        </div>
      ) : (
        placeholder("ingredients")
      )}
      {recipe ? (
        <div className="progressive-in" aria-busy={timeline ? undefined : true}>
          <BeforeYouStart
            equipment={recipe.equipment}
            timeline={timeline}
            totalMinutes={totalMinutes}
            mark={timeline ? <ReadyMark /> : null}
            status={sections.before.phase === "working" ? <WorkingNote>{sections.before.note}</WorkingNote> : null}
          />
        </div>
      ) : (
        placeholder("before")
      )}
      {timeline ? (
        <div className="progressive-in progressive-checked" aria-busy="true">
          {withTips ? <TipsToggle mode={tipsMode} onChange={chooseTipsMode} /> : null}
          <PrepSection
            timeline={timeline}
            tipsMode={mode}
            status={
              <>
                <WorkingNote className="progressive-checking">{sections.prep.note}</WorkingNote>
                {before("prep")}
              </>
            }
          />
          <StepsSection
            timeline={timeline}
            tipsMode={mode}
            timers={false}
            status={
              <>
                <WorkingNote className="progressive-checking">{sections.steps.note}</WorkingNote>
                {before("steps")}
              </>
            }
          />
        </div>
      ) : (
        <>
          {placeholder("prep")}
          {placeholder("steps")}
        </>
      )}
      {placeholder("timeline")}
    </article>
  );
}
