import { MAX_GENERATION_PLAN_IMAGES, type ImageQuality } from "@insboard/shared";
import { Check, ImagePlus, Play, Plus, RotateCcw, Square, Trash2, Workflow, X } from "lucide-react";
import { memo, useEffect, useRef, useState, type PointerEvent } from "react";
import { assetInlineUrl } from "../../shared/api/assets";
import { localizedApiErrorMessage, useI18n, type Translate } from "../../shared/i18n";
import { boundsForShape } from "../canvas/editor/geometry";
import { findVacantPosition } from "../canvas/editor/placement";
import { useEditor, useValue } from "../canvas/editor/react";
import { GenerationLoadingArt } from "../canvas/GenerationPlaceholderShape";
import {
  addWorkflowNode,
  buildWorkflowPlan,
  connectWorkflowNodes,
  editWorkflowNode,
  isWorkflowNode,
  workflowBusy,
  type WorkflowError,
  type WorkflowNode,
  WORKFLOW_WIDTH,
  WORKFLOW_HEIGHT,
  workflowPortPosition,
  workflowDisconnectPosition,
  type WorkflowStatus
} from "./model";
import { WorkflowRunner } from "./runner";

const statusKeys = { draft: "workflowDraft", queued: "workflowQueued", running: "workflowRunning", succeeded: "workflowSucceeded", failed: "workflowFailed", blocked: "workflowBlocked", cancelled: "workflowCancelled" } as const;
const errorKeys = { model: "settingsModelRequired", self: "workflowErrorSelf", duplicate: "workflowErrorDuplicate", cycle: "workflowErrorCycle", missing: "workflowErrorMissing", limit: "workflowErrorLimit", inputs: "workflowErrorInputs", prompt: "workflowErrorPrompt", asset: "workflowErrorAsset", empty: "workflowErrorEmpty" } as const;
export const WORKFLOW_ACTION_EVENT = "insboard:workflow-action";
export const workflowStatusLabel = (status: WorkflowStatus, t: Translate) => t(statusKeys[status]);

