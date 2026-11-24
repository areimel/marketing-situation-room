export function unwrapEnvelope(raw) {
  if (raw == null) return { _seed: null, data: null };
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { _seed: null, data: raw };
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { _seed: null, data: value };
  }
  const seed = value._seed;
  if (seed && typeof seed === 'object' && typeof seed.fetchedAt === 'number') {
    return { _seed: seed, data: value.data };
  }
  return { _seed: null, data: value };
}
