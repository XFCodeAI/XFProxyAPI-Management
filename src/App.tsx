import { Suspense, lazy, useEffect } from 'react';
import { Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import {
  useAuthInventoryStore,
  useAuthStore,
  useCredentialConcurrencyStore,
  useLanguageStore,
  useRuntimeObservationStore,
  useSupplierBillingProbeStore,
  useThemeStore,
} from '@/stores';

const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage }))
);
const MainLayout = lazy(() =>
  import('@/components/layout/MainLayout').then((module) => ({ default: module.MainLayout }))
);

function AppFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--muted-foreground)]">
      <LoadingSpinner size={24} />
    </div>
  );
}

function RootShell() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const startInventory = useAuthInventoryStore((state) => state.start);
  const stopInventory = useAuthInventoryStore((state) => state.stop);
  const refreshInventory = useAuthInventoryStore((state) => state.refresh);
  const startRuntimeObservation = useRuntimeObservationStore((state) => state.start);
  const stopRuntimeObservation = useRuntimeObservationStore((state) => state.stop);
  const startSupplierBillingProbes = useSupplierBillingProbeStore((state) => state.start);
  const stopSupplierBillingProbes = useSupplierBillingProbeStore((state) => state.stop);
  const loadCredentialConcurrency = useCredentialConcurrencyStore((state) => state.load);
  const resetCredentialConcurrency = useCredentialConcurrencyStore((state) => state.reset);

  useEffect(() => {
    if (!isAuthenticated || connectionStatus !== 'connected') {
      stopInventory(true);
      stopRuntimeObservation(true);
      stopSupplierBillingProbes(true);
      resetCredentialConcurrency();
      return;
    }
    startInventory();
    startRuntimeObservation();
    startSupplierBillingProbes();
    void loadCredentialConcurrency(true).catch(() => undefined);
    return () => {
      stopInventory(false);
      stopRuntimeObservation(false);
      stopSupplierBillingProbes(false);
    };
  }, [
    connectionStatus,
    isAuthenticated,
    loadCredentialConcurrency,
    resetCredentialConcurrency,
    startInventory,
    startRuntimeObservation,
    startSupplierBillingProbes,
    stopSupplierBillingProbes,
    stopInventory,
    stopRuntimeObservation,
  ]);

  useEffect(() => {
    if (!isAuthenticated || connectionStatus !== 'connected') return;
    const refresh = () => {
      void refreshInventory().catch(() => undefined);
      void loadCredentialConcurrency(true).catch(() => undefined);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [connectionStatus, isAuthenticated, loadCredentialConcurrency, refreshInventory]);

  return (
    <>
      <NotificationContainer />
      <ConfirmationModal />
      <Outlet />
    </>
  );
}

const router = createHashRouter([
  {
    element: <RootShell />,
    children: [
      {
        path: '/login',
        element: (
          <Suspense fallback={<AppFallback />}>
            <LoginPage />
          </Suspense>
        ),
      },
      {
        path: '/*',
        element: (
          <ProtectedRoute>
            <Suspense fallback={<AppFallback />}>
              <MainLayout />
            </Suspense>
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  useEffect(() => {
    const cleanupTheme = initializeTheme();
    return cleanupTheme;
  }, [initializeTheme]);

  useEffect(() => {
    setLanguage(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Initial i18n language sync for first render only.

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <TooltipProvider delayDuration={250}>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}

export default App;
