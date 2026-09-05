// Zindagi with Sachin — shared site script
// Handles the mobile nav toggle and highlights the current page's nav link.

document.addEventListener('DOMContentLoaded', function () {
  var toggleBtn = document.getElementById('menuToggle');
  var navLinks = document.getElementById('navLinks');

  if (toggleBtn && navLinks) {
    toggleBtn.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('show');
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // Mark the current page's nav link as active
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  var links = document.querySelectorAll('.nav-links a');
  links.forEach(function (link) {
    var href = link.getAttribute('href');
    if (href === currentPage) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });

  // ---- English / Hindi language toggle ----
  var LANG_KEY = 'zws-lang';
  var langToggleBtn = document.getElementById('langToggle');
  var htmlEl = document.documentElement;

  function applyLanguage(lang) {
    lang = (lang === 'hi') ? 'hi' : 'en';
    htmlEl.setAttribute('lang', lang);

    document.querySelectorAll('[data-en]').forEach(function (el) {
      var value = (lang === 'hi') ? el.getAttribute('data-hi') : el.getAttribute('data-en');
      if (value !== null) { el.innerHTML = value; }
    });

    if (langToggleBtn) {
      langToggleBtn.textContent = (lang === 'hi') ? 'हिं | EN' : 'EN | हिं';
      langToggleBtn.setAttribute(
        'aria-label',
        (lang === 'hi') ? 'Switch to English / अंग्रेज़ी में बदलें' : 'Switch to Hindi / हिंदी में बदलें'
      );
    }

    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* storage unavailable — ignore */ }
  }

  if (langToggleBtn) {
    var savedLang = 'en';
    try { savedLang = localStorage.getItem(LANG_KEY) || 'en'; } catch (e) { /* storage unavailable — ignore */ }
    applyLanguage(savedLang);

    langToggleBtn.addEventListener('click', function () {
      var current = htmlEl.getAttribute('lang') === 'hi' ? 'hi' : 'en';
      applyLanguage(current === 'hi' ? 'en' : 'hi');
    });
  }
});
