# Muffin AI Hackathon Demo Prompts

Use these English prompts for the final video and the auditable demo run. They are phrased to reduce ambiguity for the local QVAC model and to make the output easy for judges to verify against the Accounts screen.

## Global Portfolio

1. How much do I have on Aptos?
2. How many Aptos wallets do I have?
3. What is my total crypto portfolio?
4. How much is left until my goal?
5. Can I cover upcoming payments?

## Account-Scoped Tools

Open an account from the Accounts screen with the `Ask` button first. The Chat screen should show `Context: <account name>`.

1. How much is here?
2. Set this account to 9642 USD.
3. Add 500 USD here.
4. Rename this account to Halyk.

## Voice Demo

1. How much do I have on Aptos?
2. How much is here?
3. Set this account to 9642 USD.

## Screenshot/OCR Demo

1. Tap `+`.
2. Choose a bank or wallet screenshot.
3. Confirm the extracted account and balance.
4. Ask: What is my total liquid portfolio now?

## Expected Evidence

- Each QVAC answer should show the `ON-DEVICE` badge with TTFT and tokens/sec.
- Tool actions should appear as confirmation cards before modifying SQLite.
- The exported audit log should include model load and inference performance for the standard demo run.
