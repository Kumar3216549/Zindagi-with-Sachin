// Builds posts/index.json from the Markdown files in content/posts.
// Runs automatically on Vercel ("npm run build") every time you publish from the writing desk.
const fs = require('fs');
const path = require('path');

// Same simple front-matter reader the website uses (no extra packages needed).
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

const SRC = path.join(__dirname, '..', 'content', 'posts');
const OUT = path.join(__dirname, '..', 'posts', 'index.json');

function parse(file) {
  const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta = m ? miniYaml(m[1]) : {};
  return {
    slug: file.replace(/\.md$/, ''),
    title: meta.title || file,
    title_hi: meta.title_hi || '',
    category: meta.category || 'blog',
    date: meta.date ? String(meta.date) : '',
    cover: meta.cover || '',
    excerpt: meta.excerpt || '',
    excerpt_hi: meta.excerpt_hi || '',
    draft: !!meta.draft
  };
}

const files = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter(f => f.endsWith('.md')) : [];
const posts = files.map(parse).filter(p => !p.draft)
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(posts, null, 2));
console.log('posts/index.json: ' + posts.length + ' post(s)');

// Vercel serves the "public" folder after a build, so copy the site there.
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SKIP = new Set(['public', 'node_modules', '.git', '.github', '.vercel', 'scripts']);
fs.rmSync(PUBLIC, { recursive: true, force: true });
fs.mkdirSync(PUBLIC);
for (const name of fs.readdirSync(ROOT)) {
  if (SKIP.has(name)) continue;
  fs.cpSync(path.join(ROOT, name), path.join(PUBLIC, name), { recursive: true });
}
console.log('Copied site to public/');
