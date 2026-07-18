import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  CheckCircle2,
  CircleAlert,
  Play,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  fieldErrorClass,
  fieldHintClass,
  fieldLabelClass,
  fieldRootClass,
  inputClass,
} from '@/components/ui/formStyles';
import { getStatusBadgeClass, type StatusBadgeVariant } from '@/components/ui/statusStyles';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import {
  migrationApi,
  normalizeMigrationSourceEndpoint,
  sourceMigrationApi,
  type MigrationDomainInventory,
  type MigrationIssue,
  type MigrationPreflightJob,
  type MigrationPreflightSource,
  type MigrationTransferJob,
} from '@/services/api';
import styles from './MigrationPage.module.scss';

type PreflightState = {
  source: MigrationPreflightSource;
  job: MigrationPreflightJob;
};

type SealedSource = {
  endpoint: string;
  managementKey: string;
  generation: number;
};

const terminalTransferStatuses = new Set(['completed', 'failed', 'canceled']);

const domainLabels: Record<string, string> = {
  config: 'config',
  credentials: 'credentials',
  'credential-groups': 'credential_groups',
  'proxy-pools': 'proxy_pools',
  providers: 'providers',
  'two-factor': 'two_factor',
  plugins: 'plugins',
};

function countDomain(domain?: MigrationDomainInventory): number {
  if (!domain) return 0;
  return domain.records + (domain.logical_records ?? 0);
}

