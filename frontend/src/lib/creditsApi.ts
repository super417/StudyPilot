import { apiRequest } from './httpClient';
import { CREDIT_SELECTION_CHANGED } from './creditModelOptions';

export interface CreditModel {
  id: string; provider: string; displayName: string; inputPointsPerMillion: string;
  outputPointsPerMillion: string; maxInputTokens: number; maxOutputTokens: number;
}
export interface CreditCatalog {
  status: string; platformAvailable: boolean; models: CreditModel[];
  plans: { id: string; name: string; priceFen: number; basePoints: number; bonusPoints: number; purchaseAvailable: boolean }[];
}
export interface CreditAccount {
  status: string; testPlan?: boolean; planName?: string; mode: 'byok' | 'platform'; modelId: string | null;
  availableMicroPoints: number; reservedMicroPoints: number; nextRefreshAt: string;
  lots: { id: string; kind: string; grantedMicroPoints: number; remainingMicroPoints: number; reservedMicroPoints: number; expiresAt: string }[];
  ledger: { id: string; kind: string; amountMicroPoints: number; createdAt: string }[];
}
export const fetchCreditCatalog = () => apiRequest<CreditCatalog>('/api/credits/catalog');
export const fetchCreditAccount = () => apiRequest<CreditAccount>('/api/credits/account');
export const saveCreditPreferences = async (mode: 'byok' | 'platform', modelId: string | null) => {
  const result = await apiRequest('/api/credits/preferences', { method: 'PUT', body: JSON.stringify({ mode, modelId }) });
  window.dispatchEvent(new Event(CREDIT_SELECTION_CHANGED));
  return result;
};
export const formatPoints = (microPoints: number) => (microPoints / 1_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
