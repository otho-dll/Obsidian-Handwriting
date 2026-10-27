#!/usr/bin/env python3
"""Embeds the current tools/hnote2pdf.py into src/converterScript.ts (the plugin saves it to the vault from the settings).
Run from the plugin root folder after every change to the script:  python3 tools/embed_script.py"""
import json
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(root, 'tools', 'hnote2pdf.py'), encoding='utf-8') as f:
    src = f.read()
with open(os.path.join(root, 'src', 'converterScript.ts'), 'w', encoding='utf-8') as f:
    f.write('// Generated from tools/hnote2pdf.py by tools/embed_script.py – do not edit by hand.\n')
    f.write('export const HNOTE2PDF_PY = ' + json.dumps(src, ensure_ascii=False) + ';\n')
print('src/converterScript.ts updated')
