import { type GenerationRecord, MAX_REFERENCE_IMAGES } from "@insboard/shared";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { readErrorMessage } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { type Editor } from "../canvas/editor/Editor";
import { type ReferenceSelectionItem } from "../canvas/references";
import { showGenerationCompleteNotification } from "./notifications";
import { generationValidationMessage } from "./options";
import {
  createGenerationPlaceholders,
  generationContextBounds,
  markGenerationPlaceholdersFailed,
  placeholderSetForGenerationRecord,
  replaceGenerationPlaceholders
} from "./placeholders";
import { preloadGenerationRecordPreviews, waitForGenerationPollInterval } from "./polling";
import {
  createTemporaryGenerationRecord,
  generationFailureMessage,
  generationWarningMessage,
  isActiveGenerationRecord,
  isGenerationResponse,
  isTerminalGenerationRecord
} from "./records";
import {
  type ActiveGenerationPlaceholders,
  type ActiveGenerationTask,
  type GenerationMode,
  type GenerationReferenceInput,
  type GenerationSubmitInput
} from "./types";

interface GenerationTasksInput {
  editorRef: MutableRefObject<Editor | null>;
  generationRecords: GenerationRecord[];
  setGenerationRecords: Dispatch<SetStateAction<GenerationRecord[]>>;
  isProjectLoaded: boolean;
  saveProjectSnapshot: (editor: Editor) => Promise<void>;
}

