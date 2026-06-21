/* ===== Nijmegen Duckstad — interacties ===== */
(function () {
  var C = window.DUCKSTAD || {};
  var euro = function (n) { return '€' + Number(n).toLocaleString('nl-NL'); };

  /* --- Cookieloze, privacy-vriendelijke pageview-telling (first-party, geen PII) --- */
  (function () {
    try {
      var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
      var ref = '';
      if (document.referrer) { try { var h = new URL(document.referrer).hostname; if (h && h !== location.hostname) ref = h; } catch (e) {} }
      var body = JSON.stringify({ path: path, ref: ref });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      else fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true });
    } catch (e) {}
  })();

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

  /* --- Easter egg: 2x op het logo (linksboven) klikken -> alle eendjes maken een koprol --- */
  (function () {
    var logo = document.querySelector('.nav__logo');
    if (!logo) return;
    var wrapped = false;
    // Wikkel elke losse 🦆-emoji eenmalig in een <span> zodat we 'm los kunnen animeren.
    function wrapDucks() {
      if (wrapped) return; wrapped = true;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue || n.nodeValue.indexOf('🦆') === -1) return NodeFilter.FILTER_REJECT;
          var p = n.parentNode, t = p && p.nodeName;
          if (!p || t === 'SCRIPT' || t === 'STYLE' || (p.classList && p.classList.contains('egg-duck'))) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (n) {
        var parts = n.nodeValue.split('🦆'), frag = document.createDocumentFragment();
        parts.forEach(function (part, i) {
          if (part) frag.appendChild(document.createTextNode(part));
          if (i < parts.length - 1) {
            var s = document.createElement('span'); s.className = 'egg-duck'; s.textContent = '🦆';
            frag.appendChild(s);
          }
        });
        n.parentNode.replaceChild(frag, n);
      });
    }
    function koprol() {
      wrapDucks();
      var els = [];
      var limg = logo.querySelector('img'); if (limg) els.push(limg); // het eendje in het logo
      Array.prototype.forEach.call(document.querySelectorAll('.bigduck, .footer-duck, .egg-duck'), function (e) { els.push(e); });
      els.forEach(function (el, i) {
        el.classList.remove('koprol-go');
        el.getBoundingClientRect();              // forceer reflow -> animatie herstart
        el.style.animationDelay = (i % 14) * 55 + 'ms';
        el.classList.add('koprol-go');
      });
    }
    document.addEventListener('animationend', function (e) {
      if (e.target.classList && e.target.classList.contains('koprol-go')) {
        e.target.classList.remove('koprol-go');
        e.target.style.animationDelay = '';
      }
    });
    // Dubbelklik detecteren zonder dat de eerste klik al naar home navigeert.
    var timer = null;
    logo.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // modifier-clicks ongemoeid
      e.preventDefault();
      if (timer) { clearTimeout(timer); timer = null; koprol(); }
      else { timer = setTimeout(function () { timer = null; window.location.href = logo.getAttribute('href') || 'index.html'; }, 280); }
    });
  })();

  /* --- Easter egg 2: 2x op de grote eend klikken -> "Kwaak!" met geluid + animatie --- */
  (function () {
    var duck = document.querySelector('.bigduck');
    if (!duck) return;
    var audioCtx = null;
    // Eendenkwaak synthetiseren met formant-filtering (nasale "aa"-klank), een pitch-contour
    // die kort omhoog en dan omlaag gaat ("kwAAk"), 2 ontstemde zaagtanden + ruisaanzet ("k").
    function quackSound() {
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        var ctx = audioCtx, t = ctx.currentTime, dur = 0.33;

        // Eindtrap + amplitude-envelope (snelle attack, korte decay)
        var env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(0.8, t + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        var out = ctx.createGain(); out.gain.value = 0.5;
        env.connect(out); out.connect(ctx.destination);

        // Bron: 2 licht ontstemde zaagtanden met pitch-contour (omhoog -> omlaag)
        function tone(detune) {
          var o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = detune;
          o.frequency.setValueAtTime(320, t);
          o.frequency.linearRampToValueAtTime(720, t + 0.05);
          o.frequency.exponentialRampToValueAtTime(400, t + 0.16);
          o.frequency.exponentialRampToValueAtTime(240, t + dur);
          return o;
        }
        var o1 = tone(0), o2 = tone(-22);
        var src = ctx.createGain(); src.gain.value = 0.45;
        o1.connect(src); o2.connect(src);

        // Formanten -> nasale eend-vokaal (3 parallelle bandpass-filters)
        function formant(freq, q, g) {
          var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
          var fg = ctx.createGain(); fg.gain.value = g;
          src.connect(f); f.connect(fg); fg.connect(env);
        }
        formant(560, 8, 1.0);
        formant(1100, 9, 0.6);
        formant(2500, 11, 0.3);

        // Roughness: snelle tremolo op de envelope
        var lfo = ctx.createOscillator(); lfo.frequency.value = 33;
        var lfoG = ctx.createGain(); lfoG.gain.value = 0.16;
        lfo.connect(lfoG); lfoG.connect(env.gain);

        // Korte "k"-aanzet (gefilterde ruisburst)
        var nb = ctx.createBufferSource();
        var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
        var chd = buf.getChannelData(0);
        for (var i = 0; i < chd.length; i++) chd[i] = Math.random() * 2 - 1;
        nb.buffer = buf;
        var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1400;
        var ng = ctx.createGain();
        ng.gain.setValueAtTime(0.22, t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        nb.connect(nf); nf.connect(ng); ng.connect(out);

        var stop = t + dur + 0.03;
        o1.start(t); o2.start(t); lfo.start(t); nb.start(t);
        o1.stop(stop); o2.stop(stop); lfo.stop(stop); nb.stop(t + 0.06);
      } catch (e) {}
    }
    function showBubble() {
      var parent = duck.parentNode || duck;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      var b = parent.querySelector('.quack-bubble');
      if (!b) { b = document.createElement('div'); b.className = 'quack-bubble'; b.textContent = 'Kwaak!'; parent.appendChild(b); }
      b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    }
    // Speel de echte eendenopname (kwaak.mp3, CC0/rechtenvrij — BigSoundBank #0276);
    // val terug op de gesynthetiseerde kwaak als het bestand niet laadt of mag afspelen.
    var snd = null, sndBroken = false;
    function playQuack() {
      if (sndBroken) { quackSound(); return; }
      try {
        if (!snd) { snd = new Audio('assets/audio/kwaak.mp3?v=2'); snd.addEventListener('error', function () { sndBroken = true; }); }
        snd.currentTime = 0;
        var p = snd.play();
        if (p && p.catch) p.catch(function () { quackSound(); });
      } catch (e) { quackSound(); }
    }
    function quack() {
      playQuack();
      showBubble();
      duck.classList.remove('quack-go'); duck.getBoundingClientRect(); duck.classList.add('quack-go');
    }
    document.addEventListener('animationend', function (e) {
      if (!e.target.classList) return;
      if (e.target.classList.contains('quack-go')) e.target.classList.remove('quack-go');
      if (e.target.classList.contains('quack-bubble')) e.target.classList.remove('show');
    });
    duck.addEventListener('dblclick', function (e) { e.preventDefault(); quack(); });
  })();
})();
