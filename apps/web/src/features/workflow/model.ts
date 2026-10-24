import {
  IMAGE_MODEL,
  isImageModel,
  dependencyGraphError,
  MAX_GENERATION_JOB_REFERENCES,
  MAX_GENERATION_PLAN_IMAGES,
  type GenerationJobStatus,
  type GenerationOutput,
  type GenerationPlan,
  type ImageQuality
} from "@insboard/shared";
import type { Editor } from "../canvas/editor/Editor";
import type { TLBaseShape, TLShape, TLShapePartial } from "../canvas/editor/types";
import { boundsForShape } from "../canvas/editor/geometry";
import { findVacantPosition } from "../canvas/editor/placement";
import { canvasNodeNumber } from "../canvas/node-number";

export const WORKFLOW_NODE = "workflow-node";
export const WORKFLOW_WIDTH = 300;
export const WORKFLOW_HEIGHT = 420;
export const workflowSizes = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1536, height: 1024 },
  portrait: { width: 1024, height: 1536 }
} as const;
export type WorkflowStatus = GenerationJobStatus | "draft";
export interface WorkflowNodeProps {
  w: number;
  h: number;
  title: string;
  prompt: string;
  model: string;
  size: keyof typeof workflowSizes;
  quality: ImageQuality;
  inputIds: string[];
  status: WorkflowStatus;
  outputs: GenerationOutput[];
  error: string;
  runId: string;
  connectionId: string;
  planId: string;
}
export interface WorkflowNode extends TLBaseShape<WorkflowNodeProps> { type: typeof WORKFLOW_NODE; }
export const isWorkflowNode = (shape: TLShape): shape is WorkflowNode => shape.type === WORKFLOW_NODE;
export const workflowNodes = (editor: Editor): WorkflowNode[] => editor.getCurrentPageShapes().filter(isWorkflowNode);
export const workflowBusy = (editor: Editor): boolean => workflowNodes(editor).some((node) => Boolean(node.props.runId));

export function workflowPortPosition(shape: TLShape, input = false): { x: number; y: number; } {
  return {
    x: shape.x + (input ? 0 : Number(shape.props.w)),
    y: shape.y + (isWorkflowNode(shape) ? 78 * shape.props.w / WORKFLOW_WIDTH : Number(shape.props.h) / 2)
  };
}

export function workflowDisconnectPosition(from: TLShape, to: TLShape): { x: number; y: number; } {
  const start = workflowPortPosition(from), end = workflowPortPosition(to, true);
  const dx = end.x - start.x, dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const scale = Math.max(isWorkflowNode(from) ? from.props.w / WORKFLOW_WIDTH : 1, isWorkflowNode(to) ? to.props.w / WORKFLOW_WIDTH : 1);
  const clearance = 20 * scale + 28;
  const offset = distance / 2 < clearance ? Math.sqrt(clearance ** 2 - (distance / 2) ** 2) : 0;
  return {
    x: (start.x + end.x) / 2 + (distance ? dy / distance : 0) * offset,
    y: (start.y + end.y) / 2 - (distance ? dx / distance : 1) * offset
  };
}

export function normalizeWorkflowProps(props: Record<string, unknown>): WorkflowNodeProps {
  const statuses = ["draft", "queued", "running", "succeeded", "failed", "blocked", "cancelled"];
  const scale = typeof props.w === "number" && Number.isFinite(props.w) ? Math.min(4, Math.max(0.4, props.w / WORKFLOW_WIDTH)) : 1;
  return {
    w: WORKFLOW_WIDTH * scale, h: WORKFLOW_HEIGHT * scale,
    title: typeof props.title === "string" ? props.title : "",
    model: typeof props.model === "string" ? props.model : IMAGE_MODEL,
    prompt: typeof props.prompt === "string" ? props.prompt : "",
    size: props.size === "landscape" || props.size === "portrait" ? props.size : "square",
    quality: ["low", "medium", "high", "auto"].includes(String(props.quality)) ? props.quality as ImageQuality : "medium",
    inputIds: Array.isArray(props.inputIds) ? props.inputIds.filter((id): id is string => typeof id === "string") : [],
    status: statuses.includes(String(props.status)) ? props.status as WorkflowStatus : "draft",
    outputs: Array.isArray(props.outputs) ? props.outputs.filter((output): output is GenerationOutput => Boolean(output && typeof output === "object" && typeof output.id === "string" && output.status === "succeeded" && output.asset && typeof output.asset.id === "string" && Number.isFinite(output.asset.width) && Number.isFinite(output.asset.height))) : [],
    error: typeof props.error === "string" ? props.error : "",
    runId: typeof props.runId === "string" ? props.runId : "",
    connectionId: typeof props.connectionId === "string" ? props.connectionId : "",
    planId: typeof props.planId === "string" ? props.planId : ""
  };
}

