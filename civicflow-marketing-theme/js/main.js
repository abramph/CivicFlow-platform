/**
 * Unestra Theme — main.js
 */
(function () {
  'use strict';

  /* Mobile nav toggle */
  var toggle = document.getElementById('nav-toggle');
  var menu   = document.getElementById('primary-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* Smooth scroll */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = this.getAttribute('href').slice(1);
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      var hdr = document.getElementById('site-header');
      var offset = hdr ? hdr.offsetHeight + 8 : 76;
      var top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: top, behavior: 'smooth' });
    });
  });

  /* Contact form AJAX */
  var form    = document.getElementById('civicflow-contact-form');
  var success = document.getElementById('cf-success');
  var errorEl = document.getElementById('cf-error');

  if (form && typeof civicflowData !== 'undefined') {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var submit = form.querySelector('.cf-submit');
      var name   = (form.querySelector('#cf-name').value || '').trim();
      var email  = (form.querySelector('#cf-email').value || '').trim();

      if (!name || !email) { showError('Please enter your name and email address.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Please enter a valid email address.'); return; }

      hideError();
      submit.disabled = true;
      submit.textContent = 'Sending\u2026';

      var data = new FormData(form);
      data.append('action', 'civicflow_contact');
      data.append('nonce',  civicflowData.nonce);

      fetch(civicflowData.ajaxUrl, { method: 'POST', body: data })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r.success) {
            form.reset();
            form.style.display    = 'none';
            success.style.display = 'block';
          } else {
            showError((r.data && r.data.message) ? r.data.message : 'Something went wrong.');
            submit.disabled = false;
            submit.textContent = 'Send message';
          }
        })
        .catch(function () {
          showError('Network error. Please email us directly at support@getunestra.com');
          submit.disabled = false;
          submit.textContent = 'Send message';
        });
    });
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.querySelector('p').textContent = msg;
    errorEl.style.display = 'block';
  }
  function hideError() {
    if (errorEl) errorEl.style.display = 'none';
  }
})();
