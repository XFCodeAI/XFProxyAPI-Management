import type { AuthFileCredentialIdentity, AuthFileItem } from '@/types/authFile';
import { normalizeCredentialWeight } from '@/utils/credentialWeight';
import {
  findCurrentAuthFileForIdentity,
  isAuthFileIdentityChangedError,
  readAuthFileCredentialIdentity,
} from './credentialIdentity';

export const AUTH_FILES_BATCH_WEIGHT_CONCURRENCY = 4;

export type AuthFilesBatchWeightInventory = {
  files: readonly AuthFileItem[];
  inventoryId: string;
  revision: number;
};

export type AuthFilesBatchWeightPlan = {
  inventoryId: string;
  revision: number;
  targets: AuthFileCredentialIdentity[];
};

export type AuthFilesBatchWeightMutationResponse = {
  files?: AuthFileItem[];
  inventory_id?: string;
  revision?: number;
};

export type AuthFilesBatchWeightFailureReason =
  'stale_inventory' | 'stale_identity' | 'patch_failed' | 'confirmation_failed';

export type AuthFilesBatchWeightFailure = {
  target: AuthFileCredentialIdentity;
  reason: AuthFilesBatchWeightFailureReason;
  error: unknown;
};

export type AuthFilesBatchWeightVersion = {
  inventoryId: string;
  revision: number;
  files: AuthFileItem[];
};

export type AuthFilesBatchWeightResult = {
  successCount: number;
  failed: AuthFilesBatchWeightFailure[];
  versions: AuthFilesBatchWeightVersion[];
};

type ApplyAuthFilesBatchWeightOptions = {
  plan: AuthFilesBatchWeightPlan;
  weight: number | null;
  getInventory: () => AuthFilesBatchWeightInventory;
  patch: (
    target: AuthFileCredentialIdentity,
    fields: { weight: number | null }
  ) => Promise<AuthFilesBatchWeightMutationResponse>;
  concurrency?: number;
};

const normalizeRevision = (value: unknown): number => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
};

const identityKey = (target: AuthFileCredentialIdentity): string => {
  const identity = readAuthFileCredentialIdentity(target);
  return [identity.name, identity.credentialId ?? '', identity.authIndex ?? ''].join('\u0000');
};

const generationMatches = (
  expected: AuthFileCredentialIdentity,
  current: AuthFileCredentialIdentity
): boolean => {
  if (expected.credentialGeneration === undefined || expected.credentialGeneration === null) {
    return true;
  }
  return current.credentialGeneration === expected.credentialGeneration;
};

const resolveCurrentTarget = (
  plan: AuthFilesBatchWeightPlan,
  expected: AuthFileCredentialIdentity,
  inventory: AuthFilesBatchWeightInventory
): { target: AuthFileCredentialIdentity | null; reason?: AuthFilesBatchWeightFailureReason } => {
  if (
    (plan.inventoryId && inventory.inventoryId !== plan.inventoryId) ||
    normalizeRevision(inventory.revision) < plan.revision
  ) {
    return { target: null, reason: 'stale_inventory' };
  }

  const currentFile = findCurrentAuthFileForIdentity(inventory.files, expected);
  if (!currentFile) return { target: null, reason: 'stale_identity' };

  const currentIdentity = readAuthFileCredentialIdentity(currentFile);
  if (!generationMatches(expected, currentIdentity)) {
    return { target: null, reason: 'stale_identity' };
  }
  return { target: currentIdentity };
};

const responseConfirmsWeight = (
  response: AuthFilesBatchWeightMutationResponse,
  target: AuthFileCredentialIdentity,
  weight: number | null
): boolean => {
  const authoritativeFile = findCurrentAuthFileForIdentity(response.files ?? [], target);
  if (!authoritativeFile) return false;

  const responseIdentity = readAuthFileCredentialIdentity(authoritativeFile);
  if (
    target.credentialGeneration !== undefined &&
    responseIdentity.credentialGeneration !== undefined &&
    responseIdentity.credentialGeneration !== target.credentialGeneration
  ) {
    return false;
  }

  const savedWeight = normalizeCredentialWeight(authoritativeFile.weight);
  return weight === null ? savedWeight === undefined : savedWeight === weight;
};

export const createAuthFilesBatchWeightPlan = (
  inventory: AuthFilesBatchWeightInventory,
  names: readonly string[]
): AuthFilesBatchWeightPlan => {
  const selectedNames = new Set(names.map((name) => String(name ?? '').trim()).filter(Boolean));
  const seen = new Set<string>();
  const targets: AuthFileCredentialIdentity[] = [];

  inventory.files.forEach((file) => {
    if (!selectedNames.has(file.name)) return;
    const identity = readAuthFileCredentialIdentity(file);
    const key = identityKey(identity);
    if (!identity.name || seen.has(key)) return;
    seen.add(key);
    targets.push(identity);
  });

  return {
    inventoryId: String(inventory.inventoryId ?? '').trim(),
    revision: normalizeRevision(inventory.revision),
    targets,
  };
};

export async function applyAuthFilesBatchWeight({
  plan,
  weight,
  getInventory,
  patch,
  concurrency = AUTH_FILES_BATCH_WEIGHT_CONCURRENCY,
}: ApplyAuthFilesBatchWeightOptions): Promise<AuthFilesBatchWeightResult> {
  const failed: AuthFilesBatchWeightFailure[] = [];
  const versions: AuthFilesBatchWeightVersion[] = [];
  let successCount = 0;
  let nextIndex = 0;

  const workerCount = Math.min(
    plan.targets.length,
    Math.max(1, Math.floor(Number(concurrency) || 1))
  );

  // A fixed worker pool bounds in-flight PATCH requests regardless of selection size.
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= plan.targets.length) return;

      const expected = plan.targets[index];
      const resolved = resolveCurrentTarget(plan, expected, getInventory());
      if (!resolved.target) {
        failed.push({
          target: expected,
          reason: resolved.reason ?? 'stale_identity',
          error: new Error(resolved.reason ?? 'stale_identity'),
        });
        continue;
      }

      try {
        const response = await patch(resolved.target, { weight });
        if (!responseConfirmsWeight(response, resolved.target, weight)) {
          failed.push({
            target: expected,
            reason: 'confirmation_failed',
            error: new Error('credential weight update was not confirmed'),
          });
          continue;
        }
        successCount += 1;
        versions.push({
          inventoryId: String(response.inventory_id ?? '').trim(),
          revision: normalizeRevision(response.revision),
          files: response.files ?? [],
        });
      } catch (error: unknown) {
        failed.push({
          target: expected,
          reason: isAuthFileIdentityChangedError(error) ? 'stale_identity' : 'patch_failed',
          error,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  versions.sort((left, right) => left.revision - right.revision);
  return { successCount, failed, versions };
}