export function useGenerationTasks({
  editorRef, generationRecords, setGenerationRecords, isProjectLoaded, saveProjectSnapshot
}: GenerationTasksInput) {
  const { locale, t } = useI18n();
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const [generationError, setGenerationError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationWarning, setGenerationWarning] = useState("");
  const generationRecordsRef = useRef<GenerationRecord[]>([]);

  generationRecordsRef.current = generationRecords;
  const activeGenerationsRef = useRef<Map<string, ActiveGenerationTask>>(new Map());
  const isGenerating = activeGenerationCount > 0;

  useEffect(() => {
    return () => {
      for (const task of activeGenerationsRef.current.values()) {
        task.controller.abort();
      }
      activeGenerationsRef.current.clear();
    };
  }, []);

  function upsertGenerationRecord(record: GenerationRecord, options: { promote?: boolean; } = {}): void {
    setGenerationRecords((history) => {
      const existingIndex = history.findIndex((item) => item.id === record.id);
      if (existingIndex >= 0 && !options.promote) {
        return history.map((item) => (item.id === record.id ? record : item));
      }

      return [record, ...history.filter((item) => item.id !== record.id)].slice(0, 20);
    });
  }

  async function fetchGenerationRecord(recordId: string, signal: AbortSignal): Promise<GenerationRecord> {
    const response = await fetch(`/api/generations/${encodeURIComponent(recordId)}`, {
      signal
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, locale, t));
    }

    const body = (await response.json()) as unknown;
    if (!isGenerationResponse(body)) {
      throw new Error(t("generationInvalidResponse"));
    }

    return body.record;
  }

  function finishPolledGeneration(record: GenerationRecord, placeholderSet: ActiveGenerationPlaceholders, notify: boolean): void {
    const editor = editorRef.current;
    const livePlaceholderSet = editor ? placeholderSetForGenerationRecord(editor, record) ?? placeholderSet : placeholderSet;
    const insertedCount = editor && livePlaceholderSet.placements.length > 0 ? replaceGenerationPlaceholders(editor, livePlaceholderSet, record, t) : 0;
    if (editor && livePlaceholderSet.placements.length > 0) {
      void saveProjectSnapshot(editor);
    }
    const failedCount =
      record.outputs.filter((output) => output.status === "failed").length +
      Math.max(0, livePlaceholderSet.placements.length - record.outputs.length);
    if (!notify) {
      return;
    }

    if (insertedCount > 0) {
      if (failedCount > 0) {
        setGenerationWarning(generationWarningMessage(record, insertedCount, failedCount, t));
      } else {
        setGenerationMessage(t("generationImageInserted", { count: insertedCount }));
      }
      showGenerationCompleteNotification(record, insertedCount, failedCount, t);
      return;
    }

    if (record.status === "failed" || record.status === "cancelled") {
      setGenerationError(generationFailureMessage(record, t));
    }
  }

  function startGenerationPolling(
    record: GenerationRecord,
    placeholderSet: ActiveGenerationPlaceholders | undefined,
    options: { notify?: boolean; } = {}
  ): void {
    if (!isActiveGenerationRecord(record) || activeGenerationsRef.current.has(record.id)) {
      return;
    }

    const editor = editorRef.current;
    const controller = new AbortController();
    activeGenerationsRef.current.set(record.id, {
      requestId: record.id,
      controller,
      placeholderSet: placeholderSet ?? (editor ? placeholderSetForGenerationRecord(editor, record) : undefined) ?? {
        requestId: record.id,
        placements: []
      }
    });
    setActiveGenerationCount(activeGenerationsRef.current.size);
    void pollGenerationUntilComplete(record.id, options.notify === true);
  }

  async function pollGenerationUntilComplete(recordId: string, notify: boolean): Promise<void> {
    while (true) {
      const task = activeGenerationsRef.current.get(recordId);
      if (!task) {
        return;
      }

      try {
        await waitForGenerationPollInterval(task.controller.signal);
        const record = await fetchGenerationRecord(recordId, task.controller.signal);
        upsertGenerationRecord(record);

        if (!isTerminalGenerationRecord(record)) {
          continue;
        }

        await preloadGenerationRecordPreviews(record, task.controller.signal);
        finishPolledGeneration(record, task.placeholderSet, notify);
        activeGenerationsRef.current.delete(recordId);
        setActiveGenerationCount(activeGenerationsRef.current.size);
        return;
      } catch (error) {
        if (task.controller.signal.aborted) {
          return;
        }

        if (notify) {
          setGenerationError(error instanceof Error ? error.message : t("generationErrorDefault"));
        }
      }
    }
  }

  function recoverActiveGenerationPolling(editor: Editor | null = editorRef.current): void {
    if (!editor) {
      return;
    }

    generationRecordsRef.current.forEach((record) => {
      const placeholderSet = placeholderSetForGenerationRecord(editor, record);
      if (isActiveGenerationRecord(record)) {
        startGenerationPolling(record, placeholderSet, { notify: false });
        return;
      }

      if (placeholderSet && isTerminalGenerationRecord(record)) {
        finishPolledGeneration(record, placeholderSet, false);
      }
    });
  }

  useEffect(() => {
    if (!isProjectLoaded) {
      return;
    }

    recoverActiveGenerationPolling();
  }, [generationRecords, isProjectLoaded]);

  async function executeGeneration(
    input: GenerationSubmitInput,
    requestMode: GenerationMode,
    resolveReference?: (signal: AbortSignal) => Promise<GenerationReferenceInput | undefined>,
    referenceAssetIds?: string[],
    references?: ReferenceSelectionItem[]
  ): Promise<void> {
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");

    const inputValidationMessage = generationValidationMessage(input.prompt, input.size.width, input.size.height, t, locale);
    if (inputValidationMessage) {
      setGenerationWarning(inputValidationMessage);
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      setGenerationError(t("generationCanvasNotReady"));
      return;
    }

    const controller = new AbortController();
    const generationId = crypto.randomUUID();
    const placeholderSet = createGenerationPlaceholders(editor, input, generationId, {
      references: requestMode === "reference" ? references : undefined,
      selectPlaceholders: requestMode !== "reference"
    });
    editor.zoomToBounds(generationContextBounds(editor, placeholderSet.placements, requestMode === "reference" ? references : undefined), { animation: { duration: 220 }, inset: 72 });
    const temporaryRecord = createTemporaryGenerationRecord({
      requestId: generationId,
      submitInput: input,
      requestMode,
      referenceAssetIds
    });

    activeGenerationsRef.current.set(generationId, {
      requestId: generationId,
      controller,
      placeholderSet
    });
    setActiveGenerationCount(activeGenerationsRef.current.size);
    upsertGenerationRecord(temporaryRecord, { promote: true });
    void saveProjectSnapshot(editor);

    try {
      const referenceForRequest = requestMode === "reference" ? await resolveReference?.(controller.signal) : undefined;
      if (requestMode === "reference" && (!referenceForRequest || referenceForRequest.referenceImages.length === 0)) {
        throw new Error(t("generationRequireReference", { max: MAX_REFERENCE_IMAGES }));
      }

      const requestBody: Record<string, unknown> = {
        model: input.model,
        clientRequestId: generationId,
        prompt: input.prompt.trim(),
        presetId: input.presetId,
        sizePresetId: input.sizePresetId,
        size: input.size,
        quality: input.quality,
        outputFormat: input.outputFormat,
        count: input.count
      };

      if (requestMode === "reference" && referenceForRequest) {
        requestBody.referenceImages = referenceForRequest.referenceImages;
        if (referenceForRequest.referenceAssetIds?.length) {
          requestBody.referenceAssetIds = referenceForRequest.referenceAssetIds;
        }
      }

      const response = await fetch(requestMode === "reference" ? "/api/images/edit" : "/api/images/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const body = (await response.json()) as unknown;
      if (!isGenerationResponse(body)) {
        throw new Error(t("generationInvalidResponse"));
      }

      if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
        return;
      }

      upsertGenerationRecord(body.record);
      void saveProjectSnapshot(editor);
      if (isTerminalGenerationRecord(body.record)) {
        await preloadGenerationRecordPreviews(body.record, controller.signal);
        finishPolledGeneration(body.record, placeholderSet, true);
        if (activeGenerationsRef.current.delete(generationId)) {
          setActiveGenerationCount(activeGenerationsRef.current.size);
        }
        return;
      }

      void pollGenerationUntilComplete(generationId, true);
    } catch (error) {
      if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
        return;
      }

      const message = error instanceof Error ? error.message : t("generationErrorDefault");
      try {
        const recoveredRecord = await fetchGenerationRecord(generationId, controller.signal);
        upsertGenerationRecord(recoveredRecord);
        if (isTerminalGenerationRecord(recoveredRecord)) {
          await preloadGenerationRecordPreviews(recoveredRecord, controller.signal);
          finishPolledGeneration(recoveredRecord, placeholderSet, true);
          if (activeGenerationsRef.current.delete(generationId)) {
            setActiveGenerationCount(activeGenerationsRef.current.size);
          }
          return;
        }

        void pollGenerationUntilComplete(generationId, true);
        return;
      } catch {
        if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
          return;
        }
      }

      markGenerationPlaceholdersFailed(editor, placeholderSet, message);
      void saveProjectSnapshot(editor);
      setGenerationRecords((history) =>
        history.map((record) => (record.id === temporaryRecord.id ? { ...record, status: "failed", error: message } : record))
      );
      setGenerationError(message);
      if (activeGenerationsRef.current.delete(generationId)) {
        setActiveGenerationCount(activeGenerationsRef.current.size);
      }
    }
  }

  async function cancelGeneration(requestId: string): Promise<void> {
    const task = activeGenerationsRef.current.get(requestId);
    if (!task) {
      return;
    }

    setGenerationError("");
    setGenerationWarning("");

    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(requestId)}/cancel`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const body = (await response.json()) as unknown;
      if (!isGenerationResponse(body)) {
        throw new Error(t("generationInvalidResponse"));
      }

      task.controller.abort();
      const editor = editorRef.current;
      if (editor) {
        markGenerationPlaceholdersFailed(editor, task.placeholderSet, body.record.error ?? t("generationUnknownCancel"));
        void saveProjectSnapshot(editor);
      }

      activeGenerationsRef.current.delete(requestId);
      setActiveGenerationCount(activeGenerationsRef.current.size);
      upsertGenerationRecord(body.record);
      setGenerationMessage(t("generationUnknownCancel"));
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : t("generationErrorDefault"));
    }
  }

  function cancelAllGenerations(): void {
    for (const task of activeGenerationsRef.current.values()) void cancelGeneration(task.requestId);
  }

  return {
    activeGenerationCount,
    isGenerating,
    generationError,
    generationMessage,
    generationWarning,
    executeGeneration,
    recoverActiveGenerationPolling,
    cancelAllGenerations
  };
}
