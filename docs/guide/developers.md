[← README](../../README.md) · [Writing](writing.md) · [Pages](pages.md) · [Media](media.md) · [Export](export.md) · [Data](data.md) · [Settings](settings.md)

# For developers

## Project layout
```
src/main.ts             plugin + the view (lifecycle, loading / saving notes)
src/styles.css          all styles
src/view/*.ts           view features as mixins (input, navigation, selection, currentPage, pagesPanel, toolbar, versions, …)
src/format.ts           file format versions and migrations (v1 → v4)
src/pageFormat.ts       page sizes (A4, landscape, endless)
src/templates.ts        page patterns (shared geometry for screen, thumbnails, PDF)
src/math/               calculator, expression parser, units, function plots
src/tools/hnote2pdf.py  standalone converter; src/tools/embed_script.py copies it into src/converterScript.ts
scripts/                esbuild.config.mjs (build), build-site.mjs (website), deploy.mjs (copy the build into a vault)
site/                   website + live demo: content.mjs (texts and links), render.mjs, site.css, shim/ (fake Obsidian API)
manifest.json           plugin manifest – stays in the repository root, Obsidian reads it from there
.github/workflows/      release.yml: GitHub release on a version tag · pages.yml: the website on GitHub Pages
build/                  build output (not committed)
```

## Scripts
```bash
npm install
npm run dev           # build into build/ and rebuild on change
npm run build         # production build into build/
npm run typecheck     # TypeScript check
npm run embed         # after changing src/tools/hnote2pdf.py
npm run deploy:local  # build and copy build/* into the vault folder set in .vault-plugin-dir
npm run site:dev      # website + live demo on http://localhost:8080 (rebuilds on change)
npm run site:build    # website into build/site/
```

## Releasing
Set the same version in `manifest.json` and `package.json`, then push a tag with that version (no `v` prefix).
`release.yml` builds the plugin and creates the GitHub release; `pages.yml` publishes the website.
