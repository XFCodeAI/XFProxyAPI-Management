import type { CredentialIdentityCatalogEntry } from '@/services/api';
import type { AuthFileItem } from '@/types/authFile';

export interface ReconciledCredentialIdentity extends CredentialIdentityCatalogEntry {
  groups: string[];
}

const currentCredential = (file: AuthFileItem): ReconciledCredentialIdentity | null => {
  const recordedId = String(file.id ?? file.name ?? '').trim();
  if (!recordedId) return null;
  return {
    recordedId,
    displayName: String(file.name ?? recordedId).trim() || recordedId,
    provider: String(file.provider ?? file.type ?? '').trim(),
    currentId: recordedId,
    current: true,
    hasUsage: false,
    groups: Array.isArray(file.groups)
      ? file.groups.map((group) => String(group).trim()).filter(Boolean)
      : [],
  };
};

export const reconcileCredentialIdentityCatalog = (
  catalog: CredentialIdentityCatalogEntry[],
  files: AuthFileItem[]
): ReconciledCredentialIdentity[] => {
  const currentByID = new Map<string, ReconciledCredentialIdentity>();
  files.forEach((file) => {
    const identity = currentCredential(file);
    if (identity) currentByID.set(identity.recordedId, identity);
  });

  const seen = new Set<string>();
  const reconciled: ReconciledCredentialIdentity[] = [];
  catalog.forEach((entry) => {
    const recordedId = entry.recordedId.trim();
    if (!recordedId || seen.has(recordedId)) return;
    const current = currentByID.get(recordedId);
    if (!current && !entry.hasUsage) return;
    reconciled.push({
      ...entry,
      recordedId,
      displayName: entry.displayName.trim() || current?.displayName || recordedId,
      provider: entry.provider.trim() || current?.provider || '',
      currentId: current ? recordedId : '',
      current: Boolean(current),
      groups: current?.groups ?? [],
    });
    seen.add(recordedId);
  });
  currentByID.forEach((entry, recordedId) => {
    if (seen.has(recordedId)) return;
    reconciled.push(entry);
  });
  return reconciled;
};
