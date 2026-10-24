import {
  type AssetMetadataResponse,
  type GeneratedAsset,
  type ImageSize,
  type OutputFormat,
  type ReferenceImageInput
} from "@insboard/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import sharp from "sharp";
import { db } from "../../infrastructure/database.js";
import {
  type EditImageProviderInput,
  type ImageProviderInput,
  ProviderError,
  type ProviderImage
} from "../../infrastructure/providers/image-provider.js";
import { runtimePaths } from "../../infrastructure/runtime.js";
import { assets } from "../../infrastructure/schema.js";
import { LocalAssetStorageAdapter } from "../../infrastructure/storage/asset-storage.js";

const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;

const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

const localAssetStorage = new LocalAssetStorageAdapter();

export interface StoredAssetFile {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
}

const mimeTypes: Record<OutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export async function ensureReferenceAssetIds(input: EditImageProviderInput): Promise<string[]> {
  return Promise.all(
    input.referenceImages.map(async (referenceImage, index) => {
      const existingAssetId = persistedReferenceAssetId(input.referenceAssetIds?.[index]);
      if (existingAssetId) {
        return existingAssetId;
      }

      const savedReferenceAsset = await saveReferenceImageInput(referenceImage);
      return savedReferenceAsset.id;
    })
  );
}

function persistedReferenceAssetId(assetId: string | undefined): string | undefined {
  if (!assetId) {
    return undefined;
  }

  for (const candidateAssetId of persistedReferenceAssetIdCandidates(assetId)) {
    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.id, candidateAssetId)).get();
    if (asset?.id) {
      return asset.id;
    }
  }

  return undefined;
}

function persistedReferenceAssetIdCandidates(assetId: string): string[] {
  const trimmedAssetId = assetId.trim();
  const candidates = [trimmedAssetId];
  const prefixedAssetMatch = /^asset:(.+)$/u.exec(trimmedAssetId);
  if (prefixedAssetMatch?.[1]) {
    candidates.push(prefixedAssetMatch[1]);
  }

  return candidates.filter((candidate, index, values) => candidate && values.indexOf(candidate) === index);
}

export async function saveReferenceImageInput(input: ReferenceImageInput): Promise<GeneratedAsset> {
  const parsed = referenceDataUrlToBytes(input);
  const imageSize = await readImageSize(parsed.bytes);
  if (!imageSize) {
    throw new ProviderError("unsupported_provider_behavior", "Reference image dimensions could not be read.", 400);
  }

  const assetId = randomUUID();
  const extension = extensionForMimeType(parsed.mimeType);
  const fileName = `${assetId}.${extension}`;
  const relativePath = `assets/${fileName}`;
  const filePath = resolve(runtimePaths.dataDir, relativePath);
  const createdAt = new Date().toISOString();

  await localAssetStorage.putObject({ filePath, bytes: parsed.bytes });
  db.insert(assets)
    .values({
      id: assetId,
      fileName,
      relativePath,
      mimeType: parsed.mimeType,
      width: imageSize.width,
      height: imageSize.height,
      createdAt
    })
    .run();

  return {
    id: assetId,
    url: `/api/assets/${assetId}`,
    fileName,
    mimeType: parsed.mimeType,
    width: imageSize.width,
    height: imageSize.height
  };
}

function referenceDataUrlToBytes(input: ReferenceImageInput): { bytes: Buffer; mimeType: string; } {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "Unsupported reference image format.", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "Reference images must be PNG, JPEG or WebP.", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "Reference images cannot exceed 50 MB.", 400);
  }

  return {
    bytes,
    mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType
  };
}

function extensionForMimeType(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
}

export function getStoredAssetFile(assetId: string): StoredAssetFile | undefined {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) {
    return undefined;
  }

  const filePath = resolve(runtimePaths.dataDir, asset.relativePath);
  if (!isInsideDirectory(filePath, runtimePaths.assetsDir)) {
    return undefined;
  }

  return {
    id: asset.id,
    fileName: asset.fileName,
    filePath,
    mimeType: asset.mimeType
  };
}

export async function readStoredAsset(assetId: string): Promise<{ file: StoredAssetFile; bytes: Buffer; } | undefined> {
  const file = getStoredAssetFile(assetId);
  if (!file) {
    return undefined;
  }

  try {
    return {
      file,
      bytes: await localAssetStorage.getObject({ filePath: file.filePath })
    };
  } catch {
    return undefined;
  }
}

export async function readStoredAssetMetadata(assetId: string): Promise<AssetMetadataResponse | undefined> {
  const asset = await readStoredAsset(assetId);
  if (!asset) {
    return undefined;
  }

  const size = await readImageSize(asset.bytes);
  if (!size) {
    return undefined;
  }

  const storedMetadata = db.select().from(assets).where(eq(assets.id, assetId)).get();
  return {
    id: asset.file.id,
    width: size.width,
    height: size.height,
    prompt: storedMetadata?.prompt ?? undefined,
    effectivePrompt: storedMetadata?.effectivePrompt ?? undefined
  };
}

export async function saveProviderImage(image: ProviderImage, input: ImageProviderInput, _signal?: AbortSignal): Promise<GeneratedAsset> {
  const assetId = randomUUID();
  const fileName = `${assetId}.${input.outputFormat === "jpeg" ? "jpg" : input.outputFormat}`;
  const relativePath = `assets/${fileName}`;
  const filePath = resolve(runtimePaths.dataDir, relativePath);
  const mimeType = mimeTypes[input.outputFormat];
  const bytes = Buffer.from(image.b64Json, "base64");
  const imageSize = await readImageSize(bytes);

  if (!imageSize) {
    throw new ProviderError("unsupported_provider_behavior", "Generated image dimensions could not be read.", 502);
  }

  await localAssetStorage.putObject({ filePath, bytes });
  return {
    id: assetId,
    url: `/api/assets/${assetId}`,
    fileName,
    mimeType,
    width: imageSize.width,
    height: imageSize.height,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt
  };
}

async function readImageSize(bytes: Buffer): Promise<ImageSize | undefined> {
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) {
      return undefined;
    }

    return {
      width: metadata.width,
      height: metadata.height
    };
  } catch {
    return undefined;
  }
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

function isInsideDirectory(filePath: string, directory: string): boolean {
  const localPath = relative(directory, filePath);
  return Boolean(localPath) && !localPath.startsWith("..") && !isAbsolute(localPath);
}
