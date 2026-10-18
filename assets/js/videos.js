// Zindagi with Sachin — Videos page (videos.html) and the "Latest on YouTube" strip on the home page.
// Video lists come from youtube/index.json, which is refreshed from YouTube on every publish and once a day.
// Playlists are set in the Writer's Desk → "YouTube playlists" (content/youtube.json).
(function () {
  // Same categories as the audiobooks, plus the poems playlist.
  var CATS = {
    'science': { en: 'Science', hi: 'विज्ञान', icon: '🔬' },
    'commerce-finance': { en: 'Commerce & Finance', hi: 'वाणिज्य और वित्त', icon: '💰' },
    'humanities': { en: 'Humanities', hi: 'मानविकी', icon: '📜' },
    'zindagi-ke-sabak': { en: 'Zindagi ke Sabak', hi: 'ज़िंदगी के सबक', icon: '🌱' },
    'mera-safar': { en: 'My Journey', hi: 'मेरा सफ़र', icon: '🧭' },
    'kahani': { en: 'Stories', hi: 'कहानियाँ', icon: '📖' },
    'anya-sroton-ke-chuninda-gyan': { en: 'Anya Sroton ke Chuninda Gyan', hi: 'अन्य स्रोतों के चुनिंदा ज्ञान', icon: '💡' },
    'kavita': { en: 'Mahan Kavita (Poems)', hi: 'महान कविताएँ', icon: '🎙️' },
    'sva-rachit': { en: 'My Own Poems', hi: 'स्व-रचित', icon: '✍️' }
  };
  var state = { cat: '' };
  var data = null;

  function lang() { return document.documentElement.getAttribute('lang') === 'hi' ? 'hi' : 'en'; }
  function T(en, hi) { return lang() === 'hi' ? hi : en; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function bi(tag, en, hi, attrs) {
    hi = hi || en;
    return '<' + tag + (attrs ? ' ' + attrs : '') + ' data-en="' + esc(en) + '" data-hi="' + esc(hi) + '">' + esc(lang() === 'hi' ? hi : en) + '</' + tag + '>';
  }
  function fmtDate(d) {
    if (!d) return '';
    var x = new Date(d + 'T00:00:00');
    if (isNaN(x)) return d;
    try { return x.toLocaleDateString(lang() === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; }
  }
  function listId(link) { var m = String(link || '').match(/[?&]list=([\w-]+)/); return m ? m[1] : String(link || '').trim(); }
  function channelUrl() { return (data && data.channel_url) || 'https://www.youtube.com/@sachinjha8890'; }

  function load() {
    return fetch('youtube/index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) {
        if (d && d.playlists) return d;
        // first publish not done yet: use the settings file (players still work, lists are filled by YouTube)
        return fetch('content/youtube.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
          .then(function (c) {
            if (!c) return null;
            return { channel_url: c.channel_url, latest: [], playlists: (c.playlists || []).filter(function (p) { return !p.hide; }).map(function (p) {
              return { id: listId(p.link), title: p.title, title_hi: p.title_hi, category: p.category, videos: null };
            }) };
          });
      });
  }

  function videoCard(v, listIdOpt, i) {
    return '<button type="button" class="vd-card post-enter" style="animation-delay:' + ((i || 0) * 0.04) + 's" data-v="' + esc(v.id) + '"' + (listIdOpt ? ' data-list="' + esc(listIdOpt) + '"' : '') + '>' +
      '<span class="vd-thumb"><img src="https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/mqdefault.jpg" alt="" loading="lazy"><span class="vd-play" aria-hidden="true">▶</span>' +
      (v.short ? '<span class="vd-badge">Short</span>' : '') + '</span>' +
      '<span class="vd-title">' + esc(v.title) + '</span>' +
      (v.published ? '<span class="vd-date">' + esc(fmtDate(v.published)) + '</span>' : '') +
      '</button>';
  }

  /* ---------- player ---------- */
  function embedUrl(videoId, list) {
    var q = [];
    if (list) q.push('list=' + encodeURIComponent(list));
    q.push('rel=0');
    if (videoId) { q.push('autoplay=1'); return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) + '?' + q.join('&'); }
    return 'https://www.youtube-nocookie.com/embed/videoseries?' + q.join('&');
  }
  function showPlayer(videoId, list, title) {
    var box = document.getElementById('vdPlayer');
    if (!box) { window.open('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId), '_blank', 'noopener'); return; }
    var watch = videoId ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId) + (list ? '&list=' + encodeURIComponent(list) : '')
      : 'https://www.youtube.com/playlist?list=' + encodeURIComponent(list);
    box.innerHTML = '<div class="vd-frame"><iframe src="' + esc(embedUrl(videoId, list)) + '" title="' + esc(title || 'YouTube video') + '" loading="lazy" ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>' +
      '<div class="vd-player-bar"><a href="' + esc(watch) + '" target="_blank" rel="noopener">' + bi('span', 'Open on YouTube ↗', 'यूट्यूब पर खोलें ↗') + '</a>' +
      '<a href="' + esc(channelUrl() + '?sub_confirmation=1') + '" target="_blank" rel="noopener" class="vd-sub-mini">' + bi('span', '▶ Subscribe', '▶ सब्सक्राइब') + '</a></div>';
    box.hidden = false;
    if (videoId) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- page ---------- */
  function countFor(cat) {
    return data.playlists.filter(function (p) { return p.category === cat; })
      .reduce(function (n, p) { return n + (p.videos ? p.videos.length : 0); }, 0);
  }
  function renderFilter() {
    var top = document.getElementById('vdFilter');
    if (!top) return;
    var total = (data.latest || []).length;
    var html = '<button type="button" data-cat="" class="' + (!state.cat ? 'active' : '') + '" aria-pressed="' + !state.cat + '">' + bi('span', 'All', 'सभी') + '<span class="count">' + total + '</span></button>';
    Object.keys(CATS).forEach(function (k) {
      var c = CATS[k];
      if (!data.playlists.some(function (p) { return p.category === k; })) return;
      html += '<button type="button" data-cat="' + k + '" class="' + (state.cat === k ? 'active' : '') + '" aria-pressed="' + (state.cat === k) + '">' +
        bi('span', c.icon + ' ' + c.en, c.icon + ' ' + c.hi) + '<span class="count">' + countFor(k) + '</span></button>';
    });
    top.innerHTML = html;
    top.hidden = false;
  }
  function renderAll(box) {
    var html = '';
    var latest = data.latest || [];
    if (latest.length) {
      html += '<div class="vd-section">' + bi('h2', 'Latest videos', 'नए वीडियो') +
        '<div class="vd-grid">' + latest.slice(0, 12).map(function (v, i) { return videoCard(v, '', i); }).join('') + '</div></div>';
    }
    html += '<div class="vd-section">' + bi('h2', 'Playlists', 'प्लेलिस्ट') + '<div class="vd-pl-grid">' +
      data.playlists.map(function (p) {
        var c = CATS[p.category] || { en: p.title, hi: p.title_hi, icon: '▶' };
        var first = p.videos && p.videos[0];
        var n = p.videos ? p.videos.length : null;
        return '<button type="button" class="vd-pl" data-cat="' + esc(p.category) + '">' +
          '<span class="vd-pl-img">' + (first ? '<img src="https://i.ytimg.com/vi/' + encodeURIComponent(first.id) + '/mqdefault.jpg" alt="" loading="lazy">' : '<span class="vd-pl-icon">' + c.icon + '</span>') + '</span>' +
          '<span class="vd-pl-text">' + bi('strong', p.title || c.en, p.title_hi || c.hi) +
          (n === null ? '' : n ? bi('span', n + (n === 1 ? ' video' : ' videos'), n + ' वीडियो', 'class="vd-pl-n"') : bi('span', 'Coming soon', 'जल्द आ रहा है', 'class="vd-pl-n"')) +
          '</span></button>';
      }).join('') + '</div></div>';
    box.innerHTML = html;
  }
  function renderCat(box) {
    var lists = data.playlists.filter(function (p) { return p.category === state.cat; });
    var c = CATS[state.cat] || {};
    var html = '';
    var firstWithVideos = null;
    lists.forEach(function (p) {
      var url = 'https://www.youtube.com/playlist?list=' + encodeURIComponent(p.id);
      html += '<div class="vd-section">' + bi('h2', p.title || c.en, p.title_hi || c.hi) +
        '<p class="vd-open"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + bi('span', 'Open this playlist on YouTube ↗', 'यह प्लेलिस्ट यूट्यूब पर खोलें ↗') + '</a></p>';
      if (p.videos && !p.videos.length) {
        html += '<div class="vd-empty">' + bi('p', 'Videos for this category are coming soon. Subscribe to get them first.', 'इस श्रेणी के वीडियो जल्द आ रहे हैं। सबसे पहले पाने के लिए सब्सक्राइब करें।') +
          '<a class="btn" href="' + esc(channelUrl() + '?sub_confirmation=1') + '" target="_blank" rel="noopener">' + bi('span', '▶ Subscribe', '▶ सब्सक्राइब करें') + '</a></div>';
      } else {
        if (!firstWithVideos) firstWithVideos = p;
        if (p.videos) html += '<div class="vd-grid">' + p.videos.map(function (v, i) { return videoCard(v, p.id, i); }).join('') + '</div>';
      }
      html += '</div>';
    });
    box.innerHTML = html;
    if (firstWithVideos) showPlayer('', firstWithVideos.id, firstWithVideos.title);
  }
  function render() {
    var box = document.getElementById('vdContent');
    if (!box) return;
    if (!data) { box.innerHTML = bi('p', 'Videos could not be loaded. Please visit the channel on YouTube.', 'वीडियो लोड नहीं हो सके। कृपया यूट्यूब पर चैनल देखें।', 'class="center"'); return; }
    if (state.cat && !data.playlists.some(function (p) { return p.category === state.cat; })) state.cat = '';
    var pl = document.getElementById('vdPlayer');
    if (pl) { pl.hidden = true; pl.innerHTML = ''; }
    renderFilter();
    if (state.cat) renderCat(box); else renderAll(box);
  }
  function setCat(cat) {
    state.cat = cat || '';
    history.replaceState(null, '', location.pathname + location.search + (state.cat ? '#cat=' + encodeURIComponent(state.cat) : ''));
    render();
    var f = document.getElementById('vdFilter'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- home page strip ---------- */
  function renderHome() {
    var box = document.getElementById('ytHome');
    if (!box || !data) return;
    var vids = (data.latest || []).filter(function (v) { return !v.short; }).slice(0, 3);
    if (!vids.length) return;
    box.innerHTML = '<div class="section-head center">' + bi('span', 'On YouTube', 'यूट्यूब पर', 'class="eyebrow"') + bi('h2', 'Latest videos', 'नए वीडियो') + '</div>' +
      '<div class="vd-grid vd-grid-3">' + vids.map(function (v, i) {
        return '<a class="vd-card post-enter" style="animation-delay:' + (i * 0.06) + 's" href="videos.html#v=' + encodeURIComponent(v.id) + '">' +
          '<span class="vd-thumb"><img src="https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/mqdefault.jpg" alt="" loading="lazy"><span class="vd-play" aria-hidden="true">▶</span></span>' +
          '<span class="vd-title">' + esc(v.title) + '</span></a>';
      }).join('') + '</div>' +
      '<p class="center" style="margin-top:22px"><a class="btn" href="videos.html">' + bi('span', 'All videos', 'सभी वीडियो') + '</a></p>';
    box.hidden = false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var onPage = !!document.getElementById('vdContent');
    if (!onPage && !document.getElementById('ytHome')) return;
    var h = new URLSearchParams(location.hash.slice(1));
    state.cat = h.get('cat') || '';
    load().then(function (d) {
      data = d;
      if (data && data.channel_url) {
        var sub = document.getElementById('vdSubscribe');
        if (sub) sub.href = data.channel_url + '?sub_confirmation=1';
      }
      renderHome();
      if (!onPage) return;
      render();
      if (h.get('v')) showPlayer(h.get('v'), '', '');
    });
    if (!onPage) return;
    window.addEventListener('hashchange', function () {
      var q = new URLSearchParams(location.hash.slice(1));
      if (q.get('v')) { showPlayer(q.get('v'), '', ''); return; }
      if ((q.get('cat') || '') !== state.cat) { state.cat = q.get('cat') || ''; if (data) render(); }
    });
    document.getElementById('vdFilter').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b) setCat(b.getAttribute('data-cat'));
    });
    document.getElementById('vdContent').addEventListener('click', function (e) {
      var card = e.target.closest('.vd-card');
      if (card) { showPlayer(card.getAttribute('data-v'), card.getAttribute('data-list') || '', card.querySelector('.vd-title').textContent); return; }
      var pl = e.target.closest('.vd-pl');
      if (pl) setCat(pl.getAttribute('data-cat'));
    });
  });
})();
