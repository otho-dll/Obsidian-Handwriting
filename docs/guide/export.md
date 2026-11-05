[← README](../../README.md) · [Writing](writing.md) · [Pages](pages.md) · [Media](media.md) · **Export** · [Data](data.md) · [Settings](settings.md)

# Export and history

## Export to PDF
**⋯ → Export to PDF** (or the command). Choose where to save it each time, or set a default: next to the note, a vault
folder, or - on desktop - a folder on your computer. Page sizes, patterns, images and PDF backgrounds are kept; page
titles become bookmarks. Resolution: Settings → Files and export.

## Printing
**⋯ → Print…** On desktop the system print dialog opens with one sheet per page (endless pages are cut into A4 sheets).
On phones and tablets plugins can't open a print dialog, so the note is exported to PDF - print it from your PDF viewer.

## Version history
Versions are saved automatically: while you work (at most every N minutes), when you close the note, before pages are
deleted and before an older version is restored. Identical and empty versions are never stored.

**⋯ → Version history…** lists versions by day with a preview: **restore** (can be undone), **open as a copy**,
**save a version now** or **delete**. The last 24 hours keep every version, older days keep one per day.
Retention and a size limit per note: Settings → Version history.

## PDF without Obsidian - `hnote2pdf.py`
A small Python script (3.8+, no extra packages; Pillow optional) turns `.hnote` notes into vector PDFs on any computer.

1. Settings → Files and export → **Save hnote2pdf.py**, or the command *Copy terminal line to convert this note to PDF with
   Python*.
2. Run it:

```bash
python3 hnote2pdf.py "Lectures/Physics/Lecture 1.hnote"          # → Lecture 1.pdf next to the note
python3 hnote2pdf.py "Lecture 1.hnote" -o ~/Desktop/lecture.pdf
python3 hnote2pdf.py MyVault -r -o ~/PDF/                         # every note in a folder, recursively
python3 hnote2pdf.py ".Lecture 1.hnote-data/history/20261019-212953_0f315cad_auto.hnote.gz"   # an old version
```

Options: `--no-pattern`, `--pressure 0.7` / `--no-pressure`, `--vault PATH`. The file format is described at the top
of the script and in [`src/tools/README.md`](../../src/tools/README.md).
