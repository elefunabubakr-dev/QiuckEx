import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTranslation } from 'react-i18next';
import { FALLBACK_LANGUAGE, getSupportedLocales } from '../src/lib/i18n';
import { useTheme } from '../src/theme/ThemeContext';

/**
 * Endonyms — each language's name in itself, matching the frontend picker.
 * These are display labels only: the set of offered locales comes from the
 * loaded dictionary (see `getLocaleOptions`), so a dictionary locale without a
 * label here is still selectable and falls back to its uppercase code.
 */
export const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
};

export interface LocaleOption {
  value: string;
  label: string;
}

/**
 * The picker's item list, derived from `translations.json` through the i18n
 * bootstrap. Deriving it means the picker can never drift from the locales the
 * app actually ships resources for.
 */
export function getLocaleOptions(): LocaleOption[] {
  return getSupportedLocales().map((value) => ({
    value,
    label: LOCALE_LABELS[value] ?? value.toUpperCase(),
  }));
}

export function LocaleSwitcher() {
  const { i18n } = useTranslation();
  const { theme } = useTheme();

  const options = getLocaleOptions();
  const active = i18n.resolvedLanguage ?? i18n.language;
  const selectedValue = options.some((option) => option.value === active)
    ? active
    : FALLBACK_LANGUAGE;

  const changeLanguage = (lng: string) => {
    // The i18n `languageChanged` handler persists the selection (AsyncStorage
    // on native, localStorage on web), so it survives an app restart.
    void i18n.changeLanguage(lng);
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.label, { color: theme.textPrimary }]}>🌐 Language</Text>
      <Picker
        testID="locale-picker"
        selectedValue={selectedValue}
        onValueChange={changeLanguage}
        style={{ color: theme.textPrimary }}
      >
        {options.map((option) => (
          <Picker.Item key={option.value} label={option.label} value={option.value} />
        ))}
      </Picker>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
});
