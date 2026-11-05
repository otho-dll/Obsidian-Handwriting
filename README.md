<p align="center"><img src="docs/banner.png" alt="Handwritten A4 Notebook - an Obsidian plugin for pen-first handwritten notes" width="100%"></p>

<h1 align="center">Handwritten A4 Notebook</h1>

<p align="center">
  Write by hand on real pages in Obsidian - pressure ink, shapes, PDFs and a calculator,<br>
  in notes that stay readable even without Obsidian.
</p>

<p align="center">
  <a href="https://handwriting.anulab.tech/demo/"><b>✏️ Try the live demo</b></a> ·
  <a href="https://handwriting.anulab.tech/">Website</a> ·
  <a href="#install">Install</a> ·
  <a href="#user-guide">User guide</a>
</p>

> [!NOTE]
> **Made with AI.** This project is entirely vibe-coded using Claude Code. It started as a personal tool and grew into
> something I decided to share - expect a few rough edges; feedback and bug reports are welcome.

## Features

| | |
|---|---|
| ✏️ **Pen, highlighter, eraser** | Pressure ink with opacity, a flat highlighter, an eraser that cuts strokes |
| 🔷 **Shapes** | Lines, arrows, rectangles, ellipses - dashes, fills, separate outline and fill colours |
| ➰ **Lasso selection** | Move, scale, rotate, recolour, group, lock - even onto another page |
| 📑 **Pages panel** | Thumbnails grouped into sections; jump to, reorder, duplicate and restyle pages |
| 📄 **Page styles** | Portrait, landscape or one endless page; dots, lines, grid, Cornell, music staff… |
| 🖼️ **Images & PDFs** | Paste and crop images, import a PDF and write on it |
| 🧮 **Calculator & plots** | Scientific calculator with units and matrices, editable function plots |
| 📤 **Export & history** | PDF export with bookmarks, printing, automatic version history |
| 📱 **Tablets & OLED** | Palm rejection, pinch zoom, pen side button, dark paper, burn-in protection |

## Install

- **Community plugins:** Settings → Community plugins → Browse → search *Handwritten A4 Notebook* → Install → Enable.
- **Beta via BRAT:** install *BRAT* → *Add beta plugin* → `otho-dll/Obsidian-Handwriting`.
- **Manually:** copy `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/otho-dll/Obsidian-Handwriting/releases/latest)
  into `<vault>/.obsidian/plugins/handwritten-notebook/` and enable the plugin.

**Quick start:** right-click a folder → **New handwritten note** (or the command *Create new handwritten note*).
The pen draws, fingers scroll and zoom, and everything saves automatically.

## User guide

| Topic | What's inside |
|---|---|
| ✏️ [Writing and selecting](docs/guide/writing.md) | tools and their options, shapes, the lasso, keyboard shortcuts |
| 📄 [Pages and navigation](docs/guide/pages.md) | scrolling and zoom, the pages panel, page style, titles and contents |
| 🖼️ [Images, PDFs and maths](docs/guide/media.md) | images and screenshots, PDF import, calculator, function plots |
| 📤 [Export and history](docs/guide/export.md) | PDF export, printing, version history, `hnote2pdf.py` |
| 💾 [Your data and privacy](docs/guide/data.md) | where notes and images are stored, what the plugin does and doesn't do |
| ⚙️ [Settings and controls](docs/guide/settings.md) | toolbar, pen and touch, OLED care, commands, all settings |
| 🛠️ [For developers](docs/guide/developers.md) | project layout, build scripts, the website |

## License

[MIT](LICENSE) - free to use, change and share, also commercially, as long as the copyright notice and the license
text are kept.
