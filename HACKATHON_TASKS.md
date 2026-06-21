# QVAC Hackathon Final Tasks

This file tracks the remaining work for the Muffin AI DoraHacks submission.

## Submission Links

- Public build page: https://dorahacks.io/buidl/45441
- DoraHacks edit path: open the build page, use the settings gear, then `Edit` / `editBuild`.
- Current placeholder video: https://youtu.be/XZxL72rn7qE
- GitHub repository: https://github.com/ssadkov/muffin-ai
- X account: https://x.com/ssadkov
- Telegram/community link currently shown: https://t.me/cbdc_expert

## What Is Already Filled

- Product name: Muffin AI.
- Public GitHub link is present.
- Placeholder YouTube link is present.
- X/social link is present.
- DoraHacks description already emphasizes:
  - fully on-device AI,
  - QVAC SDK,
  - local LLM,
  - local speech-to-text,
  - local OCR,
  - local SQLite financial memory,
  - audit logs,
  - airplane/offline positioning.
- Current page copy is strong enough to keep, with small accuracy edits below.

## High-Impact Copy Fixes

- In "What touches the network", avoid saying direct `Solana / Aptos RPC` unless the final app actually calls those RPCs directly. Current disclosure should say public non-AI lookups through disclosed services such as Yield AI public wallet portfolio APIs, CoinGecko, ExchangeRate-API, and user-provided exchange APIs.
- Keep "The AI never goes to the cloud" prominent.
- If the final device/GPU backend is not explicitly verified as Metal in logs or device output, prefer "GPU when available" over "Metal".
- Keep the QVAC evidence concrete: `llamacpp-completion`, `whispercpp-transcription`, `onnx-ocr`, `ctx_size: 8192`, audit log with TTFT and tokens/sec.

## Phone / Hardware Evidence To Collect

For the final DoraHacks submission, the hardware details must match the device shown in the video.

Current demo phone evidence:

- Device: iPhone 17 Pro.
- Device name shown in Settings: "Сергей 17".
- Model number: MG874J/A.
- iOS version: 26.5.1.
- Storage capacity: 256 GB.
- Available storage in screenshot: 36.76 GB.
- Serial number was visible in the raw screenshot and must be redacted before any public upload.

### iPhone Screenshots

Take screenshots from:

- `Settings -> General -> About`
  - device name,
  - iOS version,
  - model name,
  - model number,
  - serial number can be hidden/redacted,
  - capacity.
- `Settings -> General -> iPhone Storage`
  - storage capacity and available storage.
- Optional: `Settings -> Battery`
  - useful only if showing sustained demo conditions.

### Specs Not Shown By iOS

iOS does not show RAM, CPU, GPU, or Neural Engine details in Settings. For those fields:

- Use the exact model name/model number from `Settings -> General -> About`: iPhone 17 Pro, MG874J/A.
- Fill CPU/GPU/Neural Engine from Apple's official iPhone 17 Pro tech specs: Apple A19 Pro; 6-core CPU with 2 performance and 4 efficiency cores; 6-core GPU with Neural Accelerators; 16-core Neural Engine.
- Fill RAM as 12 GB only with a note that this comes from external device-spec sources, because Apple/iOS Settings does not publish RAM in the About screen.
- In `SUBMISSION.md`, keep the source note clear: model/storage/OS from iOS Settings screenshot; CPU/GPU/Neural Engine from Apple; RAM from external specs.

## Final Demo Video Checklist

Target length: under 5 minutes.

1. Show the app running on the declared retail phone.
2. Show this is a native/dev/standalone build, not Expo Go.
3. Load or use the QVAC local model and show the on-device badge/performance line.
4. Ask by voice: "How much do I have across all Aptos wallets?"
5. Show both Aptos wallets included, with total and breakdown.
6. Show bank/exchange screenshot OCR running locally.
7. Ask one follow-up finance question to demonstrate local financial memory and KV-cache reuse.
8. Show the audit log export button or exported log file.
9. Mention clearly: no cloud AI calls; remote calls are disclosed non-AI data lookups only.
10. End with the exact GitHub repo and Apache-2.0 license.

## Artifact Checklist

- Replace placeholder YouTube link with final unlisted video.
- Export a fresh `inference_audit_log.json` from the final demo run.
- Ensure the final log includes clean examples for:
  - model load,
  - QVAC chat inference,
  - QVAC Whisper transcription,
  - QVAC OCR,
  - TTFT,
  - tokens/sec,
  - prompt/response fields.
- Update `SUBMISSION.md` hardware table with the final phone details.
- Update `README.md` hardware table with the same final phone details.
- Attach phone hardware screenshots to DoraHacks.
- Confirm `remote_apis.json` exactly matches the final app behavior.
- Confirm no cloud AI APIs are listed or used.
- Run TypeScript check before final push.
- Push all final changes to GitHub before submitting.

## Current Repo Risk

- `src/agent/muffinAiAgent.ts` currently has local changes for more deterministic wallet-scope answers and LLM polishing.
- Before the final video/submission, run the app and verify:
  - Aptos-only questions include both Aptos wallets.
  - Solana is excluded from Aptos answers.
  - all-public-wallet questions group Aptos and Solana correctly.
  - the answer still shows QVAC runtime stats when polished through the local model.
- Then run:

```powershell
npm.cmd exec tsc -- --noEmit
git diff --check
```

Commit and push once verified.

## DoraHacks Final Fields

- Product name: Muffin AI.
- Short description: private local-first finance assistant that runs AI on the phone.
- Primary track: Mobile.
- Secondary track: General Purpose only if the same repo is runnable for judge evaluation outside phone.
- Team: solo, Sergei Sadkov.
- Location: fill with the final country/city you want shown.
- Hashtag: `#muffinai`.
- Prior work: disclose that planning and earlier app work existed before final submission; judging should focus on the current QVAC-based implementation and hackathon-period work.
- Remote API disclosure: point to `remote_apis.json`.
- Audit evidence: point to `inference_audit_log.json` and the in-app export flow.

## Winning Angle

Muffin AI turns a retail phone into a private financial analyst. Bank data is messy because it arrives as screenshots, OCR, currencies, and app-specific layouts. Crypto data is structured but fragmented across wallets and chains. Muffin AI unifies both into local financial memory, then uses QVAC for local LLM reasoning, speech-to-text, and OCR. The result is auditable edge AI for sensitive financial data: no cloud AI, runnable on a phone, with TTFT/tokens/sec logs judges can inspect.
