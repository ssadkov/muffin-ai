# Muffin AI - Historical MVP Note

This file used to contain the early planning spec for Muffin AI. That planning document included obsolete fallback ideas, including LM Studio and mock-agent notes, from before the current QVAC integration was completed.

For the QVAC Hackathon submission, treat the following files as the current source of truth:

- [README.md](README.md) for build, run, and verification instructions.
- [SUBMISSION.md](SUBMISSION.md) for DoraHacks submission metadata, prior-work disclosure, demo video, hardware evidence requirements, and demo script.
- [remote_apis.json](remote_apis.json) for every disclosed remote service.
- [src/services/qvacService.ts](src/services/qvacService.ts) for local QVAC chat and financial reasoning.
- [src/services/ocrService.ts](src/services/ocrService.ts) for QVAC on-device OCR.
- [src/services/transcriptionService.ts](src/services/transcriptionService.ts) for QVAC on-device speech transcription.
- [qvac/worker.entry.mjs](qvac/worker.entry.mjs) and [qvac/addons.manifest.json](qvac/addons.manifest.json) for the QVAC worker/plugin bundle.

Current submission claim: all AI inference, OCR, transcription, and tool-call reasoning in the submitted app runs locally through the QVAC SDK. The remote services disclosed in [remote_apis.json](remote_apis.json) are non-AI services such as model downloads, Expo Updates, rates, read-only exchange APIs, and public wallet portfolio data.
