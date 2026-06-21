import * as FileSystem from 'expo-file-system/legacy';
import { loadModel, completion, unloadModel } from '@qvac/sdk';
import { addAuditLog } from './inferenceLogService';
import { ModelId, DEFAULT_MODEL_ID, getModelSpec } from './modelCatalog';

/**
 * Per-inference telemetry pulled from our own wall-clock timing plus the
 * engine's RuntimeStats. Surfaced in the chat UI as the "on-device" badge so
 * a reviewer can see, per answer, that it ran locally (GPU vs CPU), how fast,
 * and whether the KV cache was reused. All fields are best-effort.
 */
export type InferenceStats = {
  ttftMs: number;
  generationTimeMs: number;
  tokenCount: number;
  tokensPerSec: number;
  backendDevice?: string;
  cacheTokens?: number;
  // True for answers resolved entirely from local SQLite without any model
  // inference. Used to render an honest "on-device • instant" badge.
  instant?: boolean;
};

const loadedModels: { [filename: string]: string } = {};

export function getModelLocalPath(modelId: ModelId = DEFAULT_MODEL_ID): string {
  const spec = getModelSpec(modelId);
  return `${FileSystem.documentDirectory}models/${spec.filename}`;
}

export function isModelLoaded(modelId: ModelId = DEFAULT_MODEL_ID): boolean {
  return !!loadedModels[getModelSpec(modelId).filename];
}

export async function checkModelExists(modelId: ModelId = DEFAULT_MODEL_ID): Promise<boolean> {
  const spec = getModelSpec(modelId);
  const modelPath = getModelLocalPath(modelId);
  try {
    const fileInfo = await FileSystem.getInfoAsync(modelPath);
    return !!(fileInfo.exists && fileInfo.size >= spec.minSizeBytes);
  } catch (e) {
    return false;
  }
}

/** Free a loaded model's RAM so switching models doesn't keep both resident. */
export async function unloadLocalModel(modelId: ModelId): Promise<void> {
  const filename = getModelSpec(modelId).filename;
  const loaded = loadedModels[filename];
  if (!loaded) return;
  try {
    await unloadModel({ modelId: loaded });
  } catch (e) {
    console.warn(`[QVAC SDK] unloadModel failed for ${filename}:`, e);
  }
  delete loadedModels[filename];
}

export async function deleteLocalModelFile(modelId: ModelId): Promise<void> {
  await unloadLocalModel(modelId);
  const modelPath = getModelLocalPath(modelId);
  await FileSystem.deleteAsync(modelPath, { idempotent: true });
}

export async function downloadModelIfNeeded(
  modelId: ModelId = DEFAULT_MODEL_ID,
  onProgress?: (progress: number, writtenBytes: number, totalBytes: number) => void
): Promise<string> {
  const spec = getModelSpec(modelId);
  const modelFilename = spec.filename;
  const modelUrl = spec.url;

  const modelDir = `${FileSystem.documentDirectory}models/`;
  const modelPath = `${modelDir}${modelFilename}`;

  const dirInfo = await FileSystem.getInfoAsync(modelDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
  }

  const EXPECTED_MIN_SIZE = spec.minSizeBytes;
  const fileInfo = await FileSystem.getInfoAsync(modelPath);
  console.log(`[QVAC SDK] ${modelFilename} file info on disk:`, fileInfo);
  
  if (fileInfo.exists) {
    if (fileInfo.size >= EXPECTED_MIN_SIZE) {
      if (onProgress) onProgress(100, fileInfo.size, fileInfo.size);
      return modelPath;
    } else {
      console.log(`Model file size is only ${fileInfo.size} bytes. Expected >= ${EXPECTED_MIN_SIZE}. Deleting corrupted file to re-download...`);
      await FileSystem.deleteAsync(modelPath, { idempotent: true });
    }
  }

  const downloadResumable = FileSystem.createDownloadResumable(
    modelUrl,
    modelPath,
    {},
    (downloadProgress) => {
      const written = downloadProgress.totalBytesWritten;
      const total = downloadProgress.totalBytesExpectedToWrite;
      // HuggingFace serves the GGUF via a redirect (xet), so totalBytes can be
      // unreliable/understated — clamp the % and let the UI fall back to the
      // downloaded-bytes counter, which is always accurate.
      const progress = total > 0 ? Math.min(100, (written / total) * 100) : 0;
      if (onProgress) onProgress(progress, written, total);
    }
  );

  await downloadResumable.downloadAsync();
  return modelPath;
}

