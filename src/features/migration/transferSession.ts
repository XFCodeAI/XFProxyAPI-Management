import type { MigrationTransferStatus } from '@/services/api/migration';

const MIGRATION_TRANSFER_SESSION_KEY = 'migration.activeTransferID';
const MIGRATION_TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type TransferSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readMigrationTransferID(
  storage: TransferSessionStorage | null | undefined
): string | null {
  if (!storage) return null;
  try {
    const id = storage.getItem(MIGRATION_TRANSFER_SESSION_KEY)?.trim() ?? '';
    if (!id) return null;
    if (!MIGRATION_TRANSFER_ID_PATTERN.test(id)) {
      storage.removeItem(MIGRATION_TRANSFER_SESSION_KEY);
      return null;
    }
    return id;
  } catch {
    return null;
  }
}

export function writeMigrationTransferID(
  storage: TransferSessionStorage | null | undefined,
  id: string
): void {
  if (!storage || !MIGRATION_TRANSFER_ID_PATTERN.test(id)) return;
  try {
    storage.setItem(MIGRATION_TRANSFER_SESSION_KEY, id);
  } catch {
    return;
  }
}

export function clearMigrationTransferID(
  storage: Pick<TransferSessionStorage, 'removeItem'> | null | undefined
): void {
  if (!storage) return;
  try {
    storage.removeItem(MIGRATION_TRANSFER_SESSION_KEY);
  } catch {
    return;
  }
}

export function shouldPersistMigrationTransfer(status: MigrationTransferStatus): boolean {
  return status !== 'completed' && status !== 'canceled';
}

function browserSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export const readActiveMigrationTransferID = (): string | null =>
  readMigrationTransferID(browserSessionStorage());

export const writeActiveMigrationTransferID = (id: string): void =>
  writeMigrationTransferID(browserSessionStorage(), id);

export const clearActiveMigrationTransferID = (): void =>
  clearMigrationTransferID(browserSessionStorage());
