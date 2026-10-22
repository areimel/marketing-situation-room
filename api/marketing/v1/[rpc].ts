export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';
import { createMarketingServiceRoutes } from '../../../src/generated/server/worldmonitor/marketing/v1/service_server';
import { marketingHandler } from '../../../server/worldmonitor/marketing/v1/handler';

export default createDomainGateway(
  createMarketingServiceRoutes(marketingHandler, serverOptions),
);
