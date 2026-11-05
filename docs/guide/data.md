[← README](../../README.md) · [Writing](writing.md) · [Pages](pages.md) · [Media](media.md) · [Export](export.md) · **Data** · [Settings](settings.md)

# Your data and privacy

## Where your data lives
```
Lectures/Physics/Lecture 1.hnote                  ← the note (plain JSON)
Lectures/Physics/.Lecture 1.hnote-data/           ← hidden folder of this note
    attachments/        images, plots, imported PDF pages
    history/            versions (gzip) + images only old versions use
    meta.json
```
- The hidden folder **moves, renames and is deleted together with the note** - the two contain everything.
- Images the note no longer uses move to `history/attachments` and are removed once no version needs them.
- Prefer Obsidian's attachment folder? Settings → Files and export → *Where to keep pasted images and PDF pages*.
  Some sync services (e.g. Obsidian Sync) skip hidden folders.

## Privacy
- **No network requests, no telemetry.** PDF import uses the PDF engine bundled with Obsidian.
- **Writes** only `.hnote` notes, their hidden `.<name>.hnote-data` folders and - when you ask - `hnote2pdf.py`.
  Files outside the vault only when you pick a folder on your computer for PDF export (desktop).
- **Reads** only `.hnote` files, never your Markdown notes. The vault file list is used to find other notes (so a
  renamed note can't take over another note's folder) and to offer folders for PDF export.
- **Clipboard** only when you ask: copy / paste, a screenshot, a calculator result or the `hnote2pdf.py` command - and
  while waiting for a Snipping Tool screenshot you started.
- **Desktop-only extras:** saving PDFs outside the vault, the Windows Snipping Tool, and reading images from the system
  clipboard. Everything else works on desktop, tablets and phones.
