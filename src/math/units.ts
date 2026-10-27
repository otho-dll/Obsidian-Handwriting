/**
 * Unit conversion: "100 km/h to m/s", "5 kWh to MJ", "4700 µF to mF", "20 °C to °F".
 * Each unit is a factor to SI and a dimension (powers of m, kg, s, A, K, mol, bit).
 * Compound units (km/h, m/s^2, N*m) are built from simple ones.
 */
type Dim = [number, number, number, number, number, number, number];   // m kg s A K mol bit
interface U { f: number; d: Dim; off?: number; prefix?: boolean; }

const D = (m = 0, kg = 0, s = 0, A = 0, K = 0, mol = 0, bit = 0): Dim => [m, kg, s, A, K, mol, bit];
const NONE = D();

const BASE: Record<string, U> = {
    // length
    m: { f: 1, d: D(1), prefix: true }, in: { f: 0.0254, d: D(1) }, ft: { f: 0.3048, d: D(1) }, yd: { f: 0.9144, d: D(1) },
    mi: { f: 1609.344, d: D(1) }, nmi: { f: 1852, d: D(1) }, 'Å': { f: 1e-10, d: D(1) },
    // area and volume
    ha: { f: 1e4, d: D(2) }, a: { f: 100, d: D(2) }, acre: { f: 4046.8564224, d: D(2) },
    l: { f: 1e-3, d: D(3), prefix: true }, L: { f: 1e-3, d: D(3), prefix: true }, gal: { f: 3.785411784e-3, d: D(3) },
    // mass
    g: { f: 1e-3, d: D(0, 1), prefix: true }, t: { f: 1000, d: D(0, 1) }, lb: { f: 0.45359237, d: D(0, 1) }, oz: { f: 0.028349523125, d: D(0, 1) },
    // time
    s: { f: 1, d: D(0, 0, 1), prefix: true }, min: { f: 60, d: D(0, 0, 1) }, h: { f: 3600, d: D(0, 0, 1) },
    d: { f: 86400, d: D(0, 0, 1) }, week: { f: 604800, d: D(0, 0, 1) }, year: { f: 31557600, d: D(0, 0, 1) },
    // speed, frequency
    kn: { f: 1852 / 3600, d: D(1, 0, -1) }, mph: { f: 0.44704, d: D(1, 0, -1) }, kmh: { f: 1 / 3.6, d: D(1, 0, -1) },
    Hz: { f: 1, d: D(0, 0, -1), prefix: true }, rpm: { f: 1 / 60, d: D(0, 0, -1) },
    // force, pressure, energy, power
    N: { f: 1, d: D(1, 1, -2), prefix: true }, lbf: { f: 4.4482216152605, d: D(1, 1, -2) },
    Pa: { f: 1, d: D(-1, 1, -2), prefix: true }, bar: { f: 1e5, d: D(-1, 1, -2), prefix: true }, atm: { f: 101325, d: D(-1, 1, -2) },
    mmHg: { f: 133.322387415, d: D(-1, 1, -2) }, psi: { f: 6894.757293168, d: D(-1, 1, -2) },
    J: { f: 1, d: D(2, 1, -2), prefix: true }, Wh: { f: 3600, d: D(2, 1, -2), prefix: true }, cal: { f: 4.184, d: D(2, 1, -2), prefix: true },
    eV: { f: 1.602176634e-19, d: D(2, 1, -2), prefix: true },
    W: { f: 1, d: D(2, 1, -3), prefix: true }, hp: { f: 745.69987158227, d: D(2, 1, -3) },
    // electricity
    A: { f: 1, d: D(0, 0, 0, 1), prefix: true }, V: { f: 1, d: D(2, 1, -3, -1), prefix: true },
    'Ω': { f: 1, d: D(2, 1, -3, -2), prefix: true }, ohm: { f: 1, d: D(2, 1, -3, -2), prefix: true },
    S: { f: 1, d: D(-2, -1, 3, 2), prefix: true }, F: { f: 1, d: D(-2, -1, 4, 2), prefix: true },
    H: { f: 1, d: D(2, 1, -2, -2), prefix: true }, C: { f: 1, d: D(0, 0, 1, 1), prefix: true },
    Ah: { f: 3600, d: D(0, 0, 1, 1), prefix: true }, VA: { f: 1, d: D(2, 1, -3), prefix: true }, var: { f: 1, d: D(2, 1, -3), prefix: true },
    // temperature (in compound units only temperature differences count)
    K: { f: 1, d: D(0, 0, 0, 0, 1) }, '°C': { f: 1, d: D(0, 0, 0, 0, 1), off: 273.15 }, degC: { f: 1, d: D(0, 0, 0, 0, 1), off: 273.15 },
    '°F': { f: 5 / 9, d: D(0, 0, 0, 0, 1), off: 459.67 * 5 / 9 }, degF: { f: 5 / 9, d: D(0, 0, 0, 0, 1), off: 459.67 * 5 / 9 },
    mol: { f: 1, d: D(0, 0, 0, 0, 0, 1), prefix: true },
    // angles (dimensionless)
    rad: { f: 1, d: NONE, prefix: true }, '°': { f: Math.PI / 180, d: NONE }, deg: { f: Math.PI / 180, d: NONE },
    grad: { f: Math.PI / 200, d: NONE }, rev: { f: 2 * Math.PI, d: NONE },
    // data
    bit: { f: 1, d: D(0, 0, 0, 0, 0, 0, 1), prefix: true }, B: { f: 8, d: D(0, 0, 0, 0, 0, 0, 1), prefix: true },
    KiB: { f: 8 * 1024, d: D(0, 0, 0, 0, 0, 0, 1) }, MiB: { f: 8 * 1024 ** 2, d: D(0, 0, 0, 0, 0, 0, 1) },
    GiB: { f: 8 * 1024 ** 3, d: D(0, 0, 0, 0, 0, 0, 1) }, TiB: { f: 8 * 1024 ** 4, d: D(0, 0, 0, 0, 0, 0, 1) },
    '%': { f: 0.01, d: NONE },
};

