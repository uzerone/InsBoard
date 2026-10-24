import {
  type GenerationJob,
  type GenerationPlan,
  type GenerationReference,
  type ReferenceImageInput,
  type WorkflowSelectedCanvasReference
} from "@insboard/shared";
import { readStoredAsset } from "../generation/image-generation.js";
import { type ResolvedJobReferences } from "./execution-types.js";

export async function resolveJobReferences(
  plan: GenerationPlan,
  job: GenerationJob,
  selectedReferencesByKey: Map<string, WorkflowSelectedCanvasReference>
): Promise<ResolvedJobReferences> {
  const referenceImages: ReferenceImageInput[] = [];
  const referenceAssetIds: string[] = [];

  for (const reference of job.references) {
    const resolved = await resolveGenerationReference(plan, reference, selectedReferencesByKey);
    const nodeNumber = reference.nodeNumber ?? (reference.kind === "selected_canvas_image"
      ? selectedReferenceFor(reference, selectedReferencesByKey)?.nodeNumber
      : undefined);
    referenceImages.push({ ...resolved.referenceImage, nodeNumber });
    if (resolved.assetId) {
      referenceAssetIds.push(resolved.assetId);
    }
  }

  return {
    referenceImages,
    referenceAssetIds
  };
}

async function resolveGenerationReference(
  plan: GenerationPlan,
  reference: GenerationReference,
  selectedReferencesByKey: Map<string, WorkflowSelectedCanvasReference>
): Promise<{ referenceImage: ReferenceImageInput; assetId?: string; }> {
  if (reference.kind === "selected_canvas_image") {
    const selected = selectedReferenceFor(reference, selectedReferencesByKey);
    if (selected?.dataUrl) {
      return {
        referenceImage: {
          dataUrl: selected.dataUrl,
          fileName: fileNameForReference(selected.label ?? selected.assetId, selected.mimeType)
        },
        assetId: selected.assetId
      };
    }

    const assetId = selected?.assetId ?? reference.assetId;
    if (assetId) {
      const stored = await storedAssetReference(assetId);
      if (stored) {
        return stored;
      }
    }

    throw new Error(`Selected reference "${reference.assetId ?? reference.label ?? "unknown"}" is not available to the Workflow executor.`);
  }

  const sourceJob = reference.jobId ? plan.jobs.find((job) => job.id === reference.jobId) : undefined;
  const sourceOutput = sourceJob
    ? sourceJob.outputs.find((output) =>
      reference.outputId ? output.id === reference.outputId || output.asset?.id === reference.outputId : output.status === "succeeded" && output.asset
    )
    : undefined;
  const assetId = sourceOutput?.asset?.id;
  if (!assetId) {
    throw new Error(`Generated reference "${reference.jobId ?? "unknown"}" has no available output.`);
  }

  const stored = await storedAssetReference(assetId);
  if (!stored) {
    throw new Error(`Generated reference asset "${assetId}" is not available.`);
  }

  return stored;
}

async function storedAssetReference(assetId: string): Promise<{ referenceImage: ReferenceImageInput; assetId: string; } | undefined> {
  for (const candidateAssetId of storedAssetIdCandidates(assetId)) {
    const stored = await readStoredAsset(candidateAssetId);
    if (!stored) {
      continue;
    }

    return {
      referenceImage: {
        dataUrl: `data:${stored.file.mimeType};base64,${stored.bytes.toString("base64")}`,
        fileName: stored.file.fileName
      },
      assetId: stored.file.id
    };
  }

  return undefined;
}

function selectedReferenceFor(
  reference: GenerationReference,
  selectedReferencesByKey: Map<string, WorkflowSelectedCanvasReference>
): WorkflowSelectedCanvasReference | undefined {
  const keys = [...selectedReferenceLookupKeys(reference.assetId), ...selectedReferenceLookupKeys(reference.label)];
  for (const key of keys) {
    const selected = selectedReferencesByKey.get(key);
    if (selected) {
      return selected;
    }
  }

  return undefined;
}

export function createSelectedReferenceMap(references: WorkflowSelectedCanvasReference[]): Map<string, WorkflowSelectedCanvasReference> {
  const map = new Map<string, WorkflowSelectedCanvasReference>();
  references.forEach((reference, index) => {
    addSelectedReferenceMapEntries(map, reference, reference.id);
    addSelectedReferenceMapEntries(map, reference, reference.assetId);
    addSelectedReferenceMapEntries(map, reference, reference.label);
    addSelectedReferenceMapEntries(map, reference, `${index + 1}`);
    addSelectedReferenceMapEntries(map, reference, `ref${index + 1}`);
    addSelectedReferenceMapEntries(map, reference, `selected-${index + 1}`);
  });

  return map;
}

function addSelectedReferenceMapEntries(
  map: Map<string, WorkflowSelectedCanvasReference>,
  reference: WorkflowSelectedCanvasReference,
  value: string | undefined
): void {
  for (const key of selectedReferenceLookupKeys(value)) {
    if (!map.has(key)) {
      map.set(key, reference);
    }
  }
}

function selectedReferenceLookupKeys(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return [...storedAssetIdCandidates(value), value.trim()].filter((key, index, keys) => key && keys.indexOf(key) === index);
}

function storedAssetIdCandidates(assetId: string): string[] {
  const trimmed = assetId.trim();
  const candidates = [trimmed];
  const prefixedAssetMatch = /^asset:(.+)$/u.exec(trimmed);
  if (prefixedAssetMatch?.[1]) {
    candidates.push(prefixedAssetMatch[1]);
  }

  return candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index);
}

function fileNameForReference(label: string | undefined, mimeType: string | undefined): string | undefined {
  if (!label) {
    return undefined;
  }

  if (/\.(png|jpe?g|webp)$/iu.test(label)) {
    return label;
  }

  if (!mimeType) {
    return label;
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
  return `${label}.${extension}`;
}
