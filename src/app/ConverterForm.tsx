"use client";

import { useState, type FormEvent } from "react";
import type { CanonicalRecipe } from "../lib/schema/canonical";
import type { CanonicalizeCheck } from "../lib/stages/canonicalize";

interface ConvertResponse {
  recipe: CanonicalRecipe;
  checks: CanonicalizeCheck[];
  cached: boolean;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export default function ConverterForm({
  initialUrl,
  initialSrc,
}: {
  initialUrl: string;
  initialSrc: string;
}) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [value, setValue] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConvertResponse | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const body = mode === "url" ? { url: value } : { text: value };
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as ConvertResponse & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Conversion failed.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      {initialSrc ? (
        <p>Saved artifact loading is not available in this slice yet.</p>
      ) : null}
      <div>
        <button type="button" onClick={() => setMode("url")} disabled={mode === "url"}>
          Recipe URL
        </button>{" "}
        <button type="button" onClick={() => setMode("text")} disabled={mode === "text"}>
          Pasted text
        </button>
      </div>
      <form onSubmit={onSubmit}>
        {mode === "url" ? (
          <input
            type="url"
            required
            placeholder="https://example.com/recipe"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            size={60}
          />
        ) : (
          <textarea
            required
            rows={10}
            cols={60}
            placeholder="Paste a recipe here"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}{" "}
        <button type="submit" disabled={loading}>
          {loading ? "Converting…" : "Convert"}
        </button>
      </form>
      {error ? <p role="alert">Error: {error}</p> : null}
      {result ? (
        <article>
          <h2>{result.recipe.title}</h2>
          <p>
            Serves {result.recipe.nativeServings}
            {result.recipe.servingsLarge ? `–${result.recipe.servingsLarge}` : ""} ·{" "}
            {result.recipe.ingredients.length} ingredients · {result.recipe.steps.length} steps
            {result.cached ? " · cached" : ""}
          </p>
          <p>
            Credit: {[result.recipe.source.site, result.recipe.source.author].filter(Boolean).join(" · ") || "Unknown source"}{" "}
            {result.recipe.source.url ? (
              <a href={result.recipe.source.url} rel="noreferrer">
                View original
              </a>
            ) : null}
          </p>
          <ul>
            {result.checks.map((c) => (
              <li key={c.name}>
                {c.name}: {c.passed ? "pass" : `FAIL — ${c.detail}`}
              </li>
            ))}
          </ul>
          <details>
            <summary>Canonical JSON</summary>
            <pre>{JSON.stringify(result.recipe, null, 2)}</pre>
          </details>
        </article>
      ) : null}
    </section>
  );
}
