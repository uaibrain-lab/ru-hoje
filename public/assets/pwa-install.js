/* Instalação PWA opcional — nenhum push, permissão ou dependência externa. */
(() => {
  'use strict';

  const CLOSED_KEY = 'hub:pwa-install:closed:v1';
  const WAIT_MS = 10000;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /Android/i.test(ua);
  let deferredPrompt = null;
  let installedThisSession = false;
  let ui = null;
  let showTimer = null;

  const standalone = () => Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
    navigator.standalone === true
  );
  const readClosed = () => {
    try { return localStorage.getItem(CLOSED_KEY) === '1'; }
    catch { return false; }
  };
  const markClosed = () => {
    try { localStorage.setItem(CLOSED_KEY, '1'); }
    catch { /* Site continua utilizável com armazenamento desativado. */ }
  };
  const hideToast = () => {
    if (showTimer !== null) clearTimeout(showTimer);
    showTimer = null;
    if (ui) ui.toast.hidden = true;
  };
  const dismissToast = () => {
    markClosed();
    hideToast();
  };

  function refreshInstalledState() {
    if (!ui) return;
    const installed = standalone() || installedThisSession;
    ui.manual.hidden = installed;
    if (installed) {
      deferredPrompt = null;
      hideToast();
      if (ui.dialog.open) ui.dialog.close();
    }
  }

  function scheduleToast() {
    if (!ui || showTimer !== null || standalone() || readClosed() ||
      (!deferredPrompt && !isIOS)) return;
    showTimer = setTimeout(() => {
      showTimer = null;
      if (!ui || standalone() || readClosed() ||
        (!deferredPrompt && !isIOS)) return;
      // Não encobrir a seleção inicial de RU, formulários ou outros diálogos.
      if (document.hidden || document.querySelector('dialog[open]')) {
        scheduleToast();
        return;
      }
      ui.toast.hidden = false;
    }, WAIT_MS);
  }

  function showInstructions() {
    if (!ui || standalone()) return;
    const steps = isIOS
      ? [
          ...(!/Safari/i.test(ua) || /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
            ? ['Abra este site no Safari do iPhone ou iPad.'] : []),
          'No Safari, toque em Compartilhar (quadrado com seta para cima).',
          'Escolha “Adicionar à Tela de Início”.',
          'Se aparecer, ative “Abrir como App” e confirme em “Adicionar”.'
        ]
      : /Android/i.test(ua)
        ? [
            'No Chrome ou Edge, abra o menu de três pontos (⋮).',
            'Procure “Instalar aplicativo” ou “Adicionar à tela inicial”, se disponível.',
            'Confirme para criar o atalho do Hub UFMG.'
          ]
        : [
            'Abra este site no Chrome ou Edge.',
            'No menu do navegador, procure “Instalar aplicativo” ou a opção de instalar este site como app.',
            'Confirme a instalação, se o navegador oferecer a opção.'
          ];
    ui.title.textContent = isIOS ? 'Adicionar à Tela de Início' : 'Instalar Hub UFMG';
    ui.description.textContent = isIOS
      ? 'No iPhone e no iPad, a instalação é feita pelo navegador.'
      : 'Se a instalação direta não aparecer, tente pelo menu do navegador.';
    ui.steps.replaceChildren();
    for (const instruction of steps) {
      const item = document.createElement('li');
      item.textContent = instruction;
      ui.steps.append(item);
    }
    if (!ui.dialog.open) ui.dialog.showModal();
  }

  async function requestInstall() {
    if (standalone()) return;
    dismissToast();
    const prompt = deferredPrompt;
    deferredPrompt = null;
    if (!prompt) {
      showInstructions();
      return;
    }
    try {
      // A chamada a prompt() ocorre diretamente dentro do clique.
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      showInstructions();
    }
  }

  function init() {
    const ids = (id) => document.getElementById(id);
    ui = {
      toast: ids('pwa-install-toast'),
      action: ids('pwa-install-action'),
      dismiss: ids('pwa-install-dismiss'),
      manual: ids('pwa-install-manual-wrap'),
      manualButton: ids('pwa-install-manual'),
      dialog: ids('pwa-install-guide'),
      title: ids('pwa-install-guide-title'),
      description: ids('pwa-install-guide-description'),
      steps: ids('pwa-install-guide-steps'),
      close: ids('pwa-install-guide-close')
    };
    if (Object.values(ui).some((element) => !element)) {
      ui = null;
      return;
    }
    if (isIOS) {
      ui.action.textContent = 'Como instalar';
      ids('pwa-install-subtitle').textContent = 'Acesse direto da Tela de Início.';
    } else {
      ui.action.textContent = 'Instalar';
      ids('pwa-install-subtitle').textContent =
        isMobile ? 'Abra direto pela tela inicial.' : 'Abra como aplicativo no computador.';
    }
    ui.action.addEventListener('click', requestInstall);
    ui.manualButton.addEventListener('click', requestInstall);
    ui.dismiss.addEventListener('click', dismissToast);
    ui.close.addEventListener('click', () => ui.dialog.close());
    ui.dialog.addEventListener('click', (event) => {
      if (event.target === ui.dialog) ui.dialog.close();
    });
    refreshInstalledState();
    scheduleToast();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    // O navegador continua decidindo se o PWA é elegível.
    event.preventDefault();
    if (standalone()) return;
    deferredPrompt = event;
    scheduleToast();
  });
  window.addEventListener('appinstalled', () => {
    installedThisSession = true;
    markClosed();
    deferredPrompt = null;
    refreshInstalledState();
    hideToast();
  });
  window.addEventListener('pageshow', refreshInstalledState);
  window.addEventListener('storage', (event) => {
    if (event.key === CLOSED_KEY && readClosed()) hideToast();
  });
  try {
    window.matchMedia?.('(display-mode: standalone)')
      .addEventListener?.('change', refreshInstalledState);
  } catch { /* Navegadores antigos usam somente pageshow. */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once: true});
  } else {
    init();
  }
})();
