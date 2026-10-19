/**
 * Mobile locale picker coverage (issue #1022).
 *
 * The mobile dictionary already ships `en`, `es`, and `fr`, but the picker used
 * to hardcode a single "English" item. These tests pin the picker's item list to
 * the dictionary (`translations.json`) so the two cannot drift again, and cover
 * that a selection is persisted through the i18n `languageChanged` handler.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import translations from '../src/lib/i18n/translations.json';
import i18n, { LANGUAGE_STORAGE_KEY } from '../src/lib/i18n';
import { QuickExThemeProvider } from '../src/theme/ThemeContext';
import { LocaleSwitcher, getLocaleOptions } from '../components/LocaleSwitcher';

// Render the picker's children as plain text so assertions target the options
// the component hands to <Picker>, without depending on native picker internals.
jest.mock('@react-native-picker/picker', () => {
  const mockReact = require('react');
  const { Text: MockText } = require('react-native');

  type ItemProps = { label: string; value: string };
  type PickerProps = {
    children?: unknown;
    selectedValue?: string;
    onValueChange?: (value: string) => void;
  };

  const Item = (_props: ItemProps) => null;

  const Picker = Object.assign(
    ({ children, selectedValue, onValueChange }: PickerProps) => {
      const options = mockReact.Children.toArray(children).map(
        (child: { props: ItemProps }) => ({
          label: child.props.label,
          value: child.props.value,
        }),
      );
      return mockReact.createElement(
        MockText,
        { testID: 'locale-picker-options', selectedValue, onValueChange },
        JSON.stringify({ selectedValue, options }),
      );
    },
    { Item },
  );

  return { Picker };
});

const DICTIONARY_LOCALES = Object.keys(translations);

interface RenderedPicker {
  selectedValue: string;
  options: { label: string; value: string }[];
}

function renderSwitcher() {
  return render(
    <QuickExThemeProvider>
      <LocaleSwitcher />
    </QuickExThemeProvider>,
  );
}

function readRenderedPicker(): RenderedPicker {
  return JSON.parse(
    String(screen.getByTestId('locale-picker-options').props.children),
  ) as RenderedPicker;
}

describe('mobile locale picker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    (AsyncStorage.setItem as jest.Mock).mockClear();
  });

  it('offers exactly the locales present in the mobile dictionary', () => {
    expect(getLocaleOptions().map((option) => option.value)).toEqual(DICTIONARY_LOCALES);
    // Regression guard for this issue: es and fr must be selectable.
    expect(DICTIONARY_LOCALES).toEqual(expect.arrayContaining(['en', 'es', 'fr']));
  });

  it('renders one picker item per dictionary locale, each with a label', () => {
    renderSwitcher();
    const { options } = readRenderedPicker();

    expect(options.map((option) => option.value)).toEqual(DICTIONARY_LOCALES);
    for (const option of options) {
      expect(option.label).toBeTruthy();
    }
  });

  it('switches language and persists the selection', async () => {
    renderSwitcher();

    fireEvent(screen.getByTestId('locale-picker-options'), 'valueChange', 'fr');

    await waitFor(() => expect(i18n.language).toBe('fr'));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'fr');
  });
});
