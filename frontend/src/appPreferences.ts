import type { UiLanguage } from "./uiI18n";

export type ThemeMode = "light" | "dark";
export type MetadataLanguage = "de-de" | "en-gb";

export const THEME_MODE_STORAGE_KEY = "tafforge.ui.theme.v1";

const PLACEHOLDER_METADATA_VALUES = new Set([
  "demo",
  "copyright",
  "copyright demo",
  "demo copyright",
]);

const normalizePlaceholderCandidate = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[©"'()[\]{}]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const sanitizeMetadataText = (value: unknown): string => {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  return PLACEHOLDER_METADATA_VALUES.has(normalizePlaceholderCandidate(text)) ? "" : text;
};

export const getDefaultMetadataLanguage = (uiLanguage: UiLanguage): MetadataLanguage =>
  uiLanguage === "en" ? "en-gb" : "de-de";

export const getMetadataLanguageOptions = (
  labels: Record<MetadataLanguage, string>
): Array<{ value: MetadataLanguage; label: string }> => [
  { value: "de-de", label: labels["de-de"] },
  { value: "en-gb", label: labels["en-gb"] },
];

export const readStoredThemeMode = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
};

export const storeThemeMode = (mode: ThemeMode): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  }
};
