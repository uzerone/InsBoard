import { CUSTOM_SIZE_PRESET_ID, SIZE_PRESETS, type ImageSize, type ImageSizePresetId } from "./image.js";

export type ValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: string;
      message: string;
      reason?: ImageSizeValidationReason;
    };

export type ImageSizeValidationReason =
  | "non_integer"
  | "too_small"
  | "too_large"
  | "not_multiple"
  | "aspect_ratio"
  | "total_pixels_too_small"
  | "total_pixels_too_large"
  | "unsupported_preset";

export type ImageSizeValidationResult =
  | {
      ok: true;
      size: ImageSize;
      apiValue: string;
      source: "preset" | "custom";
      presetId?: ImageSizePresetId;
    }
  | {
      ok: false;
      code: "invalid_size" | "invalid_size_preset";
      message: string;
      reason?: ImageSizeValidationReason;
    };

export const MIN_IMAGE_DIMENSION = 512;
export const MAX_IMAGE_DIMENSION = 3840;
export const IMAGE_SIZE_MULTIPLE = 16;
export const MIN_TOTAL_PIXELS = 655_360;
export const MAX_TOTAL_PIXELS = 8_294_400;
export const MAX_IMAGE_ASPECT_RATIO = 3;

export function validateImageSize(size: ImageSize): ValidationResult {
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height)) {
    return { ok: false, code: "invalid_size", reason: "non_integer", message: "Width and height must be integers." };
  }
  if (size.width < MIN_IMAGE_DIMENSION || size.height < MIN_IMAGE_DIMENSION) {
    return { ok: false, code: "invalid_size", reason: "too_small", message: `Width and height must be at least ${MIN_IMAGE_DIMENSION}px.` };
  }
  if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
    return { ok: false, code: "invalid_size", reason: "too_large", message: `Width and height cannot exceed ${MAX_IMAGE_DIMENSION}px.` };
  }
  if (size.width % IMAGE_SIZE_MULTIPLE !== 0 || size.height % IMAGE_SIZE_MULTIPLE !== 0) {
    return { ok: false, code: "invalid_size", reason: "not_multiple", message: `Width and height must be multiples of ${IMAGE_SIZE_MULTIPLE}px.` };
  }
  if (Math.max(size.width, size.height) / Math.min(size.width, size.height) > MAX_IMAGE_ASPECT_RATIO) {
    return { ok: false, code: "invalid_size", reason: "aspect_ratio", message: `The aspect ratio cannot exceed ${MAX_IMAGE_ASPECT_RATIO}:1.` };
  }
  if (size.width * size.height < MIN_TOTAL_PIXELS) {
    return {
      ok: false,
      code: "invalid_size",
      reason: "total_pixels_too_small",
      message: `Total pixels must be at least ${MIN_TOTAL_PIXELS.toLocaleString("en")}.`
    };
  }
  if (size.width * size.height > MAX_TOTAL_PIXELS) {
    return {
      ok: false,
      code: "invalid_size",
      reason: "total_pixels_too_large",
      message: `Total pixels cannot exceed ${MAX_TOTAL_PIXELS.toLocaleString("en")}.`
    };
  }
  return { ok: true };
}

export function sizeToApiValue(size: ImageSize): string {
  return `${size.width}x${size.height}`;
}

export function validateSceneImageSize(input: {
  size: ImageSize;
  sizePresetId?: string | null;
}): ImageSizeValidationResult {
  const requestedPresetId = input.sizePresetId?.trim();
  const requestedPreset =
    requestedPresetId && requestedPresetId !== CUSTOM_SIZE_PRESET_ID
      ? SIZE_PRESETS.find((preset) => preset.id === requestedPresetId)
      : undefined;

  if (requestedPresetId && requestedPresetId !== CUSTOM_SIZE_PRESET_ID && !requestedPreset) {
    return {
      ok: false,
      code: "invalid_size_preset",
      reason: "unsupported_preset",
      message: "Unsupported size preset."
    };
  }

  const sizeValidation = validateImageSize(input.size);
  if (!sizeValidation.ok) {
    return {
      ok: false,
      code: "invalid_size",
      reason: sizeValidation.reason,
      message: sizeValidation.message
    };
  }

  const matchingPreset = SIZE_PRESETS.find(
    (preset) => preset.width === input.size.width && preset.height === input.size.height
  );

  return {
    ok: true,
    size: input.size,
    apiValue: sizeToApiValue(input.size),
    source: matchingPreset ? "preset" : "custom",
    presetId: matchingPreset?.id ?? CUSTOM_SIZE_PRESET_ID
  };
}
