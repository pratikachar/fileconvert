/**
 * PWA install prompt. Chrome only fires beforeinstallprompt when the app is
 * genuinely installable (PNG icons 192+512, standalone, SW) - the manifest
 * in public/ satisfies that since Phase 9. Until the event fires the button
 * stays hidden; iOS (no event ever) gets the manual Add-to-Home-Screen hint.
 */

const $ = (id) => document.getElementById(id);

let deferred = null;

function toast(msg) {
  let t = $('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '') && !window.MSStream;
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function setupInstall() {
  const btn = $('install-btn');
  if (!btn) return;
  if (isStandalone()) return; // already installed - nothing to offer

  // The button is always visible: where the browser offers a real prompt we
  // use it, everywhere else the button explains the manual path. (An earlier
  // version only appeared on beforeinstallprompt, which left Firefox/iOS
  // users with no discoverable install path at all.)
  btn.hidden = false;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
    toast('FileForge installed - find it on your home screen.');
  });

  btn.addEventListener('click', async () => {
    if (deferred && typeof deferred.prompt === 'function') {
      deferred.prompt();
      try {
        const choice = await deferred.userChoice;
        toast(choice && choice.outcome === 'accepted' ? 'Installing…' : 'Install dismissed - the button stays here.');
        if (choice && choice.outcome === 'accepted') deferred = null;
      } catch {
        toast('Install prompt failed.');
      }
      return;
    }
    // No deferred prompt (iOS, or not installable here): say how, honestly.
    toast(isIos()
      ? 'On iPhone: Share → Add to Home Screen.'
      : 'Install from the browser menu (⋮ → Install / Add to Home screen).');
  });
}
