import {
    SCHEME_DARK,
    SCHEME_DEFAULT,
    calculateSolarDay,
    classifySolarState,
    describeLocationAge,
} from '../lib/solar.js';

const log = globalThis.print ?? console.log;

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertBetween(value, min, max, message) {
    assert(value >= min && value <= max,
        `${message}: expected ${value} between ${min} and ${max}`);
}

function localMinutes(date) {
    return (date.getHours() * 60) + date.getMinutes();
}

function assertSameLocalDay(left, right, message) {
    assert(left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate(), message);
}

const london = {
    latitude: 51.5072,
    longitude: -0.1276,
};

{
    const day = calculateSolarDay(new Date(2026, 5, 21, 12, 0, 0), london.latitude, london.longitude);
    assert(day.kind === 'normal', 'London summer solstice should have civil dawn and dusk');
    assertSameLocalDay(day.dawn, new Date(2026, 5, 21), 'London dawn should be on the requested local day');
    assertSameLocalDay(day.dusk, new Date(2026, 5, 21), 'London dusk should be on the requested local day');
    assertBetween(localMinutes(day.dawn), (3 * 60) + 20, (4 * 60) + 30,
        'London June civil dawn should be early morning');
    assertBetween(localMinutes(day.dusk), (21 * 60) + 30, (22 * 60) + 45,
        'London June civil dusk should be late evening');
}

{
    const beforeDawn = classifySolarState(new Date(2026, 5, 21, 3, 0, 0),
        london.latitude, london.longitude);
    assert(beforeDawn.scheme === SCHEME_DARK, 'Before civil dawn should be dark');
    assert(beforeDawn.period === 'before-dawn', 'Before dawn period should be reported');
    assert(beforeDawn.nextTransition.getTime() === beforeDawn.dawn.getTime(),
        'Next transition should be dawn');

    const daytime = classifySolarState(new Date(2026, 5, 21, 12, 0, 0),
        london.latitude, london.longitude);
    assert(daytime.scheme === SCHEME_DEFAULT, 'Daytime should use the default scheme');
    assert(daytime.period === 'daytime', 'Daytime period should be reported');

    const afterDusk = classifySolarState(new Date(2026, 5, 21, 23, 30, 0),
        london.latitude, london.longitude);
    assert(afterDusk.scheme === SCHEME_DARK, 'After civil dusk should be dark');
    assert(afterDusk.period === 'after-dusk', 'After dusk period should be reported');
    assert(afterDusk.nextTransition > new Date(2026, 5, 22, 0, 0, 0),
        'After dusk should transition at a future dawn');
}

{
    const dstStart = classifySolarState(new Date(2026, 2, 29, 1, 30, 0),
        london.latitude, london.longitude);
    assert(dstStart.nextCheck instanceof Date, 'DST boundary should still schedule a check');
    assert(dstStart.nextCheck > new Date(2026, 2, 29, 1, 30, 0),
        'DST boundary check should be in the future');
}

{
    const highNorthSummer = classifySolarState(new Date(2026, 5, 21, 12, 0, 0),
        80, 0);
    assert(highNorthSummer.scheme === SCHEME_DEFAULT, '80N midsummer should not request dark mode');
    assert(highNorthSummer.period === 'always-day', '80N midsummer should report always-day');
    assert(highNorthSummer.nextTransition === null, 'Always-day should not invent a transition');

    const highNorthWinter = classifySolarState(new Date(2026, 11, 21, 12, 0, 0),
        80, 0);
    assert(highNorthWinter.scheme === SCHEME_DARK, '80N midwinter should request dark mode');
    assert(highNorthWinter.period === 'always-night', '80N midwinter should report always-night');
    assert(highNorthWinter.nextTransition === null, 'Always-night should not invent a transition');
}

{
    assert(describeLocationAge(1000, 1040) === 'location age under 2 minutes',
        'Short location ages should be rounded to a friendly phrase');
    assert(describeLocationAge(1000, 1000 + (58 * 60)) === 'location age 58 minutes',
        'Minute-scale location ages should be shown in minutes');
    assert(describeLocationAge(1000, 1000 + (7 * 24 * 60 * 60)) === 'location age 7 days',
        'Day-scale location ages should be shown in days');
}

log('solar tests passed');
