import { type GenerationRecord, type GenerationResponse } from "@insboard/shared";
import { randomUUID } from "node:crypto";
import {
  type EditImageProviderInput,
  type ImageProvider,
  type ImageProviderInput,
  ProviderError
} from "../../infrastructure/providers/image-provider.js";
import { ensureReferenceAssetIds, saveProviderImage } from "../assets/asset-store.js";
import {
  completeGenerationRecord,
  createRunningGenerationRecord,
  saveCompletedGenerationRecord
} from "./generation-records.js";
import {
  callProviderWithRetry,
  errorToMessage,
  isAbortError,
  mapWithConcurrency,
  throwIfAborted
} from "./provider-call.js";
import { type BatchOutputResult } from "./types.js";

const BATCH_CONCURRENCY = 2;

export async function runTextToImageGeneration(input: ImageProviderInput, provider: ImageProvider, signal?: AbortSignal): Promise<GenerationResponse> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => generateSingleOutput(input, provider, signal)
  );

  const record = saveCompletedGenerationRecord(
    randomUUID(),
    {
      ...input,
      mode: "generate"
    },
    outputs
  );

  return {
    record
  };
}

function numberedReferencePrompt(input: EditImageProviderInput): string {
  const mapping = input.referenceImages.flatMap((reference, index) =>
    Number.isSafeInteger(reference.nodeNumber) && Number(reference.nodeNumber) > 0
      ? [`Input image ${index + 1} = canvas node #${reference.nodeNumber}.`]
      : []
  );
  if (!mapping.length) return input.prompt;
  return `${input.prompt}\n\nCanvas reference mapping (numbers identify source images, not text to draw):\n${mapping.join("\n")}\nResolve image numbers in the request using this mapping, not upload position.`;
}

export async function runReferenceImageGeneration(
  input: EditImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal
): Promise<GenerationResponse> {
  const referenceAssetIds = await ensureReferenceAssetIds(input);
  const inputWithReferenceAssets: EditImageProviderInput = {
    ...input,
    prompt: numberedReferencePrompt(input),
    referenceAssetIds,
    referenceAssetId: referenceAssetIds[0]
  };

  const outputs = await mapWithConcurrency(
    Array.from({ length: inputWithReferenceAssets.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => editSingleOutput(inputWithReferenceAssets, provider, signal)
  );

  const record = saveCompletedGenerationRecord(
    randomUUID(),
    {
      ...inputWithReferenceAssets,
      mode: "edit"
    },
    outputs
  );

  return {
    record
  };
}

export function createRunningTextToImageGeneration(input: ImageProviderInput): GenerationRecord {
  return createRunningGenerationRecord({
    ...input,
    mode: "generate"
  });
}

export async function createRunningReferenceImageGeneration(
  input: EditImageProviderInput
): Promise<{ record: GenerationRecord; input: EditImageProviderInput; }> {
  const referenceAssetIds = await ensureReferenceAssetIds(input);
  const inputWithReferenceAssets: EditImageProviderInput = {
    ...input,
    prompt: numberedReferencePrompt(input),
    referenceAssetIds,
    referenceAssetId: referenceAssetIds[0]
  };

  return {
    record: createRunningGenerationRecord({
      ...inputWithReferenceAssets,
      mode: "edit"
    }),
    input: inputWithReferenceAssets
  };
}

export async function finishTextToImageGeneration(
  generationId: string,
  input: ImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal
): Promise<GenerationRecord> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => generateSingleOutput(input, provider, signal)
  );
  throwIfAborted(signal);

  return completeGenerationRecord(
    generationId,
    {
      ...input,
      mode: "generate"
    },
    outputs
  );
}

export async function finishReferenceImageGeneration(
  generationId: string,
  input: EditImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal
): Promise<GenerationRecord> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => editSingleOutput(input, provider, signal)
  );
  throwIfAborted(signal);

  return completeGenerationRecord(
    generationId,
    {
      ...input,
      mode: "edit"
    },
    outputs
  );
}

async function generateSingleOutput(input: ImageProviderInput, provider: ImageProvider, signal?: AbortSignal): Promise<BatchOutputResult> {
  const outputId = randomUUID();

  try {
    throwIfAborted(signal);
    const result = await callProviderWithRetry(
      () =>
        provider.generate(
          {
            ...input,
            count: 1
          },
          signal
        ),
      signal
    );
    throwIfAborted(signal);

    const providerImage = result.images[0];
    if (!providerImage) {
      throw new ProviderError("unsupported_provider_behavior", "The image service returned no images.", 502);
    }

    const asset = await saveProviderImage(providerImage, input, signal);

    return {
      id: outputId,
      status: "succeeded",
      asset
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error;
    }

    return {
      id: outputId,
      status: "failed",
      error: errorToMessage(error)
    };
  }
}

async function editSingleOutput(input: EditImageProviderInput, provider: ImageProvider, signal?: AbortSignal): Promise<BatchOutputResult> {
  const outputId = randomUUID();

  try {
    throwIfAborted(signal);
    const result = await callProviderWithRetry(
      () =>
        provider.edit(
          {
            ...input,
            count: 1
          },
          signal
        ),
      signal
    );
    throwIfAborted(signal);

    const providerImage = result.images[0];
    if (!providerImage) {
      throw new ProviderError("unsupported_provider_behavior", "The image service returned no images.", 502);
    }

    const asset = await saveProviderImage(providerImage, input, signal);

    return {
      id: outputId,
      status: "succeeded",
      asset
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error;
    }

    return {
      id: outputId,
      status: "failed",
      error: errorToMessage(error)
    };
  }
}

export type { StoredAssetFile } from "../assets/asset-store.js";

export { getGenerationRecord } from "./generation-records.js";

export { deleteGenerationHistory } from "./generation-records.js";

export { cancelGenerationRecord } from "./generation-records.js";

export { failGenerationRecord } from "./generation-records.js";

export { markInterruptedGenerationRecordsFailed } from "./generation-records.js";

export { saveReferenceImageInput } from "../assets/asset-store.js";

export { getStoredAssetFile } from "../assets/asset-store.js";

export { readStoredAsset } from "../assets/asset-store.js";

export { readStoredAssetMetadata } from "../assets/asset-store.js";
