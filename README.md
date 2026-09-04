# Zindagi with Sachin

A personal blog by Sachin Kumar Jha — life stories, experiences, and memories.

## What's in here

- `index.html`, `about.html`, `life-stories.html`, `blog.html`, `gallery.html`, `contact.html`, `story.html`, `story1.html`, `story2.html` — the site's pages
- `assets/css/style.css` — one shared stylesheet used by every page (colors, type, layout, responsive nav)
- `assets/js/main.js` — the mobile menu toggle and current-page nav highlighting
- `assets/img/` — optimized site images (WebP) and favicons

## Before you publish

A few placeholders are left on purpose for you to fill in:

- **contact.html** — replace `YOUR-EMAIL@example.com` with your real email, and swap the form's `action` for a Formspree/EmailJS endpoint if you want the form itself to send mail (see the comment in the file for details).
- **Story pages** (`story.html`, `story1.html`, `story2.html`) — the body text is draft placeholder copy written in your original tone. Swap in your real memories, names, and specific moments; the structure and headings can stay as-is.
- **Blog page** — currently a styled "coming soon" page with category tags. Duplicate one of the story pages as a template once you're ready to publish real posts.

## Local preview

No build step — just open `index.html` in a browser, or run a tiny local server from this folder:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploying

This is a static site, so it works as-is on GitHub Pages: push this folder to the repo, then enable Pages (Settings → Pages → Deploy from branch → `main` / root).
