import { Suspense, lazy, useEffect } from 'react';
import { Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { useAuthInventoryStore, useAuthStore, useLanguageStore, useThemeStore } from '@/stores';

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

  useEffect(() => {
    if (!isAuthenticated || connectionStatus !== 'connected') {
      stopInventory(true);
      return;
    }
    startInventory();
    return () => stopInventory(false);
  }, [connectionStatus, isAuthenticated, startInventory, stopInventory]);

  useEffect(() => {
    if (!isAuthenticated || connectionStatus !== 'connected') return;
    const refresh = () => void refreshInventory().catch(() => undefined);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [connectionStatus, isAuthenticated, refreshInventory]);

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
