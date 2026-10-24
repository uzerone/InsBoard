import {
  type GenerationPlan,
  type ReferenceImageInput,
  type WorkflowSelectedCanvasReference,
  type WorkflowServerEvent
} from "@insboard/shared";
import { type ImageProvider } from "../../infrastructure/providers/image-provider.js";

export interface StoredWorkflowGenerationPlan {
  plan: GenerationPlan;
  selectedReferences: WorkflowSelectedCanvasReference[];
}

export type WorkflowPlanExecutionMode = "execute" | "retry_failed";

export interface WorkflowPlanExecutionInput extends StoredWorkflowGenerationPlan {
  mode: WorkflowPlanExecutionMode;
  provider?: ImageProvider;
  requestId?: string;
  runId: string;
  signal: AbortSignal;
  sendEvent: (event: WorkflowServerEvent) => void;
  isRunActive: () => boolean;
}

export interface WorkflowPlanExecutionResult {
  status: "succeeded" | "failed" | "cancelled";
  plan: GenerationPlan;
}

export interface ResolvedJobReferences {
  referenceImages: ReferenceImageInput[];
  referenceAssetIds: string[];
}
