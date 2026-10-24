import {
  isImageModel,
  dependencyGraphError,
  MAX_GENERATION_JOB_REFERENCES,
  MAX_GENERATION_PLAN_IMAGES,
  type GenerationJob,
  type GenerationPlan,
  type GenerationReference,
  type ImageQuality,
  type ImageSize,
  type OutputFormat
} from "@insboard/shared";

export function isExecutableGenerationPlan(value: unknown): value is GenerationPlan {
  if (!isRecord(value)) {
    return false;
  }

  const jobs = Array.isArray(value.jobs) ? value.jobs : [];
  const edges = Array.isArray(value.edges) ? value.edges : [];

  return (
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isPlanStatus(value.status) &&
    isRecord(value.defaults) &&
    isImageSize(value.defaults.size) &&
    isQuality(value.defaults.quality) &&
    isOutputFormat(value.defaults.outputFormat) &&
    Array.isArray(value.jobs) &&
    jobs.every(isExecutableGenerationJob) &&
    Array.isArray(value.edges) &&
    edges.every(isDependencyEdge) &&
    executionPlanWithinBounds(jobs as GenerationJob[], edges as Array<{ fromJobId: string; toJobId: string; }>) &&
    (value.createdBy === "agent" || value.createdBy === "user") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isExecutableGenerationJob(value: unknown): value is GenerationJob {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    (value.model === undefined || isImageModel(value.model)) &&
    typeof value.prompt === "string" &&
    isExecutableGenerationCount(value.count) &&
    isJobRole(value.role) &&
    isJobStatus(value.status) &&
    (value.size === undefined || isImageSize(value.size)) &&
    (value.quality === undefined || isQuality(value.quality)) &&
    (value.outputFormat === undefined || isOutputFormat(value.outputFormat)) &&
    Array.isArray(value.references) &&
    value.references.every(isGenerationReference) &&
    Array.isArray(value.outputs) &&
    typeof value.visible === "boolean" &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isExecutableGenerationCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_GENERATION_PLAN_IMAGES;
}

function executionPlanWithinBounds(jobs: GenerationJob[], edges: Array<{ fromJobId: string; toJobId: string; }>): boolean {
  if (!jobs.length || dependencyGraphError(jobs.map((job) => job.id), edges)) return false;
  if (jobs.some((job) => job.references.some((reference) =>
    reference.kind === "generated_output" && !edges.some((edge) => edge.fromJobId === reference.jobId && edge.toJobId === job.id)
  ))) return false;
  const totalOutputCount = jobs.reduce((total, job) => total + job.count, 0);
  if (totalOutputCount > MAX_GENERATION_PLAN_IMAGES) {
    return false;
  }

  if (jobs.some((job) => job.references.length > MAX_GENERATION_JOB_REFERENCES)) {
    return false;
  }

  const sourceJobIds = new Set(edges.map((edge) => edge.fromJobId));
  for (const job of jobs) {
    for (const reference of job.references) {
      if (reference.kind === "generated_output" && reference.jobId) {
        sourceJobIds.add(reference.jobId);
      }
    }
  }

  return jobs.every((job) => !sourceJobIds.has(job.id) || job.count === 1);
}

function isGenerationReference(value: unknown): value is GenerationReference {
  if (!isRecord(value) || !isReferenceUsage(value.usage)) {
    return false;
  }

  if (value.kind === "selected_canvas_image") {
    return value.assetId === undefined || typeof value.assetId === "string";
  }

  if (value.kind === "generated_output") {
    return typeof value.jobId === "string" && (value.outputId === undefined || typeof value.outputId === "string");
  }

  return false;
}

function isDependencyEdge(value: unknown): boolean {
  return isRecord(value) && typeof value.fromJobId === "string" && typeof value.toJobId === "string";
}

function isImageSize(value: unknown): value is ImageSize {
  return (
    isRecord(value) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height)
  );
}

function isPlanStatus(value: unknown): value is GenerationPlan["status"] {
  return isOneOf(value, ["awaiting_confirmation", "confirmed", "running", "succeeded", "partial", "failed", "cancelled"]);
}

function isJobStatus(value: unknown): value is GenerationJob["status"] {
  return isOneOf(value, ["queued", "running", "succeeded", "failed", "blocked", "cancelled"]);
}

function isJobRole(value: unknown): value is GenerationJob["role"] {
  return isOneOf(value, ["final_image", "variation", "character_anchor", "style_anchor", "reference_anchor"]);
}

function isQuality(value: unknown): value is ImageQuality {
  return isOneOf(value, ["auto", "low", "medium", "high"]);
}

function isOutputFormat(value: unknown): value is OutputFormat {
  return isOneOf(value, ["png", "jpeg", "webp"]);
}

function isReferenceUsage(value: unknown): value is GenerationReference["usage"] {
  return isOneOf(value, ["subject", "character", "style", "composition", "scene", "product", "other"]);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
