import { askLocalQVAC } from '../services/qvacService';
import {
  getLatestBalances,
  getActiveGoals,
  executeBalanceUpdate,
} from '../tools/databaseTools';
import { checkMoneyRules } from '../tools/rulesTools';
import { getBitcoinPrice } from '../tools/cryptoApiTools';

export type AgentResponse = {
  message: string;
  actions?: AgentAction[];
};

export type AgentAction = {
  type: string;
  label: string;
  metadata?: Record<string, unknown>;
};

function buildContextString(): string {
  const accounts = getLatestBalances();
  const goals = getActiveGoals();
  const rules = checkMoneyRules();

  let context = 'LOCAL FINANCIAL MEMORY\n\n';
  
  context += 'Goals:\n';
  goals.forEach(g => context += `- ${g.title}: $${g.target_value}\n`);

  context += '\nAccounts:\n';
  let total = 0;
  accounts.forEach(a => {
    // Include account ID and currency to help the LLM match them correctly
    context += `- ${a.name} (ID: ${a.id}): ${a.amount} ${a.currency || 'USD'} (USD value: $${a.usd_value}), source: ${a.source}, updated: ${a.created_at}\n`;
    total += a.usd_value;
  });

  context += '\nRules Warnings:\n';
  rules.forEach(r => context += `* ${r.message}\n`);

  context += `\nComputed:\n- Total liquid assets: $${total}\n`;

  return context;
}

export async function askMuffinAi(question: string): Promise<{ message: string }> {
  const context = buildContextString();
  const instructions = `You are a private local AI on an iPhone. Keep answers concise.
If the user asks for the Bitcoin price or BTC price, reply exactly with: [TOOL_CALL: BTC_PRICE]
If the user wants to add money, subtract/spend money, or set/update the balance of one of their accounts, identify the correct account ID and details from the context list, and reply exactly with: [TOOL_CALL: UPDATE_BALANCE: {"accountId": "ACCOUNT_ID", "amount": NUMBER, "currency": "CURRENCY_CODE", "type": "add" | "subtract" | "set"}]
Examples:
- "получил 100$ на halyk, добавь" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_halyk", "amount": 100, "currency": "USD", "type": "add"}]
- "списали 5000 тенге с Kaspi" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_kaspi", "amount": 5000, "currency": "KZT", "type": "subtract"}]
- "у меня на Bybit теперь 500$" -> [TOOL_CALL: UPDATE_BALANCE: {"accountId": "acc_bybit", "amount": 500, "currency": "USD", "type": "set"}]
Only output the TOOL_CALL if you are sure about the account. Do not include any conversational text with it.
Otherwise, answer their question using the context provided.`;

  const prompt = `${context}\n\nSYSTEM INSTRUCTIONS:\n${instructions}\n\nUSER QUESTION:\n${question}`;
  
  console.log("Sending prompt to Edge AI...");
  let response = await askLocalQVAC(prompt);

  // Tool parsing loop
  if (response.message.includes('[TOOL_CALL: BTC_PRICE]')) {
    console.log("Edge AI requested tool: BTC_PRICE");
    const price = await getBitcoinPrice();
    const followupPrompt = `${prompt}\n\nSYSTEM: Tool returned Bitcoin price = $${price}. Please answer the user now.`;
    response = await askLocalQVAC(followupPrompt);
  } else if (response.message.includes('[TOOL_CALL: UPDATE_BALANCE:')) {
    console.log("Edge AI requested tool: UPDATE_BALANCE");
    const match = response.message.match(/\[TOOL_CALL: UPDATE_BALANCE: (\{.*?\})\]/);
    if (match) {
      try {
        const { accountId, amount, currency, type } = JSON.parse(match[1]);
        const result = executeBalanceUpdate(accountId, amount, currency, type);
        console.log("Balance update executed successfully:", result);
        
        const followupPrompt = `${prompt}\n\nSYSTEM: Tool successfully executed ${type} of ${amount} ${currency} for account '${result.accountName}' (ID: ${accountId}). New account balance is ${result.newAmount} ${result.currency} (USD equivalent: $${result.newUsdValue.toFixed(2)}). Please tell the user that the balance has been updated and confirm the new details.`;
        response = await askLocalQVAC(followupPrompt);
      } catch (e: any) {
        console.error("Error executing balance update tool:", e);
        const errorPrompt = `${prompt}\n\nSYSTEM: Failed to update balance. Error: ${e?.message || e}. Please inform the user.`;
        response = await askLocalQVAC(errorPrompt);
      }
    }
  }

  return response;
}
