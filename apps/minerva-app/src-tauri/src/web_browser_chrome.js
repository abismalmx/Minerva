// Desktop in-app browser chrome (#5775). Injected into every page of a
// `browser-*` window by `web_browser.rs`, which replaces the placeholder
// identifier below with the JSON options (theme colours + translated labels).
(function (OPTIONS) {
  if (window.top !== window) return;
  if (window.__minervaBrowser) return;

  var L = OPTIONS.labels || {};
  var BG = OPTIONS.background || '#1f2024';
  var FG = OPTIONS.foreground || '#f5f5f7';
  var EINK = !!OPTIONS.isEink;
  // A companion window carries a third-party app instead of a book source:
  // there is nothing to clip, and no download status to report.
  var SHOW_CLIP = OPTIONS.showClip !== false;
  var SENTINEL = 'https://minerva-browser.invalid/';

  function label(key, fallback) {
    return L[key] || fallback;
  }

  var state = { hideTimer: null };
  var refs = {};

  /**
   * The origin the panel is showing.
   *
   * A companion window keeps the title the app gave it, so the reader has
   * no other way to tell that the page moved to another site: without this
   * label a phishing page looks exactly like the site the reader opened.
   */
  function updateHost() {
    if (!refs.origin) return;
    var host = location.host || '';
    refs.origin.textContent = host;
    refs.origin.title = location.href;
  }

  /** Follow the origin across the navigations a single-page app makes. */
  function watchLocation() {
    var push = history.pushState;
    var replace = history.replaceState;
    if (push) {
      history.pushState = function () {
        var result = push.apply(this, arguments);
        updateHost();
        return result;
      };
    }
    if (replace) {
      history.replaceState = function () {
        var result = replace.apply(this, arguments);
        updateHost();
        return result;
      };
    }
    window.addEventListener('popstate', updateHost);
    window.addEventListener('hashchange', updateHost);
  }

  function css() {
    return (
      ':host{all:initial;}' +
      '.pill{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;' +
      'display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:999px;' +
      'box-sizing:border-box;max-width:calc(100vw - 24px);' +
      'background:' +
      BG +
      ';color:' +
      FG +
      ';font:13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'border:1px solid ' +
      (EINK ? FG : 'rgba(128,128,128,.35)') +
      ';' +
      (EINK ? '' : 'box-shadow:0 4px 16px rgba(0,0,0,.18);') +
      'direction:ltr;user-select:none;-webkit-user-select:none;}' +
      '.btn{appearance:none;border:0;background:transparent;color:' +
      FG +
      ';width:32px;height:32px;border-radius:999px;' +
      'display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;padding:0;margin:0;flex:none;}' +
      '.btn:hover{background:rgba(128,128,128,.18);}' +
      '.host{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:32vw;' +
      'opacity:.75;font-size:12px;padding:0 2px;}' +
      '.status{display:none;align-items:center;gap:8px;padding:0 8px;min-width:0;flex:0 1 auto;}' +
      '.status.show{display:inline-flex;}' +
      '.status-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto;}' +
      '.open{appearance:none;border:0;border-radius:999px;padding:4px 12px;flex:none;white-space:nowrap;background:' +
      FG +
      ';color:' +
      BG +
      ';font-weight:600;cursor:pointer;}' +
      '.clip{min-height:32px;}' +
      '.sep{width:1px;height:20px;background:rgba(128,128,128,.35);margin:0 2px;}'
    );
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(key, glyph, fallback, onClick) {
    var b = el('button', 'btn', glyph);
    b.type = 'button';
    b.setAttribute('aria-label', label(key, fallback));
    b.title = label(key, fallback);
    b.addEventListener('click', function (e) {
      e.preventDefault();
      onClick();
    });
    return b;
  }

  function navigate(path) {
    location.href = SENTINEL + path;
  }

  function install() {
    if (refs.host || !document.documentElement) return;
    var host = el('div');
    host.id = '__minerva_browser_chrome__';
    var root = host.attachShadow({ mode: 'closed' });
    var style = el('style', null, css());
    var pill = el('div', 'pill');
    pill.setAttribute('role', 'toolbar');

    refs.back = button('back', '‹', 'Back', function () {
      history.back();
    });
    refs.forward = button('forward', '›', 'Forward', function () {
      history.forward();
    });
    refs.reload = button('reload', '↻', 'Reload', function () {
      location.reload();
    });
    if (SHOW_CLIP) {
      refs.clip = el('button', 'open clip', label('clipPage', 'Clip Page'));
      refs.clip.type = 'button';
      refs.clip.onclick = function () {
        refs.clip.disabled = true;
        navigate('capture');
      };
      refs.status = el('span', 'status');
      refs.statusText = el('span', 'status-text');
      refs.open = el('button', 'open', label('open', 'Open'));
      refs.open.type = 'button';
      refs.open.hidden = true;
      refs.status.appendChild(refs.statusText);
      refs.status.appendChild(refs.open);
    }
    refs.close = button('close', '×', 'Close', function () {
      navigate('close');
    });
    refs.origin = el('span', 'host');

    pill.appendChild(refs.back);
    pill.appendChild(refs.forward);
    pill.appendChild(refs.reload);
    if (SHOW_CLIP) {
      pill.appendChild(refs.clip);
      pill.appendChild(refs.status);
    }
    pill.appendChild(refs.origin);
    pill.appendChild(el('span', 'sep'));
    pill.appendChild(refs.close);
    root.appendChild(style);
    root.appendChild(pill);
    (document.body || document.documentElement).appendChild(host);
    refs.host = host;
    updateHost();
    watchLocation();
  }

  function scheduleHide() {
    state.hideTimer = setTimeout(function () {
      refs.status.classList.remove('show');
    }, 8000);
  }

  function setStatus(status) {
    install();
    if (!refs.status) return;
    if (status.state === 'failed') refs.clip.disabled = false;
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
    var fallback = {
      downloading: 'Downloading',
      importing: 'Importing',
      added: 'Added to library',
      failed: 'Import failed',
      unsupported: 'Not a supported book format',
    };
    var text = label(status.state, fallback[status.state] || status.state);
    if (status.filename) text += ' · ' + status.filename;
    refs.statusText.textContent = text;
    refs.status.classList.add('show');
    if (status.state === 'added' && status.bookHash) {
      refs.open.hidden = false;
      refs.open.onclick = function () {
        navigate('open/' + encodeURIComponent(status.bookHash));
      };
      scheduleHide();
    } else {
      refs.open.hidden = true;
      refs.open.onclick = null;
      if (status.state !== 'downloading' && status.state !== 'importing') scheduleHide();
    }
  }

  window.addEventListener(
    'keydown',
    function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === '[') {
        e.preventDefault();
        history.back();
      } else if (mod && e.key === ']') {
        e.preventDefault();
        history.forward();
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        history.back();
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        history.forward();
      } else if (mod && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        location.reload();
      } else if (mod && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        navigate('close');
      } else if (e.key === 'Escape') {
        window.stop();
      }
    },
    true,
  );

  window.__minervaBrowser = { setStatus: setStatus };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(__MINERVA_BROWSER_OPTIONS__);
