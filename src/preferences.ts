import {locale, t} from './i18n';
import {isTauri} from '@tauri-apps/api/core';

export function initPreferences() {
  const trigger = document.getElementById('openPreferences') as HTMLButtonElement;
  const dialog = document.getElementById('preferencesDialog') as HTMLDialogElement;
  const form = document.getElementById('preferencesForm') as HTMLFormElement;
  const select = document.getElementById('uiLocale') as HTMLSelectElement;
  const desktopDownloads = document.getElementById('desktopDownloads');
  if (desktopDownloads) desktopDownloads.hidden = isTauri();
  trigger.title = t('Preferences');
  trigger.setAttribute('aria-label', t('Preferences'));
  trigger.addEventListener('click', () => {
    select.value = locale;
    dialog.showModal();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const apply = (event.submitter as HTMLButtonElement | null)?.value === 'save';
    if (apply && select.value !== locale) {
      localStorage.setItem('editor.locale', select.value);
      // Both UI hosts use the same saved locale. Their document draft is saved synchronously.
      window.location.reload();
      return;
    }
    dialog.close();
  });
  dialog.addEventListener('close', () => trigger.focus());
}
