// ESLint with the rules Obsidian's community plugin review uses (eslint-plugin-obsidianmd, recommended).
// The review scans the whole repository, so the website / demo (site/) and the build scripts (scripts/) are linted too.
// Run from the project root:  npm run lint
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
    // Build output, docs and the generated converter script (a copy of src/tools/hnote2pdf.py).
    globalIgnores(["node_modules", "build", "docs", "src/converterScript.ts", "src/tools"]),
    ...obsidianmd.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    // JavaScript files outside the TypeScript projects (src/tsconfig.json, site/tsconfig.json)
                    allowDefaultProject: ["eslint.config.mjs", "scripts/*.mjs", "site/*.mjs", "site/theme.js"],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // Node build scripts
        files: ["scripts/**/*.mjs", "eslint.config.mjs"],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        // Plain browser script of the website
        files: ["site/theme.js"],
        languageOptions: { globals: { ...globals.browser } },
    },
]);
