import {locale, t} from './i18n';
import {isTauri} from '@tauri-apps/api/core';
import {applyColorScheme, currentColorScheme, isColorScheme, readColorScheme, saveColorScheme} from './color-scheme';
import {flushDocumentDraftStore} from './document-draft-store';
import {readProofreadingSettings,saveProofreadingSettings,validateProofreadingSettings,type ProofreadingSettings} from './proofreading-settings';

export function initPreferences() {
  const trigger = document.getElementById('openPreferences') as HTMLButtonElement;
  const dialog = document.getElementById('preferencesDialog') as HTMLDialogElement;
  const form = document.getElementById('preferencesForm') as HTMLFormElement;
  const select = document.getElementById('uiLocale') as HTMLSelectElement;
  const colorScheme = document.getElementById('uiColorScheme') as HTMLSelectElement;
  const error = document.getElementById('preferencesError') as HTMLParagraphElement;
  const desktopDownloads = document.getElementById('desktopDownloads');
  const proofreading = document.getElementById('proofreadingPreferences') as HTMLFieldSetElement;
  const proofreadingEnabled = document.getElementById('proofreadingEnabled') as HTMLInputElement;
  const proofreadingProvider = document.getElementById('proofreadingProvider') as HTMLSelectElement;
  const proofreadingLanguageTool = document.getElementById('proofreadingLanguageTool') as HTMLDivElement;
  const proofreadingAI = document.getElementById('proofreadingAI') as HTMLDivElement;
  const languageToolEndpoint = document.getElementById('languageToolEndpoint') as HTMLInputElement;
  const languageToolLanguage = document.getElementById('languageToolLanguage') as HTMLSelectElement;
  const proofreadingEndpoint = document.getElementById('proofreadingEndpoint') as HTMLInputElement;
  const proofreadingModel = document.getElementById('proofreadingModel') as HTMLInputElement;
  const proofreadingApiKey = document.getElementById('proofreadingApiKey') as HTMLInputElement;
  const proofreadingRememberKey = document.getElementById('proofreadingRememberKey') as HTMLInputElement;
  const proofreadingKeyHint = document.getElementById('proofreadingKeyHint') as HTMLParagraphElement;
  const keyHint = () => {proofreadingKeyHint.hidden = !proofreadingRememberKey.checked;};
  const providerFields = () => {
    proofreadingLanguageTool.hidden=proofreadingProvider.value!=='languagetool';
    proofreadingAI.hidden=proofreadingProvider.value!=='ai';
  };
  const proofreadingValues = ():ProofreadingSettings => ({enabled:proofreadingEnabled.checked,
    provider:proofreadingProvider.value==='languagetool'?'languagetool':'ai',languageToolEndpoint:languageToolEndpoint.value,languageToolLanguage:languageToolLanguage.value,
    endpoint:proofreadingEndpoint.value,model:proofreadingModel.value,apiKey:proofreadingApiKey.value,rememberKey:proofreadingRememberKey.checked});
  applyColorScheme(readColorScheme());
  let originalColorScheme = currentColorScheme();
  let committed = false;
  let applying = false, generation = 0;
  const setApplying = (value:boolean) => {
    applying = value;select.disabled = value;colorScheme.disabled = value;proofreading.disabled = value;
    form.querySelectorAll<HTMLButtonElement>('button[value="save"]').forEach(button => {button.disabled = value;});
  };
  if (desktopDownloads) desktopDownloads.hidden = isTauri();
  trigger.title = t('Preferences');
  trigger.setAttribute('aria-label', t('Preferences'));
  trigger.addEventListener('click', () => {
    select.value = locale;
    originalColorScheme = currentColorScheme();
    colorScheme.value = originalColorScheme;
    const settings = readProofreadingSettings();
    proofreadingEnabled.checked = settings.enabled;proofreadingProvider.value=settings.provider;
    languageToolEndpoint.value=settings.languageToolEndpoint;
    languageToolLanguage.querySelectorAll('option[data-custom-language]').forEach(option=>option.remove());
    if(settings.languageToolLanguage&&![...languageToolLanguage.options].some(option=>option.value===settings.languageToolLanguage)){
      const option=document.createElement('option');option.value=settings.languageToolLanguage;option.textContent=settings.languageToolLanguage;option.dataset.customLanguage='true';languageToolLanguage.append(option);
    }
    languageToolLanguage.value=settings.languageToolLanguage;providerFields();proofreadingEndpoint.value = settings.endpoint;
    proofreadingModel.value = settings.model;proofreadingApiKey.value = settings.apiKey;
    proofreadingRememberKey.checked = settings.rememberKey;keyHint();
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
  proofreadingRememberKey.addEventListener('change', keyHint);
  proofreadingProvider.addEventListener('change', () => {providerFields();error.hidden=true;});
  proofreading.addEventListener('input', () => {error.hidden = true;});
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const apply = (event.submitter as HTMLButtonElement | null)?.value === 'save';
    if (apply) {
      if (applying) return;
      const nextScheme = isColorScheme(colorScheme.value) ? colorScheme.value : originalColorScheme;
      const nextLocale = select.value;
      const nextProofreading = proofreadingValues();
      const validationError = validateProofreadingSettings(nextProofreading);
      if (validationError) {error.textContent = t(validationError);error.hidden = false;return;}
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
      let previousLocale:string|null = null;
      if (nextLocale !== locale) {
        try {
          previousLocale = localStorage.getItem('editor.locale');
          localStorage.setItem('editor.locale', nextLocale);
        } catch {
          saveColorScheme(originalColorScheme);
          error.textContent = t('Preferences could not be saved on this device.');
          error.hidden = false;
          return;
        }
      }
      if (!saveProofreadingSettings(nextProofreading)) {
        saveColorScheme(originalColorScheme);
        if (nextLocale !== locale) {
          try {if (previousLocale === null) localStorage.removeItem('editor.locale');else localStorage.setItem('editor.locale', previousLocale);} catch { /* Report the failed preference transaction below. */ }
        }
        error.textContent = t('Preferences could not be saved on this device.');error.hidden = false;return;
      }
      if (nextLocale !== locale) {
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
