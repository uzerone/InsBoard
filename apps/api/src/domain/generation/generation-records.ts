import {
  type GenerationOutput,
  type GenerationRecord,
  type GenerationStatus,
  type ImageMode,
  type ImageQuality,
  type OutputFormat,
  type OutputStatus
} from "@insboard/shared";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../infrastructure/database.js";
import {
  assets,
  generationOutputs,
  generationRecords,
  generationReferenceAssets
} from "../../infrastructure/schema.js";
import { toGeneratedAsset } from "../assets/asset-store.js";
import { sanitizeGenerationErrorMessage } from "./provider-call.js";
import { type BatchOutputResult, type PersistedGenerationInput } from "./types.js";

const INTERRUPTED_GENERATION_ERROR = "Generation was interrupted by an API restart. Rerun it from history.";

const CANCELLED_GENERATION_ERROR = "This generation was cancelled.";

export function getGenerationRecord(generationId: string): GenerationRecord | undefined {
  return readGenerationRecord(generationId);
}

export function deleteGenerationHistory(generationId?: string): string[] {
  const completed = inArray(generationRecords.status, ["succeeded", "partial", "failed", "cancelled"]);
  return db.delete(generationRecords)
    .where(generationId ? and(eq(generationRecords.id, generationId), completed) : completed)
    .returning({ id: generationRecords.id })
    .all()
    .map((record) => record.id);
}

export function cancelGenerationRecord(generationId: string): GenerationRecord | undefined {
  return updateGenerationRecordStatus(generationId, "cancelled", CANCELLED_GENERATION_ERROR);
}

export function failGenerationRecord(generationId: string, error: string): GenerationRecord | undefined {
  return updateGenerationRecordStatus(generationId, "failed", sanitizeGenerationErrorMessage(error));
}

export function markInterruptedGenerationRecordsFailed(): void {
  db.update(generationRecords)
    .set({
      status: "failed",
      error: INTERRUPTED_GENERATION_ERROR
    })
    .where(inArray(generationRecords.status, ["pending", "running"]))
    .run();
}

export function createRunningGenerationRecord(input: PersistedGenerationInput): GenerationRecord {
  const createdAt = new Date().toISOString();
  const generationId = input.clientRequestId || randomUUID();
  const existing = readGenerationRecord(generationId);
  if (existing) {
    return existing;
  }

  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  db.insert(generationRecords)
    .values({
      id: generationId,
      mode: input.mode,
      prompt: input.originalPrompt,
      effectivePrompt: input.prompt,
      presetId: input.presetId,
      width: input.size.width,
      height: input.size.height,
      quality: input.quality,
      outputFormat: input.outputFormat,
      count: input.count,
      status: "running",
      error: null,
      referenceAssetId: primaryReferenceAssetId ?? null,
      createdAt
    })
    .run();

  referenceAssetIds.forEach((assetId, position) => {
    db.insert(generationReferenceAssets)
      .values({
        generationId,
        assetId,
        position,
        createdAt
      })
      .run();
  });

  return {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status: "running",
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt,
    outputs: []
  };
}

export function completeGenerationRecord(generationId: string, input: PersistedGenerationInput, outputs: BatchOutputResult[]): GenerationRecord {
  const existing = readGenerationRecord(generationId);
  if (existing && isTerminalGenerationStatus(existing.status)) {
    return existing;
  }

  const successCount = outputs.filter((output) => output.status === "succeeded").length;
  const failureCount = outputs.length - successCount;
  const status = resolveGenerationStatus(successCount, failureCount);
  const error = failureCount > 0 ? `${failureCount} images failed.` : undefined;
  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  db.update(generationRecords)
    .set({
      status,
      error: error ?? null,
      referenceAssetId: primaryReferenceAssetId ?? null
    })
    .where(eq(generationRecords.id, generationId))
    .run();

  db.delete(generationOutputs).where(eq(generationOutputs.generationId, generationId)).run();

  insertGenerationOutputs(generationId, outputs);

  return readGenerationRecord(generationId) ?? {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status,
    error,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    outputs: outputs.map(toGenerationOutput)
  };
}

