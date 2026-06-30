import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const managementKey = useAuthStore((state) => state.managementKey);
  const apiBase = useAuthStore((state) => state.apiBase);
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const shouldRestoreSession = !isAuthenticated && Boolean(managementKey && apiBase);
  const [checking, setChecking] = useState(shouldRestoreSession);

  useEffect(() => {
    if (!shouldRestoreSession) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    const tryRestore = async () => {
      setChecking(true);
      try {
        await checkAuth();
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    };
    tryRestore();

    return () => {
      cancelled = true;
    };
  }, [checkAuth, shouldRestoreSession]);

  if (checking) {
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
