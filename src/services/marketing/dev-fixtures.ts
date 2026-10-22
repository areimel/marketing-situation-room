import type { MarketingClient } from '../../../shared/marketing/types';

/**
 * Five fake clients for local development. Only `roster.ts` imports this
 * file, dynamically and behind `import.meta.env.DEV`, so production builds
 * never ship it. The states (TX, FL, OK, CO, NC) are storm-prone so the
 * weather layer has something to show.
 */
export const DEV_CLIENTS: MarketingClient[] = [
  {
    id: 'fixture-client-1',
    name: 'Fixture Lone Star Cooling',
    category: 'hvac',
    locations: [
      { id: 'fixture-loc-1a', label: 'Austin', address: '100 Fixture Ave', city: 'Austin', stateCode: 'TX', lat: 30.2672, lon: -97.7431, serviceRadiusMiles: 30 },
    ],
    competitors: ['Fixture Rival Air'],
    keywords: ['ac repair', 'furnace install'],
    accountManagerEmail: null,
    active: true,
  },
  {
    id: 'fixture-client-2',
    name: 'Fixture Gulf Coast Roofing',
    category: 'roofing',
    locations: [
      { id: 'fixture-loc-2a', label: 'Tampa', address: '200 Fixture Blvd', city: 'Tampa', stateCode: 'FL', lat: 27.9506, lon: -82.4572, serviceRadiusMiles: 25 },
    ],
    competitors: ['Fixture Rival Roofs'],
    keywords: ['roof repair', 'hurricane damage'],
    accountManagerEmail: null,
    active: true,
  },
  {
    id: 'fixture-client-3',
    name: 'Fixture Plains Plumbing',
    category: 'plumbing',
    locations: [
      { id: 'fixture-loc-3a', label: 'Tulsa', address: '300 Fixture St', city: 'Tulsa', stateCode: 'OK', lat: 36.154, lon: -95.9928, serviceRadiusMiles: 20 },
    ],
    competitors: ['Fixture Rival Pipes'],
    keywords: ['burst pipe', 'water heater'],
    accountManagerEmail: null,
    active: true,
  },
  {
    id: 'fixture-client-4',
    name: 'Fixture Front Range Landscaping',
    category: 'landscaping',
    locations: [
      { id: 'fixture-loc-4a', label: 'Denver', address: '400 Fixture Way', city: 'Denver', stateCode: 'CO', lat: 39.7392, lon: -104.9903, serviceRadiusMiles: 40 },
    ],
    competitors: ['Fixture Rival Lawns'],
    keywords: ['hail cleanup', 'sprinkler repair'],
    accountManagerEmail: null,
    active: true,
  },
  {
    id: 'fixture-client-5',
    name: 'Fixture Piedmont Pest Control',
    category: 'pest-control',
    locations: [
      { id: 'fixture-loc-5a', label: 'Charlotte', address: '500 Fixture Rd', city: 'Charlotte', stateCode: 'NC', lat: 35.2271, lon: -80.8431, serviceRadiusMiles: 15 },
    ],
    competitors: ['Fixture Rival Pest'],
    keywords: ['termite inspection', 'mosquito control'],
    accountManagerEmail: null,
    active: true,
  },
];
