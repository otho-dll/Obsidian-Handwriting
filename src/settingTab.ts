import { App, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import { canUseDisk, pickDiskFolder } from './disk';
import { PageTemplate, PAGE_TEMPLATES } from './templates';
import { QUICK_ACTIONS, TOOLBAR_ITEMS } from './quickActions';
import { setSvg, appendSvg } from './svg';
import { CONVERTER_FILE, saveConverterScript, copyConverterCommand } from './converter';
import { LOGO_FILE } from './constants';
import { HandwritingSettings, DEFAULT_PEN_PALETTE, DEFAULT_HIGHLIGHTER_PALETTE } from './settings';
import type HandwritingPlugin from './main';

export class HandwritingSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: HandwritingPlugin) { super(app, plugin); }

    /** "About" section at the top of the settings: logo (or a fallback icon), name, version, author info. */
    private renderAbout(parent: HTMLElement) {
        const m = this.plugin.manifest;
        const card = parent.createDiv({ cls: 'hw-about' });
        const logo = card.createDiv({ cls: 'hw-about-logo' });
        // Built-in logo: the handwritten "H" on the plugin's green (same path as site/render.mjs → LOGO_H_PATH).
        // A custom logo.png in the plugin folder still takes precedence.
        const placeholder = () => {
            logo.empty();
            setSvg(logo, '<svg viewBox="0 0 64 64" width="100%" height="100%" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="64" height="64" fill="#4f7552"/><path d="M12.4 14.8C14.4 11.2 18.2 10.3 20.7 12.2C22.7 13.8 24.6 13.7 26.1 12.4C26.5 22.5 26 33 24.4 43.5C23.8 48.2 21.7 52.6 18.8 53.2C16.2 53.7 15.4 50.7 17.6 47.9C19.9 45 23.6 43.4 27 41.4C33 35 39.5 25.5 45 15.8C47 12.2 47.2 8.6 44.6 8.6C42 8.6 40.9 11.6 41 15.4C41.3 27 41.7 38.5 42.3 46.8C42.6 51.6 45 54.2 47.7 53C50.2 51.9 51.6 49.2 52.2 46.6" stroke="#ffffff" stroke-width="3.9"/></svg>');
        };
        const dir = m.dir ?? `${this.app.vault.configDir}/plugins/${m.id}`;
        const path = `${dir}/${LOGO_FILE}`;
        void (async () => {
            try {
                if (await this.app.vault.adapter.exists(path)) {
                    const img = logo.createEl('img');
                    img.alt = `${m.name} logo`;
                    img.src = this.app.vault.adapter.getResourcePath(path);
                    img.onerror = placeholder;
                } else placeholder();
            } catch { placeholder(); }
        })();
        const info = card.createDiv({ cls: 'hw-about-info' });
        const title = info.createDiv({ cls: 'hw-about-title' });
        title.createSpan({ text: m.name, cls: 'hw-about-name' });
        title.createSpan({ text: ` v${m.version}`, cls: 'hw-about-version' });
        info.createDiv({ cls: 'hw-about-text', text: 'Handwritten notes with a pen or a mouse: infinite-feeling pages, shapes, images, PDF import and export, a calculator and function plots.' });
        info.createDiv({ cls: 'hw-about-text hw-about-ai', text: 'This extension has been made using ClaudeCode under my supervision' });
        if (m.author) info.createDiv({ cls: 'hw-about-text', text: `Author: ${m.author}` });
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const st = this.plugin.settings;

        this.renderAbout(containerEl);

        const section = (title: string, open: boolean) => {
            const d = containerEl.createEl('details', { cls: 'hw-set-section' });
            if (open) d.setAttribute('open', '');
            d.createEl('summary', { text: title });
            return d.createDiv({ cls: 'hw-set-body' });
        };
        {
            const c = section('Pen and touch', true);
            new Setting(c).setName('Pen pressure').setHeading().settingEl.addClass('hw-set-sub');
            new Setting(c)
                .setName('Pressure sensitivity')
                .setDesc('Stroke width follows the pen pressure (pens only; the mouse draws with a constant width). Highlighter and shapes keep a constant width.')
                .addToggle(t => t.setValue(st.pressureEnabled).onChange(async (v) => { st.pressureEnabled = v; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
            new Setting(c)
                .setName('Sensitivity strength')
                .setDesc('How strongly pressure changes the width (0% = no effect, 100% = from hairline to double width).')
                .addSlider(sl => sl.setLimits(0, 100, 5).setValue(Math.round(st.pressureSensitivity * 100))
                    .onChange(async (v) => { st.pressureSensitivity = v / 100; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));

            new Setting(c).setName('Palm rejection').setHeading().settingEl.addClass('hw-set-sub');
            new Setting(c)
                .setName('Mode')
                .setDesc('Auto: touch is ignored while the pen is near the screen and for very large contact areas (a palm). Strict: touch never scrolls or zooms — use the mouse wheel / the fit button instead.')
                .addDropdown(d => d
                    .addOption('off', 'Off')
                    .addOption('auto', 'Auto (recommended)')
                    .addOption('strict', 'Strict (touch disabled)')
                    .setValue(st.palmRejection)
                    .onChange(async (v) => { st.palmRejection = v as HandwritingSettings['palmRejection']; await this.plugin.saveSettings(); }));
            new Setting(c)
                .setName('Ignore touch after pen activity (ms)')
                .setDesc('Auto mode: how long touch stays ignored after the pen leaves the screen or lifts.')
                .addSlider(sl => sl.setLimits(0, 2000, 50).setValue(st.palmPenTimeout)
                    .onChange(async (v) => { st.palmPenTimeout = v; await this.plugin.saveSettings(); }));
            new Setting(c)
                .setName('Palm contact size (px)')
                .setDesc('Auto mode: touches wider than this are treated as a palm. 0 disables the check (some devices report wrong sizes).')
                .addSlider(sl => sl.setLimits(0, 120, 5).setValue(st.palmContactSize)
                    .onChange(async (v) => { st.palmContactSize = v; await this.plugin.saveSettings(); }));
            new Setting(c)
                .setName('Pinch to zoom')
                .setDesc('Zoom with two fingers. Zooming starts only after a clear pinch, never while three or more fingers (a resting hand) touch the screen, and not while the pen is near the screen. Turn it off if your hand still zooms the page by accident.')
                .addToggle(t => t.setValue(st.pinchZoom).onChange(async (v) => { st.pinchZoom = v; await this.plugin.saveSettings(); }));

            new Setting(c)
                .setName('Long-press menu (touch)')
                .setDesc('Open the page menu when you hold a finger still on the page. Turn off if a resting hand still triggers it. (A mouse right-click always opens the menu.)')
                .addToggle(t => t.setValue(st.longPressMenu).onChange(async (v) => { st.longPressMenu = v; await this.plugin.saveSettings(); }));

            new Setting(c)
                .setName('Long-press delay')
                .setDesc('How long to hold a finger (in milliseconds) before the menu opens. Shorter = faster, but a resting hand may trigger it more easily.')
                .addSlider(sl => sl.setLimits(200, 1000, 50).setValue(st.longPressMs)
                    .onChange(async (v) => { st.longPressMs = v; await this.plugin.saveSettings(); }));

            new Setting(c).setName('Pen button and eraser').setHeading().settingEl.addClass('hw-set-sub');
            new Setting(c)
                .setName('Pen side button')
                .setDesc('Action of the barrel button on the stylus. Snipping Tool works on Windows only.')
                .addDropdown(d => d
                    .addOption('snip', 'Screenshot (Snipping Tool)')
                    .addOption('menu', 'Page menu')
                    .addOption('undo', 'Undo')
                    .addOption('redo', 'Redo')
                    .addOption('none', 'Nothing')
                    .setValue(st.penButtonAction)
                    .onChange(async (v) => { st.penButtonAction = v as HandwritingSettings['penButtonAction']; await this.plugin.saveSettings(); }));
            new Setting(c)
                .setName('Eraser on highlighter')
                .setDesc('Off: the eraser leaves the highlighter alone. Whole stroke: touching a highlighter stroke removes all of it at once. Partial: the eraser cuts out only the part it passes over (like with the pen). Also in the eraser menu on the toolbar.')
                .addDropdown(d => d
                    .addOption('off', 'Off (not erased)')
                    .addOption('whole', 'Whole stroke')
                    .addOption('partial', 'Partial')
                    .setValue(st.highlighterErase)
                    .onChange(async (v) => { st.highlighterErase = v as HandwritingSettings['highlighterErase']; await this.plugin.saveSettings(); }));

            new Setting(c)
                .setName('Eraser on shapes')
                .setDesc('Off: lines, rectangles, ellipses and triangles (and pieces left after partly erasing them) are never erased – handy for diagrams. Whole shape: touching a shape removes all of it. Partial: the eraser cuts out only the part it passes over (a filled shape or an arrow is still removed whole). Also in the eraser menu on the toolbar.')
                .addDropdown(d => d
                    .addOption('off', 'Off (not erased)')
                    .addOption('whole', 'Whole shape')
                    .addOption('partial', 'Partial')
                    .setValue(st.shapeErase)
                    .onChange(async (v) => { st.shapeErase = v as HandwritingSettings['shapeErase']; await this.plugin.saveSettings(); }));

            new Setting(c).setName('Selection').setHeading().settingEl.addClass('hw-set-sub');
            new Setting(c)
                .setName('Default selection mode')
                .setDesc('You can also switch it in the toolbar: click the selection tool while it is active.')
                .addDropdown(d => d
                    .addOption('lasso', 'Lasso (freehand loop)')
                    .addOption('rect', 'Rectangle')
                    .setValue(st.selectMode)
                    .onChange(async (v) => { st.selectMode = v as HandwritingSettings['selectMode']; await this.plugin.saveSettings(); }));

        }
        {
            const c = section('Colors', false);
            const paletteRow = (name: string, desc: string, key: 'penPalette' | 'highlighterPalette', defaults: string[]) => {
                const setting = new Setting(c).setName(name).setDesc(desc);
                for (let i = 0; i < 5; i++) {
                    setting.addColorPicker(c => c.setValue(st[key][i]).onChange(async (v) => {
                        st[key][i] = v.toLowerCase();
                        await this.plugin.saveSettings();
                        this.plugin.refreshViews();
                    }));
                }
                setting.addExtraButton(b => b.setIcon('reset').setTooltip('Restore default colors').onClick(async () => {
                    st[key] = [...defaults];
                    await this.plugin.saveSettings();
                    this.plugin.refreshViews();
                    this.display();
                }));
            };
            paletteRow('Pen colors', 'Five quick colors shown in the toolbar. The first one is used when a note opens.', 'penPalette', DEFAULT_PEN_PALETTE);
            paletteRow('Highlighter colors', 'Five quick colors for the highlighter.', 'highlighterPalette', DEFAULT_HIGHLIGHTER_PALETTE);

        }
        {
            const c = section('Pages and view', false);
            new Setting(c).setName('Page style').setHeading().settingEl.addClass('hw-set-sub');
            new Setting(c)
                .setName('Default page pattern')
                .setDesc('Used by notes that have no pattern of their own. Change a single note or page from the toolbar menu (⋯ → Pages and style).')
                .addDropdown(d => {
                    PAGE_TEMPLATES.forEach(t => d.addOption(t.id, t.label));
                    d.setValue(st.defaultTemplate).onChange(async (v) => { st.defaultTemplate = v as PageTemplate; await this.plugin.saveSettings(); this.plugin.refreshViews(); });
                });
            new Setting(c)
                .setName('Default paper color')
                .addColorPicker(c => c.setValue(st.defaultPaper).onChange(async (v) => { st.defaultPaper = v.toLowerCase(); await this.plugin.saveSettings(); this.plugin.refreshViews(); }))
                .addExtraButton(b => b.setIcon('reset').setTooltip('White').onClick(async () => { st.defaultPaper = '#ffffff'; await this.plugin.saveSettings(); this.plugin.refreshViews(); this.display(); }));

            new Setting(c).setName('Zoom').setHeading().settingEl.addClass('hw-set-sub');
            new Setting(c)
                .setName('Favourite zoom levels')
                .setDesc(st.zoomPresets.length
                    ? `Saved: ${st.zoomPresets.map(z => Math.round(z * 100) + '%').join(', ')}. Add or remove them in the zoom panel (the button with the current zoom on the toolbar).`
                    : 'None yet. Tap the button with the current zoom on the toolbar and choose “+ Save” to keep the zoom you like to write at.')
                .addExtraButton(b => b.setIcon('trash').setTooltip('Remove all').onClick(async () => { st.zoomPresets = []; st.openZoom = 0; await this.plugin.saveSettings(); this.display(); }));
            new Setting(c)
                .setName('Zoom when opening a note')
                .setDesc('Notes always open where you left off. Choose whether they also keep the zoom you last used in them, or open at one of your favourite zoom levels.')
                .addDropdown(d => {
                    d.addOption('0', 'Last zoom used in the note');
                    for (const z of st.zoomPresets) d.addOption(String(z), `${Math.round(z * 100)}%`);
                    d.setValue(String(st.openZoom)).onChange(async (v) => { st.openZoom = Number(v); await this.plugin.saveSettings(); });
                });

            new Setting(c).setName('Page navigation').setHeading().settingEl.addClass('hw-set-sub');
            new Setting(c)
                .setName('Pages panel side')
                .setDesc('Where the pages panel (thumbnails, adding / moving / deleting pages, page style) opens. On a phone it slides up from the bottom.')
                .addDropdown(d => d
                    .addOption('right', 'Right')
                    .addOption('left', 'Left')
                    .setValue(st.pagesPanelSide)
                    .onChange(async (v) => { st.pagesPanelSide = v as HandwritingSettings['pagesPanelSide']; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
            new Setting(c)
                .setName('Pages panel columns')
                .setDesc('How many thumbnails sit side by side in the pages panel (the panel gets wider with more columns). On a phone it always shows three.')
                .addDropdown(d => d
                    .addOption('1', 'One (large thumbnails)')
                    .addOption('2', 'Two')
                    .addOption('3', 'Three (small thumbnails)')
                    .setValue(String(st.pagesPanelColumns))
                    .onChange(async (v) => { st.pagesPanelColumns = Number(v) as HandwritingSettings['pagesPanelColumns']; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));

        }
        {
            const c = section('Toolbar', false);
            c.createEl('p', { cls: 'setting-item-description', text: 'Decide what sits on the toolbar. Anything you turn off here moves into the "More" (⋯) menu, so it is still one tap away. The pen and the colours always stay on the toolbar; tap a tool again for its thickness and options.' });
            const save = async () => { await this.plugin.saveSettings(); this.plugin.refreshViews(); };
            // Tools: chips that are on (on the toolbar) or off (in the ⋯ menu).
            new Setting(c).setName('Tools').setHeading().settingEl.addClass('hw-set-sub');
            c.createEl('p', { cls: 'setting-item-description', text: 'Tap a tool to show or hide it on the toolbar.' });
            const toolChips = c.createDiv({ cls: 'hw-chips' });
            const renderTools = () => {
                toolChips.empty();
                for (const it of TOOLBAR_ITEMS) {
                    const on = !st.toolbarHidden.includes(it.id);
                    const chip = toolChips.createEl('button', { cls: `hw-chip${on ? ' is-on' : ''}` });
                    chip.createSpan({ cls: 'hw-chip-mark', text: on ? '✓' : '+' });
                    chip.createSpan({ text: it.label });
                    chip.setAttribute('aria-pressed', String(on));
                    chip.onclick = async () => {
                        st.toolbarHidden = on ? [...st.toolbarHidden, it.id] : st.toolbarHidden.filter(x => x !== it.id);
                        renderTools();
                        await save();
                    };
                }
            };
            renderTools();

            // Shortcut buttons: the ones on the toolbar in their order (‹ › moves, × removes), the rest below to add.
            new Setting(c).setName('Shortcut buttons').setHeading().settingEl.addClass('hw-set-sub');
            c.createEl('p', { cls: 'setting-item-description', text: 'On the toolbar (in this order) – use ‹ › to move a button, × to remove it. Below: buttons you can add.' });
            const onBox = c.createDiv({ cls: 'hw-chips hw-chips-on' });
            c.createDiv({ cls: 'hw-chips-label', text: 'Available' });
            const offBox = c.createDiv({ cls: 'hw-chips' });
            const avail = QUICK_ACTIONS.filter(a => !(a.id === 'screenshot' && !Platform.isWin));
            const short = (l: string) => l.replace(/\s*\(.*\)\s*$/, '');
            const icon = (el: HTMLElement, svg: string) => { if (svg) { const s = el.createSpan({ cls: 'hw-chip-icon' }); appendSvg(s, `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`); } };
            const renderQuick = () => {
                onBox.empty(); offBox.empty();
                const ids = st.quickActions.filter(id => avail.some(a => a.id === id));
                if (ids.length === 0) onBox.createDiv({ cls: 'hw-chips-empty', text: 'No shortcut buttons on the toolbar.' });
                ids.forEach((id, k) => {
                    const a = avail.find(q => q.id === id)!;
                    const chip = onBox.createDiv({ cls: 'hw-chip is-on' });
                    chip.setAttribute('title', a.label);
                    const left = chip.createEl('button', { cls: 'hw-chip-btn', text: '‹' });
                    left.setAttribute('aria-label', `Move ${short(a.label)} left`);
                    left.disabled = k === 0;
                    icon(chip, a.icon);
                    chip.createSpan({ text: short(a.label) });
                    const right = chip.createEl('button', { cls: 'hw-chip-btn', text: '›' });
                    right.setAttribute('aria-label', `Move ${short(a.label)} right`);
                    right.disabled = k === ids.length - 1;
                    const rm = chip.createEl('button', { cls: 'hw-chip-btn hw-chip-x', text: '×' });
                    rm.setAttribute('aria-label', `Remove ${short(a.label)}`);
                    const move = async (d: number) => { const arr = [...ids]; [arr[k], arr[k + d]] = [arr[k + d], arr[k]]; st.quickActions = arr; renderQuick(); await save(); };
                    left.onclick = () => move(-1);
                    right.onclick = () => move(1);
                    rm.onclick = async () => { st.quickActions = ids.filter(x => x !== id); renderQuick(); await save(); };
                });
                for (const a of avail) {
                    if (ids.includes(a.id)) continue;
                    const chip = offBox.createEl('button', { cls: 'hw-chip' });
                    chip.setAttribute('title', a.label);
                    chip.createSpan({ cls: 'hw-chip-mark', text: '+' });
                    icon(chip, a.icon);
                    chip.createSpan({ text: short(a.label) });
                    chip.onclick = async () => { st.quickActions = [...ids, a.id]; renderQuick(); await save(); };
                }
                if (offBox.childElementCount === 0) offBox.createDiv({ cls: 'hw-chips-empty', text: 'All shortcut buttons are on the toolbar.' });
            };
            renderQuick();
        }
        {
            const c = section('Files and export', false);
            new Setting(c)
                .setName('Where to keep pasted images and PDF pages')
                .setDesc('Hidden folder: every note gets its own hidden folder next to it (".Note name.hnote-data") with its images, PDF pages and version history – the note and this folder together contain everything, and the folder follows the note when you rename, move or delete it. To move images of older notes there, run the command "Move images of the current note into its hidden folder". Note: some sync services – for example Obsidian Sync – may skip hidden folders; if images do not appear on your other devices, choose the attachment folder.')
                .addDropdown(d => d
                    .addOption('hidden', 'Hidden folder next to the note')
                    .addOption('vault', 'Obsidian attachment folder')
                    .setValue(st.attachmentLocation)
                    .onChange(async (v) => { st.attachmentLocation = v as HandwritingSettings['attachmentLocation']; await this.plugin.saveSettings(); }));
            new Setting(c).setName('PDF without Obsidian (Python)').setHeading().settingEl.addClass('hw-set-sub');
            c.createDiv({ cls: 'setting-item-description hw-set-note', text: 'hnote2pdf.py turns .hnote notes into PDF files on any computer with Python 3 – no Obsidian and no plugin needed. Use it to convert many notes at once, or to keep your notes readable if you ever stop using Obsidian. The PDF keeps sharp vector handwriting, images, page patterns and page titles as bookmarks.' });
            new Setting(c)
                .setName('Save the converter to your vault')
                .setDesc(`Writes ${CONVERTER_FILE} into the root of the vault (updated with each plugin version). Usage: python3 ${CONVERTER_FILE} "Note.hnote" → "Note.pdf" next to the note; add a folder and -r to convert whole folders.`)
                .addButton(b => b.setButtonText(`Save ${CONVERTER_FILE}`).onClick(() => { void saveConverterScript(this.app); }))
                .addButton(b => b.setButtonText('Copy command for the whole vault').onClick(() => { void copyConverterCommand(this.app, null); }));

            new Setting(c).setName('New note naming').setHeading().settingEl.addClass('hw-set-sub');

            const dynamic: { setting: Setting; show: () => boolean }[] = [];
            const updateVisibility = () => { for (const d of dynamic) d.setting.settingEl.toggle(d.show()); };
            const changed = async () => { await this.plugin.saveSettings(); refresh(); updateVisibility(); };
            const withFolder = () => st.nameMode !== 'date';
            const withDate = () => st.nameMode !== 'folder';

            // 1. The name scheme first, then only the options that fit it.
            new Setting(c)
                .setName('Name scheme')
                .setDesc('What a new note is called. A number (001, 002…) is added only when a note with the same name already exists.')
                .addDropdown(d => d
                    .addOption('folderDate', 'Folder name + date')
                    .addOption('date', 'Date only')
                    .addOption('folder', 'Folder name only')
                    .setValue(st.nameMode)
                    .onChange(async (v) => { st.nameMode = v as HandwritingSettings['nameMode']; await changed(); }));

            const preview = c.createEl('p', { cls: 'setting-item-description hw-name-preview' });
            const sample = 'University/Quantum Physics/Lectures';
            const refresh = () => {
                const n = this.plugin.buildNoteName(sample);
                preview.setText(`Example (created in the folder "${sample}"): ${n}.hnote`);
            };

            const add = (setting: Setting, show: () => boolean) => { dynamic.push({ setting, show }); };

            add(new Setting(c)
                .setName('Folders in the name')
                .setDesc('How many folders (counting from the one the note is created in) go into the name.')
                .addDropdown(d => d
                    .addOption('1', 'Current folder only')
                    .addOption('2', 'Two folders (parent + current)')
                    .addOption('3', 'Three folders')
                    .setValue(String(st.folderLevels))
                    .onChange(async (v) => { st.folderLevels = Number(v) as 1 | 2 | 3; await changed(); })), withFolder);

            add(new Setting(c)
                .setName('Folder name style')
                .setDesc('Abbreviation: initials of the words ("Quantum Physics" → QP) or the first 3 letters of a single word ("Mathematics" → MAT).')
                .addDropdown(d => d
                    .addOption('abbr', 'Abbreviation')
                    .addOption('full', 'Full folder name')
                    .setValue(st.folderStyle)
                    .onChange(async (v) => { st.folderStyle = v as HandwritingSettings['folderStyle']; await changed(); })), withFolder);

            add(new Setting(c)
                .setName('Separator between parts')
                .setDesc('Placed between folder names and between the folder name and the date.')
                .addDropdown(d => d
                    .addOption('-', 'Hyphen  (QP-13-10-2026)')
                    .addOption('_', 'Underscore  (QP_13-10-2026)')
                    .addOption(' ', 'Space  (QP 13-10-2026)')
                    .setValue(st.separator === '' ? ' ' : st.separator)
                    .onChange(async (v) => { st.separator = v; await changed(); })),
                () => st.nameMode === 'folderDate' || (st.nameMode === 'folder' && st.folderLevels > 1));

            add(new Setting(c)
                .setName('Date separator')
                .setDesc('The date is always day, month, year (DD-MM-YYYY). A slash cannot be used in file names.')
                .addDropdown(d => d
                    .addOption('-', 'Hyphen  (13-10-2026)')
                    .addOption('.', 'Dot  (13.10.2026)')
                    .addOption('_', 'Underscore  (13_10_2026)')
                    .addOption(' ', 'Space  (13 10 2026)')
                    .setValue(st.dateSeparator)
                    .onChange(async (v) => { st.dateSeparator = v as HandwritingSettings['dateSeparator']; await changed(); })), withDate);

            add(new Setting(c)
                .setName('Date shows')
                .addDropdown(d => d
                    .addOption('dmy', 'Day, month and year (DD-MM-YYYY)')
                    .addOption('dm', 'Day and month only (DD-MM)')
                    .setValue(st.dateParts)
                    .onChange(async (v) => { st.dateParts = v as HandwritingSettings['dateParts']; await changed(); })), withDate);

            updateVisibility();
            refresh();
            new Setting(c).setName('PDF export').setHeading().settingEl.addClass('hw-set-sub');
            const disk = canUseDisk();
            new Setting(c)
                .setName('Where to save')
                .setDesc('Ask: a dialog appears on each export. Default folders save straight away. Next to note: same folder as the note.')
                .addDropdown(d => {
                    d.addOption('ask', 'Ask every time')
                        .addOption('folder', 'Default folder in the vault')
                        .addOption('note', 'Next to the note');
                    if (disk) d.addOption('disk', 'Default folder on this computer');
                    d.setValue(st.pdfExportMode === 'disk' && !disk ? 'ask' : st.pdfExportMode)
                        .onChange(async (v) => { st.pdfExportMode = v as HandwritingSettings['pdfExportMode']; await this.plugin.saveSettings(); });
                });
            new Setting(c)
                .setName('Default folder in the vault')
                .setDesc('Vault-relative path, e.g. "Exports/PDF". Created automatically if it does not exist. Empty = next to the note.')
                .addText(t => t.setPlaceholder('Exports/PDF').setValue(st.pdfExportFolder)
                    .onChange(async (v) => { st.pdfExportFolder = v.trim().replace(/^\/+|\/+$/g, ''); await this.plugin.saveSettings(); }));
            const diskSetting = new Setting(c)
                .setName('Default folder on this computer')
                .setDesc(disk
                    ? 'Full path of a folder outside the vault, e.g. C:\\Users\\You\\Documents\\Notes PDF. Used when "Where to save" is set to the computer folder, and suggested in the export dialog.'
                    : 'Available only in the desktop app.');
            if (disk) {
                let input: HTMLInputElement | null = null;
                diskSetting.addText(t => {
                    input = t.inputEl;
                    t.setPlaceholder('C:\\Users\\You\\Documents').setValue(st.pdfExportDiskFolder)
                        .onChange(async (v) => { st.pdfExportDiskFolder = v.trim(); await this.plugin.saveSettings(); });
                });
                diskSetting.addExtraButton(b => b.setIcon('folder-open').setTooltip('Choose a folder…').onClick(async () => {
                    const picked = await pickDiskFolder(st.pdfExportDiskFolder);
                    if (!picked) { new Notice('The folder picker is not available here: type the path instead.'); return; }
                    st.pdfExportDiskFolder = picked;
                    if (input) input.value = picked;
                    await this.plugin.saveSettings();
                }));
            }
            new Setting(c)
                .setName('Export resolution')
                .setDesc('Higher = sharper but a larger file and more memory (mobile devices are limited to 2×).')
                .addDropdown(d => d
                    .addOption('2', 'Standard (2×)')
                    .addOption('3', 'High (3×)')
                    .addOption('4', 'Maximum (4×)')
                    .setValue(String(st.pdfScale))
                    .onChange(async (v) => { st.pdfScale = Number(v) as 2 | 3 | 4; await this.plugin.saveSettings(); }));
        }
        {
            const c = section('Version history', false);
            c.createDiv({ cls: 'setting-item-description hw-set-note', text: 'Versions of each note are saved automatically in the note’s hidden folder (".Note name.hnote-data/history"): while you work, when you close a note and before pages are deleted or an older version is restored. Open them from the ⋯ menu → Version history.' });
            new Setting(c)
                .setName('Save versions')
                .addToggle(t => t.setValue(st.historyEnabled).onChange(async (v) => { st.historyEnabled = v; await this.plugin.saveSettings(); }));
            new Setting(c)
                .setName('While working, save a version at most every')
                .addDropdown(d => d
                    .addOption('5', '5 minutes')
                    .addOption('10', '10 minutes')
                    .addOption('15', '15 minutes')
                    .addOption('30', '30 minutes')
                    .addOption('60', '1 hour')
                    .setValue(String(st.historyInterval))
                    .onChange(async (v) => { st.historyInterval = Number(v); await this.plugin.saveSettings(); }));
            new Setting(c)
                .setName('Keep versions for')
                .setDesc('All versions from the last 24 hours are kept; older days keep one version per day.')
                .addDropdown(d => d
                    .addOption('7', '7 days')
                    .addOption('30', '30 days')
                    .addOption('90', '90 days')
                    .addOption('365', '1 year')
                    .setValue(String(st.historyKeepDays))
                    .onChange(async (v) => { st.historyKeepDays = Number(v); await this.plugin.saveSettings(); }));
            new Setting(c)
                .setName('Space limit per note')
                .setDesc('When a note\'s history grows larger, the oldest versions are removed first.')
                .addDropdown(d => d
                    .addOption('10', '10 MB')
                    .addOption('50', '50 MB')
                    .addOption('200', '200 MB')
                    .addOption('1000', '1 GB')
                    .setValue(String(st.historyMaxMB))
                    .onChange(async (v) => { st.historyMaxMB = Number(v); await this.plugin.saveSettings(); }));
        }
        {
            const c = section('Performance', false);
            new Setting(c)
                .setName('Canvas sharpness')
                .setDesc('Lower sharpness uses fewer pixels, which makes writing, erasing and scrolling smoother when zoomed in on a page full of notes. If it still lags, choose Fast.')
                .addDropdown(d => d
                    .addOption('high', 'High (sharpest)')
                    .addOption('balanced', 'Balanced (recommended)')
                    .addOption('fast', 'Fast (smoothest)')
                    .setValue(st.canvasQuality)
                    .onChange(async (v) => { st.canvasQuality = v as HandwritingSettings['canvasQuality']; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
            new Setting(c)
                .setName('Low-latency ink')
                .setDesc('The stroke you are writing is drawn on a separate screen layer, so writing stays smooth at any zoom and on full pages. Turn off if the line flickers or looks doubled while writing on your device.')
                .addToggle(t => t.setValue(st.lowLatencyInk).onChange(async (v) => { st.lowLatencyInk = v; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));

        }
        {
            const c = section('OLED care', false);
            c.createDiv({ cls: 'setting-item-description hw-set-note', text: 'Protects OLED screens from burn-in: bright areas and edges that stay in the same place for hours wear the pixels unevenly. Each option works on its own. Your notes, PDF exports and other devices are not affected.' });
            const save = async () => { await this.plugin.saveSettings(); this.plugin.refreshViews(); };
            new Setting(c)
                .setName('Dark paper on screen')
                .setDesc('Light pages are shown dark with light ink (colors keep their hue). Only the display changes – the note, its colors and PDF exports stay as they are. The biggest saving for an OLED screen and its battery.')
                .addToggle(t => t.setValue(st.oledDarkPaper).onChange(async (v) => { st.oledDarkPaper = v; await save(); }));
            new Setting(c)
                .setName('Fade the toolbar while writing')
                .setDesc('A moment after you start writing, the toolbar and the page number fade. They come back when the cursor or pen gets close to them, or when you tap them.')
                .addToggle(t => t.setValue(st.oledDimToolbar).onChange(async (v) => { st.oledDimToolbar = v; await save(); }));
            new Setting(c)
                .setName('Pixel shift')
                .setDesc('Every few minutes the whole view moves by 1–2 pixels, so the edges of the toolbar and pages do not stay on the same pixels. Too small to notice.')
                .addToggle(t => t.setValue(st.oledPixelShift).onChange(async (v) => { st.oledPixelShift = v; await save(); }));
            const idleTime = new Setting(c)
                .setName('Dim after')
                .setDesc('How long without any mouse, pen, touch or keyboard input before the note dims.')
                .addDropdown(d => {
                    for (const m of [1, 2, 3, 5, 10, 15, 30]) d.addOption(String(m), m === 1 ? '1 minute' : `${m} minutes`);
                    d.setValue(String(st.oledIdleMinutes)).onChange(async (v) => { st.oledIdleMinutes = Number(v); await save(); });
                });
            new Setting(c)
                .setName('Dim when idle')
                .setDesc('When you leave the note open and step away, the view darkens almost to black. Any movement brings it back (the first tap only wakes it, it does not draw).')
                .addToggle(t => t.setValue(st.oledIdleDim).onChange(async (v) => { st.oledIdleDim = v; idleTime.settingEl.toggle(v); await save(); }));
            c.appendChild(idleTime.settingEl);
            idleTime.settingEl.toggle(st.oledIdleDim);
        }
        {
            const c = section('Advanced', false);
            new Setting(c)
                .setName('Debug logging')
                .setDesc('Writes diagnostic messages (position memory, page thumbnails) to the developer console (Ctrl+Shift+I, log level "Verbose"). Only needed when reporting a problem.')
                .addToggle(t => t.setValue(st.debugLog).onChange(async (v) => { st.debugLog = v; await this.plugin.saveSettings(); }));
            new Setting(c)
                .setName('Performance overlay')
                .setDesc('Shows frame rate, slow frames, long tasks, zoom and canvas size in the corner of the note. Useful for finding out what makes writing or scrolling lag.')
                .addToggle(t => t.setValue(st.perfOverlay).onChange(async (v) => { st.perfOverlay = v; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
        }
    }
}
