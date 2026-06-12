import { loadModel, transcribe } from '@qvac/sdk';
import * as FileSystem from 'expo-file-system/legacy';

const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const WHISPER_MODEL_FILENAME = 'ggml-base.bin';
const EXPECTED_SIZE = 147000000; // ~147.9MB

let whisperModelId: string | null = null;
let isInitializing = false;

export function isWhisperModelLoaded(): boolean {
  return whisperModelId !== null;
}

export async function downloadWhisperModelIfNeeded(
  onProgress?: (progress: number) => void
): Promise<string> {
  const modelDir = `${FileSystem.documentDirectory}models/`;
  const modelPath = `${modelDir}${WHISPER_MODEL_FILENAME}`;

  const dirInfo = await FileSystem.getInfoAsync(modelDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
  }

  const fileInfo = await FileSystem.getInfoAsync(modelPath);
  if (fileInfo.exists) {
    if (fileInfo.size >= EXPECTED_SIZE - 2000000) { // allow small margin
      if (onProgress) onProgress(100);
      return modelPath;
    } else {
      console.log(`Whisper model size is ${fileInfo.size}. Expected ~147MB. Deleting corrupted file...`);
      await FileSystem.deleteAsync(modelPath, { idempotent: true });
    }
  }

  const downloadResumable = FileSystem.createDownloadResumable(
    WHISPER_MODEL_URL,
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

export async function initWhisperModel(modelPath: string): Promise<string> {
  if (whisperModelId) return whisperModelId;

  if (isInitializing) {
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (whisperModelId) return whisperModelId;
  }

  isInitializing = true;
  try {
    const rawPath = modelPath.replace(/^file:\/\//, '');
    console.log("Loading Whisper model into QVAC SDK:", rawPath);
    whisperModelId = await loadModel({
      modelSrc: rawPath,
      modelType: "whispercpp-transcription",
      modelConfig: {
        language: "ru",
        strategy: "greedy",
        initial_prompt: "halyk, kaspi, aptos, solana, btc, доллар, евро, тенге, рубли"
      }
    });
    console.log("Whisper model loaded successfully! ID:", whisperModelId);
    return whisperModelId;
  } catch (e) {
    console.error("Failed to load Whisper model via QVAC SDK", e);
    throw e;
  } finally {
    isInitializing = false;
  }
}

export function isWhisperHallucination(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (!clean) return true;

  // Common Whisper.cpp hallucination patterns for silence/static/noise in Russian
  const hallucinationPatterns = [
    /редактор\s+субтитров/i,
    /корректор/i,
    /субтитры/i,
    /переводчик/i,
    /сообщество\s+it/i,
    /продолжение\s+следует/i,
    /спасибо\s+за\s+просмотр/i,
    /подписывайтесь\s+на/i,
    /семочна/i,
    /сухиашвили/i,
    /в\s+следующем\s+видео/i
  ];

  // If text contains mostly hallucination keywords
  const words = clean.split(/[\s,.\-!?]+/);
  const hallucinationKeywords = [
    'редактор', 'субтитров', 'корректор', 'перевод', 'переводчик', 'озвучка', 
    'субтитры', 'просмотр', 'просмотра', 'спасибо', 'канал', 'подпишитесь', 
    'подписывайтесь', 'семочна', 'сухиашвили', 'владимир', 'артур', 'семочко'
  ];
  
  let matchCount = 0;
  for (const word of words) {
    if (hallucinationKeywords.includes(word)) {
      matchCount++;
    }
  }
  
  if (words.length > 0 && (matchCount / words.length) > 0.5) {
    return true;
  }

  for (const pattern of hallucinationPatterns) {
    if (pattern.test(clean) && clean.length < 50) {
      return true;
    }
  }

  if (/^[.\s\-()]*$/.test(clean)) {
    return true;
  }

  return false;
}

export async function transcribeAudio(audioPath: string): Promise<string> {
  if (!whisperModelId) {
    throw new Error("Whisper model is not loaded.");
  }

  console.log("Transcribing audio path:", audioPath);
  try {
    const rawPath = audioPath.replace(/^file:\/\//, '');
    console.log("Transcribing via raw filePath:", rawPath);

    const resultText = await transcribe({
      modelId: whisperModelId,
      audioChunk: rawPath,
      prompt: "halyk, kaspi, aptos, solana, btc, доллар, евро, тенге, рубли"
    });

    console.log("Whisper Transcribed Text:", resultText);
    
    if (isWhisperHallucination(resultText)) {
      console.log("[Whisper] Detected silence hallucination. Cleaning output to empty string.");
      return "";
    }
    
    return resultText;
  } catch (e) {
    console.error("Whisper transcription error:", e);
    throw e;
  }
}