export function downstreamIds(shapes: TLShape[], changed: string[]): Set<string> {
  const affected = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const shape of shapes) {
      if (isWorkflowNode(shape) && !affected.has(shape.id) && shape.props.inputIds.some((id) => affected.has(id))) {
        affected.add(shape.id);
        grew = true;
      }
    }
  }
  return affected;
}

export function invalidatedWorkflowUpdates(shapes: TLShape[], changed: string[]): TLShapePartial<WorkflowNode>[] {
  const affected = downstreamIds(shapes, changed);
  return shapes.filter(isWorkflowNode).filter((node) => affected.has(node.id)).map((node) => ({
    id: node.id, props: { status: "draft", outputs: [], error: "", runId: "", connectionId: "", planId: "" }
  }));
}

export function editWorkflowNode(editor: Editor, id: string, props: Partial<WorkflowNodeProps>): void {
  if (workflowBusy(editor)) return;
  editor.run(() => {
    editor.updateShapes(invalidatedWorkflowUpdates(editor.getCurrentPageShapes(), [id]));
    editor.updateShapes<WorkflowNode>([{ id, props }]);
  });
}

export type WorkflowError = "self" | "duplicate" | "cycle" | "missing" | "limit" | "inputs" | "prompt" | "model" | "asset" | "empty";

export function connectionError(shapes: TLShape[], fromId: string, toId: string): WorkflowError | null {
  const source = shapes.find((node) => node.id === fromId);
  const target = shapes.find((node) => node.id === toId);
  if (!source || !target || !isWorkflowNode(target) || !(isWorkflowNode(source) || source.type === "image")) return "missing";
  if (fromId === toId) return "self";
  if (target.props.inputIds.includes(fromId)) return "duplicate";
  if (target.props.inputIds.length >= MAX_GENERATION_JOB_REFERENCES) return "inputs";
  const edges = shapes.filter(isWorkflowNode).flatMap((node) => node.props.inputIds.map((input) => ({ fromJobId: input, toJobId: node.id })));
  return dependencyGraphError(shapes.map((shape) => shape.id), [...edges, { fromJobId: fromId, toJobId: toId }]);
}

export function connectWorkflowNodes(editor: Editor, fromId: string, toId: string): WorkflowError | null {
  const error = connectionError(editor.getCurrentPageShapes(), fromId, toId);
  if (error) return error;
  const target = editor.getShape<WorkflowNode>(toId)!;
  editWorkflowNode(editor, toId, { inputIds: [...target.props.inputIds, fromId] });
  return null;
}

export function imageAssetId(editor: Editor, shape: TLShape): string | undefined {
  const asset = typeof shape.props.assetId === "string" ? editor.getAsset(shape.props.assetId) : undefined;
  const source = asset?.props.src ?? shape.props.url;
  if (typeof source !== "string") return undefined;
  const match = /^\/api\/assets\/([^/?#]+)(?:[/?#]|$)/u.exec(source);
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]); } catch { return undefined; }
}

