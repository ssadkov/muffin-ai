# Muffin AI - QVAC Hackathon Submission

Status: draft submission package for QVAC Hackathon I - Unleash Edge AI.

## Product

**Product name:** Muffin AI

**Description:** Muffin AI is a private, local-first personal finance assistant for retail mobile devices. It stores financial memory locally, imports bank screenshots through on-device OCR, transcribes voice commands locally, tracks read-only exchange and wallet balances through disclosed non-AI APIs, and answers finance questions through local QVAC inference.

## Tracks

- **Mobile:** primary track. The app runs as a native Expo/React Native development or standalone build on retail iOS/Android devices.
- **General Purpose:** secondary track. The same codebase can be evaluated on a retail desktop/laptop through emulator or simulator workflows where supported.

## Demo Video

Current placeholder video: https://youtu.be/XZxL72rn7qE

This link is intentionally temporary and will be replaced with a final unlisted YouTube recording before the DoraHacks submission is finalized.

## Team

- **Participant:** Sergei Sadkov
- **Team size:** solo unless DoraHacks project membership is updated before final submission.
- **Location:** pending final DoraHacks form confirmation.
- **Build-in-public hashtag:** pending final DoraHacks form confirmation.

## Public Repository

- GitHub: https://github.com/ssadkov/muffin-ai
- License: Apache-2.0, see [LICENSE](LICENSE)

## QVAC Usage

All AI workloads in the submitted app run through the QVAC SDK:

- Local chat and financial reasoning: [src/services/qvacService.ts](src/services/qvacService.ts), QVAC `llamacpp-completion`.
- Screenshot OCR: [src/services/ocrService.ts](src/services/ocrService.ts), QVAC `onnx-ocr`.
- Voice transcription: [src/services/transcriptionService.ts](src/services/transcriptionService.ts), QVAC `whispercpp-transcription`.
- QVAC worker and plugin bundle: [qvac/worker.entry.mjs](qvac/worker.entry.mjs), [qvac/addons.manifest.json](qvac/addons.manifest.json).

The app does not use cloud AI APIs for inference, embeddings, OCR, transcription, RAG, or tool calling. Network services are limited to disclosed non-AI services such as model downloads, Expo Updates, exchange rates, read-only exchange balance APIs, and public wallet portfolio lookup.

## Remote API Disclosure

Every intended remote service is listed in [remote_apis.json](remote_apis.json). The list includes model downloads and non-AI data providers. Exchange API keys are user-provided and stored locally via Expo SecureStore.

## Audit Evidence

- Sample committed log: [inference_audit_log.json](inference_audit_log.json)
- Runtime exporter: Home screen -> Hackathon logs -> Export Audit Logs
- Captured fields include model load events and inference performance: prompt, response, token count, TTFT, generation duration, and tokens/sec.

The standard demo keeps the QVAC model resident after loading, so the committed sample does not include a `model_unload` event. If the final demo adds explicit unload/reload behavior, the exported log should include that event as well.

## Reproducibility

Follow [README.md](README.md) for build and run instructions. The app requires a custom development or standalone build because QVAC uses native modules and cannot run inside Expo Go.

### Final Demo Hardware

The exact device must be updated after the final recording and must match the video and screenshots submitted on DoraHacks.

| Spec | Value |
|------|-------|
| Device | Pending final demo recording |
| CPU / GPU | Pending final demo recording |
| RAM | Pending final demo recording |
| Storage | Pending final demo recording |
| OS | Pending final demo recording |
| Inference backend | QVAC local inference; GPU intended where available |

Required screenshot evidence for final submission:

- iOS: Settings -> General -> About, plus device model/storage view where available.
- Android: Settings -> About phone, RAM/storage/device model where available.
- Emulator/simulator if used for General Purpose: host CPU/GPU/RAM/storage screenshot.

## Prior Work Disclosure

This repository includes planning and implementation work created before the final DoraHacks submission. The judging focus should be the current submitted app state and the work completed during the hackathon period.

[MVP_SPEC.md](MVP_SPEC.md) is a historical planning document and contains obsolete fallback notes such as early LM Studio/mock ideas. It is not the current runtime architecture. The current runtime QVAC paths are the source files listed in the "QVAC Usage" section above.

## Demo Script

1. Launch Muffin AI on the declared retail device.
2. Show that the app is a native development/standalone build, not Expo Go.
3. Load the local QVAC model and show the on-device performance badge.
4. Ask a finance question answered from local SQLite context.
5. Import a bank/exchange screenshot and parse it through local QVAC OCR plus local LLM parsing.
6. Use voice input and show local QVAC Whisper transcription.
7. Show disclosed remote services in [remote_apis.json](remote_apis.json).
8. Export the structured audit log and compare the run with [inference_audit_log.json](inference_audit_log.json).