const PREFIX: Record<string, number> = {
    Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 10,
    d: 1e-1, c: 1e-2, m: 1e-3, 'µ': 1e-6, 'μ': 1e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
};

function lookup(name: string): U | null {
    if (BASE[name]) return BASE[name];
    for (const len of [2, 1]) {
        const p = name.slice(0, len), rest = name.slice(len);
        if (rest && PREFIX[p] !== undefined && BASE[rest]?.prefix) {
            const b = BASE[rest];
            return { f: b.f * PREFIX[p], d: b.d };
        }
    }
    return null;
}

export interface UnitValue { f: number; d: Dim; off: number; }

/** Parses a unit ("km/h", "m/s^2", "kW*h", "N·m") into a factor and a dimension. Null = unknown unit. */
export function parseUnit(src: string): UnitValue | null {
    const s = src.trim().replace(/²/g, '^2').replace(/³/g, '^3').replace(/·/g, '*');
    if (!s) return null;
    const single = lookup(s);
    if (single) return { f: single.f, d: [...single.d] as Dim, off: single.off ?? 0 };
    let f = 1;
    const d: Dim = [0, 0, 0, 0, 0, 0, 0];
    let sign = 1;
    const re = /\s*([*/])?\s*([A-Za-zµμΩ°Å%]+)(?:\^(-?\d+))?/y;
    let pos = 0, count = 0;
    while (pos < s.length) {
        re.lastIndex = pos;
        const m = re.exec(s);
        if (!m || m[0].length === 0) return null;
        // "N m" (space) = N·m; without an operator the current sign stays (after "/" we are in the denominator)
        if (m[1] === '/') sign = -1; else if (m[1] === '*') sign = 1;
        const u = lookup(m[2]);
        if (!u) return null;
        const e = (m[3] ? parseInt(m[3], 10) : 1) * sign;
        f *= Math.pow(u.f, e);
        for (let k = 0; k < 7; k++) d[k] += u.d[k] * e;
        pos = re.lastIndex;
        count++;
    }
    return count > 0 ? { f, d, off: 0 } : null;
}

