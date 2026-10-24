import {
  IMAGE_SIZE_MULTIPLE,
  type ImageQuality,
  type ImageSizeValidationReason,
  MAX_IMAGE_ASPECT_RATIO,
  MAX_IMAGE_DIMENSION,
  MAX_TOTAL_PIXELS,
  MIN_IMAGE_DIMENSION,
  MIN_TOTAL_PIXELS,
  validateImageSize
} from "@insboard/shared";
import { type Locale, type Translate } from "../../shared/i18n";

export const DEFAULT_IMAGE_QUALITY: ImageQuality = "high";

export const RESOLUTION_PRESETS = [
  { id: "1k", label: "1K" },
  { id: "2k", label: "2K" },
  { id: "4k", label: "4K" }
] as const;

export type ResolutionPresetId = (typeof RESOLUTION_PRESETS)[number]["id"];

export const ASPECT_RATIO_PRESETS = [
  { id: "1-1", label: "1:1" },
  { id: "16-9", label: "16:9" },
  { id: "9-16", label: "9:16" },
  { id: "4-3", label: "4:3" },
  { id: "3-4", label: "3:4" },
  { id: "3-2", label: "3:2" },
  { id: "2-3", label: "2:3" }
] as const;

export type AspectRatioPresetId = (typeof ASPECT_RATIO_PRESETS)[number]["id"];

export const SIZE_MATRIX: Record<ResolutionPresetId, Record<AspectRatioPresetId, { width: number; height: number; presetId: string; }>> = {
  "1k": {
    "1-1": { width: 1024, height: 1024, presetId: "square-1k" },
    "16-9": { width: 1824, height: 1024, presetId: "video-16-9" },
    "9-16": { width: 1024, height: 1824, presetId: "story-9-16" },
    "4-3": { width: 1360, height: 1024, presetId: "ratio-4-3-1k" },
    "3-4": { width: 1024, height: 1360, presetId: "ratio-3-4-1k" },
    "3-2": { width: 1536, height: 1024, presetId: "poster-landscape" },
    "2-3": { width: 1024, height: 1536, presetId: "poster-portrait" }
  },
  "2k": {
    "1-1": { width: 2048, height: 2048, presetId: "square-2k" },
    "16-9": { width: 2048, height: 1152, presetId: "wide-2k" },
    "9-16": { width: 1152, height: 2048, presetId: "portrait-2k" },
    "4-3": { width: 2048, height: 1536, presetId: "ratio-4-3-2k" },
    "3-4": { width: 1536, height: 2048, presetId: "ratio-3-4-2k" },
    "3-2": { width: 2016, height: 1344, presetId: "ratio-3-2-2k" },
    "2-3": { width: 1344, height: 2016, presetId: "ratio-2-3-2k" }
  },
  "4k": {
    "1-1": { width: 2880, height: 2880, presetId: "square-4k" },
    "16-9": { width: 3840, height: 2160, presetId: "wide-4k" },
    "9-16": { width: 2160, height: 3840, presetId: "portrait-4k" },
    "4-3": { width: 2880, height: 2160, presetId: "ratio-4-3-4k" },
    "3-4": { width: 2160, height: 2880, presetId: "ratio-3-4-4k" },
    "3-2": { width: 3264, height: 2176, presetId: "ratio-3-2-4k" },
    "2-3": { width: 2176, height: 3264, presetId: "ratio-2-3-4k" }
  }
};

export const DEFAULT_RESOLUTION_PRESET_ID: ResolutionPresetId = "4k";

export const DEFAULT_ASPECT_RATIO_PRESET_ID: AspectRatioPresetId = "9-16";

export const DEFAULT_SIZE = SIZE_MATRIX[DEFAULT_RESOLUTION_PRESET_ID][DEFAULT_ASPECT_RATIO_PRESET_ID];

export function normalizeDimension(value: string): number {
  return Number.parseInt(value, 10);
}

export function sizeValidationMessage(width: number, height: number, t: Translate, locale: Locale): string {
  const result = validateImageSize({ width, height });

  if (result.ok) {
    return "";
  }

  return imageSizeValidationMessage(result.reason, t, locale);
}

export function generationValidationMessage(promptValue: string, widthValue: number, heightValue: number, t: Translate, locale: Locale): string {
  return promptValue.trim() ? sizeValidationMessage(widthValue, heightValue, t, locale) : t("promptRequired");
}

function imageSizeValidationMessage(reason: ImageSizeValidationReason | undefined, t: Translate, locale: Locale): string {
  const numberFormat = new Intl.NumberFormat(locale);

  switch (reason) {
    case "non_integer":
      return t("imageSizeNonInteger");
    case "too_small":
      return t("imageSizeTooSmall", { min: MIN_IMAGE_DIMENSION });
    case "too_large":
      return t("imageSizeTooLarge", { max: MAX_IMAGE_DIMENSION });
    case "not_multiple":
      return t("imageSizeNotMultiple", { multiple: IMAGE_SIZE_MULTIPLE });
    case "aspect_ratio":
      return t("imageSizeAspectRatio", { maxRatio: MAX_IMAGE_ASPECT_RATIO });
    case "total_pixels_too_small":
      return t("imageSizeTotalTooSmall", { minPixels: numberFormat.format(MIN_TOTAL_PIXELS) });
    case "total_pixels_too_large":
      return t("imageSizeTotalTooLarge", { maxPixels: numberFormat.format(MAX_TOTAL_PIXELS) });
    case "unsupported_preset":
      return t("imageSizeUnsupportedPreset");
    default:
      return t("imageSizeUnsupportedPreset");
  }
}

export function sizeSelectionForSize(
  widthValue: number,
  heightValue: number
): { resolutionPresetId: ResolutionPresetId; aspectRatioPresetId: AspectRatioPresetId; sizePresetId: string; } | undefined {
  for (const resolution of RESOLUTION_PRESETS) {
    for (const aspectRatio of ASPECT_RATIO_PRESETS) {
      const size = SIZE_MATRIX[resolution.id][aspectRatio.id];
      if (size.width === widthValue && size.height === heightValue) {
        return {
          resolutionPresetId: resolution.id,
          aspectRatioPresetId: aspectRatio.id,
          sizePresetId: size.presetId
        };
      }
    }
  }

  return undefined;
}
