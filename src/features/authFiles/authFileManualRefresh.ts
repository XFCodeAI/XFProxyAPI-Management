export type RunAuthFileManualRefreshOptions = {
  name: string;
  pendingNames: Set<string>;
  request: (name: string) => Promise<unknown>;
  refreshInventory: () => Promise<unknown>;
  onPendingChange: (name: string, pending: boolean) => void;
};

export const runAuthFileManualRefresh = async (
  options: RunAuthFileManualRefreshOptions
): Promise<boolean> => {
  const name = options.name.trim();
  if (!name || options.pendingNames.has(name)) return false;

  options.pendingNames.add(name);
  options.onPendingChange(name, true);
  try {
    await options.request(name);
    await options.refreshInventory();
    return true;
  } finally {
    options.pendingNames.delete(name);
    options.onPendingChange(name, false);
  }
};
