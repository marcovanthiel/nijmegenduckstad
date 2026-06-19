/* ===== Nijmegen Duckstad — interacties ===== */
(function () {
  var C = window.DUCKSTAD || {};
  var euro = function (n) { return '€' + Number(n).toLocaleString('nl-NL'); };

  /* --- Mobiele navigatie --- */
  var toggle = document.querySelector('.nav__toggle');
  var links = document.querySelector('.nav__links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', links.classList.contains('open'));
    });
  }

  /* --- Live teller + voortgangsbalk --- */
  var fill = document.querySelector('[data-bar-fill]');
  var numEl = document.querySelector('[data-ducks-sold]');
  var totEl = document.querySelector('[data-ducks-total]');
  var raisedEl = document.querySelector('[data-raised]');
  if (totEl) totEl.textContent = Number(C.ducksTotal).toLocaleString('nl-NL');

  function animateCount(el, target, fmt) {
    if (!el) return;
    var dur = 1400, t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var val = Math.floor((0.5 - Math.cos(p * Math.PI) / 2) * target);
      el.textContent = fmt ? fmt(val) : val.toLocaleString('nl-NL');
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function applyCounter(sold, total, raisedCents) {
    var pct = total ? Math.min(100, (sold / total) * 100) : 0;
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    animateCount(numEl, sold || 0);
    animateCount(raisedEl, raisedCents != null ? Math.round(raisedCents / 100) : (sold || 0) * (C.pricePerDuck || 0), euro);
  }

  function runCounter() {
    // Haal de echte stand op; val terug op config bij een statische deploy.
    fetch('/api/status').then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
      if (s && typeof s.sold === 'number') {
        if (totEl) totEl.textContent = Number(s.total).toLocaleString('nl-NL');
        applyCounter(s.sold, s.total, s.raised_cents);
      } else { applyCounter(C.ducksSold || 0, C.ducksTotal || 0, null); }
    }).catch(function () { applyCounter(C.ducksSold || 0, C.ducksTotal || 0, null); });
  }

  if (numEl || fill) {
    var counter = document.querySelector('.counter') || numEl;
    if ('IntersectionObserver' in window && counter) {
      var io = new IntersectionObserver(function (ents) {
        ents.forEach(function (e) { if (e.isIntersecting) { runCounter(); io.disconnect(); } });
      }, { threshold: 0.3 });
      io.observe(counter);
    } else { runCounter(); }
  }

  /* --- Countdown --- */
  var cd = document.querySelector('[data-countdown]');
  if (cd && C.eventDateISO) {
    var target = new Date(C.eventDateISO).getTime();
    var elD = cd.querySelector('[data-d]'), elH = cd.querySelector('[data-h]'),
        elM = cd.querySelector('[data-m]'), elS = cd.querySelector('[data-s]');
    function tick() {
      var diff = target - Date.now();
      if (diff < 0) diff = 0;
      var d = Math.floor(diff / 864e5), h = Math.floor(diff % 864e5 / 36e5),
          m = Math.floor(diff % 36e5 / 6e4), s = Math.floor(diff % 6e4 / 1e3);
      if (elD) elD.textContent = d;
      if (elH) elH.textContent = ('0' + h).slice(-2);
      if (elM) elM.textContent = ('0' + m).slice(-2);
      if (elS) elS.textContent = ('0' + s).slice(-2);
    }
    tick(); setInterval(tick, 1000);
  }

  /* --- Dynamische links / teksten --- */
  document.querySelectorAll('[data-sales-link]').forEach(function (a) {
    if (C.salesUrl) {
      a.href = C.salesUrl;
      if (/^https?:/i.test(C.salesUrl)) { a.target = '_blank'; a.rel = 'noopener'; }
    }
  });
  document.querySelectorAll('[data-price]').forEach(function (el) { el.textContent = euro(C.pricePerDuck); });
  document.querySelectorAll('[data-business-price]').forEach(function (el) { el.textContent = euro(C.businessDuckPrice); });
  document.querySelectorAll('[data-event-date]').forEach(function (el) { el.textContent = C.eventDateLabel || ''; });
  document.querySelectorAll('[data-event-location]').forEach(function (el) { el.textContent = C.eventLocation || ''; });
  document.querySelectorAll('[data-email]').forEach(function (a) {
    if (C.contactEmail) { a.href = 'mailto:' + C.contactEmail; a.textContent = a.dataset.email === 'text' ? C.contactEmail : a.textContent || C.contactEmail; }
  });
  document.querySelectorAll('[data-goal-net]').forEach(function (el) { el.textContent = euro(C.goalNet); });
  var year = document.querySelector('[data-year]'); if (year) year.textContent = new Date().getFullYear();

  /* --- Versienummer in de footer --- */
  (function () {
    if (!C.version) return;
    var label = 'v' + C.version;
    var explicit = document.querySelectorAll('[data-version]');
    if (explicit.length) { explicit.forEach(function (el) { el.textContent = label; }); return; }
    var fb = document.querySelector('.footer-bottom');
    if (!fb) return;
    var spans = fb.querySelectorAll('span');
    var host = spans.length ? spans[spans.length - 1] : fb;
    var v = document.createElement('span');
    v.className = 'footer-version';
    v.textContent = ' · ' + label;
    host.appendChild(v);
  })();

  function setSocial(sel, url) {
    document.querySelectorAll(sel).forEach(function (a) {
      if (url) { a.href = url; a.style.display = ''; } else { a.style.display = 'none'; }
    });
  }
  setSocial('[data-instagram]', C.instagram);
  setSocial('[data-facebook]', C.facebook);

  /* --- Contact-/aanmeldformulieren (Web3Forms of mailto-fallback) --- */
  document.querySelectorAll('form[data-mailform]').forEach(function (form) {
    var status = form.querySelector('.form-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = new FormData(form);
      function show(ok, msg) { if (!status) { alert(msg); return; } status.textContent = msg; status.className = 'form-status show ' + (ok ? 'ok' : 'err'); }
      if (C.formAccessKey) {
        data.append('access_key', C.formAccessKey);
        data.append('subject', 'Nijmegen Duckstad — ' + (form.dataset.mailform || 'formulier'));
        var btn = form.querySelector('[type=submit]');
        if (btn) { btn.disabled = true; btn.dataset.lbl = btn.textContent; btn.textContent = 'Versturen…'; }
        fetch('https://api.web3forms.com/submit', { method: 'POST', body: data })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (j.success) { form.reset(); show(true, 'Bedankt! Je bericht is verstuurd. We nemen snel contact op.'); } else { show(false, 'Er ging iets mis. Probeer het later opnieuw of mail ons direct.'); } })
          .catch(function () { show(false, 'Geen verbinding. Mail ons gerust direct via ' + (C.contactEmail || '')); })
          .finally(function () { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.lbl; } });
      } else {
        var lines = []; data.forEach(function (v, k) { if (v) lines.push(k + ': ' + v); });
        var subject = encodeURIComponent('Nijmegen Duckstad — ' + (form.dataset.mailform || 'formulier'));
        var body = encodeURIComponent(lines.join('\n'));
        window.location.href = 'mailto:' + (C.contactEmail || '') + '?subject=' + subject + '&body=' + body;
        show(true, 'Je e-mailprogramma opent met je bericht. Verstuur de mail om af te ronden.');
      }
    });
  });
})();
