import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type {
  AuthFileAvailabilityReprobeEntry,
  AuthFileAvailabilityReprobeResult,
} from '@/services/api/authFiles';

interface AuthFileAvailabilityReprobeResultModalProps {
  result: AuthFileAvailabilityReprobeResult | null;
  onClose: () => void;
}

const PAGE_SIZE = 100;

const statusLabel = (
  entry: AuthFileAvailabilityReprobeEntry,
  t: ReturnType<typeof useTranslation>['t']
): string => {
  if (entry.status === 'queued') {
    return t('auth_files.availability_reprobe_status_queued', { defaultValue: 'Queued' });
  }
  if (entry.status === 'already_probing') {
    return t('auth_files.availability_reprobe_status_already', {
      defaultValue: 'Already probing',
    });
  }
  if (entry.status === 'skipped') {
    return t('auth_files.availability_reprobe_status_skipped', { defaultValue: 'Skipped' });
  }
  return entry.status;
};

export function AuthFileAvailabilityReprobeResultModal({
  result,
  onClose,
}: AuthFileAvailabilityReprobeResultModalProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [result]);

  const entries = useMemo(() => result?.entries ?? [], [result]);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageEntries = useMemo(
    () => entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, entries]
  );
  const skipped = result
    ? Object.values(result.skipped).reduce((total, count) => total + count, 0)
    : 0;

  return (
    <Modal
      open={Boolean(result)}
      onClose={onClose}
      title={t('auth_files.availability_reprobe_results_title', {
        defaultValue: 'Availability reprobe results',
      })}
      width="min(920px, calc(100vw - 2rem))"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {result ? (
        <div className="flex min-w-0 flex-col gap-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              [
                t('auth_files.availability_reprobe_requested', { defaultValue: 'Requested' }),
                result.requested,
              ],
              [
                t('auth_files.availability_reprobe_eligible', { defaultValue: 'Eligible' }),
                result.eligible,
              ],
              [
                t('auth_files.availability_reprobe_status_queued', { defaultValue: 'Queued' }),
                result.queued,
              ],
              [
                t('auth_files.availability_reprobe_status_already', {
                  defaultValue: 'Already probing',
                }),
                result.alreadyProbing,
              ],
              [
                t('auth_files.availability_reprobe_status_skipped', { defaultValue: 'Skipped' }),
                skipped,
              ],
              [
                t('auth_files.availability_reprobe_parallel', { defaultValue: 'Max parallel' }),
                result.maximumParallel,
              ],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2"
              >
                <dt className="truncate text-xs text-[var(--muted-foreground)]">{label}</dt>
                <dd className="m-0 mt-1 text-base font-semibold tabular-nums text-[var(--foreground)]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {entries.length > 0 ? (
            <div className="min-w-0 overflow-x-auto rounded-md border border-[var(--border)]">
              <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  {t('auth_files.availability_reprobe_results_title', {
                    defaultValue: 'Availability reprobe results',
                  })}
                </caption>
                <thead className="bg-[var(--secondary)] text-xs text-[var(--muted-foreground)]">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('auth_files.availability_reprobe_credential_id', {
                        defaultValue: 'Credential ID',
                      })}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('auth_files.availability_reprobe_auth_index', {
                        defaultValue: 'Auth index',
                      })}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('common.status', { defaultValue: 'Status' })}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('auth_files.availability_reprobe_reason', { defaultValue: 'Reason' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageEntries.map((entry) => (
                    <tr
                      key={`${entry.credentialId}:${entry.authIndex}`}
                      className="border-t border-[var(--border)] align-top"
                    >
                      <td className="max-w-64 break-all px-3 py-2 font-mono text-xs">
                        {entry.credentialId}
                      </td>
                      <td className="max-w-64 break-all px-3 py-2 font-mono text-xs">
                        {entry.authIndex}
                      </td>
                      <td className="px-3 py-2 font-medium">{statusLabel(entry, t)}</td>
                      <td className="max-w-80 break-words px-3 py-2 text-[var(--muted-foreground)]">
                        {entry.reason || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="m-0 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
              {t('auth_files.availability_reprobe_no_entries', {
                defaultValue: 'No per-credential outcomes were returned.',
              })}
            </p>
          )}

          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                {t('common.previous', { defaultValue: 'Previous' })}
              </Button>
              <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                {t('auth_files.availability_reprobe_page', {
                  page: currentPage,
                  pages: totalPages,
                  defaultValue: '{{page}} / {{pages}}',
                })}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              >
                {t('common.next', { defaultValue: 'Next' })}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
