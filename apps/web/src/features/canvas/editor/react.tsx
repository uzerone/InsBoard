import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { Editor } from "./Editor";

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) {
    throw new Error("Canvas components must be used within InfiniteCanvas.");
  }
  return editor;
}

export function useValue<T>(_name: string, getter: () => T, dependencies: readonly unknown[], scope: "visual" | "document" = "visual"): T {
  const editor = useEditor();
  const subscribe = scope === "document" ? editor.subscribe : editor.subscribeVisual;
  const getRevision = scope === "document" ? editor.getRevision : editor.getVisualRevision;
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision);
  return useMemo(getter, [editor, revision, ...dependencies]);
}

export interface TLComponents {
  InFrontOfTheCanvas?: (() => ReactNode) | null;
}
