# Audiobook chapters

Each file here is one chapter for the Audiobook Studio (`/studio.html`).

- One Markdown file per chapter, e.g. `chapter-1.md`, `chapter-2.md`.
- For several books, use a folder per book: `chapters/my-book/chapter-1.md`.
- Front matter fields: `title`, `title_hi`, `book`, `chapter` (number), `author`, `narrator`, `language` (`hindi`/`english`), `description`, `cover`.
- The text below the front matter is the script shown while recording.

Recordings are saved by the studio to `audiobook/drafts/<chapter>/draft_vN.mp3`
and the finished file to `audiobook/final/<chapter>.mp3`.
