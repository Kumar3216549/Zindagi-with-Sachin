// Zindagi with Sachin — posts written from the writing desk (Pages CMS).
// Posts live in content/posts/*.md. This file lists them on the Blog and
// Life Stories pages and renders a single post on post.html?p=<slug>.
(function () {
  var REPO = 'Kumar3216549/Zindagi-with-Sachin';
  var BRANCH = 'main';

  var CATS = {
    'zindagi-ke-sabak': { en: 'Zindagi ke Sabak', hi: 'ज़िंदगी के सबक', grad: 'grad-2', icon: '💡' },
    'mera-safar':       { en: 'My Journey',       hi: 'मेरा सफ़र',       grad: 'grad-1', icon: '📖' },
    'blog':             { en: 'Blog',             hi: 'ब्लॉग',            grad: 'grad-3', icon: '✍️' }
  };

  function lang() { return document.documentElement.getAttribute('lang') === 'hi' ? 'hi' : 'en'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function imgPath(p) { return p ? String(p).replace(/^\/+/, '') : ''; }
  // bilingual attribute helper — works with the EN | हिं toggle in main.js
  function bi(tag, en, hi, attrs) {
    hi = hi || en;
    var txt = lang() === 'hi' ? hi : en;
    return '<' + tag + (attrs ? ' ' + attrs : '') + ' data-en="' + esc(en) + '" data-hi="' + esc(hi) + '">' + esc(txt) + '</' + tag + '>';
  }
  function fmtDate(d) {
    if (!d) return '';
    var dt = new Date(d + 'T00:00:00');
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString(lang() === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ---------- front matter ----------
  // Small fallback parser for the simple "key: value" front matter the desk writes
  // (used only if the js-yaml library can't load).
  function miniYaml(src) {
    var out = {}, lines = src.split(/\r?\n/), i = 0;
    function unq(v) {
      v = v.trim();
      if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'")) {
        v = v.slice(1, -1);
        if (v.indexOf("''") > -1) v = v.replace(/''/g, "'");
      }
      if (v === 'true') return true;
      if (v === 'false') return false;
      return v;
    }
    while (i < lines.length) {
      var m = lines[i].match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      i++;
      if (!m) continue;
      var key = m[1], val = m[2];
      if (/^[>|][-+]?$/.test(val.trim())) {
        var fold = val.trim()[0] === '>', buf = [];
        while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i] === '')) { buf.push(lines[i].trim()); i++; }
        out[key] = fold ? buf.join(' ').replace(/\s+/g, ' ').trim() : buf.join('\n').trim();
      } else {
        out[key] = unq(val);
      }
    }
    return out;
  }
  function splitFrontMatter(raw) {
    var m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { meta: {}, body: raw };
    var meta = {};
    try { meta = (window.jsyaml ? window.jsyaml.load(m[1]) : miniYaml(m[1])) || {}; } catch (e) { meta = miniYaml(m[1]); }
    if (meta.date instanceof Date) meta.date = meta.date.toISOString().slice(0, 10);
    return { meta: meta, body: m[2] };
  }
  function toPost(slug, meta) {
    return {
      slug: slug, title: meta.title || slug, title_hi: meta.title_hi || '',
      category: meta.category || 'blog', date: meta.date ? String(meta.date) : '',
      cover: meta.cover || '', excerpt: meta.excerpt || '', excerpt_hi: meta.excerpt_hi || '',
      youtube: meta.youtube || '',
      draft: !!meta.draft
    };
  }

  // ---------- loading the list ----------
  function fetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
  }
  // Fallback when posts/index.json hasn't been rebuilt (e.g. GitHub Pages):
  // ask GitHub which files exist, cached for 10 minutes per visitor.
  function listFromGitHub() {
    var KEY = 'zws-posts-cache';
    try {
      var c = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (c && Date.now() - c.t < 600000) return Promise.resolve(c.posts);
    } catch (e) {}
    return fetch('https://api.github.com/repos/' + REPO + '/contents/content/posts?ref=' + BRANCH)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (files) {
        var md = files.filter(function (f) { return /\.md$/.test(f.name); });
        return Promise.all(md.map(function (f) {
          return fetchText('content/posts/' + f.name)
            .catch(function () { return fetchText(f.download_url); })
            .then(function (raw) { return toPost(f.name.replace(/\.md$/, ''), splitFrontMatter(raw).meta); })
            .catch(function () { return null; });
        }));
      })
      .then(function (posts) {
        posts = posts.filter(Boolean);
        try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), posts: posts })); } catch (e) {}
        return posts;
      });
  }
  function loadPosts() {
    return fetch('posts/index.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; })
      .then(function (list) {
        if (list && list.length) return list;
        return listFromGitHub().catch(function () { return []; });
      })
      .then(function (list) {
        return list.filter(function (p) { return !p.draft; })
          .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      });
  }

  // ---------- card ----------
  function card(p, headingTag) {
    var cat = CATS[p.category] || CATS.blog;
    var media = p.cover
      ? '<img src="' + esc(imgPath(p.cover)) + '" alt="' + esc(p.title) + '" loading="lazy">'
      : '<div class="card-media--gradient ' + cat.grad + '" role="img" aria-hidden="true">' + cat.icon + '</div>';
    var href = 'post.html?p=' + encodeURIComponent(p.slug);
    return '<div class="card post-card">' + media +
      '<div class="card-content">' +
        '<div class="post-meta">' + bi('span', cat.en, cat.hi, 'class="post-chip"') +
          (p.date ? '<span class="post-date">' + esc(fmtDate(p.date)) + '</span>' : '') + '</div>' +
        bi(headingTag || 'h3', p.title, p.title_hi) +
        (p.excerpt ? bi('p', p.excerpt, p.excerpt_hi) : '') +
        '<a class="btn" href="' + href + '" data-en="Read Full Story" data-hi="पूरी कहानी पढ़ें">' +
          (lang() === 'hi' ? 'पूरी कहानी पढ़ें' : 'Read Full Story') + '</a>' +
      '</div></div>';
  }
  function popIn(container) {
    var cards = container.querySelectorAll('.post-card');
    cards.forEach(function (c, i) {
      c.classList.add('post-enter');
      c.style.animationDelay = (i * 0.08) + 's';
    });
  }

  // ---------- Blog page ----------
  function renderBlog(posts) {
    var wrap = document.getElementById('blogPosts');
    if (!wrap) return;
    var grid = wrap.querySelector('.grid');
    var empty = document.getElementById('blogEmpty');
    var filter = wrap.querySelector('.story-filter');
    if (!posts.length) { wrap.hidden = true; if (empty) empty.hidden = false; return; }
    wrap.hidden = false; if (empty) empty.hidden = true;

    function draw(catKey) {
      var list = catKey === 'all' ? posts : posts.filter(function (p) { return p.category === catKey; });
      grid.innerHTML = list.map(function (p) { return card(p); }).join('') ||
        '<p class="center" style="grid-column:1/-1;color:var(--color-text-muted)" data-en="Nothing here yet." data-hi="यहाँ अभी कुछ नहीं है।">' +
        (lang() === 'hi' ? 'यहाँ अभी कुछ नहीं है।' : 'Nothing here yet.') + '</p>';
      popIn(grid);
      filter.querySelectorAll('button').forEach(function (b) {
        var on = b.getAttribute('data-filter') === catKey;
        b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    filter.querySelectorAll('button').forEach(function (b) {
      var k = b.getAttribute('data-filter');
      var n = k === 'all' ? posts.length : posts.filter(function (p) { return p.category === k; }).length;
      var badge = b.querySelector('.count'); if (badge) badge.textContent = n;
      b.addEventListener('click', function () { draw(k); });
    });
    draw('all');
  }

  // ---------- Life Stories page: add posts to their category ----------
  function renderLifeStories(posts) {
    var groups = document.querySelectorAll('.story-group[data-cat]');
    if (!groups.length) return;
    groups.forEach(function (g) {
      var mine = posts.filter(function (p) { return p.category === g.getAttribute('data-cat'); });
      if (!mine.length) return;
      var grid = g.querySelector('.grid');
      grid.insertAdjacentHTML('afterbegin', mine.map(function (p) { return card(p, 'h2'); }).join(''));
      popIn(grid);
    });
    // refresh the counts on the filter chips
    var filter = document.querySelector('.story-filter');
    if (filter) {
      filter.querySelectorAll('button').forEach(function (b) {
        var k = b.getAttribute('data-filter'), n = 0;
        groups.forEach(function (g) {
          if (k === 'all' || g.getAttribute('data-cat') === k) n += g.querySelectorAll('.card').length;
        });
        var badge = b.querySelector('.count'); if (badge) badge.textContent = n;
      });
    }
  }

  // YouTube link (watch, youtu.be, shorts or embed) -> embedded player
  function ytEmbed(link) {
    var m = String(link || '').match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
    if (!m) return '';
    return '<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0" title="YouTube video" loading="lazy" ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>';
  }

  // ---------- single post page ----------
  function renderPost() {
    var root = document.getElementById('postRoot');
    if (!root) return;
    var slug = new URLSearchParams(location.search).get('p') || '';
    if (!/^[\wऀ-ॿ.-]+$/.test(slug)) { showMissing(); return; }
    fetchText('content/posts/' + slug + '.md')
      .catch(function () { return fetchText('https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/content/posts/' + encodeURIComponent(slug) + '.md'); })
      .then(function (raw) {
        var fm = splitFrontMatter(raw);
        var p = toPost(slug, fm.meta);
        var cat = CATS[p.category] || CATS.blog;
        var src = fm.body || '';
        var bodyHtml = window.marked ? window.marked.parse(src)
          : (/^\s*</.test(src) ? src : src.split(/\n{2,}/).map(function (para) { return '<p>' + esc(para).replace(/\n/g, '<br>') + '</p>'; }).join(''));
        var titleEl = document.querySelector('title');
        if (titleEl) {
          titleEl.setAttribute('data-en', esc(p.title) + ' | Zindagi with Sachin');
          titleEl.setAttribute('data-hi', esc(p.title_hi || p.title) + ' | ज़िंदगी विद सचिन');
        }
        document.title = (lang() === 'hi' && p.title_hi ? p.title_hi : p.title) + ' | Zindagi with Sachin';
        root.querySelector('.post-head').innerHTML =
          '<a class="back-link" href="' + (p.category === 'blog' ? 'blog.html' : 'life-stories.html#' + p.category) + '">' +
            bi('span', '← Back to ' + cat.en, '← ' + cat.hi + ' पर वापस जाएं') + '</a>' +
          bi('span', cat.en, cat.hi, 'class="eyebrow"') +
          bi('h1', p.title, p.title_hi) +
          (p.date ? '<p class="post-date" style="margin-bottom:24px">' + esc(fmtDate(p.date)) + '</p>' : '') +
          (p.cover && !p.youtube ? '<img class="story-hero-img" src="' + esc(imgPath(p.cover)) + '" alt="' + esc(p.title) + '">' : '') +
          ytEmbed(p.youtube);
        var body = root.querySelector('.story-body');
        body.innerHTML = bodyHtml;
        body.querySelectorAll('img').forEach(function (img) {
          var s = img.getAttribute('src'); if (s && s.charAt(0) === '/') img.setAttribute('src', imgPath(s));
          img.setAttribute('loading', 'lazy');
        });
        root.classList.add('post-enter');
      })
      .catch(showMissing);

    function showMissing() {
      root.querySelector('.post-head').innerHTML =
        bi('h1', 'Story not found', 'कहानी नहीं मिली') +
        bi('p', 'This story may have been moved or is still being published. Please check again in a minute.',
               'यह कहानी हटाई गई हो सकती है या अभी प्रकाशित हो रही है। एक मिनट बाद फिर देखें।') +
        '<a class="btn" href="blog.html" data-en="Go to the Blog" data-hi="ब्लॉग पर जाएं">' + (lang() === 'hi' ? 'ब्लॉग पर जाएं' : 'Go to the Blog') + '</a>';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderPost();
    if (document.getElementById('blogPosts') || document.querySelector('.story-group[data-cat]')) {
      loadPosts().then(function (posts) { renderBlog(posts); renderLifeStories(posts); });
    }
  });
})();