export function buildWorkflowPlan(editor: Editor, title: string, retry = false): { plan: GenerationPlan; } | { error: WorkflowError; nodeId?: string; } {
  const nodes = workflowNodes(editor);
  if (!nodes.length) return { error: "empty" };
  if (nodes.length > MAX_GENERATION_PLAN_IMAGES) return { error: "limit" };
  const shapes = editor.getCurrentPageShapes();
  const graphEdges = nodes.flatMap((node) => node.props.inputIds.map((id) => ({ fromJobId: id, toJobId: node.id })));
  const graphError = dependencyGraphError(shapes.map((shape) => shape.id), graphEdges);
  if (graphError) return { error: graphError };
  const jobs: GenerationPlan["jobs"] = [];
  for (const node of nodes) {
    if (!isImageModel(node.props.model)) return { error: "model", nodeId: node.id };
    if (!node.props.prompt.trim()) return { error: "prompt", nodeId: node.id };
    if (node.props.inputIds.length > MAX_GENERATION_JOB_REFERENCES) return { error: "inputs", nodeId: node.id };
    const references: GenerationPlan["jobs"][number]["references"] = [];
    for (const id of node.props.inputIds) {
      const source = editor.getShape(id);
      if (!source) return { error: "missing", nodeId: node.id };
      if (isWorkflowNode(source)) references.push({ kind: "generated_output", usage: "subject", nodeNumber: canvasNodeNumber(source), jobId: source.id });
      else {
        const assetId = source.type === "image" ? imageAssetId(editor, source) : undefined;
        if (!assetId) return { error: "asset", nodeId: node.id };
        references.push({ kind: "selected_canvas_image", usage: "subject", nodeNumber: canvasNodeNumber(source), assetId });
      }
    }
    jobs.push({
      id: node.id, model: node.props.model.trim(), role: "final_image", prompt: node.props.prompt.trim(), count: 1,
      size: workflowSizes[node.props.size], quality: node.props.quality, outputFormat: "png", references,
      status: retry && node.props.status === "succeeded" ? "succeeded" : "queued",
      outputs: retry ? node.props.outputs : [], visible: true
    });
  }
  const now = new Date().toISOString();
  return {
    plan: {
      schemaVersion: 1, id: `workflow-${crypto.randomUUID()}`, title, status: "awaiting_confirmation",
      defaults: { size: workflowSizes.square, quality: "medium", outputFormat: "png" }, jobs,
      edges: graphEdges.filter((edge) => isWorkflowNode(editor.getShape(edge.fromJobId)!)),
      createdBy: "user", createdAt: now, updatedAt: now
    }
  };
}

export function addWorkflowNode(editor: Editor, title: string): WorkflowNode | undefined {
  if (workflowBusy(editor) || workflowNodes(editor).length >= MAX_GENERATION_PLAN_IMAGES) return undefined;
  const selected = editor.getSelectedShapes().find((shape) => isWorkflowNode(shape) || shape.type === "image");
  const center = editor.getViewportPageBounds().center;
  const node: WorkflowNode = {
    id: `shape:workflow-${crypto.randomUUID()}`, typeName: "shape", type: WORKFLOW_NODE,
    x: selected ? selected.x + Number(selected.props.w) + 100 : center.x - WORKFLOW_WIDTH / 2,
    y: selected ? selected.y : center.y - WORKFLOW_HEIGHT / 2,
    props: normalizeWorkflowProps({ title, inputIds: selected ? [selected.id] : [] })
  };
  const vacant = findVacantPosition({ x: node.x, y: node.y, w: WORKFLOW_WIDTH, h: WORKFLOW_HEIGHT }, editor.getCurrentPageShapes().map(boundsForShape));
  node.x = vacant.x;
  node.y = vacant.y;
  editor.createShapes([node]);
  editor.select(node.id);
  const compact = editor.getContainer().getBoundingClientRect().width < 600;
  editor.panToBounds({ x: node.x, y: node.y, w: WORKFLOW_WIDTH, h: WORKFLOW_HEIGHT },
    { animation: { duration: 180 }, inset: compact ? 24 : 72 });
  return node;
}
