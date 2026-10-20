// Tiny YAML reader for the front matter Pages CMS writes.
// Handles: key: value, quoted strings, true/false, numbers kept as strings,
// block text (> or |), and lists of plain values or of small objects, e.g.
//   chapters:
//     - title: Chapter 1
//       audio: assets/audio/ch1.mp3
// Used by scripts/build-posts.js (Node) and copied into assets/js/audiobooks.js (browser).
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
export default yamlLite;
