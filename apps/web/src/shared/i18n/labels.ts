import {
  type ImageQuality,
  type OutputFormat,
  type StylePresetId
} from "@insboard/shared";
import { type Locale } from "./types";

export const stylePresetLabels: Record<Locale, Record<StylePresetId, string>> = {
  en: {
    none: "No style",
    photoreal: "Photoreal",
    product: "Commercial product",
    illustration: "Polished illustration",
    poster: "Poster visual",
    avatar: "Avatar character"
  }
};

export const qualityLabels: Record<Locale, Record<ImageQuality, string>> = {
  en: {
    auto: "Auto",
    low: "Fast draft",
    medium: "Standard",
    high: "High quality"
  }
};

export const outputFormatLabels: Record<OutputFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP"
};

export const commonApiErrorMessages: Record<Locale, Record<string, string>> = {
  en: {
    empty_json: "The request body cannot be empty and must be valid JSON.",
    gallery_export_asset_unavailable: "One or more Gallery original assets are unavailable.",
    gallery_export_empty: "Select at least one Gallery image to export.",
    gallery_export_not_found: "One or more Gallery images were not found.",
    internal_error: "Internal server error.",
    invalid_gallery_export_request: "The Gallery export request is invalid.",
    invalid_json: "The request body must be valid JSON.",
    invalid_prompt: "Enter a valid prompt.",
    invalid_request: "The request is invalid.",
    invalid_size: "Provide a valid image size.",
    missing_selected_canvas_reference: "Select the original canvas images to edit.",
    missing_provider: "Save an image API key in settings first.",
    missing_api_key: "The server does not have an available OpenAI API key.",
    generation_in_progress: "Cancel the active generation before deleting its history.",
    not_found: "The requested resource was not found.",
    provider_config_error: "Provider settings could not be saved.",
    upstream_failure: "The upstream image service request failed. Try again later.",
    unsupported_media_type: "The request Content-Type must be application/json.",
    unsupported_provider_behavior: "The image service returned an unsupported result."
  }
};
