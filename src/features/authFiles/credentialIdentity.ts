import type { AuthFileCredentialIdentity, AuthFileItem } from '@/types/authFile';

type APIErrorLike = {
  status?: unknown;
  code?: unknown;
};

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const normalizeGeneration = (value: unknown): number | null => {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
};

export const readAuthFileCredentialIdentity = (
  file: AuthFileItem | AuthFileCredentialIdentity
): AuthFileCredentialIdentity => {
  const record = file as AuthFileItem & AuthFileCredentialIdentity;
  const credentialId = normalizeText(record.credentialId ?? record.credential_id ?? record.id);
  const authIndex = normalizeText(record.authIndex ?? record.auth_index);
  const credentialGeneration = normalizeGeneration(
    record.credentialGeneration ?? record.credential_generation
  );

  return {
    name: normalizeText(record.name),
    ...(credentialId ? { credentialId } : {}),
    ...(authIndex ? { authIndex } : {}),
    ...(credentialGeneration === null ? {} : { credentialGeneration }),
  };
};

export const authFileMatchesCredentialIdentity = (
  file: AuthFileItem,
  expected: AuthFileCredentialIdentity
): boolean => {
  const current = readAuthFileCredentialIdentity(file);
  const identity = readAuthFileCredentialIdentity(expected);
  if (!identity.name || current.name !== identity.name) return false;
  if (identity.credentialId && current.credentialId !== identity.credentialId) return false;
  if (identity.authIndex && current.authIndex !== identity.authIndex) return false;
  return true;
};

export const findCurrentAuthFileForIdentity = (
  files: readonly AuthFileItem[],
  expected: AuthFileCredentialIdentity
): AuthFileItem | null => {
  const identity = readAuthFileCredentialIdentity(expected);
  const exact = files.find((file) => authFileMatchesCredentialIdentity(file, identity));
  if (exact) return exact;
  if (identity.credentialId || identity.authIndex) return null;

  const sameName = files.filter((file) => normalizeText(file.name) === identity.name);
  return sameName.length === 1 ? sameName[0] : null;
};

export const isAuthFileIdentityChangedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as APIErrorLike;
  return candidate.status === 409 && candidate.code === 'auth_identity_changed';
};

export const recoverAuthFileIdentityConflict = async (
  error: unknown,
  refreshInventory: () => Promise<void>
): Promise<boolean> => {
  if (!isAuthFileIdentityChangedError(error)) return false;
  await refreshInventory();
  return true;
};
