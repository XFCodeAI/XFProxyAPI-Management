import type { CapabilityBindingTarget, CapabilityPackStatus, PromptRewriteCatalog } from '@/types';

export type CapabilityTargetType = 'global' | 'provider' | 'credential-group' | 'credential';

export type CapabilitySimulationKind = 'request' | 'response' | 'response-events';

export const globalCapabilityTarget: CapabilityBindingTarget = { type: 'global' };
export const requestSimulationFixture = '{\n  "instructions": "base",\n  "input": "hello"\n}';
export const responseSimulationFixture =
  '{\n  "output": [\n    {\n      "type": "message",\n      "content": [\n        {\n          "type": "output_text",\n          "text": "I cannot help with that."\n        }\n      ]\n    }\n  ]\n}';
export const responseEventsSimulationFixture =
  '[\n  {\n    "type": "response.output_text.delta",\n    "delta": "I cannot help with that."\n  }\n]';

export const capabilityTargetKey = (target: CapabilityBindingTarget) =>
  `${target.type}:${(target.value ?? '').trim().toLowerCase()}`;

export const capabilityTargetLabel = (target: CapabilityBindingTarget) =>
  target.type === 'global' ? 'global' : `${target.type}:${target.value ?? ''}`;

export const resolvePackCapabilities = (status: CapabilityPackStatus, capabilityIDs: string[]) => {
  const byID = new Map(status.pack.capabilities.map((item) => [item.id.toLowerCase(), item]));
  const resolved: CapabilityPackStatus['pack']['capabilities'] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    const key = id.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    const capability = byID.get(key);
    if (!capability) return;
    seen.add(key);
    if (capability.kind === 'profile') {
      capability.includes.forEach(visit);
      return;
    }
    resolved.push(capability);
  };
  capabilityIDs.forEach(visit);
  return resolved;
};

export const responsePackCapabilities = (status: CapabilityPackStatus, capabilityIDs: string[]) =>
  resolvePackCapabilities(status, capabilityIDs).filter(
    (capability) => capability.kind === 'response-transform'
  );

export const capabilitySelectionIsLocalOnly = (
  status: CapabilityPackStatus,
  capabilityIDs: string[]
) =>
  resolvePackCapabilities(status, capabilityIDs).some((capability) =>
    capability.resourceIDs.some(
      (resourceID) => status.pack.resources.find((item) => item.id === resourceID)?.localOnly
    )
  );

export const sameCapabilitySelection = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));

export const splitCapabilityMatchValues = (value: string): string[] => {
  const seen = new Set<string>();
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const parseSimulationFixture = (value: string, expected: 'object' | 'array'): unknown => {
  const parsed: unknown = JSON.parse(value);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (expected === 'array' ? !Array.isArray(parsed) : Array.isArray(parsed))
  ) {
    throw new TypeError(
      expected === 'array' ? 'fixture_array_required' : 'fixture_object_required'
    );
  }
  if (
    expected === 'array' &&
    (parsed as unknown[]).some(
      (item) => item === null || typeof item !== 'object' || Array.isArray(item)
    )
  ) {
    throw new TypeError('fixture_event_object_required');
  }
  return parsed;
};

export const simulationFixtureIsValid = (
  kind: CapabilitySimulationKind,
  body: string,
  events: string
) => {
  try {
    parseSimulationFixture(
      kind === 'response-events' ? events : body,
      kind === 'response-events' ? 'array' : 'object'
    );
    return true;
  } catch {
    return false;
  }
};

export const prettySimulationFixture = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
};

export const capabilityResourceIDs = (
  status: CapabilityPackStatus,
  capabilityID: string
): string[] => {
  const resources = new Set<string>();
  resolvePackCapabilities(status, [capabilityID]).forEach((capability) =>
    capability.resourceIDs.forEach((resourceID) => resources.add(resourceID))
  );
  return [...resources];
};

export const codexTargetOptions = (
  catalog: PromptRewriteCatalog | null,
  type: CapabilityTargetType
) => {
  if (type === 'provider') {
    return (
      catalog?.providers
        .filter(
          (provider) => provider.carrierSupported && provider.id.trim().toLowerCase() === 'codex'
        )
        .map((provider) => ({ value: provider.id, label: provider.id })) ?? []
    );
  }
  if (type === 'credential-group') {
    const credentials = catalog?.credentials ?? [];
    return (
      catalog?.credentialGroups
        .filter((group) =>
          credentials.some(
            (credential) =>
              credential.groups.some(
                (credentialGroup) =>
                  credentialGroup.trim().toLowerCase() === group.trim().toLowerCase()
              ) &&
              credential.carrierSupported &&
              credential.provider.trim().toLowerCase() === 'codex'
          )
        )
        .map((group) => ({ value: group, label: group })) ?? []
    );
  }
  if (type === 'credential') {
    return (
      catalog?.credentials
        .filter(
          (credential) =>
            credential.carrierSupported && credential.provider.trim().toLowerCase() === 'codex'
        )
        .map((credential) => ({
          value: credential.id,
          label: [credential.displayName || credential.id, credential.provider]
            .filter(Boolean)
            .join(' / '),
        })) ?? []
    );
  }
  return [];
};
