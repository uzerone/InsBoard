import {
  isImageModel,
  type GenerationCount,
  type ImageQuality,
  type ImageSize,
  type OutputFormat,
  type ReferenceImageInput,
  type StylePresetId,
  composePrompt,
  GENERATION_COUNTS,
  IMAGE_QUALITIES,
  MAX_REFERENCE_IMAGES,
  OUTPUT_FORMATS,
  SIZE_PRESETS,
  STYLE_PRESETS,
  validateSceneImageSize
} from "@insboard/shared";
import { getStoredAssetFile } from "../../domain/generation/image-generation.js";
import {
  type EditImageProviderInput,
  type ImageProviderInput
} from "../../infrastructure/providers/image-provider.js";
import { type ParseResult, errorResponse } from "../http/errors.js";
import { isRecord, parseClientRequestId, parseOptionalString } from "./fields.js";

export function parseGeneratePayload(input: unknown): ParseResult<ImageProviderInput> {
  const base = parseBaseImagePayload(input);
  if (!base.ok) {
    return base;
  }

  return {
    ok: true,
    value: base.value
  };
}

export function parseEditPayload(input: unknown): ParseResult<EditImageProviderInput> {
  const base = parseBaseImagePayload(input);
  if (!base.ok) {
    return base;
  }

  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", `Image editing requires 1–${MAX_REFERENCE_IMAGES} reference images.`)
    };
  }

  const referenceImages = parseReferenceImages(input);
  if (!referenceImages.ok) {
    return referenceImages;
  }

  const referenceAssetIds = parseReferenceAssetIds(input, referenceImages.value.length);
  if (!referenceAssetIds.ok) {
    return referenceAssetIds;
  }

  for (const referenceAssetId of referenceAssetIds.value) {
    if (!getStoredAssetFile(referenceAssetId)) {
      return {
        ok: false,
        error: errorResponse("invalid_request", "Reference image assets were not found.")
      };
    }
  }

  return {
    ok: true,
    value: {
      ...base.value,
      referenceImages: referenceImages.value,
      referenceImage: referenceImages.value[0],
      referenceAssetIds: referenceAssetIds.value.length > 0 ? referenceAssetIds.value : undefined,
      referenceAssetId: referenceAssetIds.value[0]
    }
  };
}

function parseReferenceImages(input: Record<string, unknown>): ParseResult<ReferenceImageInput[]> {
  const rawReferenceImages = Array.isArray(input.referenceImages)
    ? input.referenceImages
    : isRecord(input.referenceImage)
      ? [input.referenceImage]
      : undefined;

  if (!rawReferenceImages) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", `Image editing requires 1–${MAX_REFERENCE_IMAGES} reference images.`)
    };
  }

  if (rawReferenceImages.length < 1 || rawReferenceImages.length > MAX_REFERENCE_IMAGES) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", `Provide 1–${MAX_REFERENCE_IMAGES} reference images.`)
    };
  }

  const referenceImages: ReferenceImageInput[] = [];
  for (const rawReferenceImage of rawReferenceImages) {
    if (!isRecord(rawReferenceImage)) {
      return {
        ok: false,
        error: errorResponse("unsupported_provider_behavior", "Unsupported reference image format.")
      };
    }

    const dataUrl = rawReferenceImage.dataUrl;
    if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) {
      return {
        ok: false,
        error: errorResponse("unsupported_provider_behavior", "Unsupported reference image format.")
      };
    }

    const fileName = rawReferenceImage.fileName;
    referenceImages.push({
      dataUrl,
      nodeNumber: Number.isSafeInteger(rawReferenceImage.nodeNumber) && Number(rawReferenceImage.nodeNumber) > 0 ? Number(rawReferenceImage.nodeNumber) : undefined,
      fileName: typeof fileName === "string" && fileName.trim() ? fileName.trim() : undefined
    });
  }

  return {
    ok: true,
    value: referenceImages
  };
}

function parseReferenceAssetIds(input: Record<string, unknown>, referenceImageCount: number): ParseResult<string[]> {
  const legacyReferenceAssetId = parseOptionalString(input.referenceAssetId);
  const rawReferenceAssetIds = Array.isArray(input.referenceAssetIds)
    ? input.referenceAssetIds
    : legacyReferenceAssetId
      ? [legacyReferenceAssetId]
      : [];

  if (
    rawReferenceAssetIds.length > MAX_REFERENCE_IMAGES ||
    (rawReferenceAssetIds.length > 0 && rawReferenceAssetIds.length !== referenceImageCount)
  ) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Reference asset IDs must match the reference image count.")
    };
  }

  const referenceAssetIds: string[] = [];
  for (const rawReferenceAssetId of rawReferenceAssetIds) {
    const referenceAssetId = parseOptionalString(rawReferenceAssetId);
    if (!referenceAssetId) {
      return {
        ok: false,
        error: errorResponse("invalid_request", "Unsupported reference asset ID format.")
      };
    }

    referenceAssetIds.push(referenceAssetId);
  }

  return {
    ok: true,
    value: referenceAssetIds
  };
}

