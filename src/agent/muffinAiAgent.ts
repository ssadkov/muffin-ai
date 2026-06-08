import { qvacChat } from '../services/qvacService';
import {
  getLatestBalances,
  getTotalLiquidAssets,
  getActiveGoals,
  getActiveRules
} from '../tools/databaseTools';
import { checkMoneyRules } from '../tools/rulesTools';

export type AgentResponse = {
  message: string;
  actions?: AgentAction[];
};

export type AgentAction = {
  type: string;
  label: string;
  metadata?: Record<string, unknown>;
};

export async function askMuffinAi(question: string): Promise<AgentResponse> {
  const balances = getLatestBalances();
  const goals = getActiveGoals();
  const rules = getActiveRules();
  const totalAssets = getTotalLiquidAssets();
  const ruleWarnings = checkMoneyRules();

  // 1. Build Context
  let context = 'LOCAL FINANCIAL MEMORY\\n\\n';
  
  if (goals.length > 0) {
    context += 'Goals:\\n';
    goals.forEach(g => {
      context += `- ${g.title}\\n`;
    });
    context += '\\n';
  }

  if (balances.length > 0) {
    context += 'Accounts:\\n';
    balances.forEach(b => {
      context += `- ${b.name}: $${b.usd_value}, source: ${b.source}, updated: ${b.created_at}\\n`;
    });
    context += '\\n';
  }

  if (rules.length > 0) {
    context += 'Rules:\\n';
    rules.forEach(r => {
      context += `- ${r.title}\\n`;
    });
    context += '\\n';
  }

  context += 'Computed:\\n';
  context += `- Total liquid assets: $${totalAssets}\\n`;
  if (goals.length > 0 && goals[0].target_value > 0) {
    const progress = (totalAssets / goals[0].target_value) * 100;
    context += `- Goal progress: ${progress.toFixed(2)}%\\n`;
  }
  
  if (ruleWarnings.length > 0) {
    context += `- Rule warnings:\\n`;
    ruleWarnings.forEach(w => {
      context += `  * ${w.message}\\n`;
    });
  } else {
    context += `- Rule warnings: None\\n`;
  }

  // 2. Build final prompt
  const fullPrompt = `${context}\\n\\nUSER QUESTION:\\n${question}`;

  console.log('Sending prompt to QVAC:', fullPrompt);

  // 3. Send to AI
  const message = await qvacChat(fullPrompt);

  return { message };
}
