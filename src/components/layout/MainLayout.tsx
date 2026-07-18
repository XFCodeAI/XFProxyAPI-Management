import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  ArrowRightLeft,
  CircleDot,
  Languages,
  LogOut,
  Menu,
  MonitorCog,
  Moon,
  RefreshCw,
  Sun,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip';
import { TooltipElement } from '@/components/ui/TooltipControls';
import { PageTransition } from '@/components/common/PageTransition';
import { MainRoutes } from '@/router/MainRoutes';
import { pluginsApi } from '@/services/api';
import {
  IconSidebarConfig,
  IconSidebarDashboard,
  IconSidebarLogs,
  IconSidebarPlugins,
  IconSidebarProviders,
  IconSidebarQuota,
  IconSidebarStore,
  IconSidebarSystem,
  IconChevronDown,
} from '@/components/ui/icons';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import {
  useAuthStore,
  useLanguageStore,
  useNotificationStore,
  useThemeStore,
  useConfigStore,
} from '@/stores';
import {
  collectPluginResourceEntries,
  PLUGIN_RESOURCES_REFRESH_EVENT,
  resolvePluginAssetURL,
  type PluginResourceEntry,
} from '@/features/plugins/pluginResources';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import type { Theme } from '@/types';

const sidebarIcons: Record<string, ReactNode> = {
  dashboard: <IconSidebarDashboard size={18} />,
  aiProviders: <IconSidebarProviders size={18} />,
  proxyPools: <IconSidebarConfig size={18} />,
  quota: <IconSidebarQuota size={18} />,
  plugins: <IconSidebarPlugins size={18} />,
  pluginStore: <IconSidebarStore size={18} />,
  config: <IconSidebarConfig size={18} />,
  logs: <IconSidebarLogs size={18} />,
  migration: <ArrowRightLeft size={18} />,
  system: <IconSidebarSystem size={18} />,
};

const isAuthFilesPath = (pathname: string) =>
  pathname === '/auth-files' || pathname.startsWith('/auth-files/');

interface SidebarNavLinkItem {
  kind?: 'link';
  path: string;
  labelKey?: string;
  metaKey?: string;
  label?: string;
  meta?: string;
  icon: ReactNode;
}

interface SidebarNavDrawerItem {
  kind: 'drawer';
  id: string;
  label: string;
  meta?: string;
  icon: ReactNode;
  children: SidebarNavLinkItem[];
}

type SidebarNavItem = SidebarNavLinkItem | SidebarNavDrawerItem;

interface SidebarNavGroup {
  id: string;
  labelKey: string;
  items: SidebarNavItem[];
}

const flattenNavItems = (items: SidebarNavItem[]): SidebarNavLinkItem[] =>
  items.flatMap((item) => (item.kind === 'drawer' ? item.children : [item]));

function PluginSidebarIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return showImage ? (
    <img src={src} alt="" onError={() => setFailed(true)} />
  ) : (
    <IconSidebarPlugins size={18} />
  );
}

const HEADER_ICON_SIZE = 16;
const PLUGIN_RESOURCES_CACHE_TTL_MS = 60_000;

type PluginResourcesCache = {
  apiBase: string;
  entries: PluginResourceEntry[];
  timestamp: number;
};

let pluginResourcesCache: PluginResourcesCache | null = null;

const THEME_CARDS: Array<{
  key: Theme;
  labelKey: string;
  colors: { bg: string; card: string; border: string; text: string; textMuted: string };
}> = [
  {
    key: 'auto',
    labelKey: 'theme.auto',
    colors: {
      bg: 'oklch(98.5% 0 0)',
      card: 'oklch(100% 0 0)',
      border: 'oklch(70.5% 0.015 286.067)',
      text: 'oklch(14.1% 0.005 285.823)',
      textMuted: 'oklch(55.2% 0.016 285.938)',
    },
  },
  {
    key: 'white',
    labelKey: 'theme.white',
    colors: {
      bg: 'oklch(100% 0 0)',
      card: 'oklch(100% 0 0)',
      border: 'oklch(92% 0.004 286.32)',
      text: 'oklch(14.1% 0.005 285.823)',
      textMuted: 'oklch(55.2% 0.016 285.938)',
    },
  },
  {
    key: 'light',
    labelKey: 'theme.light',
    colors: {
      bg: 'oklch(98.5% 0 0)',
      card: 'oklch(100% 0 0)',
      border: 'oklch(92% 0.004 286.32)',
      text: 'oklch(14.1% 0.005 285.823)',
      textMuted: 'oklch(55.2% 0.016 285.938)',
    },
  },
  {
    key: 'dark',
    labelKey: 'theme.dark',
    colors: {
      bg: 'oklch(14.1% 0.005 285.823)',
      card: 'oklch(21% 0.006 285.885)',
      border: 'oklch(27.4% 0.006 286.033)',
      text: 'oklch(98.5% 0 0)',
      textMuted: 'oklch(70.5% 0.015 286.067)',
    },
  },
];

