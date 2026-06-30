/**
 * i18next internationalization setup.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '@/types';
import { getInitialLanguage, isSupportedLanguage } from '@/utils/language';

type TranslationResource = Record<string, unknown>;
type LocaleModule = { default: TranslationResource };

const fallbackLanguage: Language = 'zh-CN';

const localeLoaders = {
  'zh-CN': () => import('./locales/zh-CN.json') as Promise<LocaleModule>,
  'zh-TW': () => import('./locales/zh-TW.json') as Promise<LocaleModule>,
  en: () => import('./locales/en.json') as Promise<LocaleModule>,
  ru: () => import('./locales/ru.json') as Promise<LocaleModule>,
} satisfies Record<Language, () => Promise<LocaleModule>>;

const loadedResources = new Map<Language, TranslationResource>();
let initializePromise: Promise<typeof i18n> | null = null;

async function loadLocaleResource(language: Language): Promise<TranslationResource> {
  const cached = loadedResources.get(language);
  if (cached) return cached;

  const module = await localeLoaders[language]();
  loadedResources.set(language, module.default);
  return module.default;
}

async function ensureLanguageResource(language: Language): Promise<void> {
  const translation = await loadLocaleResource(language);
  if (i18n.isInitialized && !i18n.hasResourceBundle(language, 'translation')) {
    i18n.addResourceBundle(language, 'translation', translation, true, true);
  }
}

export async function initializeI18n(): Promise<typeof i18n> {
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    const initialLanguage = getInitialLanguage();
    const initialTranslation = await loadLocaleResource(initialLanguage);
    const resources: Partial<Record<Language, { translation: TranslationResource }>> = {
      [initialLanguage]: { translation: initialTranslation },
    };

    if (initialLanguage !== fallbackLanguage) {
      resources[fallbackLanguage] = {
        translation: await loadLocaleResource(fallbackLanguage),
      };
    }

    await i18n.use(initReactI18next).init({
      resources,
      lng: initialLanguage,
      fallbackLng: fallbackLanguage,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    });

    return i18n;
  })();

  return initializePromise;
}

export async function changeI18nLanguage(language: string): Promise<void> {
  if (!isSupportedLanguage(language)) return;

  if (!i18n.isInitialized) {
    await initializeI18n();
  }

  await ensureLanguageResource(language);
  await i18n.changeLanguage(language);
}

export default i18n;
