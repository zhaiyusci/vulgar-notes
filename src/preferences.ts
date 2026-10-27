import {locale, t} from './i18n';
import {isTauri} from '@tauri-apps/api/core';
import {applyColorScheme, currentColorScheme, isColorScheme, readColorScheme, saveColorScheme} from './color-scheme';

export function initPreferences() {
  const trigger = document.getElementById('openPreferences') as HTMLButtonElement;
  const dialog = document.getElementById('preferencesDialog') as HTMLDialogElement;
  const form = document.getElementById('preferencesForm') as HTMLFormElement;
  const select = document.getElementById('uiLocale') as HTMLSelectElement;
  const colorScheme = document.getElementById('uiColorScheme') as HTMLSelectElement;
  const error = document.getElementById('preferencesError') as HTMLParagraphElement;
  const desktopDownloads = document.getElementById('desktopDownloads');
  applyColorScheme(readColorScheme());
  let originalColorScheme = currentColorScheme();
  let committed = false;
  if (desktopDownloads) desktopDownloads.hidden = isTauri();
  trigger.title = t('Preferences');
  trigger.setAttribute('aria-label', t('Preferences'));
  trigger.addEventListener('click', () => {
    select.value = locale;
    originalColorScheme = currentColorScheme();
    colorScheme.value = originalColorScheme;
    committed = false;
    error.hidden = true;
    dialog.querySelectorAll<HTMLDetailsElement>('#applicationAbout, #thirdPartyLicenses').forEach(section => {section.open = false;});
    dialog.showModal();
  });
  colorScheme.addEventListener('change', () => {
    if (isColorScheme(colorScheme.value)) applyColorScheme(colorScheme.value);
    error.hidden = true;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const apply = (event.submitter as HTMLButtonElement | null)?.value === 'save';
    if (apply) {
      const nextScheme = isColorScheme(colorScheme.value) ? colorScheme.value : originalColorScheme;
      applyColorScheme(nextScheme);
      if (!saveColorScheme(nextScheme)) {
        error.textContent = t('Preferences could not be saved on this device.');
        error.hidden = false;
        return;
      }
      if (select.value !== locale) {
        try {
          localStorage.setItem('editor.locale', select.value);
        } catch {
          saveColorScheme(originalColorScheme);
          error.textContent = t('Preferences could not be saved on this device.');
          error.hidden = false;
          return;
        }
        // Both UI hosts use the same saved locale. Their document draft is saved synchronously.
        committed = true;
        window.location.reload();
        return;
      }
      committed = true;
    }
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (!committed) applyColorScheme(originalColorScheme);
    trigger.focus();
  });
}
