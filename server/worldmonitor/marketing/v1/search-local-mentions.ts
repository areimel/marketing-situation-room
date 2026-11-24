import type { MarketingServiceHandler } from '../../../../src/generated/server/worldmonitor/marketing/v1/service_server';

// W0 stub; W6 owns the mentions implementation. Queries carry client names:
// never log them and never let them reach a public cache (R5).
export const searchLocalMentions: MarketingServiceHandler['searchLocalMentions'] = async () => ({
  mentions: [],
  degraded: false,
});
