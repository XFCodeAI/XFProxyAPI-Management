import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronUp, IconSlidersHorizontal } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import type { ProviderSortBy, SortDir } from '../types';
import styles from './ProviderResourceToolbar.module.scss';

interface ProviderResourceToolbarProps {
  sortBy: ProviderSortBy;
  sortDir: SortDir;
  onSortBy: (value: ProviderSortBy) => void;
  onSortDir: (value: SortDir) => void;
  availableModels: ReadonlyArray<string>;
  selectedModels: ReadonlySet<string>;
  onSelectedModelsChange: (next: Set<string>) => void;
}

export function ProviderResourceToolbar({
  sortBy,
  sortDir,
  onSortBy,
  onSortDir,
  availableModels,
  selectedModels,
  onSelectedModelsChange,
}: ProviderResourceToolbarProps) {
  const { t } = useTranslation();

  const sortOptions = useMemo(
    () => [
      { value: 'name', label: t('providersPage.toolbar.sort.name') },
      { value: 'priority', label: t('providersPage.toolbar.sort.priority') },
      {
        value: 'recent-success',
        label: t('providersPage.toolbar.sort.recentSuccess'),
      },
    ],
    [t]
  );

  const toggleModel = (name: string) => {
    const next = new Set(selectedModels);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSelectedModelsChange(next);
  };

  const selectAll = () => onSelectedModelsChange(new Set(availableModels));
  const clearAll = () => onSelectedModelsChange(new Set());

  const filterLabel =
    selectedModels.size === 0
      ? t('providersPage.toolbar.filter.allModels')
      : t('providersPage.toolbar.filter.selectedModels', {
          selected: selectedModels.size,
          total: availableModels.length,
        });

  return (
    <div className={styles.root}>
      <div className={styles.sortGroup}>
        <span className={styles.label}>{t('providersPage.toolbar.sortBy')}</span>
        <Select
          value={sortBy}
          options={sortOptions}
          onChange={(value) => onSortBy(value as ProviderSortBy)}
          ariaLabel={t('providersPage.toolbar.sortBy')}
          size="sm"
        />
        <TooltipIconButton
          type="button"
          className={styles.dirBtn}
          onClick={() => onSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          label={
            sortDir === 'asc'
              ? t('providersPage.toolbar.sort.directionAsc')
              : t('providersPage.toolbar.sort.directionDesc')
          }
        >
          {sortDir === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </TooltipIconButton>
      </div>

      <div className={styles.filterGroup}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={styles.filterTrigger}
              disabled={availableModels.length === 0}
            >
              <IconSlidersHorizontal size={14} />
              <span>{filterLabel}</span>
              <IconChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className={styles.filterPanel}>
            <div className={styles.filterToolbar}>
              <button
                type="button"
                className={styles.filterToolbarBtn}
                onClick={selectAll}
                disabled={availableModels.length === 0}
              >
                {t('providersPage.toolbar.filter.selectAll')}
              </button>
              <button
                type="button"
                className={styles.filterToolbarBtn}
                onClick={clearAll}
                disabled={selectedModels.size === 0}
              >
                {t('providersPage.toolbar.filter.clear')}
              </button>
            </div>
            {availableModels.length === 0 ? (
              <div className={styles.filterEmpty}>{t('providersPage.toolbar.filter.empty')}</div>
            ) : (
              <ul className={styles.filterList}>
                {availableModels.map((name) => (
                  <li key={name} className={styles.filterItem}>
                    <DropdownMenuCheckboxItem
                      checked={selectedModels.has(name)}
                      onCheckedChange={() => toggleModel(name)}
                      onSelect={(event) => event.preventDefault()}
                      className={styles.filterCheckboxItem}
                    >
                      <span className={styles.filterItemLabel}>{name}</span>
                    </DropdownMenuCheckboxItem>
                  </li>
                ))}
              </ul>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
