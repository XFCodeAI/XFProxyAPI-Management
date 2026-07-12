import type { ProxySelection } from '../../types/proxyPool';

export function resolveDefaultImportProxySelection(filesWithProxy: number): ProxySelection {
  return { mode: filesWithProxy > 0 ? 'file' : 'smart' };
}
