import { ModelSelect } from "../generation/ModelSelect";
import {
  MAX_GENERATION_JOB_REFERENCES,
  MAX_GENERATION_PLAN_IMAGES,
  type ImageQuality
} from "@insboard/shared";
import { assetPreviewUrl } from "../../shared/api/assets";
import { localizedApiErrorMessage, useI18n } from "../../shared/i18n";
import type { Editor } from "../canvas/editor/Editor";
import { canvasNodeNumber } from "../canvas/node-number";
import { addWorkflowNode, editWorkflowNode, isWorkflowNode, type WorkflowNode } from "./model";
import { WORKFLOW_ACTION_EVENT, workflowStatusLabel } from "./WorkflowCanvas";

export function WorkflowInspector({ editor, node, busy, providerReady, onConfigure, onCreate }: {
  editor: Editor; node: WorkflowNode; busy: boolean; providerReady: boolean; onConfigure: () => void; onCreate: () => void;
}) {
  const { t, locale } = useI18n();
  const edit = (props: Partial<WorkflowNode["props"]>) => editWorkflowNode(editor, node.id, props);
  const nodes = editor.getCurrentPageShapes().filter(isWorkflowNode);
  const output = node.props.outputs.find((item) => item.status === "succeeded" && item.asset)?.asset;
  const action = (action: "run" | "cancel" | "retry") => window.dispatchEvent(new CustomEvent(WORKFLOW_ACTION_EVENT, { detail: action }));
  return <>
    <div className="ai-panel-body studio-create-body" id="studio-panel-content" data-testid="workflow-inspector">
      <div className="studio-context">
        <button className="studio-text-button" type="button" onClick={onCreate}>{t("studioBackToCreate")}</button>
      </div>
      <div className="studio-node-state"><span data-status={node.props.status}>{workflowStatusLabel(node.props.status, t)}</span><span>{t("workflowInputs", { count: node.props.inputIds.length })}</span></div>
      <label><span className="control-label">{t("workflowNodeName")}</span><input className="field-control" aria-label={t("workflowNodeName")} maxLength={80} disabled={busy} value={node.props.title}
        onFocus={() => editor.beginHistoryGroup()} onBlur={() => editor.endHistoryGroup()}
        onChange={(event) => editor.updateShapes<WorkflowNode>([{ id: node.id, props: { title: event.target.value } }])} /></label>
      <ModelSelect key={node.id} value={node.props.model} disabled={busy} onChange={(model) => edit({ model })} />
      <label className="studio-prompt-field"><span className="control-label">{t("workflowPrompt")}</span><textarea className="prompt-textarea" aria-label={t("workflowPrompt")}
        maxLength={32000} disabled={busy} value={node.props.prompt} onFocus={() => editor.beginHistoryGroup()} onBlur={() => editor.endHistoryGroup()}
        onChange={(event) => edit({ prompt: event.target.value })} /></label>
      <div className="studio-field-grid">
        <label><span className="control-label">{t("workflowSize")}</span><select className="field-control" disabled={busy} value={node.props.size} onChange={(event) => edit({ size: event.target.value as WorkflowNode["props"]["size"] })}>
          <option value="square">1:1 · 1024</option><option value="landscape">3:2 · 1536</option><option value="portrait">2:3 · 1536</option>
        </select></label>
        <label><span className="control-label">{t("workflowQuality")}</span><select className="field-control" disabled={busy} value={node.props.quality} onChange={(event) => edit({ quality: event.target.value as ImageQuality })}>
          {(["low", "medium", "high", "auto"] as const).map((quality) => <option key={quality} value={quality}>{t("qualityLabel", { quality })}</option>)}
        </select></label>
      </div>
      <section className="studio-node-inputs"><div className="studio-section-heading"><h2>{t("studioNodeInputs")}</h2><span>{node.props.inputIds.length}/{MAX_GENERATION_JOB_REFERENCES}</span></div>
        {node.props.inputIds.map((id) => {
          const source = editor.getShape(id);
          return <div className="studio-input-row" key={id}><button type="button" className="studio-text-button" onClick={() => { editor.select(id); editor.zoomToSelection(); }}>{source ? `${t("canvasNodeLabel", { number: canvasNodeNumber(source) })} · ${isWorkflowNode(source) ? source.props.title : t("workflowImage")}` : t("workflowImage")}</button>
            <button type="button" className="studio-text-button" disabled={busy} aria-label={t("studioDisconnectInput", { name: source && isWorkflowNode(source) ? source.props.title : t("workflowImage") })} onClick={() => edit({ inputIds: node.props.inputIds.filter((input) => input !== id) })}>{t("studioDisconnect")}</button></div>;
        })}
      </section>
      {output && <figure className="studio-node-output"><img src={assetPreviewUrl(output.id, 512)} alt={node.props.prompt} /><figcaption>{output.width} × {output.height} · PNG</figcaption></figure>}
      {node.props.error && <p className="studio-feedback studio-feedback--error" role="status">{localizedApiErrorMessage({ code: node.props.error, fallbackMessage: node.props.error, fallbackText: t("workflowRunError"), locale, status: 0, includeHttpSuffix: false })}</p>}
      <button type="button" className="studio-secondary-button" disabled={busy || nodes.length >= MAX_GENERATION_PLAN_IMAGES} onClick={() => addWorkflowNode(editor, t("workflowNodeNumber", { number: nodes.length + 1 }))}>{t("studioNextNode")}</button>
    </div>
    <div className="ai-panel-actions studio-node-actions">
      <div className="studio-output-summary"><span>{t("workflowNodeCount", { count: nodes.length })}</span></div>
      <button className="primary-action" type="button" onClick={() => busy ? action("cancel") : providerReady ? action("run") : onConfigure()}>{t(busy ? "workflowCancel" : providerReady ? "studioRunWorkflow" : "studioConfigureApi")}</button>
      {!busy && nodes.some((item) => ["failed", "blocked", "cancelled"].includes(item.props.status)) && <button className="studio-text-button" type="button" onClick={() => providerReady ? action("retry") : onConfigure()}>{t("workflowRetry")}</button>}
    </div>
  </>;
}