export function MainLayout() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const location = useLocation();

  const logout = useAuthStore((state) => state.logout);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);

  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pluginResources, setPluginResources] = useState<PluginResourceEntry[]>([]);
  const [expandedPluginResourceIDs, setExpandedPluginResourceIDs] = useState<Set<string>>(
    () => new Set()
  );
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  const fullBrandName = 'CLI Proxy API Management Center';
  const abbrBrandName = t('title.abbr');
  const isLogsPage = location.pathname.startsWith('/logs');
  const isPluginResourcePage = location.pathname.startsWith('/plugin-pages');
  const showSidebarLabels = !sidebarCollapsed || sidebarOpen;

  // Keep floating header height available to sticky mobile elements and overlays.
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      const height = headerRef.current?.offsetHeight;
      if (height) {
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    };

    updateHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && headerRef.current
        ? new ResizeObserver(updateHeaderHeight)
        : null;
    if (resizeObserver && headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  // Keep the content center available to bottom overlays that align with the main area.
  useLayoutEffect(() => {
    const updateContentCenter = () => {
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      document.documentElement.style.setProperty('--content-center-x', `${centerX}px`);
    };

    updateContentCenter();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && contentRef.current
        ? new ResizeObserver(updateContentCenter)
        : null;

    if (resizeObserver && contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }

    window.addEventListener('resize', updateContentCenter);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateContentCenter);
      document.documentElement.style.removeProperty('--content-center-x');
    };
  }, []);

  const handleThemeSelect = useCallback(
    (nextTheme: Theme) => {
      setTheme(nextTheme);
    },
    [setTheme]
  );

  const handleLanguageSelect = useCallback(
    (nextLanguage: string) => {
      if (!isSupportedLanguage(nextLanguage)) {
        return;
      }
      setLanguage(nextLanguage);
    },
    [setLanguage]
  );

  useEffect(() => {
    fetchConfig().catch(() => {
      // Ignore the initial failure; the login flow shows the user-facing prompt.
    });
  }, [fetchConfig]);

  const loadPluginResources = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (connectionStatus !== 'connected' || !supportsPlugin) {
        setPluginResources([]);
        pluginResourcesCache = null;
        return;
      }

      const now = Date.now();
      if (
        !force &&
        pluginResourcesCache &&
        pluginResourcesCache.apiBase === apiBase &&
        now - pluginResourcesCache.timestamp < PLUGIN_RESOURCES_CACHE_TTL_MS
      ) {
        setPluginResources(pluginResourcesCache.entries);
        return;
      }

      try {
        const plugins = await pluginsApi.list();
        const entries = collectPluginResourceEntries(plugins.plugins);
        pluginResourcesCache = { apiBase, entries, timestamp: Date.now() };
        setPluginResources(entries);
      } catch {
        setPluginResources([]);
      }
    },
    [apiBase, connectionStatus, supportsPlugin]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPluginResources();
    }, 0);

    const handlePluginResourcesRefresh = () => {
      void loadPluginResources({ force: true });
    };

    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, handlePluginResourcesRefresh);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, handlePluginResourcesRefresh);
    };
  }, [apiBase, loadPluginResources]);

  const pluginResourceGroups = pluginResources.reduce<
    Array<{ pluginID: string; pluginTitle: string; entries: PluginResourceEntry[] }>
  >((groups, resource) => {
    const group = groups.find((item) => item.pluginID === resource.pluginID);
    if (group) {
      group.entries.push(resource);
      return groups;
    }

    groups.push({
      pluginID: resource.pluginID,
      pluginTitle: resource.pluginTitle,
      entries: [resource],
    });
    return groups;
  }, []);

  const pluginPageNavItems: SidebarNavItem[] = supportsPlugin
    ? pluginResourceGroups.flatMap((group): SidebarNavItem[] => {
        if (group.entries.length === 1) {
          const resource = group.entries[0];
          const pluginLogo = resolvePluginAssetURL(resource.pluginLogo, apiBase);
          return [
            {
              path: resource.route,
              label: resource.label,
              meta: resource.description,
              icon: <PluginSidebarIcon src={pluginLogo} />,
            },
          ];
        }

        const pluginLogo = resolvePluginAssetURL(group.entries[0]?.pluginLogo ?? '', apiBase);
        return [
          {
            kind: 'drawer',
            id: `plugin-pages-${group.pluginID}`,
            label: group.pluginTitle,
            meta: t('plugin_resource.page_count', { count: group.entries.length }),
            icon: <PluginSidebarIcon src={pluginLogo} />,
            children: group.entries.map((resource) => ({
              path: resource.route,
              label: resource.label,
              meta: resource.description,
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
            })),
          },
        ];
      })
    : [];

  const navGroups: SidebarNavGroup[] = [
    {
      id: 'operate',
      labelKey: 'nav_groups.operate',
      items: [
        {
          path: '/',
          labelKey: 'nav.dashboard',
          metaKey: 'nav_meta.dashboard',
          icon: sidebarIcons.dashboard,
        },
      ],
    },
    {
      id: 'gateway',
      labelKey: 'nav_groups.gateway',
      items: [
        {
          path: '/ai-providers',
          labelKey: 'nav.ai_providers',
          metaKey: 'nav_meta.ai_providers',
          icon: sidebarIcons.aiProviders,
        },
        {
          path: '/proxy-pools',
          labelKey: 'nav.proxy_pools',
          metaKey: 'nav_meta.proxy_pools',
          icon: sidebarIcons.proxyPools,
        },
      ],
    },
    {
      id: 'observe',
      labelKey: 'nav_groups.observe',
      items: [
        {
          kind: 'drawer',
          id: 'credential-management',
          label: t('nav.quota_management'),
          icon: sidebarIcons.quota,
          children: [
            {
              path: '/quota',
              labelKey: 'nav.credential_quota',
              metaKey: 'nav_meta.credential_quota',
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
            },
            {
              path: '/credential-groups',
              labelKey: 'nav.credential_groups',
              metaKey: 'nav_meta.credential_groups',
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
            },
            {
              path: '/2fa',
              labelKey: 'nav.two_factor',
              metaKey: 'nav_meta.two_factor',
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
            },
          ],
        },
        {
          path: '/logs',
          labelKey: 'nav.logs',
          metaKey: 'nav_meta.logs',
          icon: sidebarIcons.logs,
        },
      ],
    },
    {
      id: 'control',
      labelKey: 'nav_groups.control',
      items: [
        {
          path: '/migration',
          labelKey: 'nav.migration',
          metaKey: 'nav_meta.migration',
          icon: sidebarIcons.migration,
        },
        {
          path: '/config',
          labelKey: 'nav.config_management',
          metaKey: 'nav_meta.config_management',
          icon: sidebarIcons.config,
        },
        ...(supportsPlugin
          ? [
              {
                path: '/plugins',
                labelKey: 'nav.plugins',
                metaKey: 'nav_meta.plugins',
                icon: sidebarIcons.plugins,
              },
              {
                path: '/plugin-store',
                labelKey: 'nav.plugin_store',
                metaKey: 'nav_meta.plugin_store',
                icon: sidebarIcons.pluginStore,
              },
            ]
          : []),
        {
          path: '/system',
          labelKey: 'nav.system_info',
          metaKey: 'nav_meta.system_info',
          icon: sidebarIcons.system,
        },
      ],
    },
    ...(pluginPageNavItems.length > 0
      ? [
          {
            id: 'plugin-pages',
            labelKey: 'nav_groups.plugin_pages',
            items: pluginPageNavItems,
          },
        ]
      : []),
  ];
  const navItems = navGroups.flatMap((group) => flattenNavItems(group.items));
  const navOrder = navItems.map((item) => item.path);
  const isNavPathActive = (path: string) => {
    const normalize = (value: string) => {
      const trimmed = value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
      return trimmed === '/dashboard' ? '/' : trimmed;
    };

    const targetPath = normalize(path);
    const currentPath = normalize(location.pathname);
    if (targetPath === '/quota' && isAuthFilesPath(currentPath)) {
      return true;
    }
    return targetPath === '/'
      ? currentPath === '/'
      : currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
  };

  const getRouteOrder = (pathname: string) => {
    const trimmedPath =
      pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const normalizedPath = trimmedPath === '/dashboard' ? '/' : trimmedPath;

    const quotaIndex = navOrder.indexOf('/quota');
    if (quotaIndex !== -1) {
      if (normalizedPath === '/auth-files') return quotaIndex;
      if (normalizedPath.startsWith('/auth-files/')) {
        if (normalizedPath.startsWith('/auth-files/oauth-excluded')) return quotaIndex + 0.1;
        if (normalizedPath.startsWith('/auth-files/oauth-model-alias')) return quotaIndex + 0.2;
        return quotaIndex + 0.05;
      }
    }

    const exactIndex = navOrder.indexOf(normalizedPath);
    if (exactIndex !== -1) return exactIndex;
    const nestedIndex = navOrder.findIndex(
      (path) => path !== '/' && normalizedPath.startsWith(`${path}/`)
    );
    return nestedIndex === -1 ? null : nestedIndex;
  };

  const getTransitionVariant = useCallback((fromPathname: string, toPathname: string) => {
    const normalize = (pathname: string) => {
      const trimmed =
        pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      return trimmed === '/dashboard' ? '/' : trimmed;
    };

    const from = normalize(fromPathname);
    const to = normalize(toPathname);
    const isCredentialsQuota = (pathname: string) =>
      pathname === '/quota' ||
      pathname === '/credential-groups' ||
      pathname === '/2fa' ||
      isAuthFilesPath(pathname);
    if (isCredentialsQuota(from) && isCredentialsQuota(to)) return 'ios';
    return 'vertical';
  }, []);

  const handleRefreshAll = async () => {
    clearCache();
    const results = await Promise.allSettled([
      fetchConfig(undefined, true),
      loadPluginResources({ force: true }),
      triggerHeaderRefresh(),
    ]);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') {
      const reason = rejected.reason;
      const message =
        typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
      showNotification(
        `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
      return;
    }
    showNotification(t('notification.data_refreshed'), 'success');
  };

  const togglePluginResourceDrawer = useCallback((drawerID: string) => {
    setExpandedPluginResourceIDs((current) => {
      const next = new Set(current);
      if (next.has(drawerID)) {
        next.delete(drawerID);
      } else {
        next.add(drawerID);
      }
      return next;
    });
  }, []);

  const renderNavLink = (item: SidebarNavLinkItem, className = 'nav-item') => {
    const itemLabel = item.label ?? (item.labelKey ? t(item.labelKey) : '');
    const isActive = isNavPathActive(item.path);

    const link = (
      <Link
        key={item.path}
        to={item.path}
        className={`${className}${isActive ? ' active' : ''}`}
        onClick={() => setSidebarOpen(false)}
      >
        <span className="nav-icon">{item.icon}</span>
        {showSidebarLabels && (
          <span className="nav-text">
            <span className="nav-label">{itemLabel}</span>
          </span>
        )}
      </Link>
    );

    return (
      <TooltipElement key={item.path} label={showSidebarLabels ? undefined : itemLabel}>
        {link}
      </TooltipElement>
    );
  };

  const renderNavItem = (item: SidebarNavItem) => {
    if (item.kind !== 'drawer') {
      return renderNavLink(item);
    }

    const isActive = item.children.some((child) => isNavPathActive(child.path));
    const isOpen = isActive || expandedPluginResourceIDs.has(item.id);

    return (
      <div className={`nav-drawer ${isOpen ? 'open' : ''}`} key={item.id}>
        <TooltipElement label={showSidebarLabels ? undefined : item.label}>
          <button
            type="button"
            className={`nav-item nav-drawer-toggle ${isActive ? 'active' : ''} ${
              isOpen ? 'open' : ''
            }`}
            onClick={() => togglePluginResourceDrawer(item.id)}
            aria-expanded={isOpen}
          >
            <span className="nav-icon">{item.icon}</span>
            {showSidebarLabels && (
              <>
                <span className="nav-text">
                  <span className="nav-label">{item.label}</span>
                </span>
                <span className="nav-drawer-caret" aria-hidden="true">
                  <IconChevronDown size={14} />
                </span>
              </>
            )}
          </button>
        </TooltipElement>
        {isOpen ? (
          <div className="nav-sub-list">
            {item.children.map((child) => renderNavLink(child, 'nav-item nav-sub-item'))}
          </div>
        ) : null}
      </div>
    );
  };

  const mobileSidebarToggleLabel = sidebarOpen
    ? t('sidebar.toggle_collapse', { defaultValue: 'Close navigation' })
    : t('sidebar.toggle_expand', { defaultValue: 'Open navigation' });
  const sidebarCollapseLabel = sidebarCollapsed
    ? t('sidebar.expand', { defaultValue: '展开' })
    : t('sidebar.collapse', { defaultValue: '收起' });

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} ${
          isPluginResourcePage ? 'plugin-resource-shell' : ''
        }`}
      >
        <div className="top-gradient-blur" aria-hidden="true" />

        <header className="main-header" ref={headerRef}>
          <TooltipElement label={sidebarCollapseLabel}>
            <button
              type="button"
              className="sidebar-toggle-floating"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapseLabel}
            >
              {sidebarCollapsed ? (
                <ChevronRight size={HEADER_ICON_SIZE} aria-hidden="true" />
              ) : (
                <ChevronLeft size={HEADER_ICON_SIZE} aria-hidden="true" />
              )}
            </button>
          </TooltipElement>

          <div className="mobile-sidebar-actions">
            <TooltipElement label={mobileSidebarToggleLabel} side="bottom">
              <Button
                className="mobile-menu-btn"
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen((prev) => !prev)}
                aria-label={mobileSidebarToggleLabel}
              >
                {sidebarOpen ? (
                  <X size={HEADER_ICON_SIZE} aria-hidden="true" />
                ) : (
                  <Menu size={HEADER_ICON_SIZE} aria-hidden="true" />
                )}
              </Button>
            </TooltipElement>
          </div>

          <div className="header-actions floating-actions">
            <TooltipElement label={t('header.refresh_all')} side="bottom">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefreshAll}
                aria-label={t('header.refresh_all')}
              >
                <RefreshCw size={HEADER_ICON_SIZE} aria-hidden="true" />
              </Button>
            </TooltipElement>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label={t('language.switch')}>
                      <Languages size={HEADER_ICON_SIZE} aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('language.switch')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                className="language-menu-popover flex min-w-[164px] flex-col gap-0.5 p-1"
                aria-label={t('language.switch')}
              >
                <DropdownMenuRadioGroup value={language} onValueChange={handleLanguageSelect}>
                  {LANGUAGE_ORDER.map((lang) => (
                    <DropdownMenuRadioItem
                      key={lang}
                      className={`language-menu-option w-full justify-between ${
                        language === lang ? 'active text-[var(--primary)]' : ''
                      }`}
                      value={lang}
                    >
                      <span>{t(LANGUAGE_LABEL_KEYS[lang])}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label={t('theme.switch')}>
                      {theme === 'auto' ? (
                        <MonitorCog size={HEADER_ICON_SIZE} aria-hidden="true" />
                      ) : theme === 'dark' ? (
                        <Moon size={HEADER_ICON_SIZE} aria-hidden="true" />
                      ) : theme === 'white' ? (
                        <CircleDot size={HEADER_ICON_SIZE} aria-hidden="true" />
                      ) : (
                        <Sun size={HEADER_ICON_SIZE} aria-hidden="true" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('theme.switch')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                className="theme-menu-popover grid w-[min(188px,calc(100vw-16px))] grid-cols-2 gap-1 p-2 sm:flex sm:w-max"
                aria-label={t('theme.switch')}
              >
                <DropdownMenuRadioGroup
                  value={theme}
                  onValueChange={(value) => handleThemeSelect(value as Theme)}
                  className="contents"
                >
                  {THEME_CARDS.map((tc) => (
                    <DropdownMenuRadioItem
                      key={tc.key}
                      className={`theme-card flex w-full min-w-0 flex-col items-center gap-1 rounded-md border-2 bg-transparent p-1.5 pb-1 ${
                        theme === tc.key ? 'active border-[var(--primary)]' : 'border-transparent'
                      }`}
                      showIndicator={false}
                      value={tc.key}
                    >
                      <div
                        className="theme-card-preview flex h-[52px] w-[72px] flex-col overflow-hidden rounded-sm"
                        style={{
                          background: tc.colors.bg,
                          border: `1px solid ${tc.colors.border}`,
                        }}
                      >
                        <div
                          className="theme-card-header h-2.5 shrink-0"
                          style={{
                            background: tc.colors.card,
                            borderBottom: `1px solid ${tc.colors.border}`,
                          }}
                        />
                        <div className="theme-card-body flex min-h-0 flex-1">
                          <div
                            className="theme-card-sidebar w-4 shrink-0"
                            style={{
                              background: tc.colors.card,
                              borderRight: `1px solid ${tc.colors.border}`,
                            }}
                          />
                          <div
                            className="theme-card-content flex flex-1 flex-col justify-center gap-1 px-2 py-1"
                            style={{ background: tc.colors.bg }}
                          >
                            <div
                              className="theme-card-line h-[3px] rounded-[1px]"
                              style={{ background: tc.colors.textMuted }}
                            />
                            <div
                              className="theme-card-line short h-[3px] w-3/5 rounded-[1px]"
                              style={{ background: tc.colors.textMuted }}
                            />
                          </div>
                        </div>
                      </div>
                      <span className="theme-card-label text-center text-[11px] font-medium leading-tight text-[var(--foreground)]">
                        {t(tc.labelKey)}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipElement label={t('header.logout')} side="bottom">
              <Button variant="ghost" size="sm" onClick={logout} aria-label={t('header.logout')}>
                <LogOut size={HEADER_ICON_SIZE} aria-hidden="true" />
              </Button>
            </TooltipElement>
          </div>
        </header>

        <div className="main-body">
          <button
            type="button"
            className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`}
            onClick={() => setSidebarOpen(false)}
            aria-label={t('common.close')}
            aria-hidden={!sidebarOpen}
            tabIndex={sidebarOpen ? 0 : -1}
          />

          <aside
            className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}
          >
            <TooltipElement label={showSidebarLabels ? undefined : fullBrandName}>
              <div className="sidebar-brand">
                <img src={INLINE_LOGO_JPEG} alt="XFProxyAPI logo" className="sidebar-brand-logo" />
                {showSidebarLabels && <span className="sidebar-brand-title">{abbrBrandName}</span>}
              </div>
            </TooltipElement>

            <div className="nav-section">
              {navGroups.map((group, idx) => (
                <div
                  className={`nav-group ${group.id === 'plugin-pages' ? 'nav-group-bottom' : ''}`}
                  key={group.id}
                >
                  {showSidebarLabels ? (
                    <div className="nav-group-label">{t(group.labelKey)}</div>
                  ) : (
                    idx > 0 && <div className="nav-group-divider" aria-hidden="true" />
                  )}
                  {group.items.map((item) => renderNavItem(item))}
                </div>
              ))}
            </div>
          </aside>

          <div
            className={`content${isLogsPage ? ' content-logs' : ''}${
              isPluginResourcePage ? ' content-plugin-resource' : ''
            }`}
            ref={contentRef}
          >
            <main
              className={`main-content${isLogsPage ? ' main-content-logs' : ''}${
                isPluginResourcePage ? ' main-content-plugin-resource' : ''
              }`}
            >
              <PageTransition
                render={(location) => <MainRoutes location={location} />}
                getRouteOrder={getRouteOrder}
                getTransitionVariant={getTransitionVariant}
                scrollContainerRef={contentRef}
              />
            </main>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
