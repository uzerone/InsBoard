import {
  type GenerationCount,
  type ImageQuality,
  type OutputFormat,
  type ReferenceImageInput,
  type StylePresetId
} from "@insboard/shared";
import { type TLShapeId } from "../canvas/editor/types";

export type GenerationMode = "text" | "reference";

type PanelStatusTone = "progress" | "success" | "warning" | "error";

export interface PanelStatus {
  tone: PanelStatusTone;
  message: string;
  testId: "generation-progress" | "generation-message" | "generation-warning" | "validation-message" | "generation-error";
}

export interface GenerationSubmitInput {
  model?: string;
  prompt: string;
  presetId: StylePresetId;
  sizePresetId: string;
  size: {
    width: number;
    height: number;
  };
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count: GenerationCount;
}

export interface GenerationReferenceInput {
  referenceImages: ReferenceImageInput[];
  referenceAssetIds?: string[];
}

export interface GenerationPlaceholderPlacement {
  id: TLShapeId;
  x: number;
  y: number;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
}

export interface ActiveGenerationPlaceholders {
  requestId: string;
  placements: GenerationPlaceholderPlacement[];
}

export interface ActiveGenerationTask {
  requestId: string;
  controller: AbortController;
  placeholderSet: ActiveGenerationPlaceholders;
}
