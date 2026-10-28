import {locale, t} from './i18n';
import {isTauri} from '@tauri-apps/api/core';
import {applyColorScheme, currentColorScheme, isColorScheme, readColorScheme, saveColorScheme} from './color-scheme';
import {flushDocumentDraftStore} from './document-draft-store';

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
  let applying = false, generation = 0;
  const setApplying = (value:boolean) => {
    applying = value;select.disabled = value;colorScheme.disabled = value;
    form.querySelectorAll<HTMLButtonElement>('button[value="save"]').forEach(button => {button.disabled = value;});
  };
  if (desktopDownloads) desktopDownloads.hidden = isTauri();
  trigger.title = t('Preferences');
  trigger.setAttribute('aria-label', t('Preferences'));
  trigger.addEventListener('click', () => {
    select.value = locale;
    originalColorScheme = currentColorScheme();
    colorScheme.value = originalColorScheme;
    committed = false;
    generation++;setApplying(false);
    error.hidden = true;
    dialog.querySelectorAll<HTMLDetailsElement>('#applicationAbout, #thirdPartyLicenses').forEach(section => {section.open = false;});
    dialog.showModal();
  });
  colorScheme.addEventListener('change', () => {
    if (isColorScheme(colorScheme.value)) applyColorScheme(colorScheme.value);
    error.hidden = true;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const apply = (event.submitter as HTMLButtonElement | null)?.value === 'save';
    if (apply) {
      if (applying) return;
      const nextScheme = isColorScheme(colorScheme.value) ? colorScheme.value : originalColorScheme;
      const nextLocale = select.value;
      if (nextLocale !== locale) {
        const attempt = generation;setApplying(true);
        try {
          await flushDocumentDraftStore();
        } catch {
          if (attempt === generation && dialog.open) {
            error.textContent = t('Local document recovery is unavailable. Your changes remain in this window. Please save the document to a file.');
            error.hidden = false;
          }
          return;
        } finally {
          if (attempt === generation) setApplying(false);
        }
        if (attempt !== generation || !dialog.open) return;
      }
      applyColorScheme(nextScheme);
      if (!saveColorScheme(nextScheme)) {
        error.textContent = t('Preferences could not be saved on this device.');
        error.hidden = false;
        return;
      }
      if (nextLocale !== locale) {
        try {
          localStorage.setItem('editor.locale', nextLocale);
        } catch {
          saveColorScheme(originalColorScheme);
          error.textContent = t('Preferences could not be saved on this device.');
          error.hidden = false;
          return;
        }
        // Both UI hosts reload only after their document recovery has committed.
        committed = true;
        window.location.reload();
        return;
      }
      committed = true;
    }
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    generation++;setApplying(false);
    if (!committed) applyColorScheme(originalColorScheme);
    trigger.focus();
  });
}
