/** Circuit editor model (lives only inside the editor – the note gets plain strokes). Coordinates in editor px. */
export type ElType = 'R' | 'L' | 'C' | 'E' | 'J' | 'U' | 'I' | 'A' | 'V';
export interface CircuitNode { id: string; x: number; y: number }
export interface CircuitElement {
    id: string; type: ElType;
    label: string;          // may be empty
    flip: boolean;          // arrow reversed relative to a→b (sources)
    side: 1 | -1;           // label side relative to the canonical normal
}
/** A branch: straight segment a→b with elements in series. */
export interface CircuitEdge { id: string; a: string; b: string; els: CircuitElement[] }
export interface Circuit { nodes: CircuitNode[]; edges: CircuitEdge[]; nid: number }

export const GRID = 20;
export const SHEET_W = 900, SHEET_H = 675;

export const TYPES: Record<ElType, { name: string; h: number; w: number }> = {
    R: { name: 'Resistor', h: 24, w: 9 }, L: { name: 'Inductor', h: 18, w: 8 }, C: { name: 'Capacitor', h: 6, w: 14 },
    E: { name: 'Voltage source', h: 16, w: 16 }, J: { name: 'Current source', h: 16, w: 16 },
    U: { name: 'Dep. voltage', h: 17, w: 17 }, I: { name: 'Dep. current', h: 17, w: 17 },
    A: { name: 'Ammeter', h: 14, w: 14 }, V: { name: 'Voltmeter', h: 14, w: 14 },
};
export const ORDER: ElType[] = ['R', 'L', 'C', 'E', 'J', 'U', 'I', 'A', 'V'];
export const DIRECTIONAL: ElType[] = ['E', 'J', 'U', 'I'];
/** Auto-number prefixes (dependent sources and meters get none). */
export const PREFIX: Partial<Record<ElType, string>> = { R: 'R', C: 'C', L: 'L', E: 'E', J: 'I' };
