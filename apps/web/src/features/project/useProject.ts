import { type GenerationRecord, type ProjectState } from "@insboard/shared";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { type Editor } from "../canvas/editor/Editor";
import { workflowBusy } from "../workflow/model";
import { type SaveStatus } from "./SaveStatus";
import { type PersistedSnapshot, filterLoadingPlaceholdersFromSnapshot, isPersistedSnapshot } from "./snapshot";

const AUTOSAVE_DEBOUNCE_MS = 1200;

export function useProject(editorRef: MutableRefObject<Editor | null>) {
  const { t } = useI18n();
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const hasLoadedProjectRef = useRef(false);
  const [projectSnapshot, setProjectSnapshot] = useState<PersistedSnapshot | undefined>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [saveError, setSaveError] = useState("");
  const [generationRecords, setGenerationRecords] = useState<GenerationRecord[]>([]);
  const saveTimerRef = useRef<number | undefined>();
  const saveRequestRef = useRef(0);
  const projectFileBusyRef = useRef(false);
  const [projectFileBusy, setProjectFileBusy] = useState(false);
  const pendingSavesRef = useRef(new Set<Promise<Response>>());
  const saveProjectSnapshot = useCallback(async (editor: Editor): Promise<void> => {
    if (!hasLoadedProjectRef.current || projectFileBusyRef.current) return;
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setSaveStatus("saving");
    setSaveError("");

    try {
      const request = fetch("/api/project", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          snapshot: filterLoadingPlaceholdersFromSnapshot(editor.getSnapshot())
        })
      });

      pendingSavesRef.current.add(request);
      let response: Response;
      try { response = await request; } finally { pendingSavesRef.current.delete(request); }
      if (!response.ok) {
        throw new Error(`Project save failed with ${response.status}`);
      }

      if (saveRequestRef.current === requestId) {
        setSaveStatus("saved");
      }
    } catch {
      if (saveRequestRef.current === requestId) {
        setSaveStatus("error");
        setSaveError(t("autosaveFailed"));
      }
    }
  }, [t]);

  async function beginProjectFile(importing: boolean, isGenerating: boolean): Promise<unknown> {
    const editor = editorRef.current;
    if (!editor || !hasLoadedProjectRef.current) throw new Error(t("canvasLoadingTitle"));
    if (importing && (isGenerating || workflowBusy(editor))) throw new Error(t("projectFileWait"));
    projectFileBusyRef.current = true;
    setProjectFileBusy(true);
    window.clearTimeout(saveTimerRef.current);
    await Promise.all(pendingSavesRef.current);
    const snapshot = editor.getSnapshot();
    if (importing) {
      const response = await fetch("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshot }) });
      if (!response.ok) throw new Error(t("autosaveFailed"));
    }
    return snapshot;
  }

  function endProjectFile(): void {
    projectFileBusyRef.current = false;
    setProjectFileBusy(false);
    if (editorRef.current) void saveProjectSnapshot(editorRef.current);
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadProject(): Promise<void> {
      setSaveStatus("loading");
      setSaveError("");

      try {
        const response = await fetch("/api/project", {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Project load failed with ${response.status}`);
        }

        const project = (await response.json()) as ProjectState;
        const snapshot = filterLoadingPlaceholdersFromSnapshot(project.snapshot);
        if (isPersistedSnapshot(snapshot)) {
          setProjectSnapshot(snapshot);
        }
        if (!Array.isArray(project.history) || (project.snapshot !== null && !isPersistedSnapshot(project.snapshot))) throw new Error("Invalid project response");
        setGenerationRecords(project.history);
        hasLoadedProjectRef.current = true;
        setIsProjectLoaded(true);
        setSaveStatus("saved");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setSaveStatus("error");
        setSaveError(t("projectLoadFailed"));
      }
    }

    void loadProject();

    return () => {
      controller.abort();
    };
  }, []);
  const bindAutosave = useCallback((editor: Editor): (() => void) => {
    const unsubscribe = editor.store.listen(() => {
      if (!hasLoadedProjectRef.current || projectFileBusyRef.current) return;
      window.clearTimeout(saveTimerRef.current);
      setSaveStatus((status) => status === "pending" ? status : "pending");
      setSaveError("");
      saveTimerRef.current = window.setTimeout(() => { void saveProjectSnapshot(editor); }, AUTOSAVE_DEBOUNCE_MS);
    });
    return () => { window.clearTimeout(saveTimerRef.current); unsubscribe(); };
  }, [saveProjectSnapshot]);

  return {
    isProjectLoaded,
    projectSnapshot,
    saveStatus,
    saveError,
    generationRecords,
    setGenerationRecords,
    projectFileBusy,
    saveProjectSnapshot,
    beginProjectFile,
    endProjectFile,
    bindAutosave
  };
}
