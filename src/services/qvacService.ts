import * as FileSystem from 'expo-file-system/legacy';
import { loadModel, completion } from '@qvac/sdk';
import { addAuditLog } from './inferenceLogService';

const loadedModels: { [filename: string]: string } = {};

export function isModelLoaded(modelType: 'qwen' | 'medpsy' = 'qwen'): boolean {
  const modelFilename = 'qwen2.5-3b-q4.gguf';
  return !!loadedModels[modelFilename];
}

export async function checkModelExists(modelType: 'qwen' | 'medpsy' = 'qwen'): Promise<boolean> {
  const modelFilename = 'qwen2.5-3b-q4.gguf';
  const modelDir = `${FileSystem.documentDirectory}models/`;
  const modelPath = `${modelDir}${modelFilename}`;
  const EXPECTED_MIN_SIZE = 2100000000;
  try {
    const fileInfo = await FileSystem.getInfoAsync(modelPath);
    return !!(fileInfo.exists && fileInfo.size >= EXPECTED_MIN_SIZE);
  } catch (e) {
    return false;
  }
}

export async function downloadModelIfNeeded(
  modelType: 'qwen' | 'medpsy' = 'qwen',
  onProgress?: (progress: number) => void
): Promise<string> {
  const modelFilename = 'qwen2.5-3b-q4.gguf';
  const modelUrl = 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf';

  const modelDir = `${FileSystem.documentDirectory}models/`;
  const modelPath = `${modelDir}${modelFilename}`;

  const dirInfo = await FileSystem.getInfoAsync(modelDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
  }

  const EXPECTED_MIN_SIZE = 2100000000;
  const fileInfo = await FileSystem.getInfoAsync(modelPath);
  console.log(`[QVAC SDK] ${modelFilename} file info on disk:`, fileInfo);
  
  if (fileInfo.exists) {
    if (fileInfo.size >= EXPECTED_MIN_SIZE) {
      if (onProgress) onProgress(100);
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
      const progress = (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100;
      if (onProgress) onProgress(progress);
    }
  );

  await downloadResumable.downloadAsync();
  return modelPath;
}

export async function initLocalModel(modelPath: string, modelType: 'qwen' | 'medpsy' = 'qwen') {
  const modelFilename = 'qwen2.5-3b-q4.gguf';
  
  if (!loadedModels[modelFilename]) {
    const startTime = Date.now();
    try {
      const rawPath = modelPath.replace(/^file:\/\//, '');
      console.log(`Loading local model ${modelFilename} into QVAC SDK:`, rawPath);
      const modelId = await loadModel({
        modelSrc: rawPath,
        modelType: "llamacpp-completion",
        modelConfig: { ctx_size: 4096 }
      });
      loadedModels[modelFilename] = modelId;
      const durationMs = Date.now() - startTime;
      console.log(`Local Edge Model ${modelFilename} loaded successfully! ID:`, modelId);
      
      await addAuditLog({
        type: 'model_load',
        modelName: modelFilename,
        durationMs,
        success: true
      });
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      console.error(`Failed to load local model ${modelFilename} via QVAC SDK`, e);
      
      await addAuditLog({
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
  modelType: 'qwen' | 'medpsy' = 'qwen',
  onChunk?: (text: string) => void,
  chatHistory?: { role: 'user' | 'assistant'; content: string }[],
  options?: {
    generationParams?: Record<string, unknown>;
  }
): Promise<any> {
  const modelFilename = 'qwen2.5-3b-q4.gguf';
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

    console.log("Full response:", fullText);
    console.log(`[Audit Stats] TTFT: ${ttftMs}ms, Tokens: ${tokenCount}, Speed: ${tokensPerSec.toFixed(2)} tok/sec`);

    // Log inference event
    await addAuditLog({
      type: 'inference',
      modelName: modelFilename,
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      response: fullText,
      tokenCount,
      ttftMs,
      generationTimeMs,
      tokensPerSec: parseFloat(tokensPerSec.toFixed(2))
    });

    return { message: fullText || "(empty response)" };
  } catch (e: any) {
    const endTime = Date.now();
    console.error("QVAC completion error:", e?.message || e);
    
    // Log failed inference event
    await addAuditLog({
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
