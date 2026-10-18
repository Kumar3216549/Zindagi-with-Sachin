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

// ---- Motion & interaction ----
document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', function () {
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scroll reveal: section heads, cards, about blocks, story paragraphs
  var revealEls = document.querySelectorAll('.section-head, .card, .about-block, .story-body > *, .tag, .story-hero-img');
  revealEls.forEach(function (el) {
    el.classList.add('reveal');
    // stagger cards that sit in the same grid
    var parent = el.parentElement;
    if (parent && parent.classList.contains('grid')) {
      var idx = Array.prototype.indexOf.call(parent.children, el);
      el.style.setProperty('--reveal-delay', (idx * 0.12) + 's');
    }
  });
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  // Life Stories: category filter
  var filter = document.querySelector('.story-filter');
  if (filter) {
    var groups = document.querySelectorAll('.story-group');
    var buttons = filter.querySelectorAll('button');
    // story counts
    buttons.forEach(function (btn) {
      var cat = btn.getAttribute('data-filter');
      var n = 0;
      groups.forEach(function (g) {
        if (cat === 'all' || g.getAttribute('data-cat') === cat) { n += g.querySelectorAll('.card').length; }
      });
      var badge = btn.querySelector('.count');
      if (badge) { badge.textContent = n; }
    });
    function show(cat, push) {
      buttons.forEach(function (b) {
        var on = b.getAttribute('data-filter') === cat;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      groups.forEach(function (g) {
        var visible = cat === 'all' || g.getAttribute('data-cat') === cat;
        g.classList.toggle('is-hidden', !visible);
        if (visible) {
          g.classList.add('is-entering');
          g.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-visible'); });
          requestAnimationFrame(function () { requestAnimationFrame(function () { g.classList.remove('is-entering'); }); });
        }
      });
      if (push && history.replaceState) {
        history.replaceState(null, '', cat === 'all' ? location.pathname : '#' + cat);
      }
    }
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () { show(btn.getAttribute('data-filter'), true); });
    });
    var hash = location.hash.replace('#', '');
    var known = Array.prototype.some.call(buttons, function (b) { return b.getAttribute('data-filter') === hash; });
    show(known ? hash : 'all', false);
  }

  // Story pages: reading progress bar
  var storyBody = document.querySelector('.story-body');
  var bar = null;
  if (storyBody) {
    bar = document.createElement('div');
    bar.className = 'read-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
  }

  // Back-to-top button
  var topBtn = document.createElement('button');
  topBtn.className = 'to-top';
  topBtn.type = 'button';
  topBtn.setAttribute('aria-label', 'Back to top');
  topBtn.innerHTML = '&uarr;';
  document.body.appendChild(topBtn);
  topBtn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    topBtn.classList.toggle('show', y > 500);
    if (bar) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + '%';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});

// ---- Writer's desk link in the footer ----
document.addEventListener('DOMContentLoaded', function () {
  var footer = document.querySelector('.site-footer');
  if (!footer || footer.querySelector('.footer-write')) return;
  var a = document.createElement('a');
  a.className = 'footer-write';
  a.href = 'write.html';
  a.setAttribute('data-en', '✍️ Writer’s desk');
  a.setAttribute('data-hi', '✍️ लेखन डेस्क');
  a.textContent = document.documentElement.getAttribute('lang') === 'hi' ? '✍️ लेखन डेस्क' : '✍️ Writer’s desk';
  footer.appendChild(a);
});

// ---- Audiobooks link in the menu and footer (added once here, so every page gets it) ----
document.addEventListener('DOMContentLoaded', function () {
  var hi = document.documentElement.getAttribute('lang') === 'hi';
  var here = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links, .footer-links').forEach(function (box) {
    if (box.querySelector('a[href="audiobooks.html"]')) return;
    var blog = box.querySelector('a[href="blog.html"]');
    var a = document.createElement('a');
    a.href = 'audiobooks.html';
    a.setAttribute('data-en', '🎧 Audiobooks');
    a.setAttribute('data-hi', '🎧 ऑडियोबुक');
    a.textContent = hi ? '🎧 ऑडियोबुक' : '🎧 Audiobooks';
    if (box.classList.contains('nav-links') && (here === 'audiobooks.html' || here === 'audiobook.html')) {
      a.classList.add('active'); a.setAttribute('aria-current', 'page');
    }
    if (blog && blog.nextSibling) box.insertBefore(a, blog.nextSibling); else box.appendChild(a);
  });
});
