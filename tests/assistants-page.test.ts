import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AssistantsPage from "../src/app/assistants/page";
import { assistantPrompt, promptRecipeUrl } from "../src/app/assistants/content";

async function render(url?: string): Promise<string> {
  const element = await AssistantsPage({ searchParams: Promise.resolve(url === undefined ? {} : { url }) });
  return renderToStaticMarkup(element);
}

describe("/assistants", () => {
  it("shows the Muse steps, the MCP address and notes for the other assistants", async () => {
    const html = await render();
    expect(html).toContain("Connect Muse");
    // Muse adds custom connectors from a chat (Meta's help: "How Muse works
    // with Connectors"); Settings > Connectors lists only listed connectors.
    expect(html).toContain("In a chat, ask Muse to create a custom connector for TextSous");
    expect(html).not.toMatch(/Settings<\/strong> &gt;|Add custom connector/);
    expect(html).not.toContain("adults in the");
    expect(html).toContain("Steps for Muse");
    expect(html).toContain("https://textsous.com/api/mcp");
    expect(html).toContain("Copy address");
    expect(html).toContain('href="https://muse.ai"');
    for (const name of ["Muse", "ChatGPT", "Claude", "Gemini"]) expect(html).toContain(`Steps for ${name}`);
    expect(html).toContain('href="https://textsous.com/assistants"');
    expect(html).toMatch(/not limited by this\s+site&#x27;s daily free conversions/);
    expect(html).toContain("TextSous Cookbook");
    expect(html).not.toContain("Your recipe, ready to send");
  });

  it("shows a ready-to-copy prompt for ?url=", async () => {
    const url = "https://example.com/recipes/toast";
    const html = await render(url);
    expect(html).toContain("Your recipe, ready to send");
    expect(html).toContain(`Use TextSous to turn this recipe into a Cook Along: ${url}`);
    expect(html).toContain("Copy prompt");
  });

  it("ignores urls that are not web links", async () => {
    expect(promptRecipeUrl("javascript:alert(1)")).toBeNull();
    expect(promptRecipeUrl("not a url")).toBeNull();
    expect(promptRecipeUrl(["https://a.example/r", "https://b.example/r"])).toBe("https://a.example/r");
    expect(await render("javascript:alert(1)")).not.toContain("ready to send");
    expect(assistantPrompt("https://x.example/r")).toBe(
      "Use TextSous to turn this recipe into a Cook Along: https://x.example/r",
    );
  });
});