function parseBaseImagePayload(input: unknown): ParseResult<ImageProviderInput> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "The request must be a JSON object.")
    };
  }

  if (input.model !== undefined && !isImageModel(input.model)) {
    return { ok: false, error: errorResponse("invalid_model", "Enter a model ID without spaces (up to 200 characters).") };
  }

  const prompt = input.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "Enter a valid prompt.")
    };
  }

  const stylePreset = parseStylePreset(input);
  if (!stylePreset.ok) {
    return stylePreset;
  }

  const size = parseSize(input.size);
  if (!size.ok) {
    return size;
  }

  const sizePresetId = parseOptionalString(input.sizePresetId) ?? parseOptionalString(input.scenePresetId) ?? parseSizePresetFromPresetId(input.presetId);
  const resolvedSize = validateSceneImageSize({
    size: size.value,
    sizePresetId
  });

  if (!resolvedSize.ok) {
    return {
      ok: false,
      error: errorResponse(resolvedSize.code, resolvedSize.message)
    };
  }

  const quality = parseQuality(input.quality);
  if (!quality.ok) {
    return quality;
  }

  const outputFormat = parseOutputFormat(input.outputFormat);
  if (!outputFormat.ok) {
    return outputFormat;
  }

  const count = parseCount(input.count);
  if (!count.ok) {
    return count;
  }

  const clientRequestId = parseClientRequestId(input.clientRequestId);
  if (!clientRequestId.ok) {
    return clientRequestId;
  }

  return {
    ok: true,
    value: {
      model: input.model as string | undefined,
      originalPrompt: prompt.trim(),
      clientRequestId: clientRequestId.value,
      presetId: stylePreset.value,
      prompt: composePrompt(prompt, stylePreset.value),
      size: resolvedSize.size,
      sizeApiValue: resolvedSize.apiValue,
      quality: quality.value,
      outputFormat: outputFormat.value,
      count: count.value
    }
  };
}

function parseStylePreset(input: Record<string, unknown>): ParseResult<StylePresetId> {
  const presetId = parseOptionalString(input.stylePresetId) ?? parseStylePresetFromPresetId(input.presetId) ?? "none";

  if (!STYLE_PRESETS.some((preset) => preset.id === presetId)) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "Unsupported style preset.")
    };
  }

  return {
    ok: true,
    value: presetId as StylePresetId
  };
}

function parseSize(value: unknown): ParseResult<ImageSize> {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: errorResponse("invalid_size", "Provide a valid image size.")
    };
  }

  return {
    ok: true,
    value: {
      width: parseDimension(value.width),
      height: parseDimension(value.height)
    }
  };
}

function parseQuality(value: unknown): ParseResult<ImageQuality> {
  if (value === undefined) {
    return {
      ok: true,
      value: "auto"
    };
  }

  if (typeof value === "string" && IMAGE_QUALITIES.includes(value as ImageQuality)) {
    return {
      ok: true,
      value: value as ImageQuality
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "Unsupported image quality.")
  };
}

function parseOutputFormat(value: unknown): ParseResult<OutputFormat> {
  if (value === undefined) {
    return {
      ok: true,
      value: "png"
    };
  }

  if (typeof value === "string" && OUTPUT_FORMATS.includes(value as OutputFormat)) {
    return {
      ok: true,
      value: value as OutputFormat
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "Unsupported output format.")
  };
}

function parseCount(value: unknown): ParseResult<GenerationCount> {
  if (value === undefined) {
    return {
      ok: true,
      value: 1
    };
  }

  if (typeof value === "number" && GENERATION_COUNTS.includes(value as GenerationCount)) {
    return {
      ok: true,
      value: value as GenerationCount
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "Image count must be 1, 2, 4, 8 or 16.")
  };
}

function parseDimension(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function parseStylePresetFromPresetId(value: unknown): string | undefined {
  const presetId = parseOptionalString(value);
  return presetId && STYLE_PRESETS.some((preset) => preset.id === presetId) ? presetId : undefined;
}

function parseSizePresetFromPresetId(value: unknown): string | undefined {
  const presetId = parseOptionalString(value);
  return presetId && SIZE_PRESETS.some((preset) => preset.id === presetId) ? presetId : undefined;
}
