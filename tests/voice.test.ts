import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TimelineDefinition, TimelineTask } from "../src/lib/schema/timeline";
import type { ChatTextMessage, StructuredChatClient } from "../src/lib/model/structured";
import { rewriteValid, voice, type VoiceRewrite } from "../src/lib/stages/voice";

function makeTask(id: string, overrides: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id,
    phase: "cook",
    label: "Simmer",
    cardTitle: { action: "Simmer", subject: "soup", context: "" },
    description: "Simmer for 20 minutes.",
    completionCue: "Hot through.",
    minutes: 20,
    range: null,
    timingBasis: "estimate",
    sourceQuote: null,
    attention: "unattended",
    timerEnabledByDefault: false,
    laneIds: ["lane-a"],
    dependencies: [],
    sourceStepIds: ["step-1"],
    checkpoints: [],
    tip: null,
    equipmentEvent: null,
    scheduling: { waits: [], resourceIds: [], ingredientIds: [] },
    ...overrides,
  };
}

function makeTimeline(tasks: TimelineTask[]): TimelineDefinition {
  return {
    lanes: [{ id: "lane-a", label: "A", color: "red", kind: "component" }],
    tasks,
    resources: [],
    resourceHolds: [],
    serveTaskId: tasks[tasks.length - 1].id,
  };
}

function scriptedClient(scripts: VoiceRewrite[][]): {
  client: StructuredChatClient;
  seen: ChatTextMessage[][];
} {
  const seen: ChatTextMessage[][] = [];
  let n = 0;
  const client: StructuredChatClient = {
    chat: {
      completions: {
        create: async (params) => {
          seen.push(params.messages);
          const tasks = scripts[Math.min(n, scripts.length - 1)];
          n += 1;
          return {
            choices: [{ message: { content: JSON.stringify({ tasks }) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
  return { client, seen };
}

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = savedKey;
});

describe("rewriteValid", () => {
  const original = {
    label: "Simmer",
    description: "Simmer 1 1/2 cups for 20 minutes.",
    completionCue: "Done.",
  };

  it("passes when numeric tokens are unchanged and in order", () => {
    expect(
      rewriteValid(original, {
        label: "Give it a simmer, friend",
        description: "Let those 1 1/2 cups bubble away for 20 minutes.",
        completionCue: "Done and delicious.",
      }),
    ).toBe(true);
  });

  it("fails on changed, added, removed or reordered numbers", () => {
    expect(
      rewriteValid(original, {
        ...original,
        description: "Simmer 1 1/2 cups for 25 minutes.",
      }),
    ).toBe(false);
    expect(
      rewriteValid(original, { ...original, completionCue: "Done in 5." }),
    ).toBe(false);
    expect(
      rewriteValid(original, { ...original, description: "Simmer for 20 minutes." }),
    ).toBe(false);
    expect(
      rewriteValid(original, {
        ...original,
        description: "Simmer 20 cups for 1 1/2 minutes.",
      }),
    ).toBe(false);
  });
});

describe("voice", () => {
  it("applies rewrites that preserve numbers without retrying", async () => {
    const timeline = makeTimeline([
      makeTask("a", { description: "Simmer for 20 minutes." }),
      makeTask("b", { description: "Rest 5 minutes." }),
    ]);
    const { client, seen } = scriptedClient([
      [
        {
          taskId: "a",
          label: "Simmer away",
          description: "Let it simmer for 20 minutes.",
          completionCue: "Hot through, chef.",
        },
        {
          taskId: "b",
          label: "Rest it",
          description: "Give it 5 minutes to rest.",
          completionCue: "Rested and ready.",
        },
      ],
    ]);
    const result = await voice(timeline, { client });
    expect(seen).toHaveLength(1);
    expect(result.stats).toEqual({ rewritten: 2, retried: 0, keptOriginal: 0 });
    expect(result.timeline.tasks[0].description).toContain("20 minutes");
    expect(result.timeline.tasks[0].label).toBe("Simmer away");
  });

  it("retries only failed tasks and applies the fix", async () => {
    const timeline = makeTimeline([
      makeTask("a", { description: "Simmer for 20 minutes." }),
      makeTask("b", { description: "Rest 5 minutes." }),
    ]);
    const goodB = {
      taskId: "b",
      label: "Rest it",
      description: "Give it 5 minutes to rest.",
      completionCue: "Ready.",
    };
    const { client, seen } = scriptedClient([
      [
        {
          taskId: "a",
          label: "Simmer",
          description: "Simmer for 25 minutes.",
          completionCue: "Done.",
        },
        goodB,
      ],
      [
        {
          taskId: "a",
          label: "Simmer away",
          description: "Let it simmer for 20 minutes.",
          completionCue: "Hot through.",
        },
      ],
    ]);
    const result = await voice(timeline, { client });
    expect(seen).toHaveLength(2);
    const retryPayload = JSON.parse(seen[1][seen[1].length - 1].content as string) as {
      tasks: Array<{ taskId: string }>;
    };
    expect(retryPayload.tasks.map((t) => t.taskId)).toEqual(["a"]);
    expect(seen[1].map((m) => m.content as string).join(" ")).toContain("previous rewrite");
    expect(result.stats).toEqual({ rewritten: 2, retried: 1, keptOriginal: 0 });
  });

  it("keeps the original text when the retry still changes numbers", async () => {
    const timeline = makeTimeline([makeTask("a", { description: "Simmer for 20 minutes." })]);
    const bad = [
      {
        taskId: "a",
        label: "Simmer",
        description: "Simmer for 25 minutes.",
        completionCue: "Done.",
      },
    ];
    const { client, seen } = scriptedClient([bad, bad]);
    const result = await voice(timeline, { client });
    expect(seen).toHaveLength(2);
    expect(result.stats).toEqual({ rewritten: 0, retried: 1, keptOriginal: 1 });
    expect(result.timeline.tasks[0].description).toBe("Simmer for 20 minutes.");
  });

  it("keeps tasks the model omits", async () => {
    const timeline = makeTimeline([makeTask("a", { description: "Simmer for 20 minutes." })]);
    const wrongId = [
      {
        taskId: "zzz",
        label: "Other",
        description: "Something else entirely.",
        completionCue: "Done.",
      },
    ];
    const { client } = scriptedClient([wrongId, wrongId]);
    const result = await voice(timeline, { client });
    expect(result.stats).toEqual({ rewritten: 0, retried: 1, keptOriginal: 1 });
    expect(result.timeline.tasks[0].description).toBe("Simmer for 20 minutes.");
  });
});
