export type OAuthCredentialReference = {
  provider: string;
  id: string;
  name: string;
};

type OAuthCredentialInventoryEntry = {
  provider?: unknown;
  type?: unknown;
  id?: unknown;
  name: unknown;
};

export function resolveOAuthCredentialTarget<T extends OAuthCredentialInventoryEntry>(
  credential: OAuthCredentialReference,
  files: readonly T[]
): T | null {
  const rawProvider = String(credential.provider ?? '');
  const provider = rawProvider.toLowerCase();
  const id = String(credential.id ?? '');
  const name = String(credential.name ?? '');
  if (
    !provider ||
    !id ||
    !name ||
    rawProvider.trim() !== rawProvider ||
    id.trim() !== id ||
    name.trim() !== name
  ) {
    return null;
  }

  return (
    files.find((file) => {
      const fileProvider = String(file.provider ?? file.type ?? '')
        .trim()
        .toLowerCase();
      if (fileProvider !== provider) return false;
      if (file.name !== name) return false;
      return typeof file.id === 'string' && file.id === id;
    }) ?? null
  );
}
