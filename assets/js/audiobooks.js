// Zindagi with Sachin — Audiobooks: list page (audiobooks.html) and player (audiobook.html?b=<slug>).
// Audiobooks are written in the Writer's Desk (Pages CMS) into content/audiobooks/*.md.
(function () {
  var REPO = 'Kumar3216549/Zindagi-with-Sachin';
  var BRANCH = 'main';
  // Main categories (same list as in .pages.yml) — general-reading books, not academic textbooks.
  // Subcategories are free text typed in the Writer's Desk.
  var CATS = {
    'science': { en: 'Science', hi: 'विज्ञान', icon: '🔬' },
    'commerce-finance': { en: 'Commerce & Finance', hi: 'वाणिज्य और वित्त', icon: '💰' },
    'humanities': { en: 'Humanities', hi: 'मानविकी', icon: '📜' },
    'zindagi-ke-sabak': { en: 'Zindagi ke Sabak', hi: 'ज़िंदगी के सबक', icon: '🌱' },
    'mera-safar': { en: 'My Journey', hi: 'मेरा सफ़र', icon: '🧭' },
    'kahani': { en: 'Stories', hi: 'कहानियाँ', icon: '📖' },
    'anya-sroton-ke-chuninda-gyan': { en: 'Selected Wisdom from Other Sources', hi: 'अन्य स्रोतों के चुनिंदा ज्ञान', icon: '💡' }
  };
  var LANGS = { hindi: { en: 'Hindi', hi: 'हिंदी' }, english: { en: 'English', hi: 'अंग्रेज़ी' } };

  function lang() { return document.documentElement.getAttribute('lang') === 'hi' ? 'hi' : 'en'; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function bi(tag, en, hi, attrs) {
    hi = hi || en;
    return '<' + tag + (attrs ? ' ' + attrs : '') + ' data-en="' + esc(en) + '" data-hi="' + esc(hi) + '">' + esc(lang() === 'hi' ? hi : en) + '</' + tag + '>';
  }
  function T(en, hi) { return lang() === 'hi' ? hi : en; }
  function clean(p) { return p ? String(p).trim().replace(/^\/+/, '') : ''; }
  // Google Drive share links -> direct audio link
  function audioSrc(p) {
    p = clean(p);
    var m = p.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/);
    if (m) return 'https://drive.google.com/uc?export=download&id=' + m[1];
    var d = p.match(/^(https?:\/\/www\.dropbox\.com\/.*?)(\?|$)/);
    if (d) return d[1] + '?raw=1';
    return p;
  }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }

  /* ---------- tiny YAML reader (same as scripts/yaml-lite.js) ---------- */
function yamlLite(src) {
  var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  var i = 0;
  function indentOf(s) { return s.match(/^ */)[0].length; }
  function blank(s) { return /^\s*(#.*)?$/.test(s); }
  function scalar(v) {
    v = v.trim();
    if (v === '' || v === '~' || v === 'null') return '';
    var q = v[0];
    if ((q === '"' || q === "'") && v[v.length - 1] === q) {
      var inner = v.slice(1, -1);
      if (q === "'") return inner.replace(/''/g, "'");
      try { return JSON.parse('"' + inner.replace(/\\'/g, "'") + '"'); } catch (e) { return inner; }
    }
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v.replace(/\s+#.*$/, '');
  }
  function block(style, minIndent) {
    var buf = [];
    while (i < lines.length && (blank(lines[i]) || indentOf(lines[i]) >= minIndent)) { buf.push(lines[i].slice(Math.min(minIndent, indentOf(lines[i])))); i++; }
    while (buf.length && buf[buf.length - 1].trim() === '') buf.pop();
    return style === '>' ? buf.join(' ').replace(/\s+/g, ' ').trim() : buf.join('\n');
  }
  // parse a mapping whose keys sit at exactly `ind` spaces
  function mapping(ind) {
    var out = {};
    while (i < lines.length) {
      var line = lines[i];
      if (blank(line)) { i++; continue; }
      var cur = indentOf(line);
      if (cur < ind) break;
      var m = line.slice(cur).match(/^([A-Za-z0-9_\-]+):(?:\s+(.*)|\s*)$/);
      if (cur !== ind || !m) break;
      i++;
      var key = m[1], rest = m[2] === undefined ? '' : m[2];
      if (/^[>|][-+]?\s*$/.test(rest)) { out[key] = block(rest.trim()[0], ind + 1); continue; }
      if (rest.trim() !== '') { out[key] = scalar(rest); continue; }
      // nested list or mapping
      var j = i; while (j < lines.length && blank(lines[j])) j++;
      if (j < lines.length && /^\s*- /.test(lines[j]) && indentOf(lines[j]) >= ind) { i = j; out[key] = list(indentOf(lines[j])); }
      else if (j < lines.length && indentOf(lines[j]) > ind) { i = j; out[key] = mapping(indentOf(lines[j])); }
      else out[key] = '';
    }
    return out;
  }
  function list(ind) {
    var arr = [];
    while (i < lines.length) {
      var line = lines[i];
      if (blank(line)) { i++; continue; }
      if (indentOf(line) !== ind || !/^\s*-(\s|$)/.test(line)) break;
      var after = line.slice(ind + 1);
      var sp = after.match(/^ */)[0].length;
      var body = after.slice(sp);
      if (/^[A-Za-z0-9_\-]+:(\s|$)/.test(body)) {
        // object item: rewrite the dash as spaces and read it as a mapping
        lines[i] = ' '.repeat(ind + 1 + sp) + body;
        arr.push(mapping(ind + 1 + sp));
      } else { i++; arr.push(scalar(body)); }
    }
    return arr;
  }
  return mapping(0);
}

  function toBook(slug, meta) {
    var ch = (Array.isArray(meta.chapters) ? meta.chapters : []).map(function (c) {
      c = c || {}; return { title: c.title || '', title_hi: c.title_hi || '', src: clean(c.audio_url || c.audio || '') };
    }).filter(function (c) { return c.src; });
    return {
      slug: slug, title: meta.title || slug, title_hi: meta.title_hi || '', author: meta.author || '', narrator: meta.narrator || '',
      language: meta.language || '', category: meta.category || '',
      subcategory: meta.subcategory ? String(meta.subcategory).trim() : '', subcategory_hi: meta.subcategory_hi ? String(meta.subcategory_hi).trim() : '', cover: clean(meta.cover), date: meta.date ? String(meta.date) : '',
      description: meta.description || '', description_hi: meta.description_hi || '', youtube: meta.youtube || '', chapters: ch, draft: !!meta.draft
    };
  }
  function fetchText(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }); }
  function parseFile(slug, raw) {
    var m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return toBook(slug, m ? yamlLite(m[1]) : {});
  }
  // Fallback when audiobooks/index.json wasn't rebuilt (e.g. GitHub Pages): ask GitHub which files exist.
  function listFromGitHub() {
    var KEY = 'zws-audiobooks-cache';
    try { var c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.t < 600000) return Promise.resolve(c.books); } catch (e) {}
    return fetch('https://api.github.com/repos/' + REPO + '/contents/content/audiobooks?ref=' + BRANCH)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (files) {
        return Promise.all(files.filter(function (f) { return /\.md$/.test(f.name); }).map(function (f) {
          return fetchText('content/audiobooks/' + f.name).catch(function () { return fetchText(f.download_url); })
            .then(function (raw) { return parseFile(f.name.replace(/\.md$/, ''), raw); }).catch(function () { return null; });
        }));
      })
      .then(function (books) {
        books = books.filter(Boolean);
        try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), books: books })); } catch (e) {}
        return books;
      });
  }
  function loadBooks() {
    return fetch('audiobooks/index.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
      .then(function (list) { return list && list.length ? list : listFromGitHub().catch(function () { return []; }); })
      .then(function (list) {
        return list.filter(function (b) { return !b.draft && b.chapters && b.chapters.length; })
          .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      });
  }

  /* ---------- list page ---------- */
  function cover(b, cls) {
    return b.cover
      ? '<img class="' + cls + '" src="' + esc(b.cover) + '" alt="' + esc(b.title) + '" loading="lazy">'
      : '<div class="' + cls + ' ab-cover-blank" aria-hidden="true">🎧</div>';
  }
  function renderList(books) {
    var grid = document.getElementById('abGrid');
    if (!grid) return;
    var empty = document.getElementById('abEmpty');
    var listen = Number(localStorage.getItem('zws-ab-last-t') || 0);
    if (!books.length) { grid.innerHTML = ''; if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    renderFilters(books);
    var hiName = {};
    books.forEach(function (b) { if (b.subcategory_hi) hiName[subKey(b)] = b.subcategory_hi; });
    var view = books.filter(function (b) {
      return (!state.cat || b.category === state.cat) && (!state.sub || subKey(b) === state.sub);
    });
    grid.innerHTML = view.map(function (b, i) {
      var cat = CATS[b.category], lg = LANGS[b.language];
      var saved = null; try { saved = JSON.parse(localStorage.getItem('zws-ab-' + b.slug) || 'null'); } catch (e) {}
      return '<a class="ab-card post-enter" style="animation-delay:' + (i * 0.07) + 's" href="audiobook.html?b=' + encodeURIComponent(b.slug) + '">' +
        '<div class="ab-card-cover">' + cover(b, 'ab-card-img') + '<span class="ab-play" aria-hidden="true">▶</span></div>' +
        '<div class="ab-card-body">' +
          '<div class="post-meta">' + (cat ? bi('span', cat.en, cat.hi, 'class="post-chip"') : '') + (b.subcategory ? bi('span', b.subcategory, b.subcategory_hi || hiName[subKey(b)], 'class="post-chip ab-sub-chip"') : '') + (lg ? bi('span', lg.en, lg.hi, 'class="post-date"') : '') + '</div>' +
          bi('h3', b.title, b.title_hi) +
          (b.author ? '<p class="ab-by">' + bi('span', 'by ', '') + esc(b.author) + '</p>' : '') +
          '<p class="ab-count">' + bi('span', b.chapters.length + (b.chapters.length === 1 ? ' part' : ' chapters'), b.chapters.length + (b.chapters.length === 1 ? ' भाग' : ' अध्याय')) +
          (saved && saved.c != null ? ' · ' + bi('span', 'Continue from chapter ' + (saved.c + 1), 'अध्याय ' + (saved.c + 1) + ' से जारी रखें', 'class="ab-continue"') : '') + '</p>' +
        '</div></a>';
    }).join('') || bi('p', 'No audiobooks here yet — coming soon.', 'यहाँ अभी कोई ऑडियोबुक नहीं है — जल्द आ रही है।', 'class="center ab-none"');
  }

  /* ---------- category + subcategory filter ---------- */
  var state = { cat: '', sub: '' };
  var allBooks = [];
  function subKey(b) { return String(b.subcategory || '').toLowerCase().replace(/\s+/g, '-'); }
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    state.cat = p.get('cat') || ''; state.sub = p.get('sub') || '';
  }
  function writeHash() {
    var p = [];
    if (state.cat) p.push('cat=' + encodeURIComponent(state.cat));
    if (state.sub) p.push('sub=' + encodeURIComponent(state.sub));
    history.replaceState(null, '', location.pathname + location.search + (p.length ? '#' + p.join('&') : ''));
  }
  function chip(key, en, hi, n, on, attr) {
    return '<button type="button" ' + attr + '="' + esc(key) + '" class="' + (on ? 'active' : '') + '" aria-pressed="' + on + '">' +
      bi('span', en, hi) + '<span class="count">' + n + '</span></button>';
  }
  function renderFilters(books) {
    var top = document.getElementById('abFilter'), subBox = document.getElementById('abSubFilter');
    if (!top) return;
    // count books per category; every main category is always shown
    var counts = {};
    books.forEach(function (b) { counts[b.category] = (counts[b.category] || 0) + 1; });
    if (state.cat && !CATS[state.cat] && !counts[state.cat]) state.cat = '';
    var keys = Object.keys(CATS);
    top.innerHTML = chip('', 'All', 'सभी', books.length, !state.cat, 'data-cat') +
      keys.map(function (k) { var c = CATS[k]; return chip(k, (c.icon ? c.icon + ' ' : '') + c.en, (c.icon ? c.icon + ' ' : '') + c.hi, counts[k] || 0, state.cat === k, 'data-cat'); }).join('');
    top.hidden = false;
    // subcategories found in the chosen category (built automatically from what was typed in the Writer's Desk)
    var subs = {}, order = [];
    books.forEach(function (b) {
      if (!b.subcategory || (state.cat && b.category !== state.cat)) return;
      var k = subKey(b);
      var nice = b.subcategory.charAt(0).toUpperCase() + b.subcategory.slice(1);
      if (!subs[k]) { subs[k] = { en: nice, hi: b.subcategory_hi || nice, n: 0 }; order.push(k); }
      subs[k].n++;
      if (b.subcategory_hi && subs[k].hi === subs[k].en) subs[k].hi = b.subcategory_hi;
    });
    if (state.sub && !subs[state.sub]) state.sub = '';
    order.sort(function (a, b) { return subs[a].en.localeCompare(subs[b].en); });
    if (subBox) {
      if (order.length) {
        var total = order.reduce(function (s, k) { return s + subs[k].n; }, 0);
        subBox.innerHTML = chip('', 'All topics', 'सभी विषय', total, !state.sub, 'data-sub') +
          order.map(function (k) { return chip(k, subs[k].en, subs[k].hi, subs[k].n, state.sub === k, 'data-sub'); }).join('');
        subBox.hidden = false;
      } else { subBox.innerHTML = ''; subBox.hidden = true; }
    }
  }
  function bindFilters() {
    var top = document.getElementById('abFilter'), subBox = document.getElementById('abSubFilter');
    if (!top) return;
    top.addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      state.cat = btn.getAttribute('data-cat') || ''; state.sub = '';
      writeHash(); renderList(allBooks);
    });
    if (subBox) subBox.addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      state.sub = btn.getAttribute('data-sub') || '';
      writeHash(); renderList(allBooks);
    });
  }

  /* ---------- player page ---------- */
  function renderPlayer() {
    var root = document.getElementById('abPlayer');
    if (!root) return;
    var slug = new URLSearchParams(location.search).get('b') || '';
    if (!/^[\wऀ-ॿ.-]+$/.test(slug)) return missing();
    fetch('audiobooks/index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
      .then(function (list) {
        var hit = (list || []).filter(function (b) { return b.slug === slug; })[0];
        if (hit) return hit;
        return fetchText('content/audiobooks/' + slug + '.md')
          .catch(function () { return fetchText('https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/content/audiobooks/' + encodeURIComponent(slug) + '.md'); })
          .then(function (raw) { return parseFile(slug, raw); });
      })
      .then(function (b) { if (!b || !b.chapters.length) return missing(); build(b); })
      .catch(missing);

    function missing() {
      root.innerHTML = bi('h1', 'Audiobook not found', 'ऑडियोबुक नहीं मिली') +
        bi('p', 'It may still be publishing. Please check again in a minute.', 'यह अभी प्रकाशित हो रही होगी। एक मिनट बाद फिर देखें।') +
        '<a class="btn" href="audiobooks.html" data-en="All audiobooks" data-hi="सभी ऑडियोबुक">' + T('All audiobooks', 'सभी ऑडियोबुक') + '</a>';
    }

    function build(b) {
      var KEY = 'zws-ab-' + b.slug;
      var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
      var cur = Math.min(Math.max(0, saved.c || 0), b.chapters.length - 1);
      var titleEl = document.querySelector('title');
      if (titleEl) { titleEl.setAttribute('data-en', b.title + ' | Audiobook'); titleEl.setAttribute('data-hi', (b.title_hi || b.title) + ' | ऑडियोबुक'); }
      document.title = (lang() === 'hi' && b.title_hi ? b.title_hi : b.title) + ' | ' + T('Audiobook', 'ऑडियोबुक');
      var cat = CATS[b.category];

      root.innerHTML =
        '<a class="back-link" href="audiobooks.html" data-en="← All audiobooks" data-hi="← सभी ऑडियोबुक">' + T('← All audiobooks', '← सभी ऑडियोबुक') + '</a>' +
        '<div class="ab-hero post-enter">' +
          '<div class="ab-hero-cover">' + cover(b, 'ab-hero-img') + '</div>' +
          '<div class="ab-hero-info">' +
            (cat ? bi('span', cat.en + (b.subcategory ? ' · ' + b.subcategory : ''), cat.hi + (b.subcategory ? ' · ' + (b.subcategory_hi || b.subcategory) : ''), 'class="eyebrow"') : bi('span', 'Audiobook', 'ऑडियोबुक', 'class="eyebrow"')) +
            bi('h1', b.title, b.title_hi) +
            (b.author ? '<p class="ab-by">' + bi('span', 'Written by ', 'लेखक: ') + esc(b.author) + (b.narrator && b.narrator !== b.author ? ' · ' + bi('span', 'Voice: ', 'आवाज़: ') + esc(b.narrator) : '') + '</p>' : '') +
            (b.description ? bi('p', b.description, b.description_hi, 'class="ab-desc"') : '') +
            (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(b.youtube || '') ? '<a class="ab-yt" href="' + esc(b.youtube) + '" target="_blank" rel="noopener">' + bi('span', '▶ Also on YouTube', '▶ यूट्यूब पर भी देखें') + '</a>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ab-player" role="region" aria-label="Audio player">' +
          '<p class="ab-now"><span class="ab-now-label" data-en="Now playing" data-hi="अभी चल रहा है">' + T('Now playing', 'अभी चल रहा है') + '</span> <b id="abNowTitle"></b></p>' +
          '<input type="range" id="abSeek" class="ab-seek" min="0" max="1000" value="0" aria-label="Seek">' +
          '<div class="ab-times"><span id="abCurT">0:00</span><span id="abDurT">0:00</span></div>' +
          '<div class="ab-controls">' +
            '<button type="button" id="abPrev" class="ab-btn" aria-label="Previous chapter">⏮</button>' +
            '<button type="button" id="abBack" class="ab-btn" aria-label="Back 15 seconds">↺15</button>' +
            '<button type="button" id="abPlay" class="ab-btn ab-btn-main" aria-label="Play">▶</button>' +
            '<button type="button" id="abFwd" class="ab-btn" aria-label="Forward 30 seconds">30↻</button>' +
            '<button type="button" id="abNext" class="ab-btn" aria-label="Next chapter">⏭</button>' +
          '</div>' +
          '<div class="ab-extra">' +
            '<label><span data-en="Speed" data-hi="गति">' + T('Speed', 'गति') + '</span> <select id="abSpeed" class="ab-select">' +
              [0.75, 1, 1.25, 1.5, 1.75, 2].map(function (s) { return '<option value="' + s + '"' + (s === (saved.r || 1) ? ' selected' : '') + '>' + s + '×</option>'; }).join('') +
            '</select></label>' +
            '<label><span data-en="Sleep timer" data-hi="स्लीप टाइमर">' + T('Sleep timer', 'स्लीप टाइमर') + '</span> <select id="abSleep" class="ab-select">' +
              '<option value="0">' + T('Off', 'बंद') + '</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option><option value="end">' + T('End of chapter', 'अध्याय के अंत तक') + '</option>' +
            '</select></label>' +
          '</div>' +
          '<p id="abErr" class="ab-err" hidden></p>' +
        '</div>' +
        '<h2 class="ab-ch-head" data-en="Chapters" data-hi="अध्याय">' + T('Chapters', 'अध्याय') + '</h2>' +
        '<ol class="ab-chapters" id="abList">' + b.chapters.map(function (c, i) {
          return '<li><button type="button" data-i="' + i + '"><span class="ab-ch-no">' + (i + 1) + '</span>' +
            bi('span', c.title || ('Chapter ' + (i + 1)), c.title_hi || c.title || ('अध्याय ' + (i + 1)), 'class="ab-ch-title"') +
            '<span class="ab-ch-dur" id="abDur' + i + '"></span></button></li>';
        }).join('') + '</ol>' +
        // bookmarks + share
        '<div class="ab-tools">' +
          '<button type="button" class="btn" id="abMark">🔖 ' + bi('span', 'Bookmark this moment', 'यह पल सहेजें') + '</button>' +
          '<button type="button" class="btn" id="abShare">🔗 ' + bi('span', 'Share from this moment', 'इस पल से शेयर करें') + '</button>' +
        '</div>' +
        '<ul class="ab-marks" id="abMarks"></ul>' +
        // read-along text
        '<section class="ab-read" id="abRead" hidden>' +
          '<div class="ab-read-head">' + bi('h2', '📖 Read along', '📖 साथ-साथ पढ़ें') +
            '<label class="ab-read-follow"><input type="checkbox" id="abFollow" checked> ' + bi('span', 'Follow the voice', 'आवाज़ के साथ चलें') + '</label></div>' +
          bi('p', 'The highlighted paragraph follows the narration (approximately). Tap any paragraph to jump there.', 'हाइलाइट किया पैराग्राफ़ आवाज़ के साथ चलता है (लगभग)। किसी भी पैराग्राफ़ पर टैप करें — वहीं से सुनें।', 'class="ab-read-note"') +
          '<div class="ab-read-body" id="abReadBody"></div>' +
        '</section>' +
        // follow
        '<div class="ab-follow">' +
          bi('h3', '🔔 Never miss a new chapter', '🔔 नया अध्याय कभी न छूटे') +
          '<div class="ab-follow-btns">' +
            '<a class="btn gold" href="https://www.youtube.com/@sachinjha8890?sub_confirmation=1" target="_blank" rel="noopener">▶ ' + bi('span', 'Subscribe on YouTube', 'YouTube पर सब्सक्राइब') + '</a>' +
            '<a class="btn" href="https://www.facebook.com/profile.php?id=61595392176657" target="_blank" rel="noopener">f ' + bi('span', 'Follow on Facebook', 'Facebook पर फ़ॉलो') + '</a>' +
            '<a class="btn" href="feed.xml" target="_blank" rel="noopener">🎙 ' + bi('span', 'Podcast feed', 'पॉडकास्ट फ़ीड') + '</a>' +
            '<a class="btn" id="abWa" target="_blank" rel="noopener">💬 ' + bi('span', 'Share on WhatsApp', 'WhatsApp पर भेजें') + '</a>' +
          '</div>' +
        '</div>';

      var audio = new Audio();
      audio.preload = 'metadata';
      var $ = function (id) { return document.getElementById(id); };
      var seek = $('abSeek'), playBtn = $('abPlay'), errEl = $('abErr');
      var seeking = false, sleepAt = 0, sleepEnd = false;

      function save() { try { localStorage.setItem(KEY, JSON.stringify({ c: cur, t: audio.currentTime || 0, r: audio.playbackRate })); } catch (e) {} }
      function setChapter(i, autoplay, startAt) {
        cur = i;
        var c = b.chapters[i];
        audio.src = audioSrc(c.src);
        audio.playbackRate = Number($('abSpeed').value) || 1;
        errEl.hidden = true;
        $('abNowTitle').textContent = (lang() === 'hi' && c.title_hi ? c.title_hi : c.title) || T('Chapter ', 'अध्याय ') + (i + 1);
        [].forEach.call(document.querySelectorAll('#abList button'), function (bt) { bt.classList.toggle('active', Number(bt.getAttribute('data-i')) === i); });
        if (startAt) audio.addEventListener('loadedmetadata', function once() { audio.removeEventListener('loadedmetadata', once); try { audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 2)); } catch (e) {} });
        if (autoplay) audio.play().catch(function () {});
        mediaSession(c);
        save();
      }
      function mediaSession(c) {
        if (!('mediaSession' in navigator)) return;
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: c.title || b.title, artist: b.narrator || b.author || 'Zindagi with Sachin', album: b.title,
            artwork: b.cover ? [{ src: new URL(b.cover, location.href).href, sizes: '512x512' }] : []
          });
          navigator.mediaSession.setActionHandler('play', function () { audio.play(); });
          navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
          navigator.mediaSession.setActionHandler('previoustrack', prev);
          navigator.mediaSession.setActionHandler('nexttrack', next);
          navigator.mediaSession.setActionHandler('seekbackward', function () { skip(-15); });
          navigator.mediaSession.setActionHandler('seekforward', function () { skip(30); });
        } catch (e) {}
      }
      function skip(s) { if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + s)); }
      function prev() { if (audio.currentTime > 5) audio.currentTime = 0; else if (cur > 0) setChapter(cur - 1, true); }
      function next() { if (cur < b.chapters.length - 1) setChapter(cur + 1, true); }

      playBtn.addEventListener('click', function () { if (audio.paused) audio.play().catch(function () {}); else audio.pause(); });
      $('abBack').addEventListener('click', function () { skip(-15); });
      $('abFwd').addEventListener('click', function () { skip(30); });
      $('abPrev').addEventListener('click', prev);
      $('abNext').addEventListener('click', next);
      $('abSpeed').addEventListener('change', function () { audio.playbackRate = Number(this.value) || 1; save(); });
      $('abSleep').addEventListener('change', function () {
        sleepEnd = this.value === 'end'; sleepAt = (!sleepEnd && Number(this.value)) ? Date.now() + Number(this.value) * 60000 : 0;
      });
      $('abList').addEventListener('click', function (e) {
        var bt = e.target.closest('button'); if (!bt) return;
        var i = Number(bt.getAttribute('data-i'));
        if (i === cur) { if (audio.paused) audio.play(); else audio.pause(); } else setChapter(i, true);
      });
      seek.addEventListener('input', function () { seeking = true; $('abCurT').textContent = fmtTime(seek.value / 1000 * (audio.duration || 0)); });
      seek.addEventListener('change', function () { if (isFinite(audio.duration)) audio.currentTime = seek.value / 1000 * audio.duration; seeking = false; });

      audio.addEventListener('play', function () { playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', 'Pause'); root.classList.add('is-playing'); });
      audio.addEventListener('pause', function () { playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play'); root.classList.remove('is-playing'); save(); });
      audio.addEventListener('loadedmetadata', function () { $('abDurT').textContent = fmtTime(audio.duration); var d = $('abDur' + cur); if (d) d.textContent = fmtTime(audio.duration); });
      var lastSave = 0;
      audio.addEventListener('timeupdate', function () {
        if (!seeking && isFinite(audio.duration)) seek.value = Math.round(audio.currentTime / audio.duration * 1000);
        $('abCurT').textContent = fmtTime(audio.currentTime);
        if (Date.now() - lastSave > 5000) { lastSave = Date.now(); save(); }
        if (sleepAt && Date.now() > sleepAt) { audio.pause(); sleepAt = 0; $('abSleep').value = '0'; }
      });
      audio.addEventListener('ended', function () {
        if (sleepEnd) { sleepEnd = false; $('abSleep').value = '0'; save(); return; }
        if (cur < b.chapters.length - 1) setChapter(cur + 1, true); else { try { localStorage.setItem(KEY, JSON.stringify({ c: 0, t: 0, r: audio.playbackRate })); } catch (e) {} }
      });
      audio.addEventListener('error', function () {
        errEl.hidden = false;
        errEl.textContent = T('This audio could not be played. If it is a Google Drive link, make sure sharing is set to "Anyone with the link".', 'यह ऑडियो नहीं चल पाया। अगर यह Google Drive लिंक है, तो शेयरिंग "Anyone with the link" पर रखें।');
      });
      window.addEventListener('pagehide', save);

      // durations of the other chapters (light: metadata only)
      b.chapters.forEach(function (c, i) {
        var a = new Audio(); a.preload = 'metadata'; a.src = audioSrc(c.src);
        a.addEventListener('loadedmetadata', function () { var d = $('abDur' + i); if (d && !d.textContent) d.textContent = fmtTime(a.duration); a.src = ''; });
      });

      // ---------- deep link: ?b=slug&c=2&t=95 ----------
      var qs = new URLSearchParams(location.search), qc = Number(qs.get('c')), qt = Number(qs.get('t'));
      if (qs.has('c') && qc >= 1 && qc <= b.chapters.length) { cur = qc - 1; saved = { c: cur, t: qt > 0 ? qt : 0, r: saved.r }; }

      // ---------- structured data for Google ----------
      try {
        var ld = document.createElement('script'); ld.type = 'application/ld+json';
        ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Audiobook', name: b.title, url: location.origin + location.pathname + '?b=' + encodeURIComponent(b.slug),
          author: b.author ? { '@type': 'Person', name: b.author } : undefined, readBy: { '@type': 'Person', name: b.narrator || b.author || 'Sachin Kumar Jha' },
          inLanguage: b.language === 'english' ? 'en' : 'hi', description: b.description || undefined, image: b.cover ? new URL(b.cover, location.href).href : undefined,
          datePublished: b.date || undefined, publisher: { '@type': 'Organization', name: 'Zindagi with Sachin' },
          hasPart: b.chapters.map(function (c, i) { return { '@type': 'AudioObject', name: c.title, position: i + 1, contentUrl: new URL(audioSrc(c.src), location.href).href, duration: c.duration ? 'PT' + Math.round(c.duration) + 'S' : undefined }; }) });
        document.head.appendChild(ld);
      } catch (e) {}

      // ---------- bookmarks ----------
      var MK = 'zws-ab-marks-' + b.slug;
      function marks() { try { return JSON.parse(localStorage.getItem(MK) || '[]') || []; } catch (e) { return []; } }
      function drawMarks() {
        var list = marks(), ul = $('abMarks');
        ul.innerHTML = list.map(function (m, k) {
          var ct = b.chapters[m.c] ? (lang() === 'hi' && b.chapters[m.c].title_hi ? b.chapters[m.c].title_hi : b.chapters[m.c].title) : '';
          return '<li><button type="button" class="ab-mark-go" data-k="' + k + '">🔖 ' + esc(ct) + ' · ' + fmtTime(m.t) + '</button>' +
            '<button type="button" class="ab-mark-del" data-k="' + k + '" aria-label="Remove bookmark">✕</button></li>';
        }).join('');
      }
      $('abMark').addEventListener('click', function () {
        var list = marks(); list.push({ c: cur, t: Math.floor(audio.currentTime || 0) });
        try { localStorage.setItem(MK, JSON.stringify(list.slice(-30))); } catch (e) {}
        drawMarks();
      });
      $('abMarks').addEventListener('click', function (e) {
        var go = e.target.closest('.ab-mark-go'), del = e.target.closest('.ab-mark-del'), list = marks();
        if (go) { var m = list[Number(go.getAttribute('data-k'))]; if (m) { if (m.c !== cur) setChapter(m.c, true, m.t); else { audio.currentTime = m.t; audio.play().catch(function () {}); } } }
        if (del) { list.splice(Number(del.getAttribute('data-k')), 1); try { localStorage.setItem(MK, JSON.stringify(list)); } catch (e2) {} drawMarks(); }
      });
      drawMarks();

      // ---------- share from this moment ----------
      function momentLink() { return location.origin + location.pathname + '?b=' + encodeURIComponent(b.slug) + '&c=' + (cur + 1) + '&t=' + Math.floor(audio.currentTime || 0); }
      $('abShare').addEventListener('click', function () {
        var url = momentLink(), btn = this;
        if (navigator.share) { navigator.share({ title: b.title, url: url }).catch(function () {}); return; }
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
          var old = btn.innerHTML; btn.textContent = T('✓ Link copied', '✓ लिंक कॉपी हुआ'); setTimeout(function () { btn.innerHTML = old; }, 1800);
        }).catch(function () { prompt(T('Copy this link:', 'यह लिंक कॉपी करें:'), url); });
      });
      function updateWa() { $('abWa').href = 'https://wa.me/?text=' + encodeURIComponent((b.title || '') + ' — ' + T('listen:', 'सुनिए:') + ' ' + momentLink()); }
      $('abWa').addEventListener('mouseenter', updateWa); $('abWa').addEventListener('focus', updateWa); $('abWa').addEventListener('touchstart', updateWa, { passive: true }); updateWa();

      // ---------- read-along ----------
      var paras = [], cum = [], totalChars = 0, activeP = -1, readFor = -1;
      function loadScript(i) {
        var c = b.chapters[i]; readFor = i; activeP = -1;
        var box = $('abRead'), body = $('abReadBody');
        if (!c.script) { box.hidden = true; return; }
        fetchText(c.script).then(function (raw) {
          if (readFor !== i) return;
          var md = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
          var blocks = md.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); // one line = one highlight step
          paras = []; cum = []; totalChars = 0;
          body.innerHTML = blocks.map(function (x, k) {
            var head = /^#+\s*/.test(x), txt = x.replace(/^#+\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_`>]/g, '');
            cum.push(totalChars); totalChars += txt.length; paras.push(k);
            return '<p class="ab-para' + (head ? ' ab-para-h' : '') + '" data-p="' + k + '">' + esc(txt).replace(/\n/g, '<br>') + '</p>';
          }).join('');
          box.hidden = !blocks.length;
        }).catch(function () { box.hidden = true; });
      }
      function speechSpan(c) {
        var intro = Number(c.intro) || 0, outro = intro ? 4 : 0, d = audio.duration || Number(c.duration) || 0;
        return { s: intro, len: Math.max(1, d - intro - outro) };
      }
      function syncRead() {
        if (readFor !== cur || !totalChars || $('abRead').hidden) return;
        var sp = speechSpan(b.chapters[cur]), f = Math.min(0.9999, Math.max(0, (audio.currentTime - sp.s) / sp.len)), pos = f * totalChars, k = 0;
        while (k + 1 < cum.length && cum[k + 1] <= pos) k++;
        if (k === activeP) return;
        var old = document.querySelector('.ab-para.active'); if (old) old.classList.remove('active');
        var el = document.querySelector('.ab-para[data-p="' + k + '"]'); activeP = k;
        if (el) { el.classList.add('active'); if ($('abFollow').checked && !audio.paused) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }
      $('abReadBody').addEventListener('click', function (e) {
        var p = e.target.closest('.ab-para'); if (!p || !totalChars) return;
        var k = Number(p.getAttribute('data-p')), sp = speechSpan(b.chapters[cur]);
        audio.currentTime = sp.s + (cum[k] / totalChars) * sp.len; audio.play().catch(function () {});
      });
      audio.addEventListener('timeupdate', syncRead);
      audio.addEventListener('loadedmetadata', function () { if (readFor !== cur) loadScript(cur); });
      var _set = setChapter; setChapter = function (i, ap, st) { _set(i, ap, st); loadScript(i); updateWa(); };

      // ---------- keyboard: space = play/pause, ← → = 15 s / 30 s ----------
      document.addEventListener('keydown', function (e) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
        else if (e.key === 'ArrowLeft') skip(-15); else if (e.key === 'ArrowRight') skip(30);
      });

      setChapter(cur, false, saved.c === cur ? saved.t : 0);
      if (saved.t > 5) {
        var note = document.createElement('p'); note.className = 'ab-resume';
        note.setAttribute('data-en', 'Resuming where you left off — chapter ' + (cur + 1) + ', ' + fmtTime(saved.t));
        note.setAttribute('data-hi', 'जहाँ छोड़ा था वहीं से — अध्याय ' + (cur + 1) + ', ' + fmtTime(saved.t));
        note.textContent = lang() === 'hi' ? note.getAttribute('data-hi') : note.getAttribute('data-en');
        root.querySelector('.ab-player').insertBefore(note, root.querySelector('.ab-now'));
      }
    }
  }

  /* ---------- home page teaser ---------- */
  function renderHome(books) {
    var box = document.getElementById('abHome');
    if (!box || !books.length) return;
    box.hidden = false;
    var b = books[0];
    box.querySelector('.ab-home-card').innerHTML =
      '<a class="ab-home-link" href="audiobook.html?b=' + encodeURIComponent(b.slug) + '">' + cover(b, 'ab-home-img') +
      '<span class="ab-home-text">' + bi('span', 'New audiobook', 'नई ऑडियोबुक', 'class="eyebrow"') + bi('strong', b.title, b.title_hi) +
      bi('span', '▶ Listen now', '▶ अभी सुनें', 'class="ab-home-cta"') + '</span></a>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderPlayer();
    readHash(); bindFilters();
    if (document.getElementById('abGrid') || document.getElementById('abHome')) loadBooks().then(function (books) { allBooks = books; renderList(books); renderHome(books); });
  });
})();