export function saveCompletedGenerationRecord(generationId: string, input: PersistedGenerationInput, outputs: BatchOutputResult[]): GenerationRecord {
  const createdAt = new Date().toISOString();
  const successCount = outputs.filter((output) => output.status === "succeeded").length;
  const failureCount = outputs.length - successCount;
  const status = resolveGenerationStatus(successCount, failureCount);
  const error = failureCount > 0 ? `${failureCount} images failed to generate.` : undefined;

  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  db.insert(generationRecords)
    .values({
      id: generationId,
      mode: input.mode,
      prompt: input.originalPrompt,
      effectivePrompt: input.prompt,
      presetId: input.presetId,
      width: input.size.width,
      height: input.size.height,
      quality: input.quality,
      outputFormat: input.outputFormat,
      count: input.count,
      status,
      error,
      referenceAssetId: primaryReferenceAssetId ?? null,
      createdAt
    })
    .run();

  referenceAssetIds.forEach((assetId, position) => {
    db.insert(generationReferenceAssets)
      .values({
        generationId,
        assetId,
        position,
        createdAt
      })
      .run();
  });

  for (const output of outputs) {
    if (output.asset) {
      db.insert(assets)
        .values({
          id: output.asset.id,
          fileName: output.asset.fileName,
          relativePath: `assets/${output.asset.fileName}`,
          mimeType: output.asset.mimeType,
          width: output.asset.width,
          height: output.asset.height,
          prompt: output.asset.prompt,
          effectivePrompt: output.asset.effectivePrompt,
          createdAt
        })
        .run();
    }

    db.insert(generationOutputs)
      .values({
        id: output.id,
        generationId,
        status: output.status,
        assetId: output.asset?.id ?? null,
        error: output.error ?? null,
        createdAt
      })
      .run();
  }

  return {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status,
    error,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt,
    outputs: outputs.map(toGenerationOutput)
  };
}

function insertGenerationOutputs(generationId: string, outputs: BatchOutputResult[]): void {
  const createdAt = new Date().toISOString();

  for (const output of outputs) {
    if (output.asset) {
      db.insert(assets)
        .values({
          id: output.asset.id,
          fileName: output.asset.fileName,
          relativePath: `assets/${output.asset.fileName}`,
          mimeType: output.asset.mimeType,
          width: output.asset.width,
          height: output.asset.height,
          prompt: output.asset.prompt,
          effectivePrompt: output.asset.effectivePrompt,
          createdAt
        })
        .run();
    }

    db.insert(generationOutputs)
      .values({
        id: output.id,
        generationId,
        status: output.status,
        assetId: output.asset?.id ?? null,
        error: output.error ?? null,
        createdAt
      })
      .run();
  }
}

function updateGenerationRecordStatus(
  generationId: string,
  status: Extract<GenerationStatus, "cancelled" | "failed">,
  error: string
): GenerationRecord | undefined {
  const existing = readGenerationRecord(generationId);
  if (!existing) {
    return undefined;
  }

  if (isTerminalGenerationStatus(existing.status)) {
    return existing;
  }

  db.update(generationRecords)
    .set({
      status,
      error
    })
    .where(eq(generationRecords.id, generationId))
    .run();

  return readGenerationRecord(generationId);
}

function isTerminalGenerationStatus(status: GenerationStatus): boolean {
  return status === "succeeded" || status === "partial" || status === "failed" || status === "cancelled";
}

function readGenerationRecord(generationId: string): GenerationRecord | undefined {
  const record = db.select().from(generationRecords).where(eq(generationRecords.id, generationId)).get();
  if (!record) {
    return undefined;
  }

  const outputRows = db
    .select()
    .from(generationOutputs)
    .where(eq(generationOutputs.generationId, generationId))
    .orderBy(generationOutputs.createdAt)
    .all();
  const referenceRows = db
    .select()
    .from(generationReferenceAssets)
    .where(eq(generationReferenceAssets.generationId, generationId))
    .all()
    .sort((left, right) => left.position - right.position);
  const assetIds = outputRows.flatMap((output) => (output.assetId ? [output.assetId] : []));
  const assetRows = assetIds.length > 0 ? db.select().from(assets).where(inArray(assets.id, assetIds)).all() : [];
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
  const referenceAssetIds = referenceRows.map((referenceRow) => referenceRow.assetId);

  return {
    id: record.id,
    mode: record.mode as ImageMode,
    prompt: record.prompt,
    effectivePrompt: record.effectivePrompt,
    presetId: record.presetId,
    size: {
      width: record.width,
      height: record.height
    },
    quality: record.quality as ImageQuality,
    outputFormat: record.outputFormat as OutputFormat,
    count: record.count,
    status: record.status as GenerationStatus,
    error: record.error ?? undefined,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : record.referenceAssetId ? [record.referenceAssetId] : undefined,
    referenceAssetId: record.referenceAssetId ?? undefined,
    createdAt: record.createdAt,
    outputs: outputRows.map((output) => ({
      id: output.id,
      status: output.status as OutputStatus,
      asset: output.assetId ? toGeneratedAsset(assetById.get(output.assetId)) : undefined,
      error: output.error ?? undefined
    }))
  };
}

function resolveGenerationStatus(successCount: number, failureCount: number): GenerationStatus {
  if (successCount > 0 && failureCount > 0) {
    return "partial";
  }
  if (successCount > 0) {
    return "succeeded";
  }
  return "failed";
}

function toGenerationOutput(output: BatchOutputResult): GenerationOutput {
  return {
    id: output.id,
    status: output.status,
    asset: output.asset,
    error: output.error
  };
}
