import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { usePromptRewriteCatalog } from './usePromptRewriteCatalog';
import { CodexQuickSetup, type QuickTargetType } from './CodexQuickSetup';
import styles from './PromptRewritePage.module.scss';

const isTargetType = (value: string | null): value is QuickTargetType =>
  value === 'global' ||
  value === 'provider' ||
  value === 'credential-group' ||
  value === 'credential';

export function PromptRewritePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const catalogState = usePromptRewriteCatalog();

  if (catalogState.status === 'loading') {
    return (
      <div className={styles.centerState}>
        <LoadingSpinner size={28} />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  if (catalogState.status === 'unsupported') {
    return (
      <div className={styles.container}>
        <Card className={styles.stateCard}>
          <EmptyState
            title={t('prompt_rewrite.unsupported.title')}
            description={t('prompt_rewrite.unsupported.description')}
          />
          <Button variant="secondary" onClick={() => void catalogState.load()}>
            <RefreshCw size={16} /> {t('common.retry')}
          </Button>
        </Card>
      </div>
    );
  }

  if (catalogState.status === 'error' || !catalogState.catalog) {
    return (
      <div className={styles.container}>
        <Card className={styles.stateCard}>
          <ShieldAlert size={32} />
          <h1>{t('prompt_rewrite.load_failed')}</h1>
          <p>{catalogState.error}</p>
          <Button onClick={() => void catalogState.load()}>
            <RefreshCw size={16} /> {t('common.retry')}
          </Button>
        </Card>
      </div>
    );
  }

  const targetParam = searchParams.get('target');
  return (
    <div className={styles.container}>
      <CodexQuickSetup
        targetCatalog={catalogState.catalog}
        initialTargetType={isTargetType(targetParam) ? targetParam : undefined}
        initialTargetValue={searchParams.get('value') ?? undefined}
      />
    </div>
  );
}
