import type { ProviderSourceId } from "@insboard/shared";
import {
  ProviderError,
  createOpenAIImageProvider,
  type ImageProvider,
  type OpenAIImageProviderConfig
} from "../../infrastructure/providers/image-provider.js";
import {
  getEnvironmentOpenAIImageProviderConfig,
  getLocalOpenAIImageProviderConfig,
  getProviderSourceOrder
} from "./provider-config.js";

export interface ConfiguredImageProviderSelection {
  sourceId: ProviderSourceId;
  provider: "openai";
  openAIConfig: OpenAIImageProviderConfig;
}

export async function createConfiguredImageProvider(signal?: AbortSignal): Promise<ImageProvider> {
  signal?.throwIfAborted();
  const selection = selectConfiguredImageProviderSource();
  if (selection) {
    return createOpenAIImageProvider(selection.openAIConfig);
  }
  throw new ProviderError("missing_provider", "Add an image API key in Settings or set OPENAI_API_KEY, then retry.", 401);
}

export function selectConfiguredImageProviderSource(): ConfiguredImageProviderSelection | undefined {
  for (const sourceId of getProviderSourceOrder()) {
    const openAIConfig = sourceId === "env-openai"
      ? getEnvironmentOpenAIImageProviderConfig()
      : getLocalOpenAIImageProviderConfig();
    if (openAIConfig) {
      return { sourceId, provider: "openai", openAIConfig };
    }
  }
  return undefined;
}