const sameDim = (a: Dim, b: Dim) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

/** Converts a value between units or throws (unknown unit / different quantities). */
export function convertUnits(value: number, from: string, to: string): number {
    const a = parseUnit(from), b = parseUnit(to);
    if (!a) throw new Error(`Unknown unit "${from}"`);
    if (!b) throw new Error(`Unknown unit "${to}"`);
    if (!sameDim(a.d, b.d)) throw new Error(`Cannot convert ${from} to ${to}`);
    const si = value * a.f + a.off;
    return (si - b.off) / b.f;
}

/**
 * Recognizes "<expression> <unit> to <unit>" (also "->", "→").
 * Returns the parts to evaluate, or null when it isn't a unit conversion.
 */
export function splitConversion(input: string): { expr: string; from: string; to: string } | null {
    const m = /^(.*\S)\s+(?:to|->|→)\s+(\S.*)$/.exec(input.trim());
    if (!m) return null;
    const left = m[1], to = m[2].trim();
    if (!parseUnit(to)) return null;
    // The longest ending of the left side that is a unit; the rest is the expression.
    for (let i = 1; i < left.length; i++) {
        const prev = left[i - 1], c = left[i];
        if (!/[A-Za-zµμΩ°Å%]/.test(c) || /[A-Za-z_]/.test(prev)) continue;
        const unit = left.slice(i).trim(), expr = left.slice(0, i).trim();
        if (expr && parseUnit(unit)) return { expr, from: unit, to };
    }
    return null;
}

/** Quantities and units for the converter in the "Scientific" tab. */
export const UNIT_GROUPS: { name: string; units: string[] }[] = [
    { name: 'Length', units: ['m', 'km', 'cm', 'mm', 'µm', 'nm', 'in', 'ft', 'yd', 'mi', 'nmi'] },
    { name: 'Area', units: ['m^2', 'cm^2', 'mm^2', 'km^2', 'ha', 'a', 'in^2', 'ft^2', 'acre'] },
    { name: 'Volume', units: ['m^3', 'l', 'dl', 'ml', 'cm^3', 'gal', 'ft^3'] },
    { name: 'Mass', units: ['kg', 'g', 'mg', 't', 'lb', 'oz'] },
    { name: 'Time', units: ['s', 'ms', 'µs', 'min', 'h', 'd', 'week', 'year'] },
    { name: 'Speed', units: ['m/s', 'km/h', 'mph', 'kn', 'ft/s'] },
    { name: 'Frequency', units: ['Hz', 'kHz', 'MHz', 'GHz', 'rpm'] },
    { name: 'Angle', units: ['rad', '°', 'grad', 'rev'] },
    { name: 'Temperature', units: ['°C', '°F', 'K'] },
    { name: 'Force', units: ['N', 'kN', 'lbf'] },
    { name: 'Pressure', units: ['Pa', 'kPa', 'MPa', 'bar', 'atm', 'mmHg', 'psi'] },
    { name: 'Energy', units: ['J', 'kJ', 'MJ', 'Wh', 'kWh', 'cal', 'kcal', 'eV'] },
    { name: 'Power', units: ['W', 'mW', 'kW', 'MW', 'hp'] },
    { name: 'Voltage', units: ['V', 'mV', 'µV', 'kV'] },
    { name: 'Current', units: ['A', 'mA', 'µA', 'kA'] },
    { name: 'Resistance', units: ['Ω', 'mΩ', 'kΩ', 'MΩ'] },
    { name: 'Capacitance', units: ['F', 'mF', 'µF', 'nF', 'pF'] },
    { name: 'Inductance', units: ['H', 'mH', 'µH', 'nH'] },
    { name: 'Charge', units: ['C', 'mC', 'µC', 'Ah', 'mAh'] },
    { name: 'Data', units: ['bit', 'B', 'kB', 'MB', 'GB', 'TB', 'KiB', 'MiB', 'GiB'] },
];
