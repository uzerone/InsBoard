import {
  type GenerationCount,
  type ImageQuality,
  type OutputFormat,
  type StylePresetId,
  IMAGE_MODEL,
  CUSTOM_SIZE_PRESET_ID
} from "@insboard/shared";
import { useState } from "react";
import {
  type AspectRatioPresetId,
  type ResolutionPresetId,
  ASPECT_RATIO_PRESETS,
  DEFAULT_ASPECT_RATIO_PRESET_ID,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_RESOLUTION_PRESET_ID,
  DEFAULT_SIZE,
  normalizeDimension,
  RESOLUTION_PRESETS,
  SIZE_MATRIX,
  sizeSelectionForSize
} from "./options";

export function useGenerationForm() {
  const [model, setModel] = useState<string>(IMAGE_MODEL);
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<StylePresetId>("none");
  const [resolutionPresetId, setResolutionPresetId] = useState<ResolutionPresetId>(DEFAULT_RESOLUTION_PRESET_ID);
  const [aspectRatioPresetId, setAspectRatioPresetId] = useState<AspectRatioPresetId>(DEFAULT_ASPECT_RATIO_PRESET_ID);
  const [sizePresetId, setSizePresetId] = useState(DEFAULT_SIZE.presetId);
  const [width, setWidth] = useState(DEFAULT_SIZE.width);
  const [height, setHeight] = useState(DEFAULT_SIZE.height);
  const [count, setCount] = useState<GenerationCount>(1);
  const [quality, setQuality] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");

  function applySizeSelection(
    nextResolutionPresetId: ResolutionPresetId,
    nextAspectRatioPresetId: AspectRatioPresetId
  ): void {
    const nextSize = SIZE_MATRIX[nextResolutionPresetId][nextAspectRatioPresetId];
    setResolutionPresetId(nextResolutionPresetId);
    setAspectRatioPresetId(nextAspectRatioPresetId);
    setSizePresetId(nextSize.presetId);
    setWidth(nextSize.width);
    setHeight(nextSize.height);
  }

  function selectResolutionPreset(nextPresetId: string): void {
    const nextResolutionPreset = RESOLUTION_PRESETS.find((preset) => preset.id === nextPresetId);
    if (!nextResolutionPreset) {
      return;
    }

    applySizeSelection(nextResolutionPreset.id, aspectRatioPresetId);
  }

  function selectAspectRatioPreset(nextPresetId: string): void {
    const nextAspectRatioPreset = ASPECT_RATIO_PRESETS.find((preset) => preset.id === nextPresetId);
    if (!nextAspectRatioPreset) {
      return;
    }

    applySizeSelection(resolutionPresetId, nextAspectRatioPreset.id);
  }

  function syncSizeSelection(widthValue: number, heightValue: number): void {
    const selection = sizeSelectionForSize(widthValue, heightValue);
    if (!selection) {
      setSizePresetId(CUSTOM_SIZE_PRESET_ID);
      return;
    }

    setResolutionPresetId(selection.resolutionPresetId);
    setAspectRatioPresetId(selection.aspectRatioPresetId);
    setSizePresetId(selection.sizePresetId);
  }

  function updateWidth(value: string): void {
    const nextWidth = normalizeDimension(value);
    setWidth(nextWidth);
    syncSizeSelection(nextWidth, height);
  }

  function updateHeight(value: string): void {
    const nextHeight = normalizeDimension(value);
    setHeight(nextHeight);
    syncSizeSelection(width, nextHeight);
  }

  return {
    model,
    setModel,
    prompt,
    setPrompt,
    stylePreset,
    setStylePreset,
    resolutionPresetId,
    aspectRatioPresetId,
    sizePresetId,
    width,
    height,
    count,
    setCount,
    quality,
    setQuality,
    outputFormat,
    setOutputFormat,
    selectResolutionPreset,
    selectAspectRatioPreset,
    updateWidth,
    updateHeight
  };
}
