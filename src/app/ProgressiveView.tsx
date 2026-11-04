"use client";

import { useMemo, useState } from "react";
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
  readTipsMode,
  StepsSection,
  storeTipsMode,
  TipsToggle,
  type TipsMode,
} from "./ArtifactViewer";
import { conversionStage, type ConversionState } from "./conversion";
import CookingLine from "./CookingLine";

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

/** Title, credit, the posted servings, counts and times, and the allergens. */
export function FactsCard({ facts, recipe }: { facts: RecipeFacts; recipe: CanonicalRecipe | null }) {
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
        <p className="label">Your cook along</p>
        <h2 className="recipe-title">{facts.title ?? recipe?.title ?? "Your recipe"}</h2>
        {line ? <p className="meta">{line}</p> : null}
      </div>
      <Credit credit={credit} />
      <AllergenFacts allergens={facts.allergens} traces={facts.traces} />
    </section>
  );
}

/**
 * The cook along while it is written: the cooking line on top, then each
 * part as soon as it arrives, in the finished page's order. Adjustments
 * chosen here wait for the finished cook along (`onQueue`).
 */
export default function ProgressiveView({
  state,
  queued,
  onQueue,
}: {
  state: ConversionState;
  queued: AdjustChoices | null;
  onQueue: (choices: AdjustChoices | null) => void;
}) {
  const { facts, overview, recipe, timeline } = state;
  const [tipsMode, setTipsMode] = useState<TipsMode>(readTipsMode);
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

  function chooseTipsMode(next: TipsMode) {
    setTipsMode(next);
    storeTipsMode(next);
  }

  return (
    <article aria-label="Cook Along recipe, being written" className="progressive">
      <CookingLine status={conversionStage(state)} />
      {facts ? <FactsCard facts={facts} recipe={recipe} /> : null}
      {overview ? (
        <div className="progressive-in">
          <OverviewCard overview={overview} />
        </div>
      ) : null}
      {recipe ? (
        <div className="progressive-in">
          <AdjustPanel artifact={null} pending={{ servings: recipe.nativeServings, queued, onQueue }} />
          <IngredientsCard ingredients={recipe.ingredients} />
          <BeforeYouStart equipment={recipe.equipment} timeline={timeline} totalMinutes={totalMinutes} />
        </div>
      ) : null}
      {timeline ? (
        <div className="progressive-in">
          {withTips ? <TipsToggle mode={tipsMode} onChange={chooseTipsMode} /> : null}
          <PrepSection timeline={timeline} tipsMode={mode} />
          <StepsSection
            timeline={timeline}
            tipsMode={mode}
            timers={false}
            status={<p className="meta progressive-checking">Checking against the original…</p>}
          />
        </div>
      ) : null}
    </article>
  );
}
