"use client";

// Ported from the TextSous app (SOUS AI LLC) on Nov 4, 2026 at the owner's direction.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";
import {
  ArrowRight, CheckCircle2, ChefHat, ChevronDown, ChevronRight, Clock3,
  CookingPot, Download, Flame, Hand, Leaf, NotebookPen, Pause, Play, RectangleHorizontal, RotateCcw, ScrollText, Sparkles, Utensils,
} from "lucide-react";

import { CompactCookingTimeline } from "./compact-cooking-timeline";
import { CookingStepTimer } from "./cooking-step-timer";
import { InstructionDetailControl, InstructionText, InstructionExtras, useInstructionDetailPreference } from "./instruction-detail";
import type { InstructionDetail } from "./instruction-preference";
import type { InstructionPart } from "@/lib/cooking-pilot/instruction-display";
import { buildTimelineGeometry } from "@/lib/cooking-pilot/timeline-layout";
import { useCookingWakeLock } from "@/lib/cooking-pilot/use-cooking-wake-lock";
import { applySavedTimingPreferences, parseTimingPreferences, serializeTimingPreferences, timingPreferenceContext, timingPreferencesStorageKey } from "@/lib/cooking-pilot/timing-preferences";
import type { CookingMealAttribute } from "@/lib/cooking-pilot/meal-attributes";
import { cookingDisplayText } from "@/lib/cooking-pilot/display-text";
import { equipmentDisplayItems } from "@/lib/cooking-pilot/equipment-display";
import { presentCookingPlan } from "@/lib/cooking-pilot/plan-presentation";
import { buildCookingPlan, MAX_TASK_MINUTES, timingAdjustmentsMatchMethod, type CookingPlan, type CookingTimelineDefinition, type CookingScheduledTask } from "@/lib/cooking-pilot/plan";
import {
  buildTaskTimerPresets, createTaskTimelineSession, exportTimelineSession, parseStoredTaskTimelineSession, reduceTimelineSession,
  readLaneTimer, readTaskTimer, readTimeline, timelineSessionStorageKey, hasRunningTimelineTimers, legacyLaneTimerIds, syncTaskTimerPresets, shouldShowTaskTimer,
  type TimelineSession, type TimelineSessionAction,
} from "@/lib/cooking-pilot/timeline-session";
import { getZonedParts, wallTimeToUtc, zonedTimeFormatter } from "@/lib/timezone";
import styles from "./cooking-pilot.module.css";
import timingStyles from "./timing-adjustments.module.css";

export interface CookingPilotRecipe {
  id?: string;
  effectiveIdentity?: string;
  methodServings?: number;
  originalMethod?: { servings: number; steps: { kind: string; text: string }[] };
  methodLabel?: string;
  methodNotice?: string;
  title: string;
  servings: number;
  sourceFingerprint: string;
  ingredients: { name: string; quantity: string; unit: string; note?: string | null }[];
  equipment: string[];
  steps: { kind: string; text: string; instructionParts?: InstructionPart[] }[];
  allergens: string[];
  allergenTraces: string[];
}

type Tab = "overview" | "timeline" | "recipe";
type WithoutTime<T> = T extends unknown ? Omit<T, "nowMs"> : never;
const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Read this First" }, { id: "timeline", label: "Cook Along" },
  { id: "recipe", label: "Recipe" },
];
const minuteLabel = (minutes: number) => `${Math.round(minutes * 10) / 10} min`;
const durationLabel = (task: CookingScheduledTask) => `${task.timingBasis === "estimate" ? "~" : ""}${task.range
  ? task.range.min === task.range.max ? minuteLabel(task.range.min) : `${task.range.min}–${task.range.max} min`
  : minuteLabel(task.minutes)}`;
const clockLabel = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60).toString().padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
};
const MINUTE_HEIGHT = 60;
const PHASE_HEADING_HEIGHT = 36;
const phaseLabels: Record<string, string> = { prep: "Mise en Place", cook: "Cooking", plate: "Finish & serve", finish: "Finish & serve" };
const phaseLabel = (id: string, fallback?: string) => phaseLabels[id] ?? fallback ?? id;

/** Phase headings occupy display space, never cooking time. The scheduler
 * guarantees that no task crosses one of these explicit stage boundaries. */
export function timelineGridLayout(plan: Pick<CookingPlan, "phaseSpans" | "totalMinutes"> & Partial<Pick<CookingPlan, "tasks">>) {
  const geometry = plan.tasks?.length ? buildTimelineGeometry({ tasks: plan.tasks, totalMinutes: plan.totalMinutes }, {
    minimumTaskHeight: Object.fromEntries(plan.tasks.map(task => [task.id, Math.max(250, 180 + Math.ceil(task.label.length / 16) * 20)])),
    baselinePixelsPerMinute: 12,
  }) : null;
  const timePosition = (minute: number) => geometry?.position(minute) ?? minute * MINUTE_HEIGHT;
  const boundaries = plan.phaseSpans.map(span => span.startMinute);
  const before = (minute: number) => boundaries.filter(start => start < minute).length;
  const through = (minute: number) => boundaries.filter(start => start <= minute).length;
  const rows: string[] = [];
  for (let minute = 0; minute < plan.totalMinutes + 2; minute++) {
    if (boundaries.includes(minute)) rows.push(`${PHASE_HEADING_HEIGHT}px`);
    rows.push(`${timePosition(minute + 1) - timePosition(minute)}px`);
  }
  return {
    rows: rows.join(" "),
    startRow: (minute: number) => minute + 1 + through(minute),
    endRow: (minute: number) => minute + 1 + before(minute),
    headingRow: (minute: number) => minute + 1 + before(minute),
    position: (minute: number) => timePosition(minute) + through(minute) * PHASE_HEADING_HEIGHT,
  };
}

function servingInstant(value: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !timezone) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const instant = wallTimeToUtc(year, month, day, hour, minute, 0, timezone);
  const actual = getZonedParts(timezone, instant);
  // A nonexistent local time (for example at a DST change) is not silently moved.
  return actual.year === year && actual.month === month && actual.day === day
    && actual.hour === hour && actual.minute === minute ? instant.getTime() : null;
}

function LaneChips({ ids, lanes }: { ids: readonly string[]; lanes: CookingTimelineDefinition["lanes"] }) {
  return <div className={styles.laneChips}>{ids.map(id => <span key={id}>
    <i style={{ background: lanes.find(lane => lane.id === id)?.color ?? "#587454" }} />
    {lanes.find(lane => lane.id === id)?.label ?? id}
  </span>)}</div>;
}

/** Summarize an explicit cooking task; unknown techniques retain its own label. */
function cookingMethod(task: CookingScheduledTask | undefined): string | null {
  if (!task) return null;
  const label = task.label.toLowerCase();
  if (/roast/.test(label)) return "Oven-roasted";
  if (/bake/.test(label)) return "Baked";
  if (/steam/.test(label)) return "Steamed";
  if (/sear/.test(label)) return "Pan-seared";
  if (/stir.?fry/.test(label)) return "Stir-fried";
  if (/pan.?fry|sauté|saute/.test(label)) return "Pan-fried";
  if (/simmer/.test(label)) return "Simmered";
  if (/boil/.test(label)) return "Boiled";
  if (/grill/.test(label)) return "Grilled";
  if (/melt/.test(label)) return /oven/.test(task.description.toLowerCase()) || task.scheduling.resourceIds.includes("oven") ? "Melted in the oven" : "Melted";
  return task.label;
}

function EquipmentIcon({ name }: { name: string }) {
  const Icon = /oven/i.test(name) ? Flame : /bowl|pot/i.test(name) ? CookingPot
    : /pan|board|tray/i.test(name) ? RectangleHorizontal : /towel|paper/i.test(name) ? ScrollText
    : /protection|landing|mitt/i.test(name) ? Hand : /zest|grater/i.test(name) ? Sparkles : Utensils;
  return <Icon size={17} aria-hidden="true" />;
}

