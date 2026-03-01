import { en, type Locale } from './en.js';

const locales: Record<string, Locale> = { en };
let currentLocale: Locale = en;
let currentLang = 'en';

/**
 * Set the active locale by language code.
 */
export function setLocale(lang: string): void {
  if (locales[lang]) {
    currentLocale = locales[lang];
    currentLang = lang;
  }
}

/**
 * Get the current language code.
 */
export function getLocale(): string {
  return currentLang;
}

/**
 * Register a new locale.
 */
export function registerLocale(lang: string, locale: Locale): void {
  locales[lang] = locale;
}

/**
 * Get a translated string by dot-notation key path.
 * Example: t('servers.title') -> 'Servers'
 */
export function t(key: string): string {
  const parts = key.split('.');
  let value: unknown = currentLocale;

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return key; // Return key as fallback if not found
    }
  }

  return typeof value === 'string' ? value : key;
}

export { en } from './en.js';
export type { Locale, LocaleKey } from './en.js';
