export const MARKETING_CATEGORIES = ['hvac','roofing','plumbing','electrical','landscaping','pest-control','dental','medical','legal','restaurant','retail','auto','real-estate','fitness','other'] as const;
export type MarketingCategory = typeof MARKETING_CATEGORIES[number];
export interface MarketingClientLocation { id: string; label: string; address: string; city: string; stateCode: string; lat: number; lon: number; serviceRadiusMiles: number; }
export interface MarketingClient { id: string; name: string; category: MarketingCategory; locations: MarketingClientLocation[]; competitors: string[]; keywords: string[]; accountManagerEmail: string | null; active: boolean; }
export type MarketingSignalKind = 'weather' | 'mention' | 'calendar' | 'trend';
export interface MarketingSignal { id: string; kind: MarketingSignalKind; clientId: string | null; title: string; detail: string; url: string | null; severity: 'info' | 'watch' | 'warning'; occurredAt: string; lat: number | null; lon: number | null; }
