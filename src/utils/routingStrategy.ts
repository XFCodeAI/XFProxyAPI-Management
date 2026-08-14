export const ROUTING_STRATEGIES = [
  'round-robin',
  'weighted-round-robin',
  'fill-first',
] as const;

export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export function normalizeRoutingStrategy(value: unknown): RoutingStrategy | undefined {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  if (normalized === 'round-robin' || normalized === 'roundrobin' || normalized === 'rr') {
    return 'round-robin';
  }
  if (
    normalized === 'weighted-round-robin' ||
    normalized === 'weightedroundrobin' ||
    normalized === 'wrr'
  ) {
    return 'weighted-round-robin';
  }
  if (normalized === 'fill-first' || normalized === 'fillfirst' || normalized === 'ff') {
    return 'fill-first';
  }
  return undefined;
}
