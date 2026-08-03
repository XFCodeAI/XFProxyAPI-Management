export const getProviderHomepageUrl = (baseUrl: string | null | undefined): string => {
  const value = baseUrl?.trim();
  if (!value || !/^https?:\/\//i.test(value)) return '';

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
};
