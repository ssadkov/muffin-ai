import * as FileSystem from 'expo-file-system/legacy';
import { loadModel, completion } from '@qvac/sdk';

const MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf';
const MODEL_FILENAME = 'qwen2.5-3b-q4.gguf';

let localModelId: string | null = null;

export async function downloadModelIfNeeded(
  onProgress?: (progress: number) => void
): Promise<string> {
  const modelDir = `${FileSystem.documentDirectory}models/`;
  const modelPath = `${modelDir}${MODEL_FILENAME}`;

  const dirInfo = await FileSystem.getInfoAsync(modelDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
  }

  const EXPECTED_MIN_SIZE = 2100000000; // ~2.1GB
  const fileInfo = await FileSystem.getInfoAsync(modelPath);
  console.log("Model file info on disk:", fileInfo);
  
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
    MODEL_URL,
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

export async function initLocalModel(modelPath: string) {
  if (!localModelId) {
    try {
      // QVAC SDK expects a raw filesystem path, not a file:// URI
      const rawPath = modelPath.replace(/^file:\/\//, '');
      console.log("Loading model into QVAC SDK:", rawPath);
      localModelId = await loadModel({
        modelSrc: rawPath,
        modelType: "llamacpp-completion",
        modelConfig: { ctx_size: 2048 }
      });
      console.log("Local Edge Model loaded successfully! ID:", localModelId);
    } catch (e) {
      console.error("Failed to load local model via QVAC SDK", e);
      throw e;
    }
  }
}

export async function askLocalQVAC(prompt: string): Promise<any> {
  if (!localModelId) {
    throw new Error("Local model is not initialized.");
  }

  console.log("Sending prompt to Local QVAC Edge SDK...");
  
  try {
    const run = completion({
      modelId: localModelId,
      history: [
        { role: 'system', content: 'You are Muffin, a personal finance AI running privately on an iPhone. Keep answers short.' },
        { role: 'user', content: prompt }
      ],
      stream: true
    });

    console.log("Completion run created, waiting for final...");

    // Collect tokens for debugging
    let fullText = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta') {
        fullText += event.text;
        console.log("Token:", event.text);
      }
    }

    console.log("Full response:", fullText);
    return { message: fullText || "(empty response)" };
  } catch (e: any) {
    console.error("QVAC completion error:", e?.message || e);
    console.error("QVAC completion error stack:", e?.stack);
    throw e;
  }
}
