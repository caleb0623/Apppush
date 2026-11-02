import { ref } from 'vue';
import { zh } from './zh';

export type Locale = 'en' | 'zh';

/** English text is the key, so a string with no Chinese entry fails the typecheck. */
export type MessageKey = keyof typeof zh;

const STORAGE_KEY = 'apppush.locale';
const dictionary = new Map<string, string>(Object.entries(zh));

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // Storage can be blocked. The browser's language is a fine answer then.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const locale = ref<Locale>(initialLocale());

function applyToDocument() {
  document.documentElement.lang = locale.value === 'zh' ? 'zh-CN' : 'en';
  document.title = t('AppPush Console');
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const text: string = locale.value === 'zh' ? zh[key] : key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}

/** For text only known at run time, such as a stored value. Unknown text is shown as it is. */
export const translate = (text: string): string =>
  locale.value === 'zh' ? (dictionary.get(text) ?? text) : text;

// The API answers in English. These messages carry a value, so they cannot be looked up whole.
const SERVER_PATTERNS: [RegExp, MessageKey][] = [
  [/^(.+) was not found$/, '{value} was not found'],
  [/^Tag "(.+)" already exists$/, 'Tag "{value}" already exists'],
  [/^Testing environments allow at most (\d+) devices$/, 'Testing environments allow at most {value} devices'],
  [/^Testing environments allow at most (\d+) tags$/, 'Testing environments allow at most {value} tags'],
  [/^Testing environments allow at most (\d+) devices per tag$/, 'Testing environments allow at most {value} devices per tag'],
  [/^Testing environments allow at most (\d+) tags per device$/, 'Testing environments allow at most {value} tags per device'],
  [/^Testing environments allow (\d+) requests per second$/, 'Testing environments allow {value} requests per second'],
  [/^scheduledAt must be within (\d+) days$/, 'scheduledAt must be within {value} days'],
];

export function translateServerText(text: string): string {
  if (locale.value === 'en') return text;
  for (const [pattern, key] of SERVER_PATTERNS) {
    const value = pattern.exec(text)?.[1];
    if (value !== undefined) return t(key, { value: translate(value) });
  }
  return translate(text);
}

export function setLocale(next: Locale) {
  locale.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice then lasts until the page is reloaded.
  }
  applyToDocument();
}

export const toggleLocale = () => setLocale(locale.value === 'zh' ? 'en' : 'zh');

applyToDocument();
