import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSeries, schemeMatcher, seriesName } from '../src/noteNaming';

const scheme = schemeMatcher({ mode: 'folderDate', folderPart: 'MAT', separator: '-', dateSeparator: '-' });
const next = (names: string[]) => {
    const s = detectSeries(names.map((name, i) => ({ name, mtime: i })), scheme);
    return s ? seriesName(s, s.next) : null;
};

test('a series continues', () => {
    assert.equal(next(['zbiór1', 'zbiór2']), 'zbiór3');
    assert.equal(next(['ćw1', 'ćw2', 'ćw10']), 'ćw11');
});

test('zero padding is kept', () => {
    assert.equal(next(['Lab 01', 'Lab 02']), 'Lab 03');
    assert.equal(next(['Lab 09']), 'Lab 10');
});

test('one note is enough', () => {
    assert.equal(next(['zbiór1']), 'zbiór2');
});

test('names made by the name scheme are not a series', () => {
    assert.equal(next(['MAT-27-11-2026']), null);
    assert.equal(next(['MAT-27-11-2026', 'MAT-27-11-2026 001']), null);
    // an earlier scheme with another separator ends with a date too
    assert.equal(next(['QP 13.10.2026']), null);
});

test('in a mixed folder the series wins', () => {
    assert.equal(next(['MAT-27-11-2026', 'MAT-28-11-2026', 'ćw1', 'ćw2', 'Notes']), 'ćw3');
});

test('the largest group wins, a tie goes to the newest note', () => {
    assert.equal(next(['Lab 1', 'Lab 2', 'Ex 1']), 'Lab 3');
    assert.equal(next(['Lab 1', 'Ex 1']), 'Ex 2');
});

test('case is ignored when grouping; the newest spelling is used', () => {
    assert.equal(next(['lab 1', 'Lab 2']), 'Lab 3');
});

test('no series', () => {
    assert.equal(next([]), null);
    assert.equal(next(['Notes', 'Ideas']), null);
    assert.equal(next(['Lecture 2nd law']), null);
});

test('scheme matcher follows the name mode', () => {
    const d = schemeMatcher({ mode: 'date', folderPart: 'X', separator: '-', dateSeparator: '.' });
    assert.ok(d('27.11'));
    assert.ok(d('27.11.2026 002'));
    const f = schemeMatcher({ mode: 'folder', folderPart: 'Quantum Physics', separator: ' ', dateSeparator: '-' });
    assert.ok(f('Quantum Physics'));
    assert.ok(f('quantum physics 001'));
    assert.ok(!f('Quantum Physics 1'));
});