function MealAttributes({ attributes = [], recipe, minutes }: {
  attributes?: readonly CookingMealAttribute[]; recipe: CookingPilotRecipe; minutes?: number;
}) {
  return <div className={styles.mealAttributes} aria-label="Meal attributes">
    {attributes.map(attribute => attribute.detail ? <details key={attribute.label} className={styles.attributeDetail}>
      <summary><Leaf size={13} aria-hidden="true" />{attribute.label}<ChevronDown size={12} aria-hidden="true" /></summary><p>{attribute.detail}</p>
    </details> : <span key={attribute.label}><Leaf size={13} aria-hidden="true" />{attribute.label}</span>)}
    {minutes !== undefined && minutes < 60 && <span><Clock3 size={13} aria-hidden="true" />Under 1 hour</span>}
    {recipe.allergens.length > 0 && <span>Contains {recipe.allergens.join(", ")}</span>}
    {recipe.allergenTraces.length > 0 && <details className={styles.attributeDetail}><summary>Check package labels<ChevronDown size={12} aria-hidden="true" /></summary><p>Check labels for possible {recipe.allergenTraces.join(", ")}.</p></details>}
  </div>;
}

function KitchenBrief({ recipe, plan }: { recipe: CookingPilotRecipe; plan?: CookingPlan }) {
  const equipment = equipmentDisplayItems(recipe.equipment);
  const components = plan?.lanes.filter(lane => lane.kind === "component").map(lane => {
    const cooking = plan.tasks.filter(task => !task.optional && task.phase === "cook" && task.laneIds.includes(lane.id));
    const technique = cooking.find(task => cookingMethod(task) !== task.label);
    return { ...lane, method: cookingMethod(technique ?? cooking.find(task => task.attention === "unattended") ?? cooking[0]) };
  });
  return <div className={styles.kitchenBrief}>
    {equipment.length > 0 && <section className={styles.briefEquipment} aria-label="Kitchen equipment">
      <h3><span aria-hidden="true">🍳</span> Your equipment</h3>
      <ul>{equipment.map((item, index) => <li key={index}><EquipmentIcon name={item} /><span>{cookingDisplayText(item)}</span></li>)}</ul>
    </section>}
    {Boolean(components?.length) && <section aria-label="Meal components">
      <h3>What you’re cooking</h3>
      <div className={styles.componentBriefs}>{components?.map(component => <div className={styles.componentBrief} key={component.id}>
        <i style={{ background: component.color }} aria-hidden="true" /><div><h4>{component.label}</h4>{component.method && <p>{component.method}</p>}</div>
      </div>)}</div>
    </section>}
    <div className={styles.prepBrief}><ChefHat size={22} aria-hidden="true" /><div><h3>Mise en Place</h3><p>Everything in its place: ingredients gathered, measured and prepared, with your tools within reach. {plan?.phaseSpans.some(span => span.phaseId === "prep") && "Cook Along groups those prep steps before cooking begins."}</p></div></div>
  </div>;
}

function Ingredients({ recipe, preview, controls, footer }: { recipe: CookingPilotRecipe; preview?: CookingPilotProps["ingredientsPreview"]; controls?: ReactNode; footer?: ReactNode }) {
  const ingredients = preview?.ingredients ?? recipe.ingredients;
  const allergens = preview?.allergens ?? recipe.allergens;
  const allergenTraces = preview?.allergenTraces ?? recipe.allergenTraces;
  return <>
    <div className={styles.cardHeading}><span className={styles.sectionEmoji} aria-hidden="true">🥬</span><h3>{preview ? `Ingredients for ${preview.servings} servings` : "What you’ll need"}</h3><span>{preview ? "Requested amounts · plan update pending" : `${recipe.servings} servings`}</span></div>
    {controls && <div className={styles.ingredientControls}>{controls}</div>}
    {preview && <p className={styles.ingredientPreviewNotice}>{preview.label
      ? <>Requested ingredients · {preview.label}. The method and timeline below still describe the applied recipe. Update the cooking plan before using this selection.</>
      : <>The current method and timeline are still for {recipe.servings} servings. Apply the rebuilt plan before using these amounts.</>}</p>}
    <ul className={styles.ingredients}>{ingredients.map((ingredient, index) => <li key={`${ingredient.name}-${index}`}>
      <span>{ingredient.name}{ingredient.note && <small>{ingredient.note}</small>}</span>
      <strong>{[ingredient.quantity, ingredient.unit].filter(Boolean).join(" ") || "to taste"}</strong>
    </li>)}</ul>
    {(allergens.length > 0 || allergenTraces.length > 0) && <p className={styles.allergens}>
      {allergens.length > 0 && <>Contains {allergens.join(", ")}. </>}
      {allergenTraces.length > 0 && <>Check labels for possible {allergenTraces.join(", ")}.</>}
    </p>}
    {!preview && footer && <div className={styles.ingredientsFootnote}>{footer}</div>}
  </>;
}

function RecipeMetadata({ servings, actions }: { servings: number; actions?: ReactNode }) {
  return <div className={`${styles.eyebrow} ${styles.recipeMetadata}`}>
    <span><span aria-hidden="true">🍽️</span> At your table</span>
    <span className={styles.metadataItem}>{servings} servings</span>
    {actions && <div className={styles.metadataItem}>{actions}</div>}
  </div>;
}

export interface CookingPilotProps {
  /** Inside another page that already shows the title, credit and allergens:
   * no masthead, title block or footer, and no full-height page. */
  embedded?: boolean;
  mealAttributes?: readonly CookingMealAttribute[];
  recipe: CookingPilotRecipe;
  timelineDefinition?: CookingTimelineDefinition;
  controls?: ReactNode;
  ingredientsControls?: ReactNode;
  metadataActions?: ReactNode;
  ingredientsFooter?: ReactNode;
  dietaryControls?: ReactNode;
  headerActions?: ReactNode;
  footerContent?: ReactNode;
  recipeNotice?: ReactNode;
  timelinePending?: boolean;
  timelineNotice?: ReactNode;
  timingPreferences?: {
    status: "loading" | "ready" | "unavailable";
    overrides: Record<string, number>;
    storageScope?: string;
    persistenceLabel: string;
    save: (overrides: Record<string, number>) => Promise<void>;
  };
  ingredientsPreview?: {
    servings: number; ingredients: CookingPilotRecipe["ingredients"];
    label?: string; allergens?: string[]; allergenTraces?: string[];
  };
  /** Client-wrapper callback; never pass a callback across the server boundary. */
  onTimelineActivityChange?: (activity: TimelineActivity) => void;
}

export interface TimelineActivity {
  hasStarted: boolean;
  isRunning: boolean;
  hasRunningTimers: boolean;
  isReady: boolean;
}

interface CookingViewState {
  tab: Tab;
  setTab: (tab: Tab) => void;
  serveInput: string;
  setServeInput: Dispatch<SetStateAction<string>>;
  detailLevel: InstructionDetail;
  changeDetailLevel: (value: InstructionDetail) => void;
}

export function CookingPilot(props: CookingPilotProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const [serveInput, setServeInput] = useState("");
  const { detailLevel, changeDetailLevel } = useInstructionDetailPreference();
  const definition = props.timelineDefinition;
  // Recipe changes must never inherit a schedule for another yield or variant.
  // A display-preference change does not rebuild or rebind the cooking plan.
  const supported = useMemo(() => {
    if (!definition || definition.sourceFingerprint !== props.recipe.sourceFingerprint
      || definition.servings !== props.recipe.servings || definition.effectiveIdentity !== props.recipe.effectiveIdentity
      || !timingAdjustmentsMatchMethod(definition, props.recipe.steps)) return false;
    try { buildCookingPlan(definition); return true; } catch { return false; }
  }, [definition, props.recipe.sourceFingerprint, props.recipe.servings, props.recipe.effectiveIdentity, props.recipe.steps]);
  return supported && definition
    ? <ScheduledCookingRecipe {...props} tab={tab} setTab={setTab} serveInput={serveInput} setServeInput={setServeInput} timelineDefinition={definition}
        detailLevel={detailLevel} changeDetailLevel={changeDetailLevel}
        key={`${props.recipe.id ?? "recipe"}:${props.recipe.sourceFingerprint}:${definition.id}:${definition.revision}:${props.recipe.servings}`} />
    : <UntimedCookingRecipe {...props} tab={tab} setTab={setTab} serveInput={serveInput} setServeInput={setServeInput} detailLevel={detailLevel} changeDetailLevel={changeDetailLevel} />;
}

