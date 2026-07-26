/**
 * Hooks 统一导出
 */

export { useLocalStorage } from './useLocalStorage';
export { useInterval } from './useInterval';
export { useMediaQuery } from './useMediaQuery';
export { useHeaderRefresh } from './useHeaderRefresh';
export { useCoalescedAsyncTask } from './useCoalescedAsyncTask';
export { useDebouncedValue } from './useDebouncedValue';
export {
  createLatestRequestCoordinator,
  useLatestAsyncSection,
  type AsyncSection,
  type AsyncSectionState,
  type LatestRequestCoordinator,
  type LatestRequestResult,
} from './useLatestAsyncSection';
export { usePageActivityRefresh } from './usePageActivityRefresh';
