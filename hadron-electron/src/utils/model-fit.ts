import { CURATED_MODELS } from "../constants/providers";

const BYTES_PER_TOKEN = 4;
const SAFETY_FACTOR = 0.7;
const FALLBACK_BYTES = 512_000;

export function getModelSafeLimit(provider: string, modelId: string): number {
  const models = CURATED_MODELS[provider];
  if (!models) return FALLBACK_BYTES;
  const model = models.find((m) => m.id === modelId);
  if (!model || !model.context) return FALLBACK_BYTES;
  return Math.floor(model.context * BYTES_PER_TOKEN * SAFETY_FACTOR);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
}