function ScheduledCookingRecipe({ embedded = false, recipe, mealAttributes, timelineDefinition: definition, controls, ingredientsControls, ingredientsFooter, metadataActions, dietaryControls, headerActions, footerContent, recipeNotice,
  timelinePending = false, timelineNotice, timingPreferences, ingredientsPreview, onTimelineActivityChange, tab, setTab, serveInput, setServeInput, detailLevel, changeDetailLevel }:
  CookingPilotProps & CookingViewState & { timelineDefinition: CookingTimelineDefinition }) {
  const viewsRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const laneHeaderRef = useRef<HTMLDivElement>(null);
  const guideDockRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<TimelineSession | null>(null);
  const sessionRef = useRef<TimelineSession | null>(null);
  const persistedRaw = useRef<string | null>(null);
  const writesBlocked = useRef(false);
  const [now, setNow] = useState(0);
  const [timezone, setTimezone] = useState("");
  const [targetRestored, setTargetRestored] = useState(false);
  const [message, setMessage] = useState("");
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [storageConflict, setStorageConflict] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [preferenceSaveFailed, setPreferenceSaveFailed] = useState(false);
  const preferenceSaveBusy = useRef(false);
  const preferencesRef = useRef(timingPreferences);
  useEffect(() => { preferencesRef.current = timingPreferences; }, [timingPreferences]);
  const rememberedOverrides = useRef<Record<string, number>>({});
  const preferencesReady = !timingPreferences || (timingPreferences.status === "ready" && Boolean(timingPreferences.storageScope));
  const preferenceContext = useMemo(() => timingPreferenceContext(recipe.id ?? definition.id, recipe.sourceFingerprint, definition), [recipe.id, recipe.sourceFingerprint, definition]);
  const preferenceKey = timingPreferencesStorageKey(preferenceContext);
  const adjustmentsRef = useRef<HTMLDetailsElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileView, setMobileView] = useState<"compact" | "lanes">("compact");
  const compactLayout = isNarrow && mobileView === "compact";
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [detailPosition, setDetailPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const identity = useMemo(() => ({ sourceIdentity: recipe.sourceFingerprint, planIdentity: definition.revision }), [recipe.sourceFingerprint, definition.revision]);
  const storageKey = timelineSessionStorageKey(recipe.id ?? definition.id) + (timingPreferences ? `:user:${timingPreferences.storageScope ?? "pending"}` : "");
  const laneIds = useMemo(() => definition.lanes.map(lane => lane.id), [definition]);
  const plan = useMemo(() => presentCookingPlan(buildCookingPlan(definition, session?.timingOverrides ?? {}), definition), [definition, session?.timingOverrides]);
  const grid = useMemo(() => timelineGridLayout(plan), [plan]);
  const timerPresets = useMemo(() => buildTaskTimerPresets(plan), [plan]);
  const initialTimerPresets = useMemo(() => buildTaskTimerPresets(buildCookingPlan(definition)), [definition]);
  const serveAt = servingInstant(serveInput, timezone);
  const startAt = serveAt === null ? null : serveAt - plan.serveMinute * 60_000;
  const guidance = session ? readTimeline(session, now, plan.serveMinute) : null;
  const axisAnchor = guidance?.hasStarted ? guidance.effectiveAnchorMs : startAt;
  const canRecord = Boolean(session && !needsRecovery && !storageConflict && preferencesReady);
  const detailTask = plan.tasks.find(task => task.id === selectedTask);
  const guideMinutes = (guidance?.elapsedMs ?? 0) / 60_000;
  const pastPlan = Boolean(guidance?.hasStarted && guideMinutes >= plan.serveMinute);
  const hasRunningTimers = Boolean(session && hasRunningTimelineTimers(session));
  const earlierTimerIds = session ? legacyLaneTimerIds(session) : [];
  const hasStarted = Boolean(session && session.guidance.startedAtMs !== null);
  const isRunning = Boolean(session && session.guidance.runningSinceMs !== null);
  const wakeLock = useCookingWakeLock(tab === "timeline" && hasStarted && canRecord);
  const markedTimings = definition.tasks.filter(task => task.timingAdjustment);
  const adjustedRecipe = useMemo(() => {
    const adjusted = plan.tasks.filter(task => task.timingAdjustment && task.adjustedFromMinutes !== undefined);
    if (!adjusted.length) return recipe;
    // Replace only exact known method text; never guess at instructions in
    // an unfamiliar artifact. The original method stays intact below.
    const replacements = new Map(adjusted.map(task => [definition.tasks.find(original => original.id === task.id)!.description, task.description]));
    return { ...recipe, steps: recipe.steps.map(step => ({ ...step, text: replacements.get(step.text) ?? step.text })) };
  }, [recipe, plan, definition]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => { setIsNarrow(media.matches); setSelectedTask(null); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    onTimelineActivityChange?.({
      hasStarted, isRunning, hasRunningTimers, isReady: canRecord,
    });
  }, [onTimelineActivityChange, hasStarted, isRunning, hasRunningTimers, canRecord]);

  function switchTab(next: Tab) {
    setSelectedTask(null);
    setTab(next);
    window.requestAnimationFrame(() => viewsRef.current?.scrollIntoView({ behavior: "auto", block: "start" }));
  }

  useEffect(() => {
    if (!preferencesReady) return;
    const load = window.setTimeout(() => {
      const time = Date.now();
      setNow(time);
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      let restored: ReturnType<typeof parseStoredTaskTimelineSession> = { status: "empty", session: null };
      try {
        // The original manual cooking log is deliberately left at its v1 key.
        persistedRaw.current = window.localStorage.getItem(storageKey);
        restored = parseStoredTaskTimelineSession(persistedRaw.current, identity, definition.tasks, laneIds, initialTimerPresets);
        if (restored.status === "restored") {
          try { buildCookingPlan(definition, restored.session.timingOverrides); }
          catch { restored = { status: "invalid", session: null }; }
        }
        const savedTarget = window.localStorage.getItem(`${storageKey}:target`);
        if (savedTarget && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(savedTarget)) setServeInput(current => current || savedTarget);
      } catch { setStorageUnavailable(true); }
      setTargetRestored(true);
      let current = restored.session ?? createTaskTimelineSession(identity, time,
        globalThis.crypto?.randomUUID?.() ?? `timeline-${time}-${Math.random().toString(36).slice(2, 10)}`, definition.tasks, laneIds, initialTimerPresets);
      try {
        const preferences = preferencesRef.current;
        if (preferences) rememberedOverrides.current = preferences.overrides;
        else {
          const saved = parseTimingPreferences(window.localStorage.getItem(preferenceKey), preferenceContext, definition);
          rememberedOverrides.current = saved.status === "ready" ? saved.overrides : {};
          if (!["ready", "empty"].includes(saved.status)) setPreferenceMessage("Your saved timing preferences need reviewing. Recipe defaults are available below.");
        }
        const applied = applySavedTimingPreferences(current, rememberedOverrides.current, definition);
        current = applied.session;
        if (["invalid", "infeasible"].includes(applied.status)) setPreferenceMessage("Your saved timings no longer fit this plan. Review the times below.");
      } catch { setPreferenceMessage("Saved timings could not be loaded. You can adjust this cook below."); }
      sessionRef.current = current;
      setSession(current);
      if (restored.status === "restored" && current.guidance.startedAtMs !== null) {
        setMessage("Your timeline is restored. Running timers include time away from this page.");
        setTab("timeline");
      } else if (restored.status === "invalid" || restored.status === "stale") {
        writesBlocked.current = true;
        setNeedsRecovery(true);
        setMessage("This saved timeline no longer matches the recipe. Start a new guide when you’re ready.");
      }
    }, 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    const storageChanged = (event: StorageEvent) => {
      if ((event.key !== storageKey && event.key !== null) || event.newValue === persistedRaw.current) return;
      writesBlocked.current = true;
      setStorageConflict(true);
      setMessage("This timeline changed in another tab. Reload here to keep the same timers and notes.");
    };
    const refreshClock = () => setNow(Date.now());
    const onVisibility = () => { if (document.visibilityState === "visible") refreshClock(); };
    window.addEventListener("storage", storageChanged);
    window.addEventListener("pageshow", refreshClock);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(load); window.clearInterval(interval);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("pageshow", refreshClock);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [identity, storageKey, definition, laneIds, initialTimerPresets, setTab, setServeInput, preferencesReady, preferenceKey, preferenceContext]);

  useEffect(() => {
    if (!targetRestored) return;
    // Carry the shared dinner target into a newly applied profile, after giving
    // that profile's saved target a chance to fill an otherwise empty field.
    const persist = window.setTimeout(() => {
      try { window.localStorage.setItem(`${storageKey}:target`, serveInput); }
      catch { setStorageUnavailable(true); }
    }, 0);
    return () => window.clearTimeout(persist);
  }, [targetRestored, storageKey, serveInput]);

  useEffect(() => {
    const header = laneHeaderRef.current;
    const chart = chartRef.current;
    if (tab !== "timeline" || !header || !chart) return;
    // Long cooking intervals keep their instructions below the component headings.
    const measure = () => chart.style.setProperty("--lane-header-height", `${header.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [tab, compactLayout]);

  const closeDetail = useCallback((restoreFocus = false) => {
    setSelectedTask(null);
    setDetailPosition(null);
    if (restoreFocus) detailTrigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!selectedTask || tab !== "timeline") return;
    const position = () => {
      let anchor = detailTrigger.current?.getBoundingClientRect();
      const bounds = chartRef.current?.getBoundingClientRect();
      const header = laneHeaderRef.current?.getBoundingClientRect();
      if (!anchor || !bounds || !header) return;
      const visibleTop = Math.max(header.bottom, guideDockRef.current?.getBoundingClientRect().bottom ?? 0, 0);
      const visibleBottom = Math.min(bounds.bottom, window.innerHeight);
      if (anchor.bottom <= visibleTop || anchor.top >= visibleBottom) {
        // A long card's sticky text can leave the viewport before the card
        // ends. Its visible blank space is still a valid details target.
        const card = detailTrigger.current?.closest("[data-task-id]")?.getBoundingClientRect();
        if (card && card.bottom > visibleTop && card.top < visibleBottom) anchor = card;
      }
      if (anchor.bottom <= visibleTop || anchor.top >= visibleBottom
        || anchor.right <= bounds.left || anchor.left >= Math.min(bounds.right, window.innerWidth)) {
        closeDetail();
        return;
      }
      const width = Math.min(340, window.innerWidth - 24);
      const height = Math.min(detailRef.current?.offsetHeight ?? 360, window.innerHeight * 0.7);
      const rightRoom = window.innerWidth - anchor.right;
      const leftRoom = anchor.left;
      let left: number;
      let top: number;
      if (rightRoom >= width + 20) {
        left = anchor.right + 10;
        top = Math.max(anchor.top, visibleTop + 8);
      } else if (leftRoom >= width + 20) {
        left = anchor.left - width - 10;
        top = Math.max(anchor.top, visibleTop + 8);
      } else {
        left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
        // On narrow screens open just below the visible part of the card.
        top = Math.min(anchor.bottom, Math.max(anchor.top, visibleTop) + 54) + 8;
      }
      top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
      setDetailPosition({ top, left, width });
    };
    const frame = window.requestAnimationFrame(() => { position(); detailRef.current?.focus({ preventScroll: true }); });
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") closeDetail(true); };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !detailRef.current?.contains(event.target) && !detailTrigger.current?.contains(event.target)) closeDetail();
    };
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    // Optional explanations can expand an open detail sheet. Keep its bottom
    // inside the viewport without moving the task or touching cooking clocks.
    const detailResize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    if (detailRef.current) detailResize?.observe(detailRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      detailResize?.disconnect();
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [selectedTask, tab, closeDetail]);

  const save = useCallback((next: TimelineSession) => {
    if (writesBlocked.current) return false;
    try {
      if (window.localStorage.getItem(storageKey) !== persistedRaw.current) {
        writesBlocked.current = true;
        setStorageConflict(true);
        setMessage("This timeline changed in another tab. Reload here to keep the same timers and notes.");
        return false;
      }
      const raw = JSON.stringify(next);
      window.localStorage.setItem(storageKey, raw);
      persistedRaw.current = raw;
    } catch { setStorageUnavailable(true); }
    sessionRef.current = next;
    setSession(next);
    return true;
  }, [storageKey]);

  const rememberTiming = useCallback(async (overrides: Record<string, number>) => {
    if (preferenceSaveBusy.current) return;
    preferenceSaveBusy.current = true;
    setPreferenceSaving(true);
    setPreferenceSaveFailed(false);
    rememberedOverrides.current = overrides;
    try {
      if (preferencesRef.current) await preferencesRef.current.save(overrides);
      else window.localStorage.setItem(preferenceKey, serializeTimingPreferences(overrides, preferenceContext, definition));
      setPreferenceMessage(preferencesRef.current ? "Your timings are saved to your account for this recipe and setup." : "Your timings are saved in this browser for this recipe and setup.");
    } catch (error) {
      setPreferenceSaveFailed(true);
      setPreferenceMessage(`This cook uses your new times, but they could not be saved for next time. ${preferencesRef.current && error instanceof Error ? error.message : "Try saving again."}`);
    } finally { preferenceSaveBusy.current = false; setPreferenceSaving(false); }
  }, [preferenceKey, preferenceContext, definition]);

  const act = useCallback((action: WithoutTime<TimelineSessionAction>) => {
    const current = sessionRef.current;
    if (!current || writesBlocked.current || !preferencesReady) return;
    if (timelinePending && (action.type === "guidance-start" || action.type === "override")) return;
    if (action.type === "override" && preferenceSaveBusy.current) return;
    const time = Date.now();
    const result = reduceTimelineSession(current, { ...action, nowMs: time } as TimelineSessionAction, definition.tasks, laneIds);
    if (!result.ok) { setMessage(result.error); return; }
    // A valid estimate can still make the full constraint graph infeasible.
    // Keep the prior plan/session intact if the shared scheduler refuses it.
    let next = result.session;
    try {
      const nextPlan = buildCookingPlan(definition, next.timingOverrides);
      if (action.type === "override") next = syncTaskTimerPresets(next, buildTaskTimerPresets(nextPlan), definition.tasks, laneIds);
    } catch { setMessage("That timing cannot fit this cooking plan. Try a smaller change."); return; }
    setMessage("");
    setNow(time);
    const saved = save(next);
    if (saved && action.type === "override") void rememberTiming(next.timingOverrides);
    if (action.type === "guidance-start") chartRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [save, definition, laneIds, timelinePending, preferencesReady, rememberTiming]);

  function setTarget(value: string) {
    setServeInput(value);
    try { window.localStorage.setItem(`${storageKey}:target`, value); }
    catch { setStorageUnavailable(true); }
  }

  const reset = useCallback(() => {
    if (!window.confirm("Start a fresh timeline? This resets its guide, step timers and notes on this device. Save any notes you want to keep first.")) return;
    const time = Date.now();
    try { persistedRaw.current = window.localStorage.getItem(storageKey); } catch { setStorageUnavailable(true); }
    writesBlocked.current = false;
    setStorageConflict(false);
    setNeedsRecovery(false);
    const fresh = createTaskTimelineSession(identity, time,
      globalThis.crypto?.randomUUID?.() ?? `timeline-${time}-${Math.random().toString(36).slice(2, 10)}`, definition.tasks, laneIds, initialTimerPresets);
    save(applySavedTimingPreferences(fresh, rememberedOverrides.current, definition).session);
    setNow(time);
    closeDetail();
    setMessage("Fresh timeline ready. Your timing preferences and serving target are kept.");
  }, [save, identity, storageKey, closeDetail, definition, laneIds, initialTimerPresets]);

  const download = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const data = JSON.parse(exportTimelineSession(current, Date.now(), definition.tasks, laneIds));
    const result = { ...data, recipeTitle: recipe.title, servings: recipe.servings,
      servingTarget: serveAt === null ? null : { at: new Date(serveAt).toISOString(), timezone },
      plannedTasks: plan.tasks.map(task => ({ id: task.id, label: task.label, minutes: task.minutes,
        startMinute: task.startMinute, endMinute: task.endMinute, phase: task.phase, timingBasis: task.timingBasis })),
    };
    const content = needsRecovery && persistedRaw.current !== null ? persistedRaw.current : JSON.stringify(result, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = needsRecovery ? "sous-saved-timeline.json" : `sous-timeline-${current.sessionId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, [needsRecovery, plan, recipe.title, recipe.servings, serveAt, timezone, definition.tasks, laneIds]);

  function axisTime(minute: number) {
    if (axisAnchor === null || !timezone) return `${minute}′`;
    const instant = new Date(axisAnchor + minute * 60_000);
    return Number.isFinite(instant.getTime()) ? zonedTimeFormatter(timezone).format(instant) : `${minute}′`;
  }

  function showNow() {
    const chart = chartRef.current;
    if (!chart) return;
    if (compactLayout) {
      const target = chart.querySelector<HTMLElement>('[data-guide-line]')
        ?? chart.querySelector<HTMLElement>('[data-guide-current="true"]')
        ?? Array.from(chart.querySelectorAll<HTMLElement>('[data-task-id]')).find(element => Number(element.dataset.startMinute) >= guideMinutes)
        ?? chart.querySelector<HTMLElement>('[data-serving-estimate]');
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    chart.scrollTo({ top: Math.max(0, grid.position(Math.min(guideMinutes, plan.totalMinutes + 1)) - 90), behavior: "smooth" });
  }

  function selectTask(taskId: string, trigger: HTMLButtonElement) {
    if (selectedTask === taskId) { closeDetail(); return; }
    detailTrigger.current = trigger;
    setDetailPosition(null);
    setSelectedTask(taskId);
  }

  function guideButton() {
    return !guidance?.hasStarted ? <button className={styles.primaryButton} disabled={!canRecord || timelinePending} onClick={() => act({ type: "guidance-start" })}><Play size={17} />Cook</button>
      : <button className={styles.primaryButton} disabled={!canRecord} onClick={() => act({ type: guidance.isRunning ? "guidance-pause" : "guidance-resume" })}>{guidance.isRunning ? <Pause size={17} /> : <Play size={17} />}{guidance.isRunning ? "Pause guide" : "Resume guide"}</button>;
  }

  function taskTimer(task: CookingScheduledTask) {
    if (!shouldShowTaskTimer({ timerEnabledByDefault: task.timerEnabledByDefault ?? task.timingBasis === "source" }, session?.version === 4 ? session.taskTimers[task.id] : undefined)) return null;
    const timer = session?.version === 4 ? readTaskTimer(session, task.id, now) : null;
    return <CookingStepTimer id={task.id} label={task.label} timer={timer}
      state={session?.version === 4 ? session.taskTimers[task.id] : undefined}
      presetSeconds={timerPresets[task.id]?.countdownSeconds ?? task.minutes * 60} disabled={!canRecord}
      onToggle={() => act({ type: timer?.isRunning ? "task-timer-stop" : "task-timer-start", taskId: task.id })}
      onReset={() => act({ type: "task-timer-reset", taskId: task.id })}
      onConfigure={(mode, countdownSeconds) => act({ type: "task-timer-configure", taskId: task.id, mode, countdownSeconds })}
      onEdit={() => closeDetail()} />;
  }

  function earlierTimer(laneId: string) {
    const timer = session ? readLaneTimer(session, laneId, now) : null;
    const label = "Earlier " + (plan.lanes.find(lane => lane.id === laneId)?.label ?? laneId);
    return <div key={laneId}><strong>{label}</strong><CookingStepTimer id={"earlier-" + laneId} label={label}
      timer={timer} state={session?.timers[laneId]} presetSeconds={300} disabled={!canRecord}
      onToggle={() => act({ type: timer?.isRunning ? "timer-stop" : "timer-start", laneId })}
      onReset={() => act({ type: "timer-reset", laneId })}
      onConfigure={(mode, countdownSeconds) => act({ type: "timer-configure", laneId, mode, countdownSeconds })}
      onEdit={() => closeDetail()} /></div>;
  }

  const stats = <div className={styles.stats}><span><Clock3 size={17} /><strong>About {plan.serveMinute} min</strong> to serve</span><span><Utensils size={16} /><strong>{plan.handsOnMinutes} min</strong> hands-on</span><span><ChefHat size={18} />One cook</span></div>;
  return <div className={embedded ? `${styles.page} ${styles.embedded}` : styles.page}>
    {!embedded && <RecipeMasthead />}
    <main className={styles.container}>
      {embedded ? <div className={styles.embeddedStats}>{stats}{dietaryControls && <div className={styles.dietaryControls}>{dietaryControls}</div>}</div> : <section className={styles.hero}>
        <div><RecipeMetadata servings={recipe.servings} actions={metadataActions} /><h1>{recipe.title}</h1>
          {stats}
          {!ingredientsPreview && <MealAttributes attributes={mealAttributes} recipe={recipe} minutes={plan.serveMinute} />}
          {dietaryControls && <div className={styles.dietaryControls}>{dietaryControls}</div>}
        </div>

      </section>}

      {headerActions}{recipeNotice}
      <div className={styles.layout}>
        <div className={styles.mainColumn} ref={viewsRef}>
          <nav className={styles.tabs} aria-label="Cooking views">{tabs.map(item => <button key={item.id} className={tab === item.id ? styles.activeTab : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => switchTab(item.id)}>{item.label}{item.id === "timeline" && guidance?.isRunning && <span className={styles.liveDot} />}</button>)}</nav>
          {(timelinePending || timelineNotice) && tab !== "recipe" && <div className={styles.timelineNotice} role="status">
            {timelineNotice ?? "The previous plan is shown while your update is being rebuilt. Wait for the new plan before pressing Cook."}
          </div>}
          {message && <div className={styles.message} role="status">{message}<button aria-label="Dismiss message" onClick={() => setMessage("")}>×</button></div>}
          {(needsRecovery || storageConflict) && <div className={styles.recoveryActions}>
            {storageConflict ? <button className={styles.secondaryButton} onClick={() => window.location.reload()}>Reload saved cook</button> : <><button className={styles.secondaryButton} onClick={download}><Download size={15} />Export saved notes</button><button className={styles.textButton} onClick={reset}>Start a fresh timeline</button></>}
          </div>}
          {storageUnavailable && <p className={styles.storageNotice} role="status">This browser can’t save your cooking session. Keep the page open and save your notes before leaving.</p>}

          {tab === "overview" && <section className={styles.tabContent} aria-label="Read this First">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Before you begin</p><h2>Your kitchen, ready.</h2></div><span className={styles.smallPill}>One cook</span></div>
            <p className={styles.explainer}>A quick briefing: what to gather, what you’re cooking, and how the meal comes together.</p>
            {markedTimings.length > 0 && <div className={timingStyles.notice}>
              <Clock3 size={20} aria-hidden="true" /><div><strong>Check a couple of cooking times before you start.</strong>
                <p>{markedTimings.some(task => task.timingAdjustment?.kind === "package") ? "This meal includes packaged ingredients whose cooking times can vary." : "This meal includes cooking times you may want to adjust for your preferred doneness."} Review the highlighted steps in Adjust Cooking Times at the bottom of this page and build your changes into the guide.</p>
                <button type="button" onClick={() => { if (adjustmentsRef.current) { adjustmentsRef.current.open = true; adjustmentsRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); adjustmentsRef.current.querySelector("summary")?.focus({ preventScroll: true }); } }}>Review cooking times <ArrowRight size={14} /></button>
              </div>
            </div>}
            <div className={styles.setupCard}>
              <div><Clock3 size={22} /><h3>When would you like to eat?</h3><p>Pick a dinner time to see when to start. Open Cook Along when you’re ready.</p></div>
              <label className={styles.timeLabel}>Serving target <span>optional</span><input type="datetime-local" value={serveInput} onChange={event => setTarget(event.target.value)} aria-describedby="target-zone" /></label>
              <p id="target-zone" className={styles.targetHint}>{timezone ? `Your timezone: ${timezone.replaceAll("_", " ")}.` : "Uses this device’s timezone."}{serveInput && <button onClick={() => setTarget("")}>Clear target</button>}</p>
              {serveInput && serveAt === null && <p className={styles.storageNotice}>Choose a valid local date and time.</p>}
              {startAt !== null && <div className={styles.startTarget}><span>Suggested start</span><strong>{zonedTimeFormatter(timezone).format(new Date(startAt))}</strong><small>{startAt < now ? "That start time has passed. Choose a later target or cook at your own pace." : "Includes preparation and cooking time."}</small></div>}
            </div>
            <section className={`${styles.mobileIngredients} ${styles.gatherIngredients}`} aria-label="Gather your ingredients">
              <p className={styles.eyebrow}>First, gather your ingredients</p>
              <Ingredients recipe={recipe} preview={ingredientsPreview} controls={ingredientsControls ?? controls} footer={ingredientsFooter} />
            </section>
            <KitchenBrief recipe={recipe} plan={plan} />
            <details className={styles.estimates} ref={adjustmentsRef} id="adjust-cooking-times">
              <summary><div><h3>Adjust Cooking Times</h3><p>{markedTimings.length > 0 ? `${markedTimings.length} cooking steps to review, plus your preparation estimates.` : "Adjust prep and handling estimates before you begin."}</p></div><ChevronDown size={20} /></summary>
              <div className={styles.estimateList}>{plan.tasks.filter(task => task.editableMinutes).sort((a, b) => Number(Boolean(b.timingAdjustment)) - Number(Boolean(a.timingAdjustment))).map(task => <label key={task.id} className={task.timingAdjustment ? timingStyles.highlight : undefined}><span>{task.timingAdjustment && <strong className={timingStyles.badge}>{task.timingAdjustment.kind === "package" ? "Check the package" : "Your preferred doneness"}</strong>}{task.label}{task.timingAdjustment && <small>{task.timingAdjustment.note}</small>}{task.adjustedFromMinutes !== undefined && <small>Your time · recipe default {task.adjustedFromMinutes} min</small>}{task.optional && <small>Optional · skip it if the food needs you</small>}</span><div><input type="number" min={1} max={task.maxMinutes ?? MAX_TASK_MINUTES} step={1} defaultValue={task.minutes} key={`${task.id}-${task.minutes}`} disabled={!canRecord || timelinePending || preferenceSaving || Boolean(guidance?.hasStarted) || hasRunningTimers} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={event => {
                const minutes = Number(event.target.value);
                event.target.value = String(task.minutes);
                if (Number.isInteger(minutes) && minutes >= 1 && minutes <= (task.maxMinutes ?? MAX_TASK_MINUTES)) act({ type: "override", taskId: task.id, minutes });
                else { event.target.value = String(task.minutes); setMessage(`Choose a whole number from 1 to ${task.maxMinutes ?? MAX_TASK_MINUTES} minutes.`); }
              }} aria-label={`${task.label} ${task.timingAdjustment ? "cooking time" : "estimate"} in minutes`} /><span>min</span></div></label>)}</div>
              <p className={styles.smallCopy}>Adjust before pressing Cook, with timers stopped. The guide, step instructions and untouched countdowns update together. Check the food as you go.</p>
              <p className={styles.smallCopy}>{timingPreferences?.persistenceLabel ?? "Saved in this browser for this recipe, serving size and setup. Your next fresh timeline will remember these times."}</p>
              {(preferenceMessage || preferenceSaving) && <p className={timingStyles.status} role="status">{preferenceSaving ? "Saving your timings…" : preferenceMessage}</p>}
              {preferenceSaveFailed && <button className={styles.textButton} disabled={preferenceSaving} onClick={() => void rememberTiming(rememberedOverrides.current)}>Try saving timings again</button>}
            </details>
            <div className={styles.overviewActions}><button className={styles.primaryButton} onClick={() => switchTab("timeline")} disabled={!session}><Play size={16} />Open Cook Along</button><button className={styles.secondaryButton} onClick={() => switchTab("recipe")}>Read the recipe<ArrowRight size={16} /></button></div>
          </section>}

          {tab === "timeline" && <section className={styles.tabContent} aria-label="Cooking timeline">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>A place for every step</p><h2>Cook Along</h2></div><span className={styles.smallPill}>One cook</span></div>
            <InstructionDetailControl value={detailLevel} onChange={changeDetailLevel} />
            <p className={styles.explainer}>See how the meal’s components fit together, from Mise en Place to serving. Press Cook for a general timing guide. Timed instructions have a timer right on the card, like your own restaurant kitchen. Tap any step for details or to add a timer of your own.</p>
            <div className={styles.guideBar}>
              <div className={styles.guideMain}>
                {!compactLayout && guideButton()}
                <div className={styles.guideReadout}><strong>{guidance?.hasStarted ? `${clockLabel(guidance.elapsedMs / 1_000)} into the plan` : "Ready when you are"}</strong><span>
                  {guidance?.hasStarted && guidance.estimatedServeAtMs !== null && timezone
                    ? `Serving estimate · ${zonedTimeFormatter(timezone).format(new Date(guidance.estimatedServeAtMs))}`
                    : "The clock starts when you press Cook."}
                </span></div>
                {!compactLayout && guidance?.hasStarted && <button className={styles.textButton} onClick={showNow}>Find Now<ArrowRight size={14} /></button>}
              </div>
              <p>{guidance?.hasStarted && !guidance.isRunning ? "Guide paused. Your cooking equipment and step timers keep going."
                : "Follow the guide at your own pace. Check the food as you go; there’s nothing to tick off."}</p>
              {pastPlan && <p className={styles.beyondPlan}>{clockLabel((guideMinutes - plan.serveMinute) * 60)} beyond the serving estimate. Take the time the food needs.</p>}
              {guidance?.clockReversed && <p className={styles.beyondPlan}>Your device clock changed. Check its time before relying on the guide.</p>}
              {hasStarted && <p className={timingStyles.wakeStatus} role="status">{wakeLock.status === "active" ? "Screen stays awake while this cook is open in Cook Along." : wakeLock.status === "requesting" ? "Keeping your screen awake…" : wakeLock.status === "unsupported" ? "Screen-awake isn’t available in this browser. Your phone’s auto-lock setting still applies." : wakeLock.status === "unavailable" ? <>Your phone hasn’t kept the screen awake. <button type="button" onClick={wakeLock.retry}>Try again</button></> : null}</p>}
            </div>
            <div className={styles.chartHints}><span>Tap any step (&gt;) for instructions and tips</span><span>Scroll down for the full plan <ChevronDown size={13} /></span></div>
            {isNarrow && <div className={styles.mobileViewToggle} role="group" aria-label="Cooking layout">
              <button type="button" aria-pressed={compactLayout} onClick={() => { closeDetail(); setMobileView("compact"); }}>Compact lanes</button>
              <button type="button" aria-pressed={!compactLayout} onClick={() => { closeDetail(); setMobileView("lanes"); }}>All lanes</button>
              <span>{compactLayout ? "Side by side when steps overlap" : "A lane for each component"}</span>
            </div>}
            {compactLayout && <div className={styles.mobileGuideDock} ref={guideDockRef} aria-label="Cooking guide controls">
              {guideButton()}<span>{guidance?.hasStarted ? clockLabel(guidance.elapsedMs / 1_000) : `${plan.serveMinute} min`}<small>{guidance?.hasStarted ? "elapsed" : "to serve"}</small></span>
              {guidance?.hasStarted && <button type="button" className={styles.dockLink} onClick={showNow}>Find Now</button>}
            </div>}
            {compactLayout ? <CompactCookingTimeline plan={plan} guideMinutes={guideMinutes}
              hasStarted={Boolean(guidance?.hasStarted)} isRunning={Boolean(guidance?.isRunning)} selectedTask={selectedTask}
              renderTaskTimer={taskTimer} onSelectTask={selectTask} chartRef={chartRef} headerRef={laneHeaderRef} /> : <>
            <p className={styles.scrollHint}>Swipe across to see all {plan.lanes.length} lanes <ArrowRight size={13} /></p>
            <div className={styles.timelineScroll} ref={chartRef} tabIndex={0} role="region" aria-label="Scrollable cooking timeline with step timers"><div className={styles.timeline} style={{ "--lane-count": plan.lanes.length, ...(plan.lanes.length > 4 ? { minWidth: `${62 + plan.lanes.length * 155}px` } : {}) } as CSSProperties}>
              <div className={styles.laneHeader} ref={laneHeaderRef}><span className={styles.axisHeading}>Time</span>{plan.lanes.map(lane => <div key={lane.id}>
                <div className={styles.laneTitle}><i style={{ background: lane.color }} /><strong>{lane.label}</strong></div>
              </div>)}</div>
              <div className={styles.timeGrid} style={{ gridTemplateRows: grid.rows }}>
                {plan.phaseSpans.map(span => <div key={span.phaseId} className={styles.phaseBand} data-phase={span.phaseId}
                  style={{ gridColumn: "2 / -1", gridRow: `${grid.headingRow(span.startMinute)} / ${grid.endRow(span.endMinute)}` }}>
                  <h3>{phaseLabel(span.phaseId, plan.phases.find(phase => phase.id === span.phaseId)?.label)}</h3>
                </div>)}
                {plan.lanes.map((lane, index) => <div key={lane.id} className={styles.timeLane} style={{ gridColumn: `${2 + index * 2} / span 2`, gridRow: "1 / -1" }} />)}
                {Array.from({ length: Math.floor(plan.totalMinutes / 5) + 1 }, (_, index) => index * 5).map(minute => <div className={styles.timeTick} style={{ gridRow: grid.startRow(minute) }} key={minute}><time>{axisTime(minute)}</time><span /></div>)}
                {plan.tasks.map(task => {
                  const { columnStart, columnEnd } = plan.cardTracks[task.id];
                  const useSecondTrack = task.laneIds.length === 1 && columnEnd - columnStart === 1;
                  const isGuideCurrent = Boolean(guidance?.hasStarted && guideMinutes >= task.startMinute && guideMinutes < task.endMinute);
                  return <article key={task.id} className={`${styles.timelineTask} ${styles.stepCard} ${task.attention === "unattended" ? styles.unattendedTask : ""}`}
                    data-guide-current={isGuideCurrent}
                    data-task-id={task.id} data-start-minute={task.startMinute} data-end-minute={task.endMinute} data-lane={task.laneIds[0]} data-phase={task.phase} data-shared={task.laneIds.length > 1} data-minutes={task.minutes} data-long={task.attention === "unattended" && task.minutes >= 8} data-split={useSecondTrack} data-past={Boolean(guidance?.hasStarted && guideMinutes >= task.endMinute)}
                    style={{ gridColumn: `${columnStart} / ${columnEnd}`, gridRow: `${grid.startRow(task.startMinute)} / ${grid.endRow(task.endMinute)}`, "--lane-color": plan.lanes.find(lane => lane.id === task.laneIds[0])?.color, "--lane-end-color": plan.lanes.find(lane => lane.id === task.laneIds.at(-1))?.color } as CSSProperties}
                    data-expanded={selectedTask === task.id} onClick={event => {
                      if (!(event.target instanceof Element) || event.target.closest("button, a, input, select, textarea, summary, dialog, [contenteditable='true']")) return;
                      const trigger = event.currentTarget.querySelector<HTMLButtonElement>("[data-task-detail-button]");
                      if (trigger) selectTask(task.id, trigger);
                    }}>
                    <div className={styles.taskContentTrack}>
                      <button type="button" className={styles.stepInstructions} data-task-detail-button
                        onClick={event => selectTask(task.id, event.currentTarget)} aria-haspopup="dialog" aria-expanded={selectedTask === task.id} aria-controls={selectedTask === task.id ? "timeline-step-detail" : undefined}
                        title={`${task.label} · ${durationLabel(task)}`}>
                      <span className={styles.taskCopy}>
                        <strong className={styles.taskTitle}>{task.label}</strong>
                        {task.laneIds.length > 1 && <span className={styles.sharedLabel}>Shared step</span>}
                        <span className={styles.taskCardDuration}><Clock3 size={13} aria-hidden="true" />{durationLabel(task)}{task.timingBasis === "estimate" && <span className={styles.estimateTag}> · estimate</span>}{task.adjustedFromMinutes !== undefined && <span> · your time</span>}{task.optional && <span> · optional</span>}</span>
                        <span className={styles.taskDetailsLabel}>Step details <ArrowRight size={12} aria-hidden="true" /></span>
                      </span>
                      <span className={styles.taskChevron} aria-hidden="true"><ChevronRight size={16} /></span>
                      </button>
                      {taskTimer(task)}
                    </div>
                    {task.checkpoints?.map(point => <span className={styles.taskCheckpoint} key={point.afterMinutes} style={{ top: grid.position(task.startMinute + point.afterMinutes) - grid.position(task.startMinute) - 4 }}><span>Check at {point.afterMinutes} min</span></span>)}
                  </article>;
                })}
                <div className={styles.serveLine} style={{ gridRow: grid.startRow(plan.serveMinute), gridColumn: `2 / ${2 + Math.max(1, plan.lanes.length - 1) * 2}` }}><span><Utensils size={15} />Serving estimate</span><strong>{axisAnchor === null ? `Around ${plan.serveMinute} min` : axisTime(plan.serveMinute)}</strong></div>
                {guidance?.hasStarted && <div className={`${styles.nowLine} ${!guidance.isRunning ? styles.pausedLine : ""}`} style={{ top: grid.position(Math.min(guideMinutes, plan.totalMinutes + 1)) }} role="img" data-guide-line data-guide-minute={guideMinutes} aria-label="Timeline guide position"><span>{guideMinutes > plan.totalMinutes + 1 ? "Now ↓" : guidance.isRunning ? "Now" : "Paused"}</span><i /></div>}
              </div>
            </div></div>
            </>}
            {earlierTimerIds.length > 0 && <section className={styles.earlierTimers} aria-label="Earlier timers">
              <h3>Your earlier timers</h3><p>These timers were already in use before step timers were added. They keep their own time; reset each when you’re finished with it.</p>
              <div>{earlierTimerIds.map(earlierTimer)}</div>
            </section>}
            {detailTask && <article className={styles.stepDetail} id="timeline-step-detail" role="dialog" aria-modal={false} aria-labelledby="timeline-step-title" ref={detailRef} tabIndex={-1}
              style={detailPosition ? { ...detailPosition, visibility: "visible" } : { visibility: "hidden" }}>
              <button className={styles.closeDetail} aria-label="Close step details" onClick={() => closeDetail(true)}>×</button>
              <LaneChips ids={detailTask.laneIds} lanes={plan.lanes} /><h3 id="timeline-step-title">{detailTask.label}</h3>
              <div className={styles.detailBadges}><span className={styles.phaseBadge} data-phase={detailTask.phase}>{phaseLabel(detailTask.phase, plan.phases.find(phase => phase.id === detailTask.phase)?.label)}</span><span className={styles.smallPill}>{durationLabel(detailTask)}</span></div>
              <InstructionText text={detailTask.description} parts={detailTask.instructionParts} detailLevel={detailLevel} /><div className={styles.completionCue}><CheckCircle2 size={18} /><p>{cookingDisplayText(detailTask.completionCue)}</p></div>
              {detailTask.checkpoints?.map(point => <p className={styles.detailCheck} key={point.afterMinutes}><strong>Check at {point.afterMinutes} minutes.</strong> {cookingDisplayText(point.label)}</p>)}
              <InstructionExtras text={detailTask.description} parts={detailTask.instructionParts} detailLevel={detailLevel} tip={detailTask.tip} tipClassName={styles.smallCopy} />
              {!shouldShowTaskTimer({ timerEnabledByDefault: detailTask.timerEnabledByDefault ?? detailTask.timingBasis === "source" }, session?.version === 4 ? session.taskTimers[detailTask.id] : undefined) && <button type="button" className={styles.secondaryButton} disabled={!canRecord} onClick={() => { act({ type: "task-timer-add", taskId: detailTask.id }); closeDetail(true); }}><Clock3 size={16} />Add Timer</button>}
              {detailTask.adjustedFromMinutes !== undefined && <p className={styles.smallCopy}>Your selected time: {detailTask.minutes} minutes. Recipe default: {detailTask.adjustedFromMinutes} minutes.</p>}
              <p className={styles.detailMeta}>{detailTask.attention === "hands-on" ? "Hands-on" : "While it cooks"} · {detailTask.adjustedFromMinutes !== undefined ? "Your cooking time" : detailTask.timingBasis === "estimate" ? "Approximate time" : "Recipe cooking time"}{detailTask.optional ? " · optional" : ""}</p>
            </article>}
            <p className={styles.timelineFootnote}>The guide keeps time when you switch apps or lock your phone. Pause it when you need more time; your independent step timers keep running. Check the food as you go.</p>
            <details className={styles.timelineNotes}>
              <summary><span><NotebookPen size={17} />Kitchen notes</span><ChevronDown size={17} /></summary>
              <label className={styles.sessionNotes}><span>Notes for next time</span><textarea placeholder="Anything that took longer, worked well, or needs a little more room…" value={session?.notes ?? ""} disabled={!canRecord} maxLength={10_000} rows={3} onChange={event => act({ type: "note", text: event.target.value })} /></label>
              <div className={styles.exportRow}><button className={styles.secondaryButton} onClick={download} disabled={!session}><Download size={16} />Save cooking notes</button><button className={styles.textButton} onClick={reset} disabled={!session}><RotateCcw size={14} />Start a fresh timeline</button></div>
              <p className={styles.localNotice}>Saved in this browser. Your notes and timers stay here until you share the exported file.</p>
            </details>
          </section>}

          {tab === "recipe" && <><div className={timingStyles.methodNotice}>{plan.tasks.some(task => task.timingAdjustment && task.adjustedFromMinutes !== undefined) && <p>These instructions include your cooking-time adjustments. The original recipe is available below.</p>}</div><RecipeMethod recipe={adjustedRecipe} ingredientsPreview={ingredientsPreview} ingredientsControls={ingredientsControls ?? controls} ingredientsFooter={ingredientsFooter} detailLevel={detailLevel} onDetailLevelChange={changeDetailLevel} /></>}

        </div>
        <aside className={styles.recipeAside}><div className={styles.ingredientCard}><Ingredients recipe={recipe} preview={ingredientsPreview} controls={ingredientsControls ?? controls} footer={ingredientsFooter} /><button className={styles.recipeLink} onClick={() => switchTab("recipe")}>Read the full method<ArrowRight size={16} /></button></div></aside>
      </div>
      {footerContent}{!embedded && <RecipeFooter servings={recipe.servings} />}
    </main>
  </div>;
}

function RecipeMasthead() {
  return <header className={styles.masthead}><Link href="/" className={styles.wordmark} aria-label="TextSous home"><span className={styles.brandLogo}>TextSous</span></Link><span className={styles.mastheadLabel}>A little order in the kitchen</span></header>;
}

function RecipeFooter({ servings }: { servings: number }) {
  return <footer className={styles.footer}><span className={styles.footerBrand}><span className={styles.footerLogo}>TextSous</span></span><p>A meal worth slowing down for.</p><span>{servings} servings</span></footer>;
}

export function RecipeMethod({ recipe, ingredientsPreview, ingredientsControls, ingredientsFooter, detailLevel = "with-tips", onDetailLevelChange }: {
  recipe: CookingPilotRecipe; ingredientsPreview?: CookingPilotProps["ingredientsPreview"]; ingredientsControls?: ReactNode; ingredientsFooter?: ReactNode;
  detailLevel?: InstructionDetail; onDetailLevelChange?: (value: InstructionDetail) => void;
}) {
  const equipment = equipmentDisplayItems(recipe.equipment);
  return <section className={styles.tabContent} aria-label="Recipe and ingredients">
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Keep the recipe close</p><h2>Cooking instructions · {recipe.servings} servings</h2></div></div>
    <p className={styles.explainer}>{recipe.methodServings === recipe.servings ? `Follow the steps below, with quantities for ${recipe.servings} servings.` : "Use the ingredient list alongside these cooking instructions."}
      {recipe.methodServings && recipe.methodServings !== recipe.servings && <> These instructions were written for {recipe.methodServings} servings. Use the ingredient list for your adjusted quantities; pan space and cooking time may also change.</>}
    </p>
    <div className={styles.mobileIngredients}><Ingredients recipe={recipe} preview={ingredientsPreview} controls={ingredientsControls} footer={ingredientsFooter} /></div>
    {equipment.length > 0 && <div className={styles.equipment}><h3><span aria-hidden="true">🍳</span> Your equipment</h3><ul className={styles.recipeEquipmentList}>{equipment.map((item, index) => <li key={index}><EquipmentIcon name={item} /><span>{cookingDisplayText(item)}</span></li>)}</ul><small>Check your equipment and pan space before you start.</small></div>}
    {onDetailLevelChange && <InstructionDetailControl value={detailLevel} onChange={onDetailLevelChange} />}
    <ol className={styles.method}>{recipe.steps.map((step, index) => <li key={index}><span className={styles.methodNumber}>{String(index + 1).padStart(2, "0")}</span><div><span className={styles.eyebrow}>{step.kind === "prep" ? "Prep" : "Cook"}</span><InstructionText text={step.text} parts={step.instructionParts} detailLevel={detailLevel} /><InstructionExtras text={step.text} parts={step.instructionParts} detailLevel={detailLevel} /></div></li>)}</ol>
    {recipe.originalMethod && <details className={styles.originalMethod}>
      <summary><span>Original recipe instructions · {recipe.originalMethod.servings} servings</span><ChevronDown size={18} /></summary>
      <p>These are the original instructions. Their quantities and timings belong to the original {recipe.originalMethod.servings}-serving recipe.</p>
      <ol className={styles.method}>{recipe.originalMethod.steps.map((step, index) => <li key={index}><span className={styles.methodNumber}>{String(index + 1).padStart(2, "0")}</span><div><span className={styles.eyebrow}>{step.kind === "prep" ? "Prep" : "Cook"}</span><p>{step.text}</p></div></li>)}</ol>
    </details>}
  </section>;
}

function UntimedCookingRecipe({ embedded = false, recipe, mealAttributes, controls, ingredientsControls, ingredientsFooter, metadataActions, dietaryControls, headerActions, footerContent, recipeNotice, ingredientsPreview, onTimelineActivityChange, tab, setTab, detailLevel, changeDetailLevel }: CookingPilotProps & CookingViewState) {
  useEffect(() => {
    onTimelineActivityChange?.({ hasStarted: false, isRunning: false, hasRunningTimers: false, isReady: true });
  }, [onTimelineActivityChange]);
  return <div className={embedded ? `${styles.page} ${styles.embedded}` : styles.page}>{!embedded && <RecipeMasthead />}<main className={styles.container}>
    {!embedded && <section className={styles.hero}><div><RecipeMetadata servings={recipe.servings} actions={metadataActions} /><h1>{recipe.title}</h1>{!ingredientsPreview && <MealAttributes attributes={mealAttributes} recipe={recipe} />}{dietaryControls && <div className={styles.dietaryControls}>{dietaryControls}</div>}</div></section>}
    {headerActions}{recipeNotice}
    <div className={styles.layout}><div className={styles.mainColumn}>
      <nav className={styles.tabs} aria-label="Cooking views">{tabs.map(item => <button key={item.id} className={tab === item.id ? styles.activeTab : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
      {tab === "overview" && <section className={styles.tabContent} aria-label="Read this First">
        <section className={`${styles.mobileIngredients} ${styles.gatherIngredients}`} aria-label="Gather your ingredients"><p className={styles.eyebrow}>First, gather your ingredients</p><Ingredients recipe={recipe} preview={ingredientsPreview} controls={ingredientsControls ?? controls} footer={ingredientsFooter} /></section>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Ready to begin</p><h2>Your kitchen, ready.</h2></div></div>
        <p className={styles.explainer}>Gather your ingredients and equipment. Your full cooking instructions are in the Recipe tab.</p>
        <KitchenBrief recipe={recipe} />
        <div className={styles.overviewActions}><button className={styles.primaryButton} onClick={() => setTab("recipe")}>Read the recipe <ArrowRight size={16} /></button><button className={styles.secondaryButton} onClick={() => setTab("timeline")}>Open Cook Along <ArrowRight size={16} /></button></div>
      </section>}
      {tab === "timeline" && <section className={styles.tabContent} aria-label="Timeline availability"><div className={styles.sectionHeading}><h2>Cook Along isn’t available for this version yet.</h2></div><p className={styles.explainer}>There isn’t a supported timeline for this recipe, portion size and dietary version yet. Your ingredients and cooking instructions are ready to use.</p><button className={styles.secondaryButton} onClick={() => setTab("recipe")}>Read the recipe <ArrowRight size={16} /></button></section>}
      {tab === "recipe" && <RecipeMethod recipe={recipe} ingredientsPreview={ingredientsPreview} ingredientsControls={ingredientsControls ?? controls} ingredientsFooter={ingredientsFooter} detailLevel={detailLevel} onDetailLevelChange={changeDetailLevel} />}
    </div><aside className={styles.recipeAside}><div className={styles.ingredientCard}><Ingredients recipe={recipe} preview={ingredientsPreview} controls={ingredientsControls ?? controls} footer={ingredientsFooter} /><button className={styles.recipeLink} onClick={() => setTab("recipe")}>Read the full method <ArrowRight size={16} /></button></div></aside></div>
    {footerContent}{!embedded && <RecipeFooter servings={recipe.servings} />}
  </main></div>;
}

export default CookingPilot;
