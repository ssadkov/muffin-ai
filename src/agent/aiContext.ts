export type AiContext =
  | {
      kind: 'account';
      accountId: string;
      accountName: string;
      currency: string;
      ownerType?: 'personal' | 'company' | string | null;
      source?: string | null;
    }
  | {
      kind: 'none';
    };

export function isAccountContext(context?: AiContext | null): context is Extract<AiContext, { kind: 'account' }> {
  return Boolean(context && context.kind === 'account' && context.accountId);
}
