import type { TFunction } from 'i18next';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/ContextMenu';
import type { ContextMenuState } from './ModelMappingDiagramTypes';

interface DiagramContextMenuProps {
  contextMenu: ContextMenuState | null;
  t: TFunction;
  onAddAlias: () => void;
  onRenameAlias: (alias: string) => void;
  onOpenAliasSettings: (alias: string) => void;
  onDeleteAlias: (alias: string) => void;
  onEditProvider: (provider: string) => void;
  onDeleteProvider: (provider: string) => void;
  onOpenSourceSettings: (sourceId: string) => void;
}

export function DiagramContextMenu({
  contextMenu,
  t,
  onAddAlias,
  onRenameAlias,
  onOpenAliasSettings,
  onDeleteAlias,
  onEditProvider,
  onDeleteProvider,
  onOpenSourceSettings,
}: DiagramContextMenuProps) {
  if (!contextMenu) return null;

  const { type, data } = contextMenu;

  const renderBackground = () => (
    <ContextMenuItem onSelect={onAddAlias}>
      <span>{t('oauth_model_alias.diagram_add_alias')}</span>
    </ContextMenuItem>
  );

  const renderAlias = () => {
    if (!data) return null;
    return (
      <>
        <ContextMenuItem onSelect={() => onRenameAlias(data)}>
          <span>{t('oauth_model_alias.diagram_rename')}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onOpenAliasSettings(data)}>
          <span>{t('oauth_model_alias.diagram_settings')}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-[var(--destructive)] focus:bg-[var(--destructive)]/10 focus:text-[var(--destructive)]"
          onSelect={() => onDeleteAlias(data)}
        >
          <span>{t('oauth_model_alias.diagram_delete_alias')}</span>
        </ContextMenuItem>
      </>
    );
  };

  const renderProvider = () => {
    if (!data) return null;
    return (
      <>
        <ContextMenuItem onSelect={() => onEditProvider(data)}>
          <span>{t('common.edit')}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-[var(--destructive)] focus:bg-[var(--destructive)]/10 focus:text-[var(--destructive)]"
          onSelect={() => onDeleteProvider(data)}
        >
          <span>{t('oauth_model_alias.delete')}</span>
        </ContextMenuItem>
      </>
    );
  };

  const renderSource = () => {
    if (!data) return null;
    return (
      <ContextMenuItem onSelect={() => onOpenSourceSettings(data)}>
        <span>{t('oauth_model_alias.diagram_settings')}</span>
      </ContextMenuItem>
    );
  };

  return (
    <ContextMenuContent>
      {type === 'background' && renderBackground()}
      {type === 'alias' && renderAlias()}
      {type === 'provider' && renderProvider()}
      {type === 'source' && renderSource()}
    </ContextMenuContent>
  );
}
