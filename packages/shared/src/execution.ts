import type { WorkflowSelectedCanvasReference, GeneratedAsset, GenerationOutput, GenerationPlan, GenerationRecord } from "./generation.js";

export type WorkflowClientMessageType =
  | "execute_plan"
  | "cancel_run"
  | "retry_failed"
  | "ping";

export interface WorkflowBaseClientMessage {
  type: WorkflowClientMessageType;
  requestId?: string;
  runId?: string;
}

export interface WorkflowPingClientMessage extends WorkflowBaseClientMessage {
  type: "ping";
}

export interface WorkflowCancelRunClientMessage extends WorkflowBaseClientMessage {
  type: "cancel_run";
}

export interface WorkflowExecutePlanClientMessage extends WorkflowBaseClientMessage {
  type: "execute_plan";
  planId: string;
  plan?: GenerationPlan;
  selectedReferences?: WorkflowSelectedCanvasReference[];
}

export interface WorkflowRetryFailedClientMessage extends WorkflowBaseClientMessage {
  type: "retry_failed";
  planId: string;
  plan?: GenerationPlan;
  selectedReferences?: WorkflowSelectedCanvasReference[];
}

export type WorkflowClientMessage =
  | WorkflowPingClientMessage
  | WorkflowCancelRunClientMessage
  | WorkflowExecutePlanClientMessage
  | WorkflowRetryFailedClientMessage;

export type WorkflowServerEventType =
  | "connected"
  | "tool_call"
  | "plan_updated"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_blocked"
  | "asset_preview"
  | "run_cancelled"
  | "run_done"
  | "error"
  | "pong";

export interface WorkflowBaseServerEvent {
  type: WorkflowServerEventType;
  requestId?: string;
  runId?: string;
  timestamp: string;
}

export interface WorkflowConnectedEvent extends WorkflowBaseServerEvent {
  type: "connected";
  connectionId: string;
}

export interface WorkflowPongEvent extends WorkflowBaseServerEvent {
  type: "pong";
}

export interface WorkflowErrorEvent extends WorkflowBaseServerEvent {
  type: "error";
  code: string;
  message: string;
  recoverable: boolean;
}

export interface WorkflowToolCallEvent extends WorkflowBaseServerEvent {
  type: "tool_call";
  phase: "started" | "completed" | "failed";
  toolName: "create_generation_plan" | "generate_canvas_image_job";
  toolCallId: string;
  planId?: string;
  jobId?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface WorkflowPlanUpdatedEvent extends WorkflowBaseServerEvent {
  type: "plan_updated";
  plan: GenerationPlan;
}

export interface WorkflowJobStartedEvent extends WorkflowBaseServerEvent {
  type: "job_started";
  planId: string;
  jobId: string;
}

export interface WorkflowJobCompletedEvent extends WorkflowBaseServerEvent {
  type: "job_completed";
  planId: string;
  jobId: string;
  outputs?: GenerationOutput[];
  record?: GenerationRecord;
}

export interface WorkflowJobFailedEvent extends WorkflowBaseServerEvent {
  type: "job_failed";
  planId: string;
  jobId: string;
  error: string;
}

export interface WorkflowJobBlockedEvent extends WorkflowBaseServerEvent {
  type: "job_blocked";
  planId: string;
  jobId: string;
  reason: string;
}

export interface WorkflowAssetPreviewEvent extends WorkflowBaseServerEvent {
  type: "asset_preview";
  planId: string;
  jobId: string;
  outputId: string;
  assetId: string;
  url: string;
  asset: GeneratedAsset;
  shapeId?: string;
}

export interface WorkflowRunCancelledEvent extends WorkflowBaseServerEvent {
  type: "run_cancelled";
  reason: string;
  alreadyCancelled: boolean;
}

export interface WorkflowRunDoneEvent extends WorkflowBaseServerEvent {
  type: "run_done";
  status: "succeeded" | "failed" | "cancelled";
}

export type WorkflowServerEvent =
  | WorkflowConnectedEvent
  | WorkflowPongEvent
  | WorkflowErrorEvent
  | WorkflowToolCallEvent
  | WorkflowPlanUpdatedEvent
  | WorkflowJobStartedEvent
  | WorkflowJobCompletedEvent
  | WorkflowJobFailedEvent
  | WorkflowJobBlockedEvent
  | WorkflowAssetPreviewEvent
  | WorkflowRunCancelledEvent
  | WorkflowRunDoneEvent;
