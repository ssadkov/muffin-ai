import { loadModel, ocr } from '@qvac/sdk';
import { askLocalQVAC } from './qvacService';
import * as FileSystem from 'expo-file-system/legacy';

let ocrModelId: string | null = null;
let isInitializing = false;

export async function initOcrModel(): Promise<string> {
  if (ocrModelId) {
    return ocrModelId;
  }

  if (isInitializing) {
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (ocrModelId) return ocrModelId;
  }

  isInitializing = true;
  console.log("Initializing OCR model (useGPU: false for CPU execution stability)...");
  
  try {
    ocrModelId = await loadModel({
      modelSrc: "registry://s3/qvac_models_compiled/ocr/2026-02-12/rec_dyn/recognizer_cyrillic.onnx",
      modelType: "onnx-ocr",
      modelConfig: {
        detectorModelSrc: "registry://s3/qvac_models_compiled/ocr/2026-02-12/rec_512/detector_craft.onnx",
        langList: ["ru", "en"],
        useGPU: false // Force CPU execution to prevent CoreML/Metal native ONNX Runtime crashes on iOS
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
  
  console.log("Reading image path for OCR:", imagePath);

  try {
    const fileInfo = await FileSystem.getInfoAsync(imagePath);
    console.log("Image File Info:", fileInfo);
    
    // Read the file as a base64 string on the React Native thread
    const base64Data = await FileSystem.readAsStringAsync(imagePath, {
      encoding: FileSystem.EncodingType.Base64
    });
    console.log("Read base64 data length:", base64Data.length);
    
    const fakeBuffer = {
      toString: () => base64Data
    } as any;

    const { blocks } = ocr({
      modelId,
      image: fakeBuffer
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
  const systemPrompt = `You are a financial parsing bot. 
Extract the bank/service name, the main balance amount, and the currency from the provided OCR text.
If there are multiple accounts or balances, extract the main primary balance.
If the bank, exchange, or wallet name is not visible or cannot be determined from the text, use "Unknown" as the bank name. Do not fail if the name is not present.

Examples:
OCR TEXT:
В Кошельке Kaspi Gold: 1102420 KZT (USD эквивалент: $2425.32).
JSON response:
{
  "bank": "Kaspi Gold",
  "amount": 1102420,
  "currency": "KZT"
}

OCR TEXT:
Sberbank Online
Balance: 15,230.50 RUB
JSON response:
{
  "bank": "Sberbank",
  "amount": 15230.50,
  "currency": "RUB"
}

OCR TEXT:
Bybit Card
Balance: 760 USD
JSON response:
{
  "bank": "Bybit Card",
  "amount": 760,
  "currency": "USD"
}

Return ONLY a valid JSON object of this structure:
{
  "bank": "Bank Name",
  "amount": 12345.67,
  "currency": "CURRENCY_CODE"
}
Do not include any markdown format blocks or extra text outside the JSON.`;

  const userPrompt = `OCR TEXT:\n${ocrText}`;

  console.log("Sending OCR text to local LLM for parsing...");
  try {
    const response = await askLocalQVAC(systemPrompt, userPrompt);
    console.log("LLM Parsing Response:", response.message);

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
