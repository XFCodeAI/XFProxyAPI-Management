import {
  buildMonitoringDrillHref,
  type MonitoringFilters,
} from '@/features/requestMonitoring/viewModel';
import type {
  AnalyticsIdentity,
  AnalyticsView,
  DashboardAnalytics,
  DashboardFailure,
} from '@/services/api';

export const dashboardAnalyticsHref = (data: DashboardAnalytics, view: AnalyticsView): string => {
  const params = new URLSearchParams({
    view,
    from: data.todayFrom,
    to: data.snapshotAt,
    timezone: data.timezone,
    granularity: 'hour',
  });
  return `/usage-analytics?${params.toString()}`;
};

export const dashboardTodayMonitoringHref = (
  data: DashboardAnalytics,
  filters: Partial<MonitoringFilters> = {}
): string => buildMonitoringDrillHref({ from: data.todayFrom, to: data.snapshotAt }, filters);

export const dashboardRollingMonitoringHref = (data: DashboardAnalytics): string => {
  const to = new Date(data.snapshotAt);
  const from = new Date(to.getTime() - data.rolling.windowMinutes * 60_000);
  return buildMonitoringDrillHref({ from: from.toISOString(), to: to.toISOString() });
};

export const dashboardModelMonitoringHref = (
  data: DashboardAnalytics,
  identity: AnalyticsIdentity
): string =>
  dashboardTodayMonitoringHref(data, {
    provider: identity.provider || 'all',
    resolvedModel: identity.resolvedModel || 'all',
    requestedModel: identity.requestedModel || 'all',
  });

export const dashboardFailureMonitoringHref = (failure: DashboardFailure): string => {
  const center = new Date(failure.requestedAt);
  const from = new Date(center.getTime() - 60_000);
  const to = new Date(center.getTime() + 60_000);
  return buildMonitoringDrillHref(
    { from: from.toISOString(), to: to.toISOString() },
    {
      provider: failure.provider || 'all',
      resolvedModel: failure.resolvedModel || 'all',
      result: 'failure',
      requestId: failure.requestId,
    }
  );
};
