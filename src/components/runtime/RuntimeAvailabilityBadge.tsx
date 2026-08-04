import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconCheckCircle2, IconLoader2 } from '@/components/ui/icons';
import type {
  RuntimeAvailabilityCounts,
  RuntimeAvailabilityState,
  RuntimeObservationResource,
} from '@/types/runtimeObservation';
import styles from './RuntimeAvailabilityBadge.module.scss';

type RuntimeAvailabilityBadgeProps = {
  resource?: Pick<
    RuntimeObservationResource,
    | 'availabilityState'
    | 'availabilityModel'
    | 'availabilityDeadline'
    | 'availabilityUpdatedAt'
    | 'availabilityCounts'
  >;
  className?: string;
};

const countKeys: Array<[keyof RuntimeAvailabilityCounts, RuntimeAvailabilityState]> = [
  ['ready', 'ready'],
  ['transientThrottled', 'transient_throttled'],
  ['usageWait', 'usage_wait'],
  ['probing', 'probing'],
  ['halfOpen', 'half_open'],
  ['authInvalid', 'auth_invalid'],
  ['disabled', 'disabled'],
];

const formatTimestamp = (value: string, locale: string): string => {
  if (!value) return '';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(timestamp);
  } catch {
    return timestamp.toLocaleString();
  }
};

export function RuntimeAvailabilityBadge({
  resource,
  className = '',
}: RuntimeAvailabilityBadgeProps) {
  const { t, i18n } = useTranslation();
  const state = resource?.availabilityState ?? 'unknown';
  if (state === 'unknown') return null;

  const label = t(`runtime_observation.availability.${state}`);
  const deadline = formatTimestamp(resource?.availabilityDeadline ?? '', i18n.language);
  const updatedAt = formatTimestamp(resource?.availabilityUpdatedAt ?? '', i18n.language);
  const counts = countKeys
    .map(([key, countState]) => ({
      count: resource?.availabilityCounts[key] ?? 0,
      label: t(`runtime_observation.availability.${countState}`),
    }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.label} ${entry.count}`)
    .join(' · ');
  const title = [
    label,
    resource?.availabilityModel
      ? t('runtime_observation.availability_model', { model: resource.availabilityModel })
      : '',
    deadline ? t('runtime_observation.availability_deadline', { time: deadline }) : '',
    updatedAt ? t('runtime_observation.availability_updated', { time: updatedAt }) : '',
    counts ? t('runtime_observation.availability_counts', { counts }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const icon =
    state === 'ready' ? (
      <IconCheckCircle2 size={13} />
    ) : state === 'probing' ? (
      <IconLoader2 className={styles.spinning} size={13} />
    ) : (
      <IconAlertTriangle size={13} />
    );

  return (
    <span
      className={`${styles.badge} ${styles[state]} ${className}`}
      data-availability-state={state}
      title={title}
      aria-label={title}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}
