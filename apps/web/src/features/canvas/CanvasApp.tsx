import { ModelSelect } from "../generation/ModelSelect";
import {
  isImageModel,
  type GenerationCount,
  type ImageQuality,
  type OutputFormat,
  type StylePresetId,
  GENERATION_COUNTS,
  IMAGE_QUALITIES,
  MAX_IMAGE_DIMENSION,
  MIN_IMAGE_DIMENSION,
  OUTPUT_FORMATS,
  STYLE_PRESETS
} from "@insboard/shared";
import { Plus, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { ASPECT_RATIO_PRESETS, RESOLUTION_PRESETS, sizeValidationMessage } from "../generation/options";
import { isGenerationPlaceholderShape } from "../generation/placeholders";
import { type GenerationSubmitInput, type PanelStatus } from "../generation/types";
import { useGenerationForm } from "../generation/useGenerationForm";
import { useGenerationTasks } from "../generation/useGenerationTasks";
import { ProjectFiles } from "../project/ProjectFiles";
import { useProject } from "../project/useProject";
import { ProviderConfigDialog } from "../provider-config/ProviderConfigDialog";
import { WorkspaceStatus } from "../workbench/WorkspaceStatus";
import { useProviderStatus } from "../provider-config/useProviderStatus";
import { TopNavigation } from "../workbench/TopNavigation";
import { useWorkbenchDrawer } from "../workbench/useWorkbenchDrawer";
import { WorkflowNodeContent, WorkflowOverlay } from "../workflow/WorkflowCanvas";
import { WorkflowInspector } from "../workflow/WorkflowInspector";
import { type WorkflowNode, isWorkflowNode, workflowBusy } from "../workflow/model";
import { CanvasImageOpenOverlay, CanvasResolutionBadgeOverlay } from "./CanvasImageOverlays";
import { GenerationPlaceholderContent } from "./GenerationPlaceholderShape";
import { InfiniteCanvas } from "./InfiniteCanvas";
import { canvasAssetStore } from "./assets";
import { type Editor } from "./editor/Editor";
import type { TLComponents } from "./editor/react";
import { type TLShape } from "./editor/types";
import {
  type ReferenceSelection,
  areReferenceSelectionsEqual,
  missingReferenceSelection,
  readReferenceImage,
  referenceAssetIdsForSelection,
  resolveReferenceSelection
} from "./references";

export function App() {
  const { locale, t } = useI18n();
  const editorRef = useRef<Editor | null>(null);
  const {
    model, setModel,
    prompt,
    setPrompt,
    stylePreset,
    setStylePreset,
    resolutionPresetId,
    aspectRatioPresetId,
    sizePresetId,
    width,
    height,
    count,
    setCount,
    quality,
    setQuality,
    outputFormat,
    setOutputFormat,
    selectResolutionPreset,
    selectAspectRatioPreset,
    updateWidth,
    updateHeight
  } = useGenerationForm();
  const { authStatus, isAuthLoading, authError, loadAuthStatus } = useProviderStatus();
  const { isMobileDrawer, isAiPanelOpen, setIsAiPanelOpen, canvasShellRef, panelCloseButtonRef, closeAiPanel } = useWorkbenchDrawer();
  const {
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
  } = useProject(editorRef);
  const {
    activeGenerationCount,
    isGenerating,
    generationError,
    generationMessage,
    generationWarning,
    executeGeneration,
    recoverActiveGenerationPolling,
    cancelAllGenerations
  } = useGenerationTasks({ editorRef, generationRecords, setGenerationRecords, isProjectLoaded, saveProjectSnapshot });
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowNode | null>(null);
  const [isWorkflowBusy, setIsWorkflowBusy] = useState(false);
  const [isProviderConfigDialogOpen, setIsProviderConfigDialogOpen] = useState(false);
  const [referenceSelection, setReferenceSelection] = useState<ReferenceSelection>(() => missingReferenceSelection(t));

  const trimmedPrompt = prompt.trim();
  const promptValidationMessage = prompt.trim() ? "" : t("promptRequired");
  const dimensionValidationMessage = sizeValidationMessage(width, height, t, locale);
  const isReferenceMode = referenceSelection.status !== "none";
  const generationMode = isReferenceMode ? "reference" : "text";
  const isReferenceReady = isReferenceMode && referenceSelection.status === "ready";
  const referenceValidationMessage = isReferenceMode && !isReferenceReady ? referenceSelection.hint : "";
  const validationMessage = (!isImageModel(model) ? t("settingsModelRequired") : "") || promptValidationMessage || dimensionValidationMessage || referenceValidationMessage;
  const shouldShowValidation = Boolean(trimmedPrompt && validationMessage);
  const canGenerate = isProjectLoaded && !validationMessage;
  const canvasComponents = useMemo(
    () =>
      ({
        InFrontOfTheCanvas: () => (
          <>
            <WorkflowOverlay />
            <CanvasResolutionBadgeOverlay />
            <CanvasImageOpenOverlay />
          </>
        )
      }) satisfies TLComponents,
    []
  );
  const renderCanvasShape = useCallback((shape: TLShape) => {
    if (isWorkflowNode(shape)) return <WorkflowNodeContent shape={shape} />;
    if (isGenerationPlaceholderShape(shape)) {
      return <GenerationPlaceholderContent shape={shape} />;
    }
    return null;
  }, []);

  const panelStatus = useMemo<PanelStatus | null>(() => {
    if (isGenerating) {
      return {
        tone: "progress",
        message: t("generationActiveTasks", { count: activeGenerationCount }),
        testId: "generation-progress"
      };
    }

    if (generationError) {
      return {
        tone: "error",
        message: generationError,
        testId: "generation-error"
      };
    }

    if (shouldShowValidation && validationMessage) {
      return {
        tone: "warning",
        message: validationMessage,
        testId: "validation-message"
      };
    }

    if (generationWarning) {
      return {
        tone: "warning",
        message: generationWarning,
        testId: "generation-warning"
      };
    }

    if (generationMessage) {
      return {
        tone: "success",
        message: generationMessage,
        testId: "generation-message"
      };
    }

    return null;
  }, [
    activeGenerationCount,
    generationError,
    generationMessage,
    generationWarning,
    isGenerating,
    shouldShowValidation,
    t,
    validationMessage
  ]);

  function closeProviderConfigDialog(): void {
    setIsProviderConfigDialogOpen(false);
  }

  const handleEditorMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    let referenceSelectionFrame: number | undefined;
    const commitReferenceSelection = (): void => {
      const selected = editor.getSelectedShapes();
      const selectedNode = selected.length === 1 && isWorkflowNode(selected[0]) ? selected[0] : null;
      setSelectedWorkflow((current) => current === selectedNode ? current : selectedNode);
      setIsWorkflowBusy(workflowBusy(editor));
      const nextSelection = selected.some(shape => shape.type === "image")
        ? resolveReferenceSelection(editor, t)
        : missingReferenceSelection(t);
      setReferenceSelection((currentSelection) =>
        areReferenceSelectionsEqual(currentSelection, nextSelection) ? currentSelection : nextSelection
      );
    };
    const updateReferenceSelection = (): void => {
      if (referenceSelectionFrame !== undefined) {
        return;
      }

      referenceSelectionFrame = window.requestAnimationFrame(() => {
        referenceSelectionFrame = undefined;
        commitReferenceSelection();
      });
    };
    const removeAutosaveListener = bindAutosave(editor);
    const removeSelectionListener = editor.subscribe(updateReferenceSelection);
    commitReferenceSelection();
    recoverActiveGenerationPolling(editor);

    return () => {
      if (referenceSelectionFrame !== undefined) {
        window.cancelAnimationFrame(referenceSelectionFrame);
      }
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
      removeSelectionListener();
      removeAutosaveListener();
    };
  }, [bindAutosave, t]);

  async function submitGeneration(): Promise<void> {
    const input: GenerationSubmitInput = {
      model: model.trim(),
      prompt: trimmedPrompt,
      presetId: stylePreset,
      sizePresetId,
      size: {
        width,
        height
      },
      quality,
      outputFormat,
      count
    };

    if (generationMode === "reference") {
      await executeGeneration(input, "reference", async (signal) => {
        if (referenceSelection.status !== "ready") {
          return undefined;
        }

        const referenceAssetIds = referenceAssetIdsForSelection(referenceSelection);

        return {
          referenceImages: await Promise.all(referenceSelection.references.map((reference) => readReferenceImage(reference, signal, t))),
          referenceAssetIds
        };
      }, referenceSelection.status === "ready"
        ? referenceAssetIdsForSelection(referenceSelection)
        : undefined, referenceSelection.status === "ready" ? referenceSelection.references : undefined);
      return;
    }

    await executeGeneration(input, "text");
  }

  return (
    <div
      className="app-root"
      data-canvas-theme="dark"
      data-desktop-shell={navigator.userAgent.includes("Electron")}
    >
      {projectFileBusy && <div className="project-file-busy" role="status">{t("projectFileWorking")}</div>}
      <TopNavigation
        projectFiles={<ProjectFiles ready={isProjectLoaded} begin={(importing) => beginProjectFile(importing, isGenerating)} end={endProjectFile} />}
        isSettingsOpen={isProviderConfigDialogOpen}
        onOpenProviderConfig={() => setIsProviderConfigDialogOpen(true)}
      />
      <main className="app-shell app-view relative flex min-h-0 overflow-hidden bg-neutral-950 text-neutral-900">
        <section
          className="relative min-w-0 flex-1 bg-neutral-100 outline-none"
          aria-label={t("appCanvasAria")}
          data-testid="canvas-shell"
          ref={canvasShellRef}
          tabIndex={-1}
        >
          {isProjectLoaded ? (
            <InfiniteCanvas
              assets={canvasAssetStore}
              components={canvasComponents}
              renderShape={renderCanvasShape}
              snapshot={projectSnapshot}
              onMount={handleEditorMount}
            />
          ) : (
            <div className="canvas-loading-state">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-800" role={saveError ? "alert" : "status"}>{saveError || t("canvasLoadingTitle")}</p>
                {saveError && <button className="studio-secondary-button" type="button" onClick={() => window.location.reload()}>{t("projectReload")}</button>}
              </div>
            </div>
          )}
        </section>

        {isMobileDrawer ? (
          <button
            aria-label={t("generationPanelClose")}
            className="ai-panel-backdrop"
            data-drawer-state={isAiPanelOpen ? "open" : "closed"}
            data-testid="ai-panel-backdrop"
            type="button"
            onClick={closeAiPanel}
          />
        ) : null}

        <button
          aria-controls="ai-panel"
          aria-expanded={isAiPanelOpen}
          aria-haspopup="dialog"
          className="mobile-ai-trigger"
          data-drawer-state={isAiPanelOpen ? "open" : "closed"}
          data-testid="open-ai-panel"
          type="button"
          onClick={() => setIsAiPanelOpen(true)}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("studioNewImage")}
        </button>

        <aside
          aria-label={t("generationPanelAria")}
          aria-modal={isMobileDrawer && isAiPanelOpen ? true : undefined}
          className="ai-panel studio-sidebar fixed inset-y-0 right-0 z-20 flex flex-col border-l border-neutral-200 bg-white shadow-2xl shadow-neutral-950/15"
          data-drawer-state={isAiPanelOpen ? "open" : "closed"}
          data-testid="ai-panel"
          id="ai-panel"
          role={isMobileDrawer ? "dialog" : "complementary"}
          {...(isMobileDrawer && !isAiPanelOpen ? { inert: "" } : {})}
        >
          <div className="ai-panel-header border-b border-neutral-200 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <h1 className="generation-panel-title">{t("generationPanelTitle")}</h1>
              <div className="flex shrink-0 items-center gap-2">
                <WorkspaceStatus authStatus={authStatus} authError={authError} isAuthLoading={isAuthLoading} saveStatus={saveStatus}
                  onOpenSettings={() => setIsProviderConfigDialogOpen(true)} />
                {isMobileDrawer && <button
                  aria-label={t("generationPanelClose")}
                  className="ai-panel-close"
                  ref={panelCloseButtonRef}
                  type="button"
                  onClick={closeAiPanel}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>}
              </div>
            </div>
          </div>

          {selectedWorkflow && editorRef.current ? <WorkflowInspector editor={editorRef.current} node={selectedWorkflow} busy={isWorkflowBusy} providerReady={authStatus?.provider === "openai"}
            onConfigure={() => setIsProviderConfigDialogOpen(true)} onCreate={() => editorRef.current?.selectNone()} /> : (
            <>
              <div key="create" className="ai-panel-body studio-create-body" data-tab="manual" id="studio-panel-content">
                {saveError && <p className="studio-feedback studio-feedback--error" role="alert" data-testid="save-error">{saveError}</p>}
                {isReferenceMode && referenceSelection.status !== "none" && <section className="studio-references" data-reference-state={referenceSelection.status} data-testid="reference-state">
                  {referenceSelection.status === "ready" ? <>
                    <div className="studio-reference-strip">{referenceSelection.references.map((reference) => <figure key={`${reference.nodeNumber}-${reference.sourceUrl}`}>
                      <img src={reference.sourceUrl} alt={t("generationReferenceAlt", { index: reference.nodeNumber, name: reference.name })} />
                      <figcaption>{reference.nodeNumber}</figcaption>
                    </figure>)}</div>
                  </> : <p data-testid="reference-hint">{referenceSelection.hint}</p>}
                  <button className="studio-reference-clear" type="button" aria-label={t("generationRemoveReferences")} title={t("generationRemoveReferences")} onClick={() => editorRef.current?.selectNone()}><X size={16} aria-hidden="true" /></button>
                </section>}
                <ModelSelect value={model} onChange={setModel} />
                <label className="studio-prompt-field">
                  <span className="control-label">{t("studioPrompt")}</span>
                  <textarea aria-label={t("studioPrompt")} aria-invalid={shouldShowValidation && Boolean(promptValidationMessage)} className="prompt-textarea" id="prompt-input" name="prompt" value={prompt}
                    data-testid="prompt-input" onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (canGenerate && authStatus?.provider === "openai") void submitGeneration(); } }} />
                </label>
                <section className="studio-output-controls" aria-label={t("studioOutput")}>
                  <div className="studio-field-grid">
                    <label><span className="control-label">{t("generationAspectRatioLabel")}</span><select className="field-control" id="aspect-ratio-preset" data-testid="aspect-ratio-preset" value={aspectRatioPresetId} onChange={(event) => selectAspectRatioPreset(event.target.value)}>
                      {ASPECT_RATIO_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    </select></label>
                    <label><span className="control-label">{t("generationResolutionLabel")}</span><select className="field-control" id="resolution-preset" data-testid="resolution-preset" value={resolutionPresetId} onChange={(event) => selectResolutionPreset(event.target.value)}>
                      {RESOLUTION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    </select></label>
                    <label><span className="control-label">{t("generationStyleLabel")}</span><select className="field-control" id="style-preset" data-testid="style-preset" value={stylePreset} onChange={(event) => setStylePreset(event.target.value as StylePresetId)}>
                      {STYLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t("stylePresetLabel", { presetId: preset.id, fallback: preset.label })}</option>)}
                    </select></label>
                    <label><span className="control-label">{t("generationCountLabel")}</span><select className="field-control" aria-label={t("generationCountLabel")} value={count} onChange={(event) => setCount(Number(event.target.value) as GenerationCount)}>
                      {GENERATION_COUNTS.map((item) => <option key={item} value={item}>{t("studioImageCount", { count: item })}</option>)}
                    </select></label>
                  </div>
                </section>
                <details className="studio-advanced">
                  <summary>{t("studioAdvanced")}<span aria-hidden="true">+</span></summary>
                  <div className="studio-field-grid">
                    <label><span className="control-label">{t("generationQualityLabel")}</span><select className="field-control" id="quality-select" data-testid="quality-select" value={quality} onChange={(event) => setQuality(event.target.value as ImageQuality)}>{IMAGE_QUALITIES.map((item) => <option key={item} value={item}>{t("qualityLabel", { quality: item })}</option>)}</select></label>
                    <label><span className="control-label">{t("generationOutputFormatLabel")}</span><select className="field-control" id="format-select" data-testid="format-select" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}>{OUTPUT_FORMATS.map((item) => <option key={item} value={item}>{t("outputFormatLabel", { format: item })}</option>)}</select></label>
                    <label><span className="control-label">{t("generationWidthLabel")}</span><input className="field-control" id="custom-width" data-testid="custom-width" min={MIN_IMAGE_DIMENSION} max={MAX_IMAGE_DIMENSION} type="number" value={Number.isNaN(width) ? "" : width} onChange={(event) => updateWidth(event.target.value)} /></label>
                    <label><span className="control-label">{t("generationHeightLabel")}</span><input className="field-control" id="custom-height" data-testid="custom-height" min={MIN_IMAGE_DIMENSION} max={MAX_IMAGE_DIMENSION} type="number" value={Number.isNaN(height) ? "" : height} onChange={(event) => updateHeight(event.target.value)} /></label>
                  </div>
                </details>
                {shouldShowValidation && <p className="studio-feedback studio-feedback--error" role="alert">{validationMessage}</p>}
              </div>

              <div className="ai-panel-actions ai-panel-tab-panel ai-panel-tab-panel--actions grid grid-cols-1 gap-3 border-t border-neutral-200 bg-white px-5 py-4" data-tab="manual">
                <div className="studio-output-summary"><span>{Number.isNaN(width) || Number.isNaN(height) ? t("customSize") : t("studioImageCount", { count })}</span><span>{outputFormat.toUpperCase()}</span></div>
                {panelStatus ? (
                  <div
                    aria-live={panelStatus.tone === "progress" ? "polite" : "assertive"}
                    className={`action-feedback panel-status-strip panel-status--${panelStatus.tone}`}
                    data-testid={`action-${panelStatus.testId}`}
                    role={panelStatus.tone === "success" || panelStatus.tone === "progress" ? "status" : "alert"}
                  >
                    {panelStatus.message}
                  </div>
                ) : null}
                <button className="primary-action" disabled={isAuthLoading || (authStatus?.provider === "openai" && !canGenerate)} type="button"
                  data-generation-mode={generationMode} data-reference-mode={isReferenceReady ? "edit" : "generate"} data-testid="generate-button"
                  title={authStatus?.provider === "openai" ? validationMessage || undefined : t("studioConfigureHint")}
                  onClick={() => authStatus?.provider === "openai" ? void submitGeneration() : setIsProviderConfigDialogOpen(true)}>
                  {isAuthLoading ? t("studioCheckingApi") : authStatus?.provider !== "openai" ? t("studioConfigureApi") : t("studioGenerate")}
                </button>
                {activeGenerationCount > 0 && <button className="studio-text-button" data-testid="cancel-active-generations" type="button" onClick={cancelAllGenerations}>{t("generationCancelActive")}</button>}
              </div>
            </>
          )}
        </aside>

      </main>
      {isProviderConfigDialogOpen ? (
        <ProviderConfigDialog
          onClose={closeProviderConfigDialog}
          onRefreshAuthStatus={loadAuthStatus}
        />
      ) : null}
    </div>
  );
}
