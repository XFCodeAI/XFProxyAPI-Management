import { useTranslation } from 'react-i18next';
import { IconTimer } from '@/components/ui/icons';
import type { ConcurrencyMode } from '@/types/concurrency';
import type { RuntimeObservationResource } from '@/types/runtimeObservation';
import { effectiveMaxConcurrency, normalizeConcurrencySetting } from '@/utils/maxConcurrency';
import { useCredentialConcurrencyStore } from '@/stores/useCredentialConcurrencyStore';
import styles from './RuntimeCapacityBadge.module.scss';

type RuntimeCapacityBadgeProps = {
  resource?: Pick<RuntimeObservationResource, 'inFlight' | 'maximum' | 'queued'>;
  mode?: ConcurrencyMode | null;
  maxConcurrency?: number;
  aggregate?: boolean;
  className?: string;
};

export function RuntimeCapacityBadge({
  resource,
  mode,
  maxConcurrency = 0,
  aggregate = false,
  className = '',
}: RuntimeCapacityBadgeProps) {
  const { t } = useTranslation();
  const defaultMaxConcurrency = useCredentialConcurrencyStore(
    (state) => state.defaultMaxConcurrency
  );
  const configured = normalizeConcurrencySetting(mode, maxConcurrency);
  const effectiveMaximum = resource
    ? resource.maximum
    : aggregate
      ? maxConcurrency
      : effectiveMaxConcurrency(configured, defaultMaxConcurrency);
  const maximum = effectiveMaximum > 0 ? String(effectiveMaximum) : '∞';
  const source = aggregate
    ? t('concurrency.source_aggregate')
    : configured.mode === 'inherit'
      ? t('concurrency.source_inherit')
      : t('concurrency.source_independent');
  const maximumLabel =
    effectiveMaximum > 0 ? effectiveMaximum : t('runtime_observation.unlimited');
  const title = resource
    ? t('runtime_observation.capacity_title', {
        used: resource.inFlight,
        maximum: maximumLabel,
      })
    : t('runtime_observation.limit_title', { maximum: maximumLabel });
  return (
    <span
      className={`${styles.capacity} ${(resource?.queued ?? 0) > 0 ? styles.capacityQueued : ''} ${className}`}
      title={`${title} · ${source}`}
      aria-label={`${title} · ${source}`}
    >
      <span className={styles.capacityValue}>
        {resource ? `${resource.inFlight}/` : ''}
        {maximum}
      </span>
      <span className={styles.source}>{source}</span>
      {(resource?.queued ?? 0) > 0 ? (
        <span
          className={styles.queue}
          title={t('runtime_observation.queued_title', { count: resource?.queued ?? 0 })}
        >
          <IconTimer size={12} />
          {resource?.queued ?? 0}
        </span>
      ) : null}
    </span>
  );
}
