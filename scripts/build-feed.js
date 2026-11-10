// Builds the files that let other platforms find the audiobooks:
//   feed.xml    – podcast RSS (Spotify, Apple Podcasts, YouTube Music, Amazon, JioSaavn…)
//   sitemap.xml – every public page, for Google / Bing
//   robots.txt  – points search engines at the sitemap, hides the studio pages
// Settings (title, owner e-mail for platform verification…) live in content/podcast.json.
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const hms = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(s).padStart(2, '0');
};
const rfc822 = (d) => (d && !isNaN(new Date(d)) ? new Date(d) : new Date('2026-01-01')).toUTCString();

module.exports = function buildFeed({ books, posts, root }) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'content', 'podcast.json'), 'utf8')); } catch (_) {}
  const SITE = String(cfg.site || 'https://zindagi-with-sachin.vercel.app').replace(/\/+$/, '') + '/';
  const abs = (p) => (/^https?:\/\//.test(p) ? p : SITE + String(p).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/'));

  // ---------- podcast RSS ----------
  const items = [];
  for (const b of books) {
    b.chapters.forEach((c, i) => {
      let length = 0;
      try { if (!/^https?:/.test(c.src)) length = fs.statSync(path.join(root, c.src)).size; } catch (_) {}
      const date = c.date || b.date;
      const desc = [b.description || b.description_hi || '', 'Narrated by ' + (b.narrator || cfg.author || 'Sachin Kumar Jha') + '.',
        'Listen on the website: ' + SITE + 'audiobook.html?b=' + encodeURIComponent(b.slug)].filter(Boolean).join('\n\n');
      items.push({ date, xml: `    <item>
      <title>${esc((b.title ? b.title + ' — ' : '') + c.title)}</title>
      <description>${esc(desc)}</description>
      <link>${esc(SITE + 'audiobook.html?b=' + encodeURIComponent(b.slug))}</link>
      <guid isPermaLink="false">${esc(c.src)}</guid>
      <pubDate>${rfc822(date)}</pubDate>
      <enclosure url="${esc(abs(c.src))}" length="${length}" type="audio/mpeg"/>
      ${c.duration ? `<itunes:duration>${hms(c.duration)}</itunes:duration>` : ''}
      <itunes:episode>${i + 1}</itunes:episode>
      <itunes:season>1</itunes:season>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>false</itunes:explicit>
      ${b.cover ? `<itunes:image href="${esc(abs(b.cover))}"/>` : ''}
    </item>` });
    });
  }
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const title = cfg.title || 'Zindagi with Sachin — Audiobooks';
  const author = cfg.author || 'Sachin Kumar Jha';
  const summary = cfg.description || 'समय के तीन आयाम हैं — भूत, वर्तमान और भविष्य। Important books, life stories and poems narrated in Hindi by Sachin Kumar Jha. Stories · Audiobooks · Wisdom.';
  const owner = cfg.owner_email ? `\n      <itunes:email>${esc(cfg.owner_email)}</itunes:email>` : '';
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(SITE)}</link>
    <atom:link href="${esc(SITE + 'feed.xml')}" rel="self" type="application/rss+xml"/>
    <language>${esc(cfg.language || 'hi')}</language>
    <copyright>© ${new Date().getFullYear()} ${esc(author)}</copyright>
    <description>${esc(summary)}</description>
    <itunes:summary>${esc(summary)}</itunes:summary>
    <itunes:author>${esc(author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${esc(author)}</itunes:name>${owner}
    </itunes:owner>
    <itunes:image href="${esc(abs(cfg.cover || 'assets/img/podcast-cover.jpg'))}"/>
    <image><url>${esc(abs(cfg.cover || 'assets/img/podcast-cover.jpg'))}</url><title>${esc(title)}</title><link>${esc(SITE)}</link></image>
    <itunes:category text="Arts"><itunes:category text="Books"/></itunes:category>
    <itunes:category text="Education"><itunes:category text="Self-Improvement"/></itunes:category>
    <itunes:category text="Religion &amp; Spirituality"/>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
${items.map((x) => x.xml).join('\n')}
  </channel>
</rss>
`;
  fs.writeFileSync(path.join(root, 'feed.xml'), rss);

  // ---------- sitemap ----------
  const today = new Date().toISOString().slice(0, 10);
  const hidden = new Set(['studio.html', 'write.html', 'studio-guide.html', 'post.html', 'story.html', 'audiobook.html']);
  const urls = [];
  for (const f of fs.readdirSync(root).filter((f) => f.endsWith('.html') && !hidden.has(f) && !f.startsWith('_'))) {
    urls.push({ loc: f === 'index.html' ? SITE : SITE + f, pri: f === 'index.html' ? '1.0' : '0.8' });
  }
  for (const b of books) urls.push({ loc: SITE + 'audiobook.html?b=' + encodeURIComponent(b.slug), pri: '0.9', mod: b.date });
  for (const p of posts || []) urls.push({ loc: SITE + 'post.html?p=' + encodeURIComponent(p.slug), pri: '0.7', mod: p.date });
  const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${esc((u.mod && /^\d{4}-\d\d-\d\d/.test(u.mod) ? u.mod.slice(0, 10) : today))}</lastmod><priority>${u.pri}</priority></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(root, 'sitemap.xml'), sm);
  fs.writeFileSync(path.join(root, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /studio.html\nDisallow: /write.html\nDisallow: /audiobook/drafts/\n\nSitemap: ${SITE}sitemap.xml\n`);
  console.log(`feed.xml: ${items.length} episode(s) · sitemap.xml: ${urls.length} URL(s) · robots.txt`);
};
