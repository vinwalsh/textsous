import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlassesApp, {
  GlassesDetails,
  GlassesHud,
  GlassesStatus,
  InstallPanel,
  type HudProps,
} from "../src/app/glasses/GlassesApp";
import { metadata, viewport } from "../src/app/glasses/page";
import { GUIDE_IDLE, hudOrder, type TaskTimer } from "../src/lib/glasses";
import { fixtureArtifact } from "./helpers/fixture-artifact";

const noop = () => {};
const artifact = fixtureArtifact();
const { tasks: order, totalMinutes } = hudOrder(artifact.timelineDefinition);
const simmerIndex = order.findIndex((o) => o.task.id === "task-simmer-porridge");
const NOW = 1_000_000;

function hud(overrides: Partial<HudProps> = {}): string {
  const props: HudProps = {
    artifact,
    order,
    totalMinutes,
    current: 0,
    now: NOW,
    guide: GUIDE_IDLE,
    timers: [],
    voice: true,
    announcement: "",
    flashing: new Set(),
    onPrev: noop,
    onNext: noop,
    onToggleGuide: noop,
    onDetails: noop,
    onTimer: noop,
    onJump: noop,
    onToggleVoice: noop,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(GlassesHud, props));
}

describe("/glasses page", () => {
  it("declares the Meta Ray-Ban Display web app tags", () => {
    expect(metadata.applicationName).toBe("TextSous Cook Along");
    expect(metadata.other).toEqual({ "mrbd-web-app-capable": "yes" });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(viewport.themeColor).toBe("#000000");
  });

  it("hides the site chrome, keeps the install panel off the 600 x 600 screen, and stills the flash", () => {
    const css = readFileSync("src/app/glasses/glasses.css", "utf8");
    expect(css).toContain("body:has(.ts-glasses-root) > .site-header");
    expect(css).toContain("body:has(.ts-glasses-root) > .site-footer");
    expect(css).toMatch(/@media \(max-width: 640px\) and \(max-height: 640px\) \{\s*\.g-install \{\s*display: none;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.g-flash \{\s*animation: none;/);
  });

  it("shows the picker with no recipe: the demo recipes as links", () => {
    const html = renderToStaticMarkup(
      createElement(GlassesApp, {
        request: { kind: "none" },
        demos: [{ url: "https://example.com/soup", host: "example.com", title: "Soup" }],
      }),
    );
    expect(html).toContain("ts-glasses-root");
    expect(html).toContain("Choose a recipe");
    expect(html).toContain('href="/glasses?url=https%3A%2F%2Fexample.com%2Fsoup"');
    expect(html).not.toContain("site-header");
  });

  it("starts loading for ?src= and ?url=", () => {
    for (const request of [
      { kind: "src" as const, src: "https://open.textsous.com/api/artifact/x?sig=y" },
      { kind: "url" as const, url: "https://example.com/soup" },
    ]) {
      const html = renderToStaticMarkup(createElement(GlassesApp, { request, demos: [] }));
      expect(html).toContain("Getting your cook along ready");
    }
  });

  it("explains an error and offers the picker", () => {
    const html = renderToStaticMarkup(
      createElement(GlassesStatus, {
        state: { kind: "error", error: { title: "That link has expired", detail: "Open it again." } },
        demos: [],
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("That link has expired");
    expect(html).toContain('href="/glasses"');
  });
});

describe("HUD", () => {
  it("shows the task now, its lane and description, what's next and the controls in one row", () => {
    const html = hud();
    const first = order[0].task;
    expect(html).toContain(`<h1 class="g-title">${first.cardTitle.action} ${first.cardTitle.subject}</h1>`);
    expect(html).toContain(`Step 1 of ${order.length}`);
    expect(html).toContain(`Next: ${order[1].task.cardTitle.action} ${order[1].task.cardTitle.subject}`);
    const controls = html.slice(html.indexOf('aria-label="Controls"'), html.indexOf("</div>", html.indexOf('aria-label="Controls"')));
    const labels = [...controls.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Prev", "Start guide", "Details", "Start timer", "Next"]);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("0:00");
    expect(html).not.toContain("Stop timer");
  });

  it("says Pause guide while the guide runs, with the elapsed clock", () => {
    const html = hud({ guide: { elapsedMs: 0, startedAt: NOW - 125_000 } });
    expect(html).toContain("Pause guide");
    expect(html).toContain("2:05");
    expect(html).toContain("g-clock-on");
  });

  it("puts the timer controls on the task that has a timer, and a chip per timer", () => {
    const simmer = order[simmerIndex].task;
    const timers: TaskTimer[] = [
      { taskId: simmer.id, status: "running", endsAt: NOW + (3 * 3600 + 42 * 60 + 10) * 1000, remainingMs: 0 },
      { taskId: order[0].task.id, status: "paused", endsAt: null, remainingMs: 750_000 },
    ];
    const html = hud({ current: simmerIndex, timers });
    expect(html).toContain("3:42:10 left");
    expect(html).toContain("Pause timer");
    expect(html).toContain("−1 min");
    expect(html).toContain("+1 min");
    expect(html).toContain("Stop timer");
    expect(html).toContain(">Simmer 3:42:10</button>");
    expect(html).toContain(`>${order[0].task.cardTitle.action} 12:30</button>`);
    expect(html).toContain('aria-current="true"');

    const paused = hud({ current: 0, timers });
    expect(paused).toContain("Resume timer");
    expect(paused).toContain("12:30 paused");
  });

  it("flashes a finished timer's chip and announces it politely", () => {
    const simmer = order[simmerIndex].task;
    const html = hud({
      current: 0,
      timers: [{ taskId: simmer.id, status: "done", endsAt: null, remainingMs: 0 }],
      flashing: new Set([simmer.id]),
      announcement: "Simmer porridge is done",
    });
    expect(html).toContain('class="g-chip g-chip-done g-flash"');
    expect(html).toContain(">Simmer done</button>");
    expect(html).toMatch(/aria-live="polite">Simmer porridge is done</);
    expect((html.match(/aria-live/g) ?? []).length).toBe(1);
  });

  it("shows the voice toggle state", () => {
    expect(hud({ voice: true })).toContain('aria-pressed="true"');
    expect(hud({ voice: false })).toContain("Voice off");
  });
});

describe("Details", () => {
  it("shows the full task: amounts, checks, cue, tip and why, with Back first", () => {
    const item = order[simmerIndex];
    const task = { ...item.task, tip: "Stir now and then.", why: "So it doesn't catch.", checkpoints: ["Creamy"] };
    const html = renderToStaticMarkup(
      createElement(GlassesDetails, {
        artifact,
        item: { ...item, task },
        number: simmerIndex + 1,
        count: order.length,
        onBack: noop,
      }),
    );
    expect(html.indexOf(">Back</button>")).toBeGreaterThan(-1);
    expect(html.indexOf(">Back</button>")).toBeLessThan(html.indexOf("g-details-title"));
    expect(html).toContain(task.description);
    expect(html).toContain("You need");
    expect(html).toMatch(/2 cups[^<]*milk/);
    expect(html).toContain("<li>Creamy</li>");
    expect(html).toContain(`Done when:</strong> ${task.completionCue}`);
    expect(html).toContain("Tip:</strong> Stir now and then.");
    expect(html).toContain("Why:</strong> So it doesn&#x27;t catch.");
    expect(html).toContain('role="dialog"');
  });
});

describe("install panel", () => {
  it("shows the Meta AI app link for this page, with copy and open", () => {
    const html = renderToStaticMarkup(
      createElement(InstallPanel, { pageUrl: "https://open.textsous.com/glasses" }),
    );
    expect(html).toContain("Put this on your glasses");
    expect(html).toContain(
      "fb-viewapp://web_app_deep_link?appName=TextSous%20Cook%20Along&amp;appUrl=https%3A%2F%2Fopen.textsous.com%2Fglasses",
    );
    expect(html).toContain("Copy link");
    expect(html).toContain("Open in the Meta AI app");
    expect(html).toContain("Developer Mode");
  });

  it("renders nothing until the page address is known", () => {
    expect(renderToStaticMarkup(createElement(InstallPanel, {}))).toBe("");
  });
});
