export const COLOR_SCHEME_KEY = 'editor.colorScheme';
export const COLOR_SCHEME_MODES = {
  light: 'light',
  paper: 'light',
  slate: 'light',
  dark: 'dark',
  'catppuccin-latte': 'light',
  'catppuccin-frappe': 'dark',
  'catppuccin-macchiato': 'dark',
  'catppuccin-mocha': 'dark',
  nord: 'dark',
  'tokyo-night': 'dark',
  dracula: 'dark',
  'solarized-light': 'light',
  'solarized-dark': 'dark',
} as const;
export type ColorScheme = keyof typeof COLOR_SCHEME_MODES;
export const COLOR_SCHEMES: readonly ColorScheme[] = Object.freeze(Object.keys(COLOR_SCHEME_MODES) as ColorScheme[]);

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && (COLOR_SCHEMES as readonly string[]).includes(value);
}

export function isDarkColorScheme(scheme: ColorScheme): boolean {
  return COLOR_SCHEME_MODES[scheme] === 'dark';
}

/** Appearance belongs to this device, rather than to a saved document. */
export function readColorScheme(storage?: Pick<Storage, 'getItem'>): ColorScheme {
  try {
    const value = (storage ?? window.localStorage).getItem(COLOR_SCHEME_KEY);
    return isColorScheme(value) ? value : 'light';
  } catch {
    return 'light';
  }
}

export function applyColorScheme(scheme: ColorScheme, root = document.documentElement): void {
  root.dataset.colorScheme = scheme;
  root.classList.toggle('dark', isDarkColorScheme(scheme));
}

export function currentColorScheme(root = document.documentElement): ColorScheme {
  return isColorScheme(root.dataset.colorScheme) ? root.dataset.colorScheme : 'light';
}

export function saveColorScheme(scheme: ColorScheme, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    (storage ?? window.localStorage).setItem(COLOR_SCHEME_KEY, scheme);
    return true;
  } catch {
    return false;
  }
}