function transferStatusTone(status?: string): StatusBadgeVariant {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'canceled':
      return 'error';
    case 'staging':
    case 'staged':
    case 'applying':
      return 'warning';
    default:
      return 'muted';
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function MigrationPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const { showConfirmation, showNotification } = useNotificationStore();

  const [sourceEndpoint, setSourceEndpoint] = useState('');
  const [sourceManagementKey, setSourceManagementKey] = useState('');
  const [preflight, setPreflight] = useState<PreflightState | null>(null);
  const [sealedSource, setSealedSource] = useState<SealedSource | null>(null);
  const [transfer, setTransfer] = useState<MigrationTransferJob | null>(null);
  const [action, setAction] = useState<
    'idle' | 'preflight' | 'starting' | 'resuming' | 'canceling'
  >('idle');
  const [error, setError] = useState('');
  const sealedSourceRef = useRef<SealedSource | null>(null);
  const completedTransferRef = useRef<string | null>(null);

  const busy = action !== 'idle';
  const canPrepare =
    connectionStatus === 'connected' &&
    !busy &&
    !transfer &&
    sourceEndpoint.trim().length > 0 &&
    sourceManagementKey.trim().length > 0;
  const preflightReady = preflight?.job.result.status === 'ready' && Boolean(sealedSource);
  const transferTerminal = transfer ? terminalTransferStatuses.has(transfer.status) : false;

  const releaseSourceSeal = useCallback(async () => {
    const session = sealedSourceRef.current;
    sealedSourceRef.current = null;
    if (!session) return;
    await sourceMigrationApi
      .release(session.endpoint, session.managementKey, session.generation)
      .catch(() => undefined);
  }, []);

  const clearPreflight = useCallback(async () => {
    await releaseSourceSeal();
    setSealedSource(null);
    setPreflight(null);
    setError('');
  }, [releaseSourceSeal]);

  useEffect(() => {
    return () => {
      void releaseSourceSeal();
    };
  }, [releaseSourceSeal]);

  useEffect(() => {
    if (!sealedSource || transfer) return;
    const timer = window.setInterval(() => {
      const session = sealedSourceRef.current;
      if (!session) return;
      void sourceMigrationApi
        .heartbeat(session.endpoint, session.managementKey, session.generation)
        .then((response) => {
          const next = { ...session, generation: response.seal.generation };
          sealedSourceRef.current = next;
          setSealedSource(next);
        })
        .catch(() => {
          setError(t('migration.source_heartbeat_failed'));
        });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [sealedSource, t, transfer]);

  useEffect(() => {
    if (!transfer || terminalTransferStatuses.has(transfer.status)) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await migrationApi.getTransfer(transfer.id);
        if (!active) return;
        const next = response.job;
        setTransfer(next);
        if (next.status === 'completed' && completedTransferRef.current !== next.id) {
          completedTransferRef.current = next.id;
          void fetchConfig().catch(() => undefined);
          showNotification(t('migration.transfer_completed'), 'success');
        }
      } catch (pollError: unknown) {
        if (!active) return;
        setError(readErrorMessage(pollError, t('migration.transfer_poll_failed')));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [fetchConfig, showNotification, t, transfer]);

  const replacementRows = useMemo(() => preflight?.job.result.replacement ?? [], [preflight]);

  const handlePrepare = async () => {
    setError('');
    let endpoint = '';
    try {
      endpoint = normalizeMigrationSourceEndpoint(sourceEndpoint);
    } catch {
      setError(t('migration.source_invalid'));
      return;
    }
    const key = sourceManagementKey.trim();
    if (!key) {
      setError(t('migration.source_key_required'));
      return;
    }

    await clearPreflight();
    setAction('preflight');
    try {
      const sealResponse = await sourceMigrationApi.seal(endpoint, key);
      const session = { endpoint, managementKey: key, generation: sealResponse.seal.generation };
      sealedSourceRef.current = session;
      setSealedSource(session);
      const source = await sourceMigrationApi.preflightSource(endpoint, key);
      const response = await migrationApi.createPreflight(source);
      setPreflight({ source, job: response.job });
      if (response.job.result.status !== 'ready') {
        await releaseSourceSeal();
        setSealedSource(null);
      }
    } catch (prepareError: unknown) {
      await releaseSourceSeal();
      setSealedSource(null);
      setError(readErrorMessage(prepareError, t('migration.preflight_failed')));
    } finally {
      setAction('idle');
    }
  };

  const handleStart = () => {
    if (!preflight || !sealedSourceRef.current) return;
    showConfirmation({
      title: t('migration.confirm_title'),
      message: t('migration.confirm_message'),
      variant: 'danger',
      confirmText: t('migration.start'),
      onConfirm: async () => {
        const session = sealedSourceRef.current;
        if (!session) {
          throw new Error(t('migration.source_seal_missing'));
        }
        setAction('starting');
        setError('');
        try {
          const response = await migrationApi.startTransfer({
            preflightJobID: preflight.job.id,
            sourceURL: session.endpoint,
            sourceManagementKey: session.managementKey,
          });
          sealedSourceRef.current = null;
          setSealedSource(null);
          setSourceManagementKey('');
          setTransfer(response.job);
          showNotification(t('migration.transfer_started'), 'success');
        } catch (startError: unknown) {
          setError(readErrorMessage(startError, t('migration.transfer_start_failed')));
          throw startError;
        } finally {
          setAction('idle');
        }
      },
    });
  };

  const handleResume = async () => {
    if (!transfer) return;
    setAction('resuming');
    setError('');
    try {
      const response = await migrationApi.resumeTransfer(transfer.id);
      setTransfer(response.job);
    } catch (resumeError: unknown) {
      setError(readErrorMessage(resumeError, t('migration.transfer_resume_failed')));
    } finally {
      setAction('idle');
    }
  };

  const handleCancelTransfer = () => {
    if (!transfer) return;
    showConfirmation({
      title: t('migration.cancel_title'),
      message: t('migration.cancel_message'),
      variant: 'danger',
      confirmText: t('migration.cancel_transfer'),
      onConfirm: async () => {
        setAction('canceling');
        try {
          await migrationApi.cancelTransfer(transfer.id);
          setTransfer(null);
          setPreflight(null);
          showNotification(t('migration.transfer_canceled'), 'success');
        } catch (cancelError: unknown) {
          setError(readErrorMessage(cancelError, t('migration.transfer_cancel_failed')));
          throw cancelError;
        } finally {
          setAction('idle');
        }
      },
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <ArrowRightLeft size={24} aria-hidden="true" />
          <h1 className={styles.pageTitle}>{t('migration.title')}</h1>
        </div>
      </div>

      <Card>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>{t('migration.source_title')}</h2>
          </div>
          {preflight ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void clearPreflight()}
              disabled={busy || Boolean(transfer)}
            >
              <X size={16} aria-hidden="true" />
              {t('migration.clear_preflight')}
            </Button>
          ) : null}
        </div>
        <div className={styles.connectionGrid}>
          <div className={fieldRootClass}>
            <label className={fieldLabelClass} htmlFor="migration-source-endpoint">
              {t('migration.source_endpoint')}
            </label>
            <input
              id="migration-source-endpoint"
              className={inputClass}
              value={sourceEndpoint}
              onChange={(event) => setSourceEndpoint(event.target.value)}
              placeholder="https://source.example.com"
              autoComplete="url"
              disabled={busy || Boolean(transfer)}
            />
          </div>
          <div className={fieldRootClass}>
            <label className={fieldLabelClass} htmlFor="migration-source-key">
              {t('migration.source_key')}
            </label>
            <input
              id="migration-source-key"
              className={inputClass}
              type="password"
              value={sourceManagementKey}
              onChange={(event) => setSourceManagementKey(event.target.value)}
              autoComplete="off"
              disabled={busy || Boolean(transfer)}
            />
          </div>
        </div>
        <div className={styles.actionRow}>
          <Button
            onClick={() => void handlePrepare()}
            loading={action === 'preflight'}
            disabled={!canPrepare}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            {t('migration.preflight')}
          </Button>
          {sealedSource ? (
            <span className={getStatusBadgeClass('warning')}>{t('migration.source_sealed')}</span>
          ) : null}
        </div>
      </Card>

      {error ? <div className={fieldErrorClass}>{error}</div> : null}

      {preflight ? (
        <Card>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>{t('migration.preflight_title')}</h2>
            </div>
            <span className={getStatusBadgeClass(preflightReady ? 'success' : 'error')}>
              {t(`migration.preflight_status.${preflight.job.result.status}`)}
            </span>
          </div>
          <div className={styles.summaryGrid}>
            <SummaryItem
              label={t('migration.snapshot_size')}
              value={formatBytes(preflight.source.snapshot_bytes)}
            />
            <SummaryItem
              label={t('migration.source_backend')}
              value={preflight.source.inventory.storage_backend}
            />
            <SummaryItem
              label={t('migration.source_credentials')}
              value={String(
                countDomain(findDomain(preflight.source.inventory.domains, 'credentials'))
              )}
            />
            <SummaryItem
              label={t('migration.replacement_count')}
              value={String(replacementRows.length)}
            />
          </div>
          <ReplacementList rows={replacementRows} />
          <IssueList
            title={t('migration.blocking')}
            issues={preflight.job.result.blocking}
            tone="error"
          />
          <IssueList
            title={t('migration.warnings')}
            issues={preflight.job.result.warnings}
            tone="warning"
          />
          <div className={styles.actionRow}>
            <Button
              onClick={handleStart}
              loading={action === 'starting'}
              disabled={!preflightReady || busy}
            >
              <Play size={16} aria-hidden="true" />
              {t('migration.start')}
            </Button>
          </div>
        </Card>
      ) : null}

      {transfer ? (
        <Card>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>{t('migration.transfer_title')}</h2>
              <p className={styles.jobID}>{transfer.id}</p>
            </div>
            <span className={getStatusBadgeClass(transferStatusTone(transfer.status))}>
              {t(`migration.transfer_status.${transfer.status}`)}
            </span>
          </div>
          {transfer.error_code ? (
            <div className={styles.transferError}>
              <CircleAlert size={16} aria-hidden="true" />
              {t(`migration.error.${transfer.error_code}`, { defaultValue: transfer.error_code })}
            </div>
          ) : null}
          {transfer.status === 'completed' ? (
            <div className={styles.completedState}>
              <CheckCircle2 size={18} aria-hidden="true" />
              {t('migration.transfer_completed')}
            </div>
          ) : null}
          <div className={styles.actionRow}>
            {transfer.status === 'failed' ? (
              <Button
                onClick={() => void handleResume()}
                loading={action === 'resuming'}
                disabled={busy}
              >
                <RotateCcw size={16} aria-hidden="true" />
                {t('migration.resume')}
              </Button>
            ) : null}
            {!transferTerminal ? (
              <Button
                variant="danger"
                onClick={handleCancelTransfer}
                loading={action === 'canceling'}
                disabled={busy}
              >
                <X size={16} aria-hidden="true" />
                {t('migration.cancel_transfer')}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {!preflight && !transfer ? (
        <div className={fieldHintClass}>{t('migration.idle_hint')}</div>
      ) : null}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryItem}>
      <span>{label}</span>
      <strong>{value || '-'}</strong>
    </div>
  );
}

function ReplacementList({ rows }: { rows: PreflightState['job']['result']['replacement'] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <div className={styles.replacementList}>
      {rows.map((row) => (
        <div key={row.id} className={styles.replacementRow}>
          <span>
            {t(`migration.domain.${domainLabels[row.id] ?? row.id}`, { defaultValue: row.id })}
          </span>
          <strong>{countDomain(row.source)}</strong>
          <span className={styles.arrow} aria-hidden="true">
            -&gt;
          </span>
          <strong>{countDomain(row.destination)}</strong>
        </div>
      ))}
    </div>
  );
}

function IssueList({
  title,
  issues,
  tone,
}: {
  title: string;
  issues?: MigrationIssue[];
  tone: StatusBadgeVariant;
}) {
  const { t } = useTranslation();
  if (!issues?.length) return null;
  return (
    <div className={styles.issueSection}>
      <span className={getStatusBadgeClass(tone)}>{title}</span>
      <div className={styles.issueList}>
        {issues.map((issue) => (
          <div key={`${issue.code}:${issue.domain ?? ''}`} className={styles.issueRow}>
            {t(`migration.issue.${issue.code}`, { defaultValue: issue.code })}
            {issue.domain ? <span>{issue.domain}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function findDomain(
  domains: MigrationDomainInventory[],
  id: string
): MigrationDomainInventory | undefined {
  return domains.find((domain) => domain.id === id);
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
