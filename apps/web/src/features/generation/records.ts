import { type GeneratedAsset, type GenerationRecord, type GenerationResponse } from "@insboard/shared";
import { type Translate } from "../../shared/i18n";
import { generationErrorGuidance } from "../../shared/i18n/error-guidance";
import { type GenerationMode, type GenerationSubmitInput } from "./types";

export function isGenerationResponse(value: unknown): value is GenerationResponse {
  return typeof value === "object" && value !== null && "record" in value;
}

function failedOutputMessages(record: GenerationRecord, t: Translate): string[] {
  const failures = new Map<string, number[]>();
  record.outputs.forEach((output, index) => {
    if (output.status !== "failed") return;
    const raw = output.error?.trim() || record.error?.trim() || t("generationErrorDefault");
    const reason = generationErrorGuidance(raw, "en") ?? (/\p{Script=Han}/u.test(raw) ? t("generationNoSuccessfulImage") : raw);
    const numbers = failures.get(reason) ?? [];
    numbers.push(index + 1);
    failures.set(reason, numbers);
  });
  return [...failures].map(([reason, numbers]) => t("generationOutputFailure", { numbers: numbers.join(", "), reason }));
}

export function generationFailureMessage(record: GenerationRecord, t: Translate): string {
  const reasons = failedOutputMessages(record, t);
  if (reasons.length) return reasons.join("\n");
  const summary = record.error?.trim();
  return summary ? generationErrorGuidance(summary, "en") ?? (/\p{Script=Han}/u.test(summary) ? t("generationNoSuccessfulImage") : summary) : t("generationNoSuccessfulImage");
}

export function generationWarningMessage(record: GenerationRecord, insertedCount: number, failedCount: number, t: Translate): string {
  const parts = [t("generationImageInsertedPart", { count: insertedCount })];
  if (failedCount > 0) parts.push(t("generationFailedCount", { count: failedCount }));
  return [parts.join(t("commonListSeparator")), ...failedOutputMessages(record, t)].join("\n");
}

function generationModeToRecordMode(mode: GenerationMode): GenerationRecord["mode"] {
  return mode === "reference" ? "edit" : "generate";
}

export function createTemporaryGenerationRecord(input: {
  requestId: string;
  submitInput: GenerationSubmitInput;
  requestMode: GenerationMode;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
}): GenerationRecord {
  const promptValue = input.submitInput.prompt.trim();
  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : undefined);

  return {
    id: input.requestId,
    mode: generationModeToRecordMode(input.requestMode),
    prompt: promptValue,
    effectivePrompt: promptValue,
    presetId: input.submitInput.presetId,
    size: input.submitInput.size,
    quality: input.submitInput.quality,
    outputFormat: input.submitInput.outputFormat,
    count: input.submitInput.count,
    status: "running",
    referenceAssetIds,
    referenceAssetId: referenceAssetIds?.[0] ?? input.referenceAssetId,
    createdAt: new Date().toISOString(),
    outputs: []
  };
}

export function generatedAssetsForRecord(record: GenerationRecord): GeneratedAsset[] {
  return record.outputs.flatMap((output) => (output.status === "succeeded" && output.asset ? [output.asset] : []));
}

export function isActiveGenerationRecord(record: GenerationRecord): boolean {
  return record.status === "pending" || record.status === "running";
}

export function isTerminalGenerationRecord(record: GenerationRecord): boolean {
  return record.status === "succeeded" || record.status === "partial" || record.status === "failed" || record.status === "cancelled";
}
