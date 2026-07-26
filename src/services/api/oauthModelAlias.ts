export type OAuthModelAliasValue = {
  name: string;
  alias: string;
  fork?: boolean;
  displayName?: string;
  forceMapping?: boolean;
};

export const normalizeOauthModelAliasEntries = (value: unknown): OAuthModelAliasValue[] => {
  if (!Array.isArray(value)) return [];

  const entries: OAuthModelAliasValue[] = [];
  const seenAliases = new Set<string>();

  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const name = String(record.name ?? record.id ?? record.model ?? '').trim();
    const alias = String(record.alias ?? '').trim();
    const aliasKey = alias.toLowerCase();
    if (!name || !alias || seenAliases.has(aliasKey)) return;

    const entry: OAuthModelAliasValue = { name, alias };
    if (record.fork === true) entry.fork = true;

    const displayName = String(record['display-name'] ?? record.displayName ?? '').trim();
    if (displayName) entry.displayName = displayName;

    const forceMapping = record['force-mapping'] ?? record.forceMapping;
    if (typeof forceMapping === 'boolean') entry.forceMapping = forceMapping;

    seenAliases.add(aliasKey);
    entries.push(entry);
  });

  return entries;
};

export const serializeOauthModelAliases = (
  aliases: readonly OAuthModelAliasValue[]
): Array<Record<string, unknown>> =>
  aliases.map((entry) => {
    const payload: Record<string, unknown> = {
      name: entry.name,
      alias: entry.alias,
    };
    if (entry.fork) payload.fork = true;
    if (entry.displayName) payload['display-name'] = entry.displayName;
    if (typeof entry.forceMapping === 'boolean') {
      payload['force-mapping'] = entry.forceMapping;
    }
    return payload;
  });
