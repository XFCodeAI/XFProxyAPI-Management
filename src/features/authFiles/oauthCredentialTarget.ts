export type OAuthCredentialReference = {
  id: string;
  name: string;
};

type OAuthCredentialInventoryEntry = {
  id?: unknown;
  name: unknown;
};

export function resolveOAuthCredentialTarget<T extends OAuthCredentialInventoryEntry>(
  credential: OAuthCredentialReference,
  files: readonly T[]
): T | null {
  const id = String(credential.id ?? '');
  const name = String(credential.name ?? '');
  if (!id || !name || id.trim() !== id || name.trim() !== name) return null;

  return (
    files.find((file) => {
      if (file.name !== name) return false;
      return typeof file.id === 'string' && file.id === id;
    }) ?? null
  );
}
