import {
  type GenerationRecord as ApiGenerationRecord,
  type GeneratedAsset,
  type GenerationStatus,
  type ImageMode,
  type ImageQuality,
  type OutputFormat,
  type OutputStatus
} from "@insboard/shared";
import { desc, inArray } from "drizzle-orm";
import { db } from "../../infrastructure/database.js";
import {
  assets,
  generationOutputs,
  generationRecords,
  generationReferenceAssets
} from "../../infrastructure/schema.js";
import { formatErrorSummary, warnOnce } from "../project/diagnostics.js";
import { ProjectStoreUnavailableError } from "../project/errors.js";

export function getGenerationHistory(limit = 20): ApiGenerationRecord[] {
  try {
    return readGenerationHistory(limit);
  } catch (error) {
    warnOnce(
      "history-read-fallback",
      `Generation history could not be read; returning an empty history. ${formatErrorSummary(error)}`
    );
    return [];
  }
}

function queryInBatches<T>(ids: string[], read: (batch: string[]) => T[]): T[] {
  const unique = [...new Set(ids)];
  const results: T[] = [];
  for (let offset = 0; offset < unique.length; offset += 900) results.push(...read(unique.slice(offset, offset + 900)));
  return results;
}

export function readGenerationHistory(limit: number, strict = false): ApiGenerationRecord[] {
  const records = db.select().from(generationRecords).orderBy(desc(generationRecords.createdAt)).limit(limit).all();
  if (records.length === 0) {
    return [];
  }

  const generationIds = records.map((record) => record.id);
  const outputs = queryInBatches(generationIds, (batch) => db
    .select()
    .from(generationOutputs)
    .where(inArray(generationOutputs.generationId, batch))
    .orderBy(generationOutputs.createdAt)
    .all());
  const referenceRows = queryInBatches(generationIds, (batch) => db
    .select()
    .from(generationReferenceAssets)
    .where(inArray(generationReferenceAssets.generationId, batch))
    .all())
    .sort((left, right) =>
      left.generationId === right.generationId
        ? left.position - right.position
        : left.generationId.localeCompare(right.generationId)
    );

  const assetIds = outputs.flatMap((output) => (output.assetId ? [output.assetId] : []));
  const assetRows = queryInBatches(assetIds, (batch) => db.select().from(assets).where(inArray(assets.id, batch)).all());
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
  if (strict && assetIds.some((id) => !assetById.has(id))) {
    throw new ProjectStoreUnavailableError("Generation history references missing image metadata.");
  }

  const outputsByGenerationId = new Map<string, typeof outputs>();
  for (const output of outputs) {
    const existing = outputsByGenerationId.get(output.generationId) ?? [];
    existing.push(output);
    outputsByGenerationId.set(output.generationId, existing);
  }
  const referenceAssetIdsByGenerationId = new Map<string, string[]>();
  for (const referenceRow of referenceRows) {
    const existing = referenceAssetIdsByGenerationId.get(referenceRow.generationId) ?? [];
    existing.push(referenceRow.assetId);
    referenceAssetIdsByGenerationId.set(referenceRow.generationId, existing);
  }

  return records.map((record) => {
    const mappedOutputs = (outputsByGenerationId.get(record.id) ?? []).map((output) => ({
      id: output.id,
      status: output.status as OutputStatus,
      asset: output.assetId ? toGeneratedAsset(assetById.get(output.assetId)) : undefined,
      error: output.error ?? undefined
    }));

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
      referenceAssetIds: referenceAssetIdsByGenerationId.get(record.id) ?? (record.referenceAssetId ? [record.referenceAssetId] : undefined),
      referenceAssetId: record.referenceAssetId ?? undefined,
      createdAt: record.createdAt,
      outputs: mappedOutputs
    };
  });
}

export function toGeneratedAsset(asset: (typeof assets.$inferSelect) | undefined): GeneratedAsset | undefined {
  if (!asset) {
    return undefined;
  }

  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    prompt: asset.prompt ?? undefined,
    effectivePrompt: asset.effectivePrompt ?? undefined
  };
}
