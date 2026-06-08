import { getLatestBalances, getActiveRules } from './databaseTools';

export type RuleWarning = {
  ruleId: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  accountId?: string;
};

export function checkMoneyRules(): RuleWarning[] {
  const rules = getActiveRules();
  const balances = getLatestBalances();
  const warnings: RuleWarning[] = [];

  for (const rule of rules) {
    if (rule.rule_type === 'crypto_card_max_balance') {
      const limit = rule.threshold_value;
      for (const b of balances) {
        if (b.name.toLowerCase().includes('card') || b.source === 'crypto_card') {
          if (b.usd_value > limit) {
            warnings.push({
              ruleId: rule.id,
              title: rule.title,
              message: `${b.name} exceeds $${limit} by $${b.usd_value - limit}.`,
              severity: rule.severity,
              accountId: b.id
            });
          }
        }
      }
    } else if (rule.rule_type === 'stale_balance_check') {
      const maxDays = rule.threshold_value;
      const now = new Date().getTime();
      for (const b of balances) {
        const d = new Date(b.created_at).getTime();
        const diffDays = (now - d) / (1000 * 3600 * 24);
        if (diffDays > maxDays) {
          warnings.push({
            ruleId: rule.id,
            title: rule.title,
            message: `${b.name} hasn't been updated in ${Math.round(diffDays)} days.`,
            severity: rule.severity,
            accountId: b.id
          });
        }
      }
    }
  }

  return warnings;
}
