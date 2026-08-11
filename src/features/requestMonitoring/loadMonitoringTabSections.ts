export type MonitoringTab = 'credentials' | 'api_keys' | 'requests';

interface MonitoringSectionLoaders {
  summary: () => Promise<void>;
  facets: () => Promise<void>;
  identities: () => Promise<void>;
  requests: () => Promise<void>;
}

export const loadMonitoringTabSections = (
  tab: MonitoringTab,
  loaders: MonitoringSectionLoaders
): Promise<void[]> =>
  Promise.all([
    loaders.summary(),
    loaders.facets(),
    tab === 'requests' ? loaders.requests() : loaders.identities(),
  ]);
