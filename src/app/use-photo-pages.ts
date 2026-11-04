"use client";

import { useEffect, useRef, useState } from "react";
import {
  checkPickedFile,
  droppedNote,
  fitPages,
  withoutPage,
  type PhotoPickProblem,
} from "./photo-pages";

/** One page of the recipe on the photo tab. */
export interface PhotoPage {
  id: string;
  file: File;
  /** Object URL of the thumbnail, revoked when the page leaves the list. */
  url: string;
}

export interface AddPagesResult {
  added: number;
  /** The first picked file that cannot be a page, if any. */
  problem: PhotoPickProblem | null;
  /** Photos left out because the list was full, as a calm note. */
  note: string | null;
}

export interface PhotoPages {
  pages: PhotoPage[];
  add: (files: readonly File[]) => AddPagesResult;
  remove: (id: string) => void;
  clear: () => void;
  /** Empty the list and hand its pages (and their URLs) to the caller. */
  take: () => PhotoPage[];
}

/**
 * The photo tab's pages, in order, at most 3. Thumbnail object URLs are
 * created when a page is added and revoked when it is removed, cleared or
 * the form unmounts; take() moves them to the caller, who revokes them.
 */
export function usePhotoPages(): PhotoPages {
  const [pages, setPages] = useState<PhotoPage[]>([]);
  // The list as of the last change, so two changes in one tick compose.
  const list = useRef<PhotoPage[]>([]);
  const owned = useRef(new Set<string>());
  const nextId = useRef(0);

  useEffect(() => {
    const urls = owned.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  function commit(next: PhotoPage[]): void {
    list.current = next;
    setPages(next);
  }

  function add(files: readonly File[]): AddPagesResult {
    let problem: PhotoPickProblem | null = null;
    const usable = files.filter((file) => {
      const issue = checkPickedFile(file);
      if (issue && !problem) problem = issue;
      return issue === null;
    });
    const { accepted, dropped } = fitPages(list.current.length, usable);
    const added = accepted.map((file): PhotoPage => {
      nextId.current += 1;
      const url = URL.createObjectURL(file);
      owned.current.add(url);
      return { id: `page-${nextId.current}`, file, url };
    });
    if (added.length > 0) commit([...list.current, ...added]);
    return { added: added.length, problem, note: droppedNote(dropped) };
  }

  function remove(id: string): void {
    const page = list.current.find((p) => p.id === id);
    if (!page) return;
    URL.revokeObjectURL(page.url);
    owned.current.delete(page.url);
    commit(withoutPage(list.current, id));
  }

  function clear(): void {
    for (const page of list.current) {
      URL.revokeObjectURL(page.url);
      owned.current.delete(page.url);
    }
    commit([]);
  }

  function take(): PhotoPage[] {
    const taken = list.current;
    for (const page of taken) owned.current.delete(page.url);
    commit([]);
    return taken;
  }

  return { pages, add, remove, clear, take };
}
