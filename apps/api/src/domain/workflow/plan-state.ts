import { type GeneratedAsset, type GenerationPlan } from "@insboard/shared";
import { type WorkflowPlanExecutionMode } from "./execution-types.js";

export function preparePlanForExecution(plan: GenerationPlan, mode: WorkflowPlanExecutionMode): GenerationPlan {
  const now = new Date().toISOString();
  const nextPlan = cloneGenerationPlan(plan);
  nextPlan.status = "running";
  nextPlan.updatedAt = now;
  nextPlan.jobs = nextPlan.jobs.map((job) => {
    const shouldKeepSuccessfulJob =
      mode === "retry_failed" && job.status === "succeeded" && job.outputs.some((output) => output.status === "succeeded" && output.asset);

    if (shouldKeepSuccessfulJob) {
      return job;
    }

    return {
      ...job,
      status: "queued",
      outputs: [],
      error: undefined
    };
  });
  return nextPlan;
}

export function dependenciesSucceeded(plan: GenerationPlan, jobId: string): boolean {
  return plan.edges
    .filter((edge) => edge.toJobId === jobId)
    .every((edge) => plan.jobs.find((job) => job.id === edge.fromJobId)?.status === "succeeded");
}

export function dependencyFailed(plan: GenerationPlan, jobId: string): boolean {
  return plan.edges
    .filter((edge) => edge.toJobId === jobId)
    .some((edge) => {
      const status = plan.jobs.find((job) => job.id === edge.fromJobId)?.status;
      return status === "failed" || status === "blocked" || status === "cancelled";
    });
}

export function resolvePlanStatus(plan: GenerationPlan): GenerationPlan["status"] {
  const statuses = plan.jobs.map((job) => job.status);
  if (statuses.every((status) => status === "succeeded")) {
    return "succeeded";
  }
  if (statuses.some((status) => status === "succeeded")) {
    return "partial";
  }
  if (statuses.some((status) => status === "cancelled")) {
    return "cancelled";
  }
  return "failed";
}

export function cloneGenerationPlan(plan: GenerationPlan): GenerationPlan {
  return {
    ...plan,
    defaults: {
      ...plan.defaults,
      size: { ...plan.defaults.size }
    },
    jobs: plan.jobs.map((job) => ({
      ...job,
      size: job.size ? { ...job.size } : undefined,
      references: job.references.map((reference) => ({ ...reference })),
      outputs: job.outputs.map((output) => ({
        ...output,
        asset: output.asset ? cloneGeneratedAsset(output.asset) : undefined
      }))
    })),
    edges: plan.edges.map((edge) => ({ ...edge }))
  };
}

function cloneGeneratedAsset(asset: GeneratedAsset): GeneratedAsset {
  return {
    ...asset,
  };
}
