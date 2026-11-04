#!/usr/bin/env python3
"""Embeds the current src/tools/hnote2pdf.py into src/converterScript.ts (the plugin saves it to the vault from the settings).
Run after every change to the script:  npm run embed   (or: python3 src/tools/embed_script.py)"""
import json
import os

here = os.path.dirname(os.path.abspath(__file__))          # src/tools
src_dir = os.path.dirname(here)                             # src
with open(os.path.join(here, 'hnote2pdf.py'), encoding='utf-8') as f:
    script = f.read()
with open(os.path.join(src_dir, 'converterScript.ts'), 'w', encoding='utf-8') as f:
    f.write('// Generated from src/tools/hnote2pdf.py by src/tools/embed_script.py – do not edit by hand.\n')
    f.write('export const HNOTE2PDF_PY = ' + json.dumps(script, ensure_ascii=False) + ';\n')
print('src/converterScript.ts updated')
