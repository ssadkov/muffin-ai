import { loadModel, ocr } from '@qvac/sdk';
import { askLocalQVAC } from './qvacService';

let ocrModelId: string | null = null;
let isInitializing = false;

export async function initOcrModel(): Promise<string> {
  if (ocrModelId) {
    return ocrModelId;
  }

  if (isInitializing) {
    // Wait until initialization completes
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (ocrModelId) return ocrModelId;
  }

  isInitializing = true;
  console.log("Initializing OCR model (this might take some time to download on first run)...");
  
  try {
    ocrModelId = await loadModel({
      modelSrc: "registry://s3/qvac_models_compiled/ocr/2026-02-12/rec_dyn/recognizer_cyrillic.onnx",
      modelType: "onnx-ocr",
      modelConfig: {
        detectorModelSrc: "registry://s3/qvac_models_compiled/ocr/2026-02-12/rec_512/detector_craft.onnx",
        langList: ["ru", "en"]
      }
    });
    console.log("OCR model loaded successfully! ID:", ocrModelId);
    return ocrModelId;
  } catch (e) {
    console.error("Failed to load OCR model via QVAC SDK:", e);
    throw e;
  } finally {
    isInitializing = false;
  }
}

export async function recognizeImageText(imagePath: string): Promise<string> {
  const modelId = await initOcrModel();
  
  // QVAC expects raw filesystem paths without "file://" prefix
  const rawPath = imagePath.replace(/^file:\/\//, '');
  console.log("Running OCR on image path:", rawPath);

  try {
    const { blocks } = ocr({
      modelId,
      image: rawPath
    });

    const detectedBlocks = await blocks;
    const text = detectedBlocks.map(b => b.text).join('\n');
    console.log("OCR Extracted Text:", text);
    return text;
  } catch (e) {
    console.error("OCR recognition error:", e);
    throw e;
  }
}

export interface ParsedBalance {
  bank: string;
  amount: number;
  currency: string;
}

export async function parseBalanceFromOcrText(ocrText: string): Promise<ParsedBalance | null> {
  const prompt = `You are a financial parsing bot. 
Extract the bank/service name, the main balance amount, and the currency from the following OCR text.
If there are multiple accounts or balances, extract the main primary balance.
Return ONLY a valid JSON object of this structure:
{
  "bank": "Bank Name",
  "amount": 12345.67,
  "currency": "KZT" or "RUB" or "USD" etc. (use standard currency codes)
}
Do not include any markdown format blocks or extra text outside the JSON.

OCR TEXT:
${ocrText}`;

  console.log("Sending OCR text to local LLM for parsing...");
  try {
    const response = await askLocalQVAC(prompt);
    console.log("LLM Parsing Response:", response.message);

    // Clean up response to find the JSON block
    const jsonMatch = response.message.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (data.bank && typeof data.amount === 'number' && data.currency) {
        return {
          bank: String(data.bank),
          amount: Number(data.amount),
          currency: String(data.currency).toUpperCase()
        };
      }
    }
  } catch (e) {
    console.error("Error parsing balance from OCR text with LLM:", e);
  }
  return null;
}
