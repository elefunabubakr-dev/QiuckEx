import { useTheme as useThemeContext } from '../context/ThemeContext';

/**
 * Enhanced theme hook with style generators
 */
export function useTheme() {
  const theme = useThemeContext();

  /**
   * Resolve a color token to current theme string
   * Since tokens are already resolved for the current theme, just return the value
   */
  const color = (token: string): string => {
    return token;
  };

  /**
   * Generate themed StyleSheet values
   */
  const themed = <T extends Record<string, any>>(
    styles: (theme: typeof theme) => T
  ): T => {
    return styles(theme);
  };

  return {
    ...theme,
    color,
    themed,
  };
}