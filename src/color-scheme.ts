export const COLOR_SCHEME_KEY = 'editor.colorScheme';
export const COLOR_SCHEMES = ['light', 'paper', 'slate', 'dark'] as const;
export type ColorScheme = typeof COLOR_SCHEMES[number];

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && (COLOR_SCHEMES as readonly string[]).includes(value);
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
  root.classList.toggle('dark', scheme === 'dark');
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
