# Muffin AI — Private Money Memory

Muffin AI is a private, local-first personal finance assistant built for the **QVAC Hackathon I – Unleash Edge AI** (June 2026). It runs entirely on-device, processing bank screenshots via local OCR, tracking cryptocurrency wallets, checking custom financial rules, and providing conversational AI support using the local **QVAC SDK**—all with zero cloud AI dependencies.

---

## 📱 Supported Tracks
1. **Mobile Track (Primary):** Runs natively on iOS and Android devices.
2. **General Purpose Track:** Can run inside mobile emulators or simulator environments on macOS and Windows machines.

---

## ⚙️ Architecture

```
Muffin AI Mobile App (React Native / Expo)
        |
        v
QVAC Local Agent (Local LLM & OCR)
        |
        +--> Local SQLite Database (Financial Memory)
        |
        +--> SecureStore (Local API Keys Ref)
        |
        +--> Public Blockchain RPC (Solana, Aptos mainnets)
        |
        +--> Screenshot OCR & Parser Service
        |
        +--> Local Financial Rules Engine
```

---

## 🛠️ Local Build & Deployment Guide

Because Muffin AI leverages the **QVAC SDK** (which runs native C++ code for local LLM inference, Whisper speech transcription, and ONNX-based OCR on-device), **it cannot run inside the standard Expo Go sandbox app**. It requires a custom **Development Build** containing the native modules.

### Prerequisites
1. **Node.js** (v18+)
2. **Android SDK & Build Tools** (for local Android compilation on Windows/macOS)
3. **Xcode** (for local iOS compilation, macOS only)

---

### Step 1: Install Dependencies
Run from the project root:
```bash
npm install
```

### Step 2: Build the Native App Binary
This compiles the C++ libraries and Java/Objective-C native code on your computer and installs it onto your emulator or plugged device.

* **For Android (Local compilation on Windows/macOS):**
  Make sure your Android emulator is running or a device is connected via USB, then run:
  ```bash
  npm run android
  ```
* **For iOS (Local compilation, macOS only):**
  ```bash
  npm run ios
  ```
* **For EAS Cloud Compilation (Recommended for iOS on Windows, or cloud convenience):**
  Install EAS CLI globally (`npm install -g eas-cli`) and login to Expo, then run:
  ```bash
  npx eas build --profile development --platform android
  # or under iOS (requires Apple Developer Account):
  npx eas build --profile development --platform ios
  ```

---

### Step 3: Run the Development Server (Metro)
Once the custom development build is installed on your device, start the Metro server:
```bash
npx expo start --dev-client
```

* **How updates work during development (Fast Refresh):**
  You **do not** need to rebuild the app when editing TypeScript/JavaScript files. The Metro server instantly pushes updates to your running application via Wi-Fi or USB in 1 second. You only need to rebuild if you install new native packages or modify native folders.

---

### Step 4: Standalone Production Release Build
To package the app as a standalone binary that embeds the JS bundle directly (allowing it to run 100% offline without needing a Metro server running on a computer):

* **Android Release APK:**
  ```bash
  npx expo run:android --variant release
  ```
* **EAS Cloud Production Build:**
  ```bash
  npx eas build --profile production --platform android
  # or:
  npx eas build --profile production --platform ios
  ```

---

## 🔍 Hackathon Compliance & Verification Evidence

Muffin AI includes all required items for the QVAC 3-stage validation process:

1. **Remote API Call Registry ([remote_apis.json](file:///c:/work/muffin-ai/remote_apis.json)):** Discloses all remote endpoints (fiat/crypto exchange rates, model downloads, and public blockchain RPC nodes) for audit.
2. **Auditable Inference Logs:** Every model load and chat inference (prompts, responses, tokens, Time to First Token - TTFT, and tokens/sec speed) is captured on-device in a structured audit log.
3. **Log Exporter UI:** Developers can export the live audit log directly from the bottom of the **Home Screen** (via the *Export Audit Logs* button).
4. **Sample Audit Log ([inference_audit_log.json](file:///c:/work/muffin-ai/inference_audit_log.json)):** Provided at the root of the repository for reference.

---

## 📄 License
This project is licensed under the **MIT License** - see the [LICENSE](file:///c:/work/muffin-ai/LICENSE) file for details.
