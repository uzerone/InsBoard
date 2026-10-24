import {
  type GenerationJob,
  type GenerationPlan,
  type WorkflowSelectedCanvasReference,
  composePrompt,
  sizeToApiValue
} from "@insboard/shared";
import { randomUUID } from "node:crypto";
import { type ImageProvider, type ImageProviderInput } from "../../infrastructure/providers/image-provider.js";
import { runReferenceImageGeneration, runTextToImageGeneration } from "../generation/image-generation.js";
import { createConfiguredImageProvider } from "../providers/image-provider-selection.js";
import { errorToMessage, isAbortError, throwIfAborted } from "./errors.js";
import {
  emitAssetPreview,
  emitJobBlocked,
  emitJobCompleted,
  emitJobFailed,
  emitJobStarted,
  emitPlanUpdated,
  emitToolCall
} from "./events.js";
import { type WorkflowPlanExecutionInput, type WorkflowPlanExecutionResult } from "./execution-types.js";
import {
  dependenciesSucceeded,
  dependencyFailed,
  preparePlanForExecution,
  resolvePlanStatus
} from "./plan-state.js";
import { createSelectedReferenceMap, resolveJobReferences } from "./references.js";

export const WORKFLOW_EXECUTION_TOOL_ALLOWLIST = ["generate_canvas_image_job"] as const;

export async function executeGenerationPlan(input: WorkflowPlanExecutionInput): Promise<WorkflowPlanExecutionResult> {
  const plan = preparePlanForExecution(input.plan, input.mode);
  emitPlanUpdated(input, plan);

  let provider: ImageProvider;
  try {
    throwIfAborted(input.signal);
    provider = input.provider ?? (await createConfiguredImageProvider(input.signal));
  } catch (error) {
    if (isAbortError(error, input.signal)) {
      markPlanCancelled(plan);
      emitPlanUpdated(input, plan);
      return { status: "cancelled", plan };
    }

    markRunnableJobsBlocked(plan, errorToMessage(error));
    plan.status = "failed";
    plan.updatedAt = new Date().toISOString();
    emitPlanUpdated(input, plan);
    return { status: "failed", plan };
  }

  const selectedReferencesByKey = createSelectedReferenceMap(input.selectedReferences);

  while (input.isRunActive()) {
    if (input.signal.aborted) {
      markPlanCancelled(plan);
      emitPlanUpdated(input, plan);
      return { status: "cancelled", plan };
    }

    const runnableJobs = plan.jobs.filter((job) => job.status === "queued" && dependenciesSucceeded(plan, job.id));
    if (runnableJobs.length === 0) {
      const queuedJobs = plan.jobs.filter((job) => job.status === "queued");
      if (queuedJobs.length === 0) {
        break;
      }

      for (const job of queuedJobs) {
        if (dependencyFailed(plan, job.id)) {
          const reason = "Blocked because an upstream Workflow job failed or was cancelled.";
          job.status = "blocked";
          job.error = reason;
          job.outputs = [];
          emitJobBlocked(input, plan, job.id, reason);
        }
      }

      plan.updatedAt = new Date().toISOString();
      emitPlanUpdated(input, plan);
      break;
    }

    await Promise.all(
      runnableJobs.map((job) =>
        executeGenerationJob({
          ...input,
          plan,
          job,
          provider,
          selectedReferencesByKey
        })
      )
    );
  }

  if (!input.isRunActive() || input.signal.aborted) {
    markPlanCancelled(plan);
    emitPlanUpdated(input, plan);
    return { status: "cancelled", plan };
  }

  plan.status = resolvePlanStatus(plan);
  plan.updatedAt = new Date().toISOString();
  emitPlanUpdated(input, plan);

  return {
    status: plan.status === "succeeded" ? "succeeded" : "failed",
    plan
  };
}

