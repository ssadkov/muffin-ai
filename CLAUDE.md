@AGENTS.md

# Muffin AI — product & LLM architecture notes

Local-first personal finance assistant (QVAC Hackathon). Everything — chat, OCR of bank
screenshots, voice transcription, financial rules — runs on-device. The only network calls are
public blockchain RPC, exchange-rate lookups, and user-authorized read-only exchange balance APIs
(see [remote_apis.json](remote_apis.json)); there is no cloud AI call anywhere in the app.

## Stack
- Expo / React Native ([App.tsx](App.tsx), [src/screens](src/screens))
- On-device LLM via `@qvac/sdk` (llama.cpp addon) — model: `qwen2.5-3b-instruct-q4_k_m.gguf`,
  loaded with `ctx_size: 4096` ([src/services/qvacService.ts](src/services/qvacService.ts))
- On-device Whisper for voice ([src/services/transcriptionService.ts](src/services/transcriptionService.ts))
  and ONNX OCR for screenshots ([src/services/ocrService.ts](src/services/ocrService.ts))
- SQLite for all financial state ([src/tools/databaseTools.ts](src/tools/databaseTools.ts))

## How a chat message is actually answered
[src/agent/muffinAiAgent.ts](src/agent/muffinAiAgent.ts) runs requests through a cascade, cheapest
first, to avoid hitting the LLM when it isn't needed:

1. **Deterministic command parser** ([src/agent/commandParser.ts](src/agent/commandParser.ts)) —
   regex/keyword based. Recognizes balance updates, goal updates, BTC price asks. No LLM call.
2. **Deterministic read-answer templates** (`answerSimpleReadQuestion` in muffinAiAgent.ts) —
   canned answers for "how much do I have", "biggest balance", "payments due", etc. No LLM call.
3. **Structured JSON fallback** (`askStructuredCommandFallback`) — only if `isPotentialCommand()`
   thinks the text looks like a command but step 1 failed to parse it. One LLM call constrained by
   `json_schema` (`COMMAND_JSON_SCHEMA`), `temp: 0`, `reasoning_budget: 0`.
4. **Free-text LLM call** (`askLocalQVAC`) — full system prompt (TOOL_CALL conventions + few-shot
   examples) + `buildContextString()` (live snapshot: accounts, goals, rules, rates, upcoming
   payments) + last 2 turns of chat history (`getCleanChatHistory` in
   [ChatScreen.tsx](src/screens/ChatScreen.tsx)).

Every call to `askLocalQVAC` is logged to `inference_audit_log.json` (prompt, response, token
count, TTFT, tokens/sec) — required for the hackathon's audit trail.

## Is this an optimal way to talk to the LLM? No — several concrete issues

These are architectural, not cosmetic, and several of them directly explain "fast phone, feels
sluggish" (the iPhone 17 symptom):

1. **No KV-cache reuse across turns.** `completion()` in qvacService.ts never passes `kvCache`.
   The SDK explicitly supports `kvCache: true` + pushing back
   `(await run.final).cacheableAssistantContent` so only the new turn needs prefilling. Right now
   every single message reprocesses system prompt + full financial context + history from
   scratch — full prefill, every turn. This is the single highest-leverage fix.
2. **Audit logging is on the critical path and grows unbounded.** `addAuditLog`
   ([src/services/inferenceLogService.ts](src/services/inferenceLogService.ts)) reads the *entire*
   log file, `JSON.parse`s it, pushes one entry (which embeds the full prompt — i.e. the entire
   financial context string — and full response text), then `JSON.stringify`s and rewrites the
   whole file — awaited before the answer is returned to the UI. The file persists across app
   launches and only grows. This is an O(n) disk read+write per message that gets slower as the
   session/app gets older — matches "starts fast, degrades over time" exactly.
3. **GPU offload was likely already on.** `LLM_CONFIG_DEFAULTS` in the SDK is
   `{ gpu_layers: 99, device: "gpu", ... }`, so omitting them still ran on GPU (Metal on iOS).
   We now set them explicitly for clarity and log `stats.backendDevice` after each inference to
   confirm `gpu` vs `cpu` at runtime. (Implemented.)
4. **Some messages trigger two full LLM calls back to back.** If `isPotentialCommand()` is true but
   the regex parser can't resolve it, step 3 fires a full constrained inference; if that returns
   `{"action":"none"}`, execution falls through to step 4's full free-text inference. Each pays its
   own (uncached, per finding #1) prefill cost.
5. **Streaming re-renders the whole message list on every token.** The `onChunk` callback in
   ChatScreen.tsx calls `setMessages(prev => prev.map(...))` over the entire array on every single
   `contentDelta` event, plus a `console.log` per token in qvacService.ts. At ~20 tok/s that's
   dozens of full-list re-renders + FlatList diffs per second — a plausible source of UI jank
   independent of how fast the model itself is generating.
6. **`ctx_size: 4096` is tight** given the context string grows with account/payment count, and
   combined with #1 (no caching) means longer sessions risk context shifting
   (`RuntimeStats.contextSlides`), which is its own latency cliff.

### Status
1. ✅ `kvCache: true` enabled on the free-text and continuation LLM calls (qvacService/muffinAiAgent).
2. ✅ Audit logging is now fire-and-forget, FIFO-bounded to `MAX_LOG_ENTRIES`, with per-field
   truncation (inferenceLogService.ts).
3. ✅ GPU set explicitly + `backendDevice`/`cacheTokens` logged per inference.
4. ⏳ Two-LLM-call path for ambiguous command-like text — left as-is; it only fires for text that
   passes `isPotentialCommand()` but the regex parser can't resolve, which is rare, and the
   structured call is already cheap (`temp:0`, `predict:160`, `reasoning_budget:0`). Revisit only
   if audit logs show it firing often.
5. ⏳ Throttle `onChunk` UI updates and drop the per-token `console.log` — deferred (UI polish).
6. ✅ `ctx_size` raised 4096 → 8192.
