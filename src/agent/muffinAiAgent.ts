import { askLocalQVAC } from '../services/qvacService';
import {
  getLatestBalances,
  getActiveGoals,
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
    context += `- ${a.name}: $${a.usd_value}, source: ${a.source}, updated: ${a.created_at}\n`;
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
  }

  return response;
}