async function executeGenerationJob(input: WorkflowPlanExecutionInput & {
  plan: GenerationPlan;
  job: GenerationJob;
  provider: ImageProvider;
  selectedReferencesByKey: Map<string, WorkflowSelectedCanvasReference>;
}): Promise<void> {
  if (!input.isRunActive() || input.signal.aborted || input.job.status !== "queued") {
    return;
  }

  input.job.status = "running";
  input.job.error = undefined;
  input.job.outputs = [];
  input.plan.updatedAt = new Date().toISOString();
  emitJobStarted(input, input.plan, input.job.id);
  emitPlanUpdated(input, input.plan);

  const toolCallId = `tool-call-${randomUUID()}`;
  const toolStartedAt = Date.now();
  emitToolCall(input, input.plan, input.job.id, {
    phase: "started",
    toolCallId,
    toolName: "generate_canvas_image_job",
    input: {
      planId: input.plan.id,
      jobId: input.job.id,
      role: input.job.role,
      prompt: input.job.prompt,
      count: input.job.count,
      size: input.job.size ?? input.plan.defaults.size,
      quality: input.job.quality ?? input.plan.defaults.quality,
      outputFormat: input.job.outputFormat ?? input.plan.defaults.outputFormat,
      referenceCount: input.job.references.length,
      references: input.job.references.map((reference) => ({ ...reference }))
    }
  });

  try {
    throwIfAborted(input.signal);
    const references = await resolveJobReferences(input.plan, input.job, input.selectedReferencesByKey);
    throwIfAborted(input.signal);

    const request = createJobImageProviderInput(input.plan, input.job);
    const response =
      references.referenceImages.length > 0
        ? await runReferenceImageGeneration(
          {
            ...request,
            referenceImages: references.referenceImages,
            referenceAssetIds: references.referenceAssetIds,
            referenceAssetId: references.referenceAssetIds[0]
          },
          input.provider,
          input.signal
        )
        : await runTextToImageGeneration(request, input.provider, input.signal);
    throwIfAborted(input.signal);

    input.job.outputs = response.record.outputs;
    const successfulOutputs = response.record.outputs.filter((output) => output.status === "succeeded" && output.asset);
    const failedOutputs = response.record.outputs.filter((output) => output.status === "failed");
    input.job.status = successfulOutputs.length > 0 && failedOutputs.length === 0 ? "succeeded" : "failed";
    input.job.error =
      input.job.status === "failed"
        ? response.record.error ?? failedOutputs[0]?.error ?? "Workflow image generation failed."
        : undefined;
    input.plan.updatedAt = new Date().toISOString();
    emitToolCall(input, input.plan, input.job.id, {
      phase: input.job.status === "succeeded" ? "completed" : "failed",
      toolCallId,
      toolName: "generate_canvas_image_job",
      durationMs: Date.now() - toolStartedAt,
      output: {
        generationId: response.record.id,
        status: response.record.status,
        outputCount: response.record.outputs.length,
        successfulOutputCount: successfulOutputs.length,
        failedOutputCount: failedOutputs.length,
        referenceAssetIds: references.referenceAssetIds
      },
      error: input.job.error
    });

    for (const output of successfulOutputs) {
      if (output.asset) {
        emitAssetPreview(input, input.plan, input.job.id, output.id, output.asset);
      }
    }

    if (input.job.status === "succeeded") {
      emitJobCompleted(input, input.plan, input.job.id, input.job.outputs, response.record);
    } else {
      emitJobFailed(input, input.plan, input.job.id, input.job.error ?? "Workflow image generation failed.");
    }
    emitPlanUpdated(input, input.plan);
  } catch (error) {
    if (isAbortError(error, input.signal)) {
      input.job.status = "cancelled";
      input.job.error = "Workflow run was cancelled.";
      input.plan.updatedAt = new Date().toISOString();
      emitToolCall(input, input.plan, input.job.id, {
        phase: "failed",
        toolCallId,
        toolName: "generate_canvas_image_job",
        durationMs: Date.now() - toolStartedAt,
        error: input.job.error
      });
      emitPlanUpdated(input, input.plan);
      return;
    }

    input.job.status = "failed";
    input.job.outputs = [];
    input.job.error = errorToMessage(error);
    input.plan.updatedAt = new Date().toISOString();
    emitToolCall(input, input.plan, input.job.id, {
      phase: "failed",
      toolCallId,
      toolName: "generate_canvas_image_job",
      durationMs: Date.now() - toolStartedAt,
      error: input.job.error
    });
    emitJobFailed(input, input.plan, input.job.id, input.job.error);
    emitPlanUpdated(input, input.plan);
  }
}

function createJobImageProviderInput(plan: GenerationPlan, job: GenerationJob): ImageProviderInput {
  const size = job.size ?? plan.defaults.size;
  const quality = job.quality ?? plan.defaults.quality;
  const outputFormat = job.outputFormat ?? plan.defaults.outputFormat;
  const presetId = plan.defaults.stylePresetId ?? "none";

  return {
    model: job.model,
    originalPrompt: job.prompt,
    presetId,
    prompt: composePrompt(job.prompt, presetId),
    size,
    sizeApiValue: sizeToApiValue(size),
    quality,
    outputFormat,
    count: job.count
  };
}

function markRunnableJobsBlocked(plan: GenerationPlan, reason: string): void {
  for (const job of plan.jobs) {
    if (job.status === "queued" || job.status === "running") {
      job.status = "blocked";
      job.error = reason;
      job.outputs = [];
    }
  }
}

function markPlanCancelled(plan: GenerationPlan): void {
  plan.status = "cancelled";
  plan.updatedAt = new Date().toISOString();
  plan.jobs = plan.jobs.map((job) =>
    job.status === "queued" || job.status === "running"
      ? {
        ...job,
        status: "cancelled",
        error: job.error ?? "Workflow run was cancelled."
      }
      : job
  );
}

export type { StoredWorkflowGenerationPlan } from "./execution-types.js";

export type { WorkflowPlanExecutionMode } from "./execution-types.js";

export type { WorkflowPlanExecutionInput } from "./execution-types.js";

export type { WorkflowPlanExecutionResult } from "./execution-types.js";

export { isExecutableGenerationPlan } from "./validation.js";
