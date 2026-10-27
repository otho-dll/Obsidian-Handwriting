# hnote2pdf – `.hnote` notes as PDF, without Obsidian

This script converts handwritten notes to PDF. It only needs Python 3.8+ – nothing else to install.

**Where to get it:** the plugin saves it in the vault root folder – plugin settings → Files and export →
"PDF without Obsidian (Python)" → *Save hnote2pdf.py*. The command "Copy command to convert this note to PDF with Python"
copies a ready-to-run command for the open note (just paste it into a terminal).

```bash
python3 hnote2pdf.py "Vault/Studies/Lecture 1.hnote"           # → "Lecture 1.pdf" next to the note
python3 hnote2pdf.py "Lecture 1.hnote" -o ~/Desktop/lecture.pdf
python3 hnote2pdf.py Vault/Studies -r -o ~/PDF/                 # every note in the folder (and subfolders)
python3 hnote2pdf.py ".Lecture 1.hnote-data/history/20261016-120000_ab12cd34_auto.hnote.gz"   # an older version
```

Options:

| Option | Meaning |
|---|---|
| `-o FILE.pdf` / `-o FOLDER/` | where to save the result |
| `-r` | also look in subfolders |
| `--vault FOLDER` | vault root folder (usually detected automatically by the `.obsidian` folder) |
| `--no-pattern` | no dots / lines / grid – plain paper |
| `--pressure 0.7` / `--no-pressure` | pressure sensitivity (by default read from the plugin settings in the vault) |

## What ends up in the PDF

- Vector handwriting (with pressure-based width), highlighter, shapes, pen opacity.
- Images, plots and imported PDF pages from the note's hidden folder (`.Name.hnote-data/attachments`).
  If an image is missing, a grey rectangle takes its place and the script reports it.
- The pattern and colour of every page, and its format: A4 portrait, A4 landscape or an "endless" page.
- Page titles as bookmarks (table of contents) in the PDF reader.

Pillow (`pip install pillow`) is optional. It speeds up large PNG images and can read less common formats
(WebP, GIF). JPEG and plain PNG work without it.

## File format

The format description (versions 1–4) is at the top of the script. In short: `.hnote` is JSON with a list of pages,
and each page has strokes (points `[x, y]` or `[x, y, pressure]`), images and page settings.
Coordinates are in logical units: A4 = 800 × 1131, Y axis pointing down.

## For plugin developers

The plugin embeds the script in `src/converterScript.ts`. After every change to `tools/hnote2pdf.py` run
`python3 tools/embed_script.py` (from the plugin root folder) so the plugin saves the current version.
