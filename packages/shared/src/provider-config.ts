export type RuntimeImageProvider = "openai" | "none";

export const PROVIDER_SOURCE_IDS = ["env-openai", "local-openai"] as const;
export type ProviderSourceId = (typeof PROVIDER_SOURCE_IDS)[number];
export type ProviderSourceKind = "environment" | "local";
export type ProviderSourceStatus = "available" | "missing_api_key";

export interface MaskedSecret {
  hasSecret: boolean;
  value?: string;
}

export interface ProviderSourceDetails {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface ProviderSourceView {
  id: ProviderSourceId;
  kind: ProviderSourceKind;
  label: string;
  available: boolean;
  status: ProviderSourceStatus;
  details: ProviderSourceDetails;
  secret: MaskedSecret;
}

export interface ProviderSourceSummary {
  id: ProviderSourceId;
  kind: ProviderSourceKind;
  label: string;
  provider: RuntimeImageProvider;
  available: boolean;
  status: ProviderSourceStatus;
}

export interface LocalOpenAIProviderConfigView {
  apiKey: MaskedSecret;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ProviderConfigResponse {
  sourceOrder: ProviderSourceId[];
  sources: ProviderSourceView[];
  localOpenAI: LocalOpenAIProviderConfigView;
  activeSource?: ProviderSourceSummary;
}

export interface SaveLocalOpenAIProviderConfig {
  apiKey?: string;
  preserveApiKey?: boolean;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface SaveProviderConfigRequest {
  sourceOrder: ProviderSourceId[];
  localOpenAI?: SaveLocalOpenAIProviderConfig;
}

export interface AuthStatusResponse {
  provider: RuntimeImageProvider;
  openaiConfigured: boolean;
  activeSource?: ProviderSourceSummary;
}
