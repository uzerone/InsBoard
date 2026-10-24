import {
  type GeneratedAsset,
  type GenerationOutput,
  type GenerationPlan,
  type GenerationRecord,
  type WorkflowToolCallEvent
} from "@insboard/shared";
import { type WorkflowPlanExecutionInput } from "./execution-types.js";
import { cloneGenerationPlan } from "./plan-state.js";

export function emitPlanUpdated(input: WorkflowPlanExecutionInput, plan: GenerationPlan): void {
  if (!input.isRunActive()) {
    return;
  }

  input.sendEvent({
    type: "plan_updated",
    requestId: input.requestId,
    runId: input.runId,
    plan: cloneGenerationPlan(plan),
    timestamp: new Date().toISOString()
  });
}

export function emitJobStarted(input: WorkflowPlanExecutionInput, plan: GenerationPlan, jobId: string): void {
  input.sendEvent({
    type: "job_started",
    requestId: input.requestId,
    runId: input.runId,
    planId: plan.id,
    jobId,
    timestamp: new Date().toISOString()
  });
}

export function emitToolCall(
  input: WorkflowPlanExecutionInput,
  plan: GenerationPlan,
  jobId: string,
  event: Omit<WorkflowToolCallEvent, "type" | "timestamp" | "requestId" | "runId" | "planId" | "jobId">
): void {
  const toolEvent: WorkflowToolCallEvent = {
    type: "tool_call",
    requestId: input.requestId,
    runId: input.runId,
    planId: plan.id,
    jobId,
    timestamp: new Date().toISOString(),
    ...event
  };
  input.sendEvent(toolEvent);
}

export function emitJobCompleted(
  input: WorkflowPlanExecutionInput,
  plan: GenerationPlan,
  jobId: string,
  outputs: GenerationOutput[],
  record: GenerationRecord
): void {
  input.sendEvent({
    type: "job_completed",
    requestId: input.requestId,
    runId: input.runId,
    planId: plan.id,
    jobId,
    outputs,
    record,
    timestamp: new Date().toISOString()
  });
}

export function emitJobFailed(input: WorkflowPlanExecutionInput, plan: GenerationPlan, jobId: string, error: string): void {
  input.sendEvent({
    type: "job_failed",
    requestId: input.requestId,
    runId: input.runId,
    planId: plan.id,
    jobId,
    error,
    timestamp: new Date().toISOString()
  });
}

export function emitJobBlocked(input: WorkflowPlanExecutionInput, plan: GenerationPlan, jobId: string, reason: string): void {
  input.sendEvent({
    type: "job_blocked",
    requestId: input.requestId,
    runId: input.runId,
    planId: plan.id,
    jobId,
    reason,
    timestamp: new Date().toISOString()
  });
}

export function emitAssetPreview(
  input: WorkflowPlanExecutionInput,
  plan: GenerationPlan,
  jobId: string,
  outputId: string,
  asset: GeneratedAsset
): void {
  input.sendEvent({
    type: "asset_preview",
    requestId: input.requestId,
    runId: input.runId,
    planId: plan.id,
    jobId,
    outputId,
    assetId: asset.id,
    url: asset.url,
    asset,
    timestamp: new Date().toISOString()
  });
}
