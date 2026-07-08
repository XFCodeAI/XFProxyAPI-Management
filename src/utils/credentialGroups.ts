export const normalizeCredentialGroups = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const groups: string[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const group = String(item ?? '').trim();
    if (!group) return;
    const key = group.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    groups.push(group);
  });
  return groups;
};

export const areCredentialGroupsEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(normalizeCredentialGroups(left)) ===
  JSON.stringify(normalizeCredentialGroups(right));
