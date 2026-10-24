import { type TLBaseShape } from "../canvas/editor/types";

export const GENERATION_PLACEHOLDER_TYPE = "generation-placeholder" as const;

export type GenerationPlaceholderStatus = "loading" | "failed";

export interface GenerationPlaceholderProps {
  w: number;
  h: number;
  targetWidth: number;
  targetHeight: number;
  status: GenerationPlaceholderStatus;
  error: string;
  requestId: string;
  outputIndex: number;
}

export interface GenerationPlaceholderShape extends TLBaseShape<GenerationPlaceholderProps> {
  type: typeof GENERATION_PLACEHOLDER_TYPE;
}
