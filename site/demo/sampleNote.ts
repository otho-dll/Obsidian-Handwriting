// The note the live demo starts with ("Demo.hnote"): one blank, white, portrait A4 page with dots – nothing else.

/**
 * Raise this when the starting note changes: visitors who still have an older note in their browser get the new one
 * once (see site/demo/main.ts). 3 = the blank page (earlier versions had a handwritten sample).
 */
export const SAMPLE_VERSION = 3;

export function buildSampleNote(): string {
    const note = {
        v: 4,
        id: 'demo-note-0001',
        defaults: { tpl: 'dots', paper: '#ffffff', format: 'a4' },
        pages: [{ strokes: [] }],
    };
    return JSON.stringify(note);
}
