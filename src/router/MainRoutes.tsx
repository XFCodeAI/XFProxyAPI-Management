import { Suspense, lazy } from 'react';
import { Navigate, useRoutes, type Location } from 'react-router-dom';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore } from '@/stores';

const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((module) => ({ default: module.DashboardPage }))
);
const ProvidersWorkbenchPage = lazy(() =>
  import('@/features/providers/ProvidersWorkbenchPage').then((module) => ({
    default: module.ProvidersWorkbenchPage,
  }))
);
const ProxyPoolsPage = lazy(() =>
  import('@/pages/ProxyPoolsPage').then((module) => ({ default: module.ProxyPoolsPage }))
);
const AuthFilesOAuthExcludedEditPage = lazy(() =>
  import('@/pages/AuthFilesOAuthExcludedEditPage').then((module) => ({
    default: module.AuthFilesOAuthExcludedEditPage,
  }))
);
const AuthFilesOAuthModelAliasEditPage = lazy(() =>
  import('@/pages/AuthFilesOAuthModelAliasEditPage').then((module) => ({
    default: module.AuthFilesOAuthModelAliasEditPage,
  }))
);
const QuotaPage = lazy(() =>
  import('@/pages/QuotaPage').then((module) => ({
    default: module.QuotaPage,
  }))
);
const CredentialGroupsPage = lazy(() =>
  import('@/pages/CredentialGroupsPage').then((module) => ({
    default: module.CredentialGroupsPage,
  }))
);
const TwoFactorPage = lazy(() =>
  import('@/pages/TwoFactorPage').then((module) => ({
    default: module.TwoFactorPage,
  }))
);
const PluginResourcePage = lazy(() =>
  import('@/features/plugins/PluginResourcePage').then((module) => ({
    default: module.PluginResourcePage,
  }))
);
const PluginsPage = lazy(() =>
  import('@/features/plugins/PluginsPage').then((module) => ({ default: module.PluginsPage }))
);
const PluginStorePage = lazy(() =>
  import('@/features/plugins/PluginStorePage').then((module) => ({
    default: module.PluginStorePage,
  }))
);
const ConfigPage = lazy(() =>
  import('@/pages/ConfigPage').then((module) => ({ default: module.ConfigPage }))
);
const LogsPage = lazy(() =>
  import('@/pages/LogsPage').then((module) => ({ default: module.LogsPage }))
);
const ModelPricesPage = lazy(() =>
  import('@/pages/ModelPricesPage').then((module) => ({ default: module.ModelPricesPage }))
);
const RequestMonitoringPage = lazy(() =>
  import('@/pages/RequestMonitoringPage').then((module) => ({
    default: module.RequestMonitoringPage,
  }))
);
const UsageAnalyticsPage = lazy(() =>
  import('@/pages/UsageAnalyticsPage').then((module) => ({
    default: module.UsageAnalyticsPage,
  }))
);
const SystemPage = lazy(() =>
  import('@/pages/SystemPage').then((module) => ({ default: module.SystemPage }))
);
const MigrationPage = lazy(() =>
  import('@/pages/MigrationPage').then((module) => ({ default: module.MigrationPage }))
);

function RouteFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center text-[var(--muted-foreground)]">
      <LoadingSpinner size={24} />
    </div>
  );
}

function AuthFilesRedirect() {
  return <Navigate to="/quota" replace />;
}

const createMainRoutes = (supportsPlugin: boolean) => [
  { path: '/', element: <DashboardPage /> },
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/settings', element: <Navigate to="/config" replace /> },
  { path: '/api-keys', element: <Navigate to="/config" replace /> },
  { path: '/ai-providers', element: <ProvidersWorkbenchPage /> },
  { path: '/ai-providers/*', element: <Navigate to="/ai-providers" replace /> },
  { path: '/proxy-pools', element: <ProxyPoolsPage /> },
  { path: '/auth-files', element: <AuthFilesRedirect /> },
  { path: '/auth-files/oauth-excluded', element: <AuthFilesOAuthExcludedEditPage /> },
  { path: '/auth-files/oauth-model-alias', element: <AuthFilesOAuthModelAliasEditPage /> },
  { path: '/quota', element: <QuotaPage /> },
  { path: '/credential-groups', element: <CredentialGroupsPage /> },
  { path: '/2fa', element: <TwoFactorPage /> },
  ...(supportsPlugin
    ? [
        { path: '/plugin-pages/:pluginId/:menuIndex', element: <PluginResourcePage /> },
        { path: '/plugins', element: <PluginsPage /> },
        { path: '/plugin-store', element: <PluginStorePage /> },
        { path: '/plugins/*', element: <Navigate to="/plugins" replace /> },
      ]
    : [
        { path: '/plugin-pages/*', element: <Navigate to="/" replace /> },
        { path: '/plugins/*', element: <Navigate to="/" replace /> },
        { path: '/plugin-store', element: <Navigate to="/" replace /> },
      ]),
  { path: '/config', element: <ConfigPage /> },
  { path: '/model-prices', element: <ModelPricesPage /> },
  { path: '/usage-analytics', element: <UsageAnalyticsPage /> },
  { path: '/monitoring', element: <RequestMonitoringPage /> },
  { path: '/logs', element: <LogsPage /> },
  { path: '/migration', element: <MigrationPage /> },
  { path: '/system', element: <SystemPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function MainRoutes({ location }: { location?: Location }) {
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  const routes = useRoutes(createMainRoutes(supportsPlugin), location);
  return <Suspense fallback={<RouteFallback />}>{routes}</Suspense>;
}