function curve(from: { x: number; y: number; }, to: { x: number; y: number; }) {
  const bend = Math.max(65, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

export const WorkflowNodeContent = memo(function WorkflowNodeContent({ shape }: { shape: WorkflowNode; }) {
  const editor = useEditor();
  const { t, locale } = useI18n();
  const busy = useValue("workflow running", () => workflowBusy(editor), [editor], "document");
  const output = shape.props.outputs.find((item) => item.status === "succeeded" && item.asset)?.asset;
  const edit = (props: Partial<WorkflowNode["props"]>) => editWorkflowNode(editor, shape.id, props);
  const placeOutput = () => {
    if (!output) return;
    const id = `asset:workflow-${output.id}`;
    const placement = findVacantPosition({ x: shape.x, y: shape.y + shape.props.h + 60, w: output.width, h: output.height }, editor.getCurrentPageShapes().map(boundsForShape));
    editor.run(() => {
      editor.createAssets([{
        id, typeName: "asset", type: "image", props: {
          src: assetInlineUrl(output.id), w: output.width, h: output.height, name: output.fileName, mimeType: output.mimeType
        }
      }]);
      const imageId = `shape:${crypto.randomUUID()}`;
      editor.createShapes([{
        id: imageId, type: "image", x: placement.x, y: placement.y,
        props: { assetId: id, w: output.width, h: output.height, altText: shape.props.title }
      }]);
      editor.select(imageId);
    });
    editor.zoomToSelection({ animation: { duration: 220 } });
  };
  return <article style={{ width: WORKFLOW_WIDTH, height: WORKFLOW_HEIGHT, zoom: shape.props.w / WORKFLOW_WIDTH }} className="workflow-node" data-status={shape.props.status} aria-label={shape.props.title || t("workflowNode")}>
    <header className="workflow-node__header">
      <Workflow size={16} aria-hidden="true" />
      <input aria-label={t("workflowNodeName")} value={shape.props.title} disabled={busy} maxLength={80}
        onPointerDown={(event) => { event.stopPropagation(); editor.select(shape.id); }} onDoubleClick={(event) => event.stopPropagation()}
        onFocus={() => editor.beginHistoryGroup()} onBlur={() => editor.endHistoryGroup()}
        onChange={(event) => editor.updateShapes<WorkflowNode>([{ id: shape.id, props: { title: event.target.value } }])} />
      <button aria-label={t("workflowDeleteNode")} title={t("workflowDeleteNode")} disabled={busy} type="button"
        onPointerDown={(event) => event.stopPropagation()} onClick={() => editor.deleteShapes([shape.id])}><Trash2 size={15} /></button>
    </header>
    <div className="workflow-node__body" onPointerDown={(event) => { event.stopPropagation(); editor.select(shape.id); }} onDoubleClick={(event) => event.stopPropagation()} onWheel={(event) => { if (!event.ctrlKey && !event.metaKey) event.stopPropagation(); }}>
      <div className="workflow-node__ports-label"><span>{t("workflowInputs", { count: shape.props.inputIds.length })}</span><span>{t("workflowOutput")}</span></div>
      <textarea aria-label={t("workflowPrompt")} value={shape.props.prompt} disabled={busy} maxLength={32000}
        onFocus={() => editor.beginHistoryGroup()} onBlur={() => editor.endHistoryGroup()}
        onChange={(event) => edit({ prompt: event.target.value })} />
      <div className="workflow-node__settings">
        <label>{t("workflowSize")}<select value={shape.props.size} disabled={busy} onChange={(event) => edit({ size: event.target.value as WorkflowNode["props"]["size"] })}>
          <option value="square">1:1 · 1024</option><option value="landscape">3:2 · 1536</option><option value="portrait">2:3 · 1536</option>
        </select></label>
        <label>{t("workflowQuality")}<select value={shape.props.quality} disabled={busy} onChange={(event) => edit({ quality: event.target.value as ImageQuality })}>
          <option value="low">{t("workflowQualityLow")}</option><option value="medium">{t("workflowQualityMedium")}</option><option value="high">{t("workflowQualityHigh")}</option>
          <option value="auto">{t("workflowQualityAuto")}</option>
        </select></label>
      </div>
      <div className="workflow-node__preview" data-empty={!output && shape.props.status !== "running"}>
        {output ? <img key={output.id} src={assetInlineUrl(output.id)} alt={shape.props.prompt} draggable={false} />
          : shape.props.status === "running" ? <GenerationLoadingArt compact label={t("workflowRunning")} />
            : <span>{t("workflowEmptyPreview")}</span>}

      </div>
      {shape.props.error ? <p className="workflow-node__error" role="status">{localizedApiErrorMessage({ code: shape.props.error, fallbackMessage: shape.props.error, fallbackText: t("workflowRunError"), locale, status: 0, includeHttpSuffix: false })}</p> : <p className="workflow-node__status"><span data-status={shape.props.status}>{shape.props.status === "succeeded" && <Check size={12} />}{workflowStatusLabel(shape.props.status, t)}</span><span>PNG · {t("workflowOneImage")}</span></p>}
      {output && <button className="workflow-node__place" type="button" onClick={placeOutput}><ImagePlus size={14} />{t("workflowPlaceOutput")}</button>}
    </div>
  </article>;
});

export function WorkflowOverlay() {
  const editor = useEditor();
  const { t, locale } = useI18n();
  const shapes = useValue("workflow shapes", () => editor.getCurrentPageShapes(), [editor], "document");
  const camera = useValue("workflow camera", () => editor.getCamera(), [editor]);
  const selectedIds = useValue("workflow selection", () => editor.getSelectedShapeIds(), [editor], "document");
  const nodes = shapes.filter(isWorkflowNode);
  const busy = nodes.some((node) => Boolean(node.props.runId));
  const [message, setMessage] = useState("");
  const [connectionState, setConnectionState] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; } | null>(null);
  const drag = useRef<{ sourceId: string; x: number; y: number; moved: boolean; } | null>(null);
  const runner = useRef<WorkflowRunner>();
  const source = shapes.find((shape) => shape.id === sourceId);
  const complete = nodes.filter((node) => node.props.status === "succeeded").length;
  const canRetry = nodes.some((node) => ["failed", "blocked", "cancelled"].includes(node.props.status));

  useEffect(() => {
    const instance = new WorkflowRunner(editor, (state, code) => {
      setConnectionState(state);
      if (code) setMessage(localizedApiErrorMessage({ code, fallbackText: t("workflowRunError"), locale, status: 0, includeHttpSuffix: false }));
    });
    runner.current = instance;
    return () => { instance.dispose(); runner.current = undefined; };
  }, [editor, locale, t]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSourceId(null);
        setPointer(null);
        drag.current = null;
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  const report = (error: WorkflowError | null) => setMessage(error ? t(errorKeys[error]) : t("workflowConnected"));
  const connect = (fromId: string, toId: string) => {
    if (workflowBusy(editor)) return;
    const error = connectWorkflowNodes(editor, fromId, toId);
    report(error);
    if (!error) { setSourceId(null); setPointer(null); }
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (busy || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { sourceId: id, x: event.clientX, y: event.clientY, moved: false };
    setSourceId(id);
    setPointer(null);
    setMessage("");
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 4) drag.current.moved = true;
    if (drag.current.moved) setPointer(editor.screenToPage({ x: event.clientX, y: event.clientY }));
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.moved) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-workflow-input]");
      if (target?.dataset.workflowInput) connect(current.sourceId, target.dataset.workflowInput);
      else { setSourceId(null); setPointer(null); setMessage(""); }
    }
  };
  const run = (retry: boolean) => {
    if (workflowBusy(editor)) return;
    const result = buildWorkflowPlan(editor, t("workflowTitle"), retry);
    if ("error" in result) {
      report(result.error);
      if (result.nodeId) { editor.select(result.nodeId); editor.zoomToSelection({ animation: { duration: 180 } }); }
      return;
    }
    setMessage(""); setSourceId(null); setPointer(null);
    runner.current?.start(result.plan, retry);
  };
  useEffect(() => {
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<unknown>).detail;
      if (action === "run" || action === "retry") run(action === "retry");
      if (action === "cancel") { runner.current?.cancel(); setMessage(t("workflowCancelling")); }
    };
    window.addEventListener(WORKFLOW_ACTION_EVENT, handleAction);
    return () => window.removeEventListener(WORKFLOW_ACTION_EVENT, handleAction);
  });
  const edges = nodes.flatMap((node) => node.props.inputIds.flatMap((id) => {
    const from = shapes.find((shape) => shape.id === id);
    return from ? [{ from, to: node }] : [];
  }));
  const connectable = shapes.filter((shape) => isWorkflowNode(shape) || (shape.type === "image" && (nodes.length > 0 || selectedIds.includes(shape.id))));

  return <div className="workflow-overlay">
    <div className="workflow-controls" onPointerDown={(event) => event.stopPropagation()}>
      <div className="workflow-controls__buttons">
        <button type="button" disabled={busy || nodes.length >= MAX_GENERATION_PLAN_IMAGES} onClick={() => {
          const node = addWorkflowNode(editor, t("workflowNodeNumber", { number: nodes.length + 1 }));
          setMessage(node ? "" : t("workflowErrorLimit"));
        }}><Plus size={16} />{t("workflowAddNode")}</button>
        {nodes.length > 0 && <>
          <span className="workflow-controls__count">{busy ? `${complete}/${nodes.length}` : t("workflowNodeCount", { count: nodes.length })}</span>
          {busy ? <button type="button" className="workflow-run" onClick={() => { runner.current?.cancel(); setMessage(t("workflowCancelling")); }}><Square size={13} />{t("workflowCancel")}</button>
            : <button type="button" className="workflow-run" onClick={() => run(false)}><Play size={14} />{t("workflowRun")}</button>}
          {!busy && canRetry && <button type="button" title={t("workflowRetryHint")} onClick={() => run(true)}><RotateCcw size={14} />{t("workflowRetry")}</button>}
        </>}
      </div>
      {(message || (busy && connectionState === "connecting")) && <p className="workflow-message" role="status">{busy && connectionState === "connecting" ? t("workflowReconnecting") : message}</p>}
    </div>
    <div className="workflow-wires" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
      <svg className="workflow-wires__svg" width="1" height="1" aria-hidden="true">
        {edges.map(({ from, to }) => <path key={`${from.id}:${to.id}`} pathLength="1" d={curve(workflowPortPosition(from), workflowPortPosition(to, true))} data-active={to.props.status === "running"} />)}
        {source && pointer && <path className="workflow-wire-draft" d={curve(workflowPortPosition(source), pointer)} />}
      </svg>
      {edges.map(({ from, to }) => {
        const disconnect = workflowDisconnectPosition(from, to);
        return <button key={`${from.id}:${to.id}`} className="workflow-disconnect" type="button" disabled={busy}
          aria-label={t("workflowDisconnect", { from: isWorkflowNode(from) ? from.props.title : t("workflowImage"), to: to.props.title })}
          title={t("workflowDisconnectHint")} style={{ left: disconnect.x, top: disconnect.y }}
          onPointerDown={(event) => event.stopPropagation()} onClick={() => {
            editWorkflowNode(editor, to.id, { inputIds: to.props.inputIds.filter((id) => id !== from.id) }); setMessage(t("workflowDisconnected"));
          }}><X size={12} /></button>;
      })}
      {connectable.map((shape) => {
        const output = workflowPortPosition(shape), input = workflowPortPosition(shape, true);
        const name = isWorkflowNode(shape) ? shape.props.title : t("workflowImage");
        const portTransform = `translate(-50%, -50%) scale(${isWorkflowNode(shape) ? shape.props.w / WORKFLOW_WIDTH : 1})`;
        return <div key={shape.id}>
          <button type="button" className="workflow-port workflow-port--output" data-selected={sourceId === shape.id} data-workflow-output={shape.id}
            aria-label={t("workflowOutputPort", { name })} title={t("workflowOutputPort", { name })} disabled={busy}
            style={{ left: output.x, top: output.y, transform: portTransform }} onPointerDown={(event) => startDrag(event, shape.id)} onPointerMove={moveDrag} onPointerUp={endDrag}
            onPointerCancel={() => { drag.current = null; setSourceId(null); setPointer(null); }}
            onClick={(event) => { if (event.detail === 0) { setSourceId(shape.id); setMessage(""); } }}><span /></button>
          {isWorkflowNode(shape) && <button type="button" className="workflow-port workflow-port--input" data-ready={Boolean(sourceId && sourceId !== shape.id)} data-workflow-input={shape.id}
            aria-label={t("workflowInputPort", { name })} title={t("workflowInputPort", { name })} disabled={busy}
            style={{ left: input.x, top: input.y, transform: portTransform }} onPointerDown={(event) => event.stopPropagation()}
            onClick={() => { if (sourceId) connect(sourceId, shape.id); else setMessage(t("workflowSelectOutput")); }}><span /></button>}
        </div>;
      })}
    </div>
  </div>;
}