export async function initLocalModel(modelPath: string, modelId: ModelId = DEFAULT_MODEL_ID) {
  const spec = getModelSpec(modelId);
  const modelFilename = spec.filename;

  if (!loadedModels[modelFilename]) {
    const startTime = Date.now();
    try {
      const rawPath = modelPath.replace(/^file:\/\//, '');
      console.log(`Loading local model ${modelFilename} into QVAC SDK:`, rawPath);
      const modelId = await loadModel({
        modelSrc: rawPath,
        modelType: "llamacpp-completion",
        // device/gpu_layers default to "gpu"/99 in the SDK (Metal on iOS), but we
        // set them explicitly so the GPU offload intent is visible and stable.
        // ctx_size raised to 8192: the financial context string grows with the
        // number of accounts/payments/rates, and a larger window reduces the risk
        // of context shifting (RuntimeStats.contextSlides) mid-conversation.
        modelConfig: { ctx_size: spec.ctxSize, gpu_layers: 99, device: "gpu" }
      });
      loadedModels[modelFilename] = modelId;
      const durationMs = Date.now() - startTime;
      console.log(`Local Edge Model ${modelFilename} loaded successfully! ID:`, modelId);
      
      addAuditLog({
        type: 'model_load',
        modelName: modelFilename,
        durationMs,
        success: true
      });
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      console.error(`Failed to load local model ${modelFilename} via QVAC SDK`, e);
      
      addAuditLog({
        type: 'model_load',
        modelName: modelFilename,
        durationMs,
        success: false,
        error: e?.message || String(e)
      });
      throw e;
    }
  }
}

export async function askLocalQVAC(
  systemPrompt: string,
  userPrompt: string,
  modelType: ModelId = DEFAULT_MODEL_ID,
  onChunk?: (text: string) => void,
  chatHistory?: { role: 'user' | 'assistant'; content: string }[],
  options?: {
    generationParams?: Record<string, unknown>;
    /**
     * Enable the SDK's on-disk KV cache. Pass `true` to auto-key on the
     * conversation prefix, or a stable string key to reuse a session cache.
     * On a cache hit the SDK only prefills the new turn, which cuts TTFT
     * sharply on multi-turn chats. A miss falls back to a full prefill
     * (i.e. current behavior), so this is always safe to enable.
     */
    kvCache?: boolean | string;
  }
): Promise<any> {
  const modelFilename = getModelSpec(modelType).filename;
  const modelId = loadedModels[modelFilename];

  if (!modelId) {
    throw new Error(`Local model ${modelFilename} is not initialized.`);
  }

  console.log(`Sending prompt to Local QVAC Edge SDK (${modelType})...`);
  const startTime = Date.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  
  // Construct history payload to pass dialogue memory to the SDK
  const historyPayload: any[] = [
    { role: 'system', content: systemPrompt }
  ];

  if (chatHistory && chatHistory.length > 0) {
    chatHistory.forEach(msg => {
      // Strip out <think>...</think> tags from assistant responses in history 
      // to avoid polluting the model's memory context with raw thought blocks.
      let cleanContent = msg.content;
      if (msg.role === 'assistant') {
        cleanContent = cleanContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
      }
      if (cleanContent) {
        historyPayload.push({
          role: msg.role,
          content: cleanContent
        });
      }
    });
  }

  // Append current prompt containing SQLite context + latest question
  historyPayload.push({ role: 'user', content: userPrompt });

  try {
    const run = completion({
      modelId,
      history: historyPayload,
      stream: true,
      ...(options?.kvCache !== undefined ? { kvCache: options.kvCache } : {}),
      generationParams: {
        temp: 0.1, // low temperature to guarantee logical and mathematical accuracy
        top_p: 0.9,
        repeat_penalty: 1.1,
        ...(options?.generationParams || {})
      }
    });

    console.log("Completion run created, waiting for final...");

    // Collect tokens for debugging
    let fullText = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta') {
        if (firstTokenTime === null) {
          firstTokenTime = Date.now();
        }
        fullText += event.text;
        tokenCount += 1;
        if (onChunk) {
          onChunk(fullText);
        }
        console.log("Token:", event.text);
      }
    }

    const endTime = Date.now();
    const ttftMs = firstTokenTime ? (firstTokenTime - startTime) : (endTime - startTime);
    const generationTimeMs = firstTokenTime ? (endTime - firstTokenTime) : 0;
    const tokensPerSec = generationTimeMs > 0 ? (tokenCount / (generationTimeMs / 1000)) : 0;

    // Pull the engine's own stats: backendDevice tells us whether inference
    // actually ran on GPU (Metal) or fell back to CPU; cacheTokens > 0 confirms
    // a KV-cache hit. These are far more reliable than our manual wall-clock timing.
    let backendDevice: string | undefined;
    let cacheTokens: number | undefined;
    try {
      const final = await run.final;
      backendDevice = final.stats?.backendDevice;
      cacheTokens = final.stats?.cacheTokens;
    } catch {
      // stats are best-effort; ignore if unavailable
    }

    console.log("Full response:", fullText);
    console.log(`[Audit Stats] TTFT: ${ttftMs}ms, Tokens: ${tokenCount}, Speed: ${tokensPerSec.toFixed(2)} tok/sec, Backend: ${backendDevice ?? 'unknown'}, CacheTokens: ${cacheTokens ?? 0}`);

    // Log inference event
    addAuditLog({
      type: 'inference',
      modelName: modelFilename,
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      response: fullText,
      tokenCount,
      ttftMs,
      generationTimeMs,
      tokensPerSec: parseFloat(tokensPerSec.toFixed(2))
    });

    const stats: InferenceStats = {
      ttftMs,
      generationTimeMs,
      tokenCount,
      tokensPerSec: parseFloat(tokensPerSec.toFixed(2)),
      backendDevice,
      cacheTokens,
    };

    return { message: fullText || "(empty response)", stats };
  } catch (e: any) {
    const endTime = Date.now();
    console.error("QVAC completion error:", e?.message || e);
    
    // Log failed inference event
    addAuditLog({
      type: 'inference',
      modelName: modelFilename,
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      response: `[Error: ${e?.message || String(e)}]`,
      tokenCount: 0,
      ttftMs: endTime - startTime,
      generationTimeMs: 0,
      tokensPerSec: 0
    });

    throw e;
  }
}
