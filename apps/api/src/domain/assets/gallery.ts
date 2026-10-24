import {
  type GalleryImageItem,
  type GalleryResponse,
  type ImageMode,
  type ImageQuality,
  type OutputFormat
} from "@insboard/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../infrastructure/database.js";
import { assets, generationOutputs, generationRecords } from "../../infrastructure/schema.js";
import { toGeneratedAsset } from "../generation/history.js";

export interface GalleryExportAsset {
  outputId: string;
  assetId: string;
  fileName: string;
  mimeType: string;
}

export function getGalleryImages(): GalleryResponse {
  const rows = db
    .select({
      output: generationOutputs,
      generation: generationRecords,
      asset: assets
    })
    .from(generationOutputs)
    .innerJoin(generationRecords, eq(generationOutputs.generationId, generationRecords.id))
    .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
    .where(eq(generationOutputs.status, "succeeded"))
    .orderBy(desc(generationOutputs.createdAt))
    .all();

  return {
    items: rows.map(({ output, generation, asset }) => ({
      outputId: output.id,
      generationId: generation.id,
      mode: generation.mode as ImageMode,
      prompt: generation.prompt,
      effectivePrompt: generation.effectivePrompt,
      presetId: generation.presetId,
      size: {
        width: generation.width,
        height: generation.height
      },
      quality: generation.quality as ImageQuality,
      outputFormat: generation.outputFormat as OutputFormat,
      createdAt: output.createdAt,
      asset: toGeneratedAsset(asset)
    })).filter((item): item is GalleryImageItem => Boolean(item.asset))
  };
}

export function deleteGalleryOutput(outputId: string): boolean {
  const result = db.delete(generationOutputs).where(eq(generationOutputs.id, outputId)).run();
  return result.changes > 0;
}

export function deleteGalleryOutputs(outputIds: string[]): string[] {
  if (outputIds.length === 0) {
    return [];
  }

  const deletedOutputIds: string[] = [];
  for (const outputId of outputIds) {
    if (deleteGalleryOutput(outputId)) {
      deletedOutputIds.push(outputId);
    }
  }

  return deletedOutputIds;
}

export function deleteGalleryOutputsByAssetIds(assetIds: string[]): string[] {
  if (assetIds.length === 0) {
    return [];
  }

  const rows = db
    .select({
      outputId: generationOutputs.id
    })
    .from(generationOutputs)
    .where(and(inArray(generationOutputs.assetId, assetIds), eq(generationOutputs.status, "succeeded")))
    .all();

  return deleteGalleryOutputs(rows.map((row) => row.outputId));
}

export function getGalleryExportAssets(outputIds: string[]): GalleryExportAsset[] {
  if (outputIds.length === 0) {
    return [];
  }

  const rows = db
    .select({
      outputId: generationOutputs.id,
      assetId: assets.id,
      fileName: assets.fileName,
      mimeType: assets.mimeType
    })
    .from(generationOutputs)
    .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
    .where(and(inArray(generationOutputs.id, outputIds), eq(generationOutputs.status, "succeeded")))
    .all();

  const rowByOutputId = new Map(rows.map((row) => [row.outputId, row]));
  return outputIds.flatMap((outputId) => {
    const row = rowByOutputId.get(outputId);
    return row ? [row] : [];
  });
}
