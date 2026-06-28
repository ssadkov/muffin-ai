// Single source of truth for the on-device LLMs the app can run. Adding a model
// is a one-entry change here — qvacService and the UI both read from this map.

export type ModelId = 'qwen2.5-3b' | 'qwen3-4b';

export type ModelSpec = {
  id: ModelId;
  /** Short label shown in the model picker. */
  label: string;
  /** One-line tradeoff hint shown under the label. */
  hint: string;
  /** Local filename under documentDirectory/models/. */
  filename: string;
  /** HuggingFace direct-download URL for the GGUF. */
  url: string;
  /** Reject partial/corrupt downloads smaller than this. */
  minSizeBytes: number;
  /** llama.cpp context window to load with. */
  ctxSize: number;
  /** Human-readable download size for the UI. */
  sizeLabel: string;
};

export const MODEL_CATALOG: Record<ModelId, ModelSpec> = {
  'qwen2.5-3b': {
    id: 'qwen2.5-3b',
    label: 'Qwen2.5 3B',
    hint: 'Fast • default',
    filename: 'qwen2.5-3b-q4.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    minSizeBytes: 2_100_000_000,
    ctxSize: 8192,
    sizeLabel: '~2 GB',
  },
  'qwen3-4b': {
    id: 'qwen3-4b',
    label: 'Qwen3 4B',
    hint: 'Smarter • balanced • ~2.5 GB',
    filename: 'qwen3-4b-q4.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    minSizeBytes: 2_400_000_000,
    ctxSize: 8192,
    sizeLabel: '~2.5 GB',
  },
};

export const DEFAULT_MODEL_ID: ModelId = 'qwen2.5-3b';

export const MODEL_IDS = Object.keys(MODEL_CATALOG) as ModelId[];

export function getModelSpec(modelId: ModelId): ModelSpec {
  return MODEL_CATALOG[modelId] ?? MODEL_CATALOG[DEFAULT_MODEL_ID];
}
