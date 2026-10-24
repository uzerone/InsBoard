import { type GeneratedAsset } from "@insboard/shared";
import { type ImageProviderInput } from "../../infrastructure/providers/image-provider.js";

export interface BatchOutputResult {
  id: string;
  status: "succeeded" | "failed";
  asset?: GeneratedAsset;
  error?: string;
}

export type PersistedGenerationInput = ImageProviderInput & {
  mode: "generate" | "edit";
  referenceAssetIds?: string[];
  referenceAssetId?: string;
};
