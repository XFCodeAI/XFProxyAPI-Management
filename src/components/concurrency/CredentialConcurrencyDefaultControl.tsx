import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useCredentialConcurrencyStore } from '@/stores/useCredentialConcurrencyStore';
import { DEFAULT_MAX_CONCURRENCY, parseOptionalMaxConcurrency } from '@/utils/maxConcurrency';
import styles from './CredentialConcurrencyDefaultControl.module.scss';

export function CredentialConcurrencyDefaultControl() {
  const { t } = useTranslation();
  const defaultMaxConcurrency = useCredentialConcurrencyStore(
    (state) => state.defaultMaxConcurrency
  );
  const loaded = useCredentialConcurrencyStore((state) => state.loaded);
  const loading = useCredentialConcurrencyStore((state) => state.loading);
  const saving = useCredentialConcurrencyStore((state) => state.saving);
  const storeError = useCredentialConcurrencyStore((state) => state.error);
  const load = useCredentialConcurrencyStore((state) => state.load);
  const save = useCredentialConcurrencyStore((state) => state.save);
  const [value, setValue] = useState(String(DEFAULT_MAX_CONCURRENCY));
  const parsed = parseOptionalMaxConcurrency(value);
  const valid = parsed.valid && parsed.value !== undefined;

  useEffect(() => {
    if (!loaded && !loading) void load().catch(() => undefined);
  }, [load, loaded, loading]);

  useEffect(() => {
    if (loaded && !saving) setValue(String(defaultMaxConcurrency));
  }, [defaultMaxConcurrency, loaded, saving]);

  return (
    <section className={styles.control} aria-label={t('concurrency.global_default_label')}>
      <div className={styles.copy}>
        <strong>{t('concurrency.global_default_label')}</strong>
        <span>{t('concurrency.global_default_hint')}</span>
      </div>
      <div className={styles.editor}>
        <Input
          type="number"
          min={0}
          max={1000000}
          step={1}
          aria-label={t('concurrency.global_default_label')}
          value={value}
          disabled={loading || saving}
          error={valid ? undefined : t('auth_files.max_concurrency_invalid')}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          size="sm"
          loading={saving}
          disabled={!valid || loading || saving || Number(value) === defaultMaxConcurrency}
          onClick={() => void save(parsed.valid ? (parsed.value ?? 0) : 0).catch(() => undefined)}
        >
          {t('common.save')}
        </Button>
      </div>
      {storeError ? <span className={styles.error}>{storeError}</span> : null}
    </section>
  );
}
