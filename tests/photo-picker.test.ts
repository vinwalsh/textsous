import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConverterForm from "../src/app/ConverterForm";
import PhotoConfirm from "../src/app/PhotoConfirm";
import PhotoPicker from "../src/app/PhotoPicker";
import type { PhotoPage, PhotoPages } from "../src/app/use-photo-pages";
import type { CanonicalRecipe } from "../src/lib/schema/canonical";

function fakePhotos(count: number): PhotoPages {
  const pages: PhotoPage[] = Array.from({ length: count }, (_, i) => ({
    id: `page-${i + 1}`,
    file: new File([new Uint8Array(2048 * (i + 1))], `page-${i + 1}.jpg`, { type: "image/jpeg" }),
    url: `blob:probe-${i + 1}`,
  }));
  return {
    pages,
    add: () => ({ added: 0, problem: null, note: null }),
    remove: () => {},
    clear: () => {},
    take: () => pages,
  };
}

function picker(count: number, busy = false): string {
  return renderToStaticMarkup(
    createElement(PhotoPicker, {
      photos: fakePhotos(count),
      busy,
      transcribing: busy,
      error: null,
      onError: () => {},
      onSubmit: () => {},
      onPasteText: () => {},
    }),
  );
}

describe("the photo tab", () => {
  it("opens with a multi-photo picker and the one-recipe help text", () => {
    const html = renderToStaticMarkup(
      createElement(ConverterForm, { initialUrl: "", initialSrc: "", initialTab: "photo" }),
    );
    expect(html).toMatch(/<input type="file" multiple="" accept="image\/png,image\/jpeg,image\/webp"/);
    expect(html).toContain("Up to 3 photos of one recipe, for a recipe that runs over more than one page.");
    expect(html).toContain("Choose photos");
    expect(html).toMatch(/<button type="submit" class="btn btn-primary" disabled="">Transcribe photo<\/button>/);
    expect(html).not.toContain("capture");
  });

  it("lists pages in order with a remove button each and offers another page", () => {
    const html = picker(2);
    expect(html.indexOf("Page 1")).toBeLessThan(html.indexOf("Page 2"));
    expect(html).toContain('src="blob:probe-1"');
    expect(html).toContain('aria-label="Remove page 1"');
    expect(html).toContain('aria-label="Remove page 2"');
    expect(html).toContain("Add another page");
    expect(html).toContain('type="file"');
    expect(html).toMatch(/<button type="submit" class="btn btn-primary">Transcribe 2 photos<\/button>/);
  });

  it("stops offering pages at 3", () => {
    const html = picker(3);
    expect(html).toContain("Page 3");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Add another page");
    expect(html).toContain("Transcribe 3 photos");
  });

  it("locks the list while a request runs", () => {
    const html = picker(2, true);
    expect(html).toMatch(/aria-label="Remove page 1" disabled=""/);
    expect(html).toContain("photo-add is-disabled");
    expect(html).toContain("Transcribing…");
  });
});

describe("the confirm screen with several pages", () => {
  const recipe = {
    title: "Probe",
    nativeServings: 2,
    ingredients: [],
    steps: [],
  } as unknown as CanonicalRecipe;

  function confirm(pages?: { url: string; name: string }[], notices?: string[]): string {
    return renderToStaticMarkup(
      createElement(PhotoConfirm, {
        photoUrl: "blob:probe-1",
        fileName: "page-1.jpg",
        pages,
        notices,
        recipe,
        transcription: { text: "Probe", book: null, author: null, page: null },
        busy: false,
        error: null,
        onConfirm: () => {},
        onRetake: () => {},
      }),
    );
  }

  it("shows every page in order and offers to change the photos", () => {
    const html = confirm(
      [
        { url: "blob:probe-1", name: "page-1.jpg" },
        { url: "blob:probe-2", name: "page-2.jpg" },
      ],
      ["The photos show more than one recipe, so only the one that starts on the first photo was read."],
    );
    expect(html).toContain('alt="Page 1 of the recipe (page-1.jpg)"');
    expect(html).toContain('alt="Page 2 of the recipe (page-2.jpg)"');
    expect(html.indexOf("blob:probe-1")).toBeLessThan(html.indexOf("blob:probe-2"));
    expect(html).toContain("Compare the photos with what was read.");
    expect(html).toContain("Change the photos");
    expect(html).toContain("only the one that starts on the first photo was read");
  });

  it("stays as it was for one photo", () => {
    for (const html of [confirm(), confirm([{ url: "blob:probe-1", name: "page-1.jpg" }])]) {
      expect(html).toContain('alt="Uploaded recipe photo (page-1.jpg)"');
      expect(html).toContain("Compare the photo with what was read.");
      expect(html).toContain("Use a different photo");
      expect(html).not.toContain('class="notice"');
    }
  });
});

describe("photo tab styles", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("keeps 44 px tap targets and a visible focus on the hidden file input's label", () => {
    expect(rule(".photo-remove")).toContain("min-height: 44px");
    expect(rule(".photo-add")).toContain("min-height: 44px");
    expect(rule(".photo-add:focus-within")).toContain("outline: 2px solid var(--ts-accent)");
  });

  it("lets a page row shrink to a 320 px phone without overflow", () => {
    expect(rule(".photo-page")).toContain("min-width: 0");
    expect(rule(".photo-page-text")).toContain("min-width: 0");
    expect(rule(".photo-thumb")).toContain("flex: none");
  });
});
