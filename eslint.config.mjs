// ESLint with the rules Obsidian's community plugin review uses (eslint-plugin-obsidianmd, recommended).
// Run from the project root:  npm run lint
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    // Build output, Node build scripts, the website (not plugin code) and the generated converter script.
    globalIgnores(["node_modules", "build", "scripts", "site", "docs", "src/converterScript.ts", "src/tools"]),
    ...obsidianmd.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ["eslint.config.*"],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
]);
