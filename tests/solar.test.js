import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {
    SCHEME_DARK,
    SCHEME_DEFAULT,
    calculateSolarDay,
    classifySolarState,
    describeLocationAge,
} from '../lib/solar.js';

const log = globalThis.print ?? console.log;
const thisFile = fileURLToPath(import.meta.url);

const london = {
    latitude: 51.5072,
    longitude: -0.1276,
};

const mcmurdo = {
    latitude: -77.8419,
    longitude: 166.6863,
};

const southPole = {
    latitude: -90,
    longitude: 0,
};

const antarcticStations = [
    ['Antarctica/Casey', -66.2825, 110.5286],
    ['Antarctica/Davis', -68.5766, 77.9674],
    ['Antarctica/DumontDUrville', -66.6639, 140.0019],
    ['Antarctica/Macquarie', -54.5, 158.95],
    ['Antarctica/Mawson', -67.6033, 62.8738],
    ['Antarctica/McMurdo', mcmurdo.latitude, mcmurdo.longitude],
    ['Antarctica/Palmer', -64.7742, -64.0539],
    ['Antarctica/Rothera', -67.5681, -68.1270],
    ['Antarctica/Syowa', -69.0061, 39.5900],
    ['Antarctica/Troll', -72.0117, 2.5351],
    ['Antarctica/Vostok', -78.4645, 106.8376],
];

const arcticLocations = [
    ['Arctic/Longyearbyen', ['Europe/Oslo'], 78.2232, 15.6267],
    ['Arctic/Tromso', ['Europe/Oslo'], 69.6492, 18.9553],
    ['Arctic/Reykjavik', ['Atlantic/Reykjavik'], 64.1466, -21.9426],
    ['Arctic/Nuuk', ['America/Nuuk', 'America/Godthab'], 64.1835, -51.7216],
    ['Arctic/Iqaluit', ['America/Iqaluit'], 63.7467, -68.5170],
    ['Arctic/Resolute', ['America/Resolute'], 74.6973, -94.8297],
    ['Arctic/Utqiagvik', ['America/Anchorage'], 71.2906, -156.7886],
    ['Arctic/Inuvik', ['America/Inuvik'], 68.3607, -133.7230],
    ['Arctic/Anadyr', ['Asia/Anadyr'], 64.7337, 177.4968],
];

const tzdataStressLocations = [
    [['Pacific/Kiritimati'], 1.8721, -157.4278],
    [['Pacific/Chatham'], -43.95, -176.56],
    [['Australia/Lord_Howe'], -31.55, 159.08],
    [['Asia/Kathmandu', 'Asia/Katmandu'], 27.7172, 85.3240],
    [['Pacific/Marquesas'], -9.0, -139.5],
    [['America/St_Johns'], 47.5615, -52.7126],
    [['Africa/Casablanca'], 33.5731, -7.5898],
    [['Asia/Gaza'], 31.5017, 34.4668],
    [['Asia/Tehran'], 35.6892, 51.3890],
    [['America/Santiago'], -33.4489, -70.6693],
    [['Pacific/Apia'], -13.8333, -171.75],
];

const goldenSolarFixtures = [
    ['London summer solstice', ['Europe/London'], 2026, 5, 21, london.latitude, london.longitude,
        [3 * 60, 4 * 60 + 45], [21 * 60 + 15, 22 * 60 + 45]],
    ['London winter solstice', ['Europe/London'], 2026, 11, 21, london.latitude, london.longitude,
        [6 * 60 + 45, 8 * 60], [16 * 60, 17 * 60 + 15]],
    ['Casablanca spring equinox', ['Africa/Casablanca'], 2026, 2, 20, 33.5731, -7.5898,
        [5 * 60 + 30, 6 * 60 + 45], [18 * 60 + 30, 19 * 60 + 45]],
    ['New York summer solstice', ['America/New_York'], 2026, 5, 21, 40.7128, -74.0060,
        [4 * 60 + 15, 5 * 60 + 30], [20 * 60 + 30, 21 * 60 + 45]],
    ['Tokyo summer solstice', ['Asia/Tokyo'], 2026, 5, 21, 35.6762, 139.6503,
        [3 * 60 + 15, 4 * 60 + 30], [19 * 60, 20 * 60]],
    ['Sydney summer solstice', ['Australia/Sydney'], 2026, 11, 21, -33.8688, 151.2093,
        [4 * 60 + 30, 5 * 60 + 45], [20 * 60, 21 * 60 + 15]],
    ['Lord Howe summer solstice', ['Australia/Lord_Howe'], 2026, 11, 21, -31.55, 159.08,
        [4 * 60 + 15, 5 * 60 + 30], [19 * 60 + 15, 20 * 60 + 30]],
    ['Chatham summer solstice', ['Pacific/Chatham'], 2026, 11, 21, -43.95, -176.56,
        [4 * 60 + 30, 5 * 60 + 45], [21 * 60 + 15, 22 * 60 + 30]],
    ['Apia summer solstice', ['Pacific/Apia'], 2026, 11, 21, -13.8333, -171.75,
        [5 * 60, 6 * 60], [18 * 60 + 45, 19 * 60 + 45]],
    ['Tromso spring equinox', ['Europe/Oslo'], 2026, 2, 20, 69.6492, 18.9553,
        [4 * 60, 5 * 60 + 30], [18 * 60 + 15, 19 * 60 + 45]],
];

const keyLatitudes = [
    -90,
    -80,
    -66.5622,
    -45,
    -23.4367,
    0,
    23.4367,
    45,
    66.5622,
    80,
    90,
];

const keyLongitudes = [
    -179.9,
    0,
    179.9,
];

const stressDates = [
    new Date(2026, 2, 20, 12, 0, 0),
    new Date(2026, 5, 21, 12, 0, 0),
    new Date(2026, 8, 22, 12, 0, 0),
    new Date(2026, 11, 21, 12, 0, 0),
];

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertBetween(value, min, max, message) {
    assert(value >= min && value <= max,
        `${message}: expected ${value} between ${min} and ${max}`);
}

function assertDate(value, message) {
    assert(value instanceof Date, `${message}: expected a Date`);
    assert(Number.isFinite(value.getTime()), `${message}: expected a finite Date`);
}

function assertFutureDate(value, now, message) {
    assertDate(value, message);
    assert(value > now, `${message}: expected ${value.toString()} after ${now.toString()}`);
}

function localMinutes(date) {
    return (date.getHours() * 60) + date.getMinutes();
}

function assertSameLocalDay(left, right, message) {
    assert(left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate(), message);
}

function assertLocalMinutesBetween(date, range, message) {
    assertBetween(localMinutes(date), range[0], range[1], message);
}

function assertSolarStateShape(state, now, message) {
    assert([SCHEME_DARK, SCHEME_DEFAULT].includes(state.scheme),
        `${message}: unexpected scheme ${state.scheme}`);
    assert(['always-night', 'always-day', 'before-dawn', 'daytime', 'after-dusk'].includes(state.period),
        `${message}: unexpected period ${state.period}`);
    assert(state.isNight === (state.scheme === SCHEME_DARK),
        `${message}: isNight should match the selected scheme`);
    assertFutureDate(state.nextCheck, now, `${message}: nextCheck`);

    if (state.period === 'always-night' || state.period === 'always-day') {
        assert(state.dawn === null, `${message}: polar state should not expose dawn`);
        assert(state.dusk === null, `${message}: polar state should not expose dusk`);
        assert(state.nextTransition === null, `${message}: polar state should not invent a transition`);
        return;
    }

    assertDate(state.dawn, `${message}: dawn`);
    assertDate(state.dusk, `${message}: dusk`);
    assertFutureDate(state.nextTransition, now, `${message}: nextTransition`);
}

function resolveTimeZone(timeZones, aliases) {
    const match = aliases.find(timeZone => timeZones.includes(timeZone));
    assert(match, `Timezone list should include one of ${aliases.join(', ')}`);
    return match;
}

function runLondonSuite() {
    const summerSolstice = new Date(2026, 5, 21, 12, 0, 0);
    const day = calculateSolarDay(summerSolstice, london.latitude, london.longitude);
    assert(day.kind === 'normal', 'London summer solstice should have civil dawn and dusk');
    assertSameLocalDay(day.dawn, new Date(2026, 5, 21), 'London dawn should be on the requested local day');
    assertSameLocalDay(day.dusk, new Date(2026, 5, 21), 'London dusk should be on the requested local day');
    assertBetween(localMinutes(day.dawn), (3 * 60) + 20, (4 * 60) + 30,
        'London June civil dawn should be early morning');
    assertBetween(localMinutes(day.dusk), (21 * 60) + 30, (22 * 60) + 45,
        'London June civil dusk should be late evening');

    const beforeDawnNow = new Date(2026, 5, 21, 3, 0, 0);
    const beforeDawn = classifySolarState(beforeDawnNow, london.latitude, london.longitude);
    assert(beforeDawn.scheme === SCHEME_DARK, 'Before civil dawn in London should be dark');
    assert(beforeDawn.period === 'before-dawn', 'Before dawn period should be reported for London');
    assert(beforeDawn.nextTransition.getTime() === beforeDawn.dawn.getTime(),
        'London before dawn should transition at dawn');
    assertSolarStateShape(beforeDawn, beforeDawnNow, 'London before dawn');

    const daytimeNow = new Date(2026, 5, 21, 12, 0, 0);
    const daytime = classifySolarState(daytimeNow, london.latitude, london.longitude);
    assert(daytime.scheme === SCHEME_DEFAULT, 'Daytime in London should use the default scheme');
    assert(daytime.period === 'daytime', 'Daytime period should be reported for London');
    assertSolarStateShape(daytime, daytimeNow, 'London daytime');

    const afterDuskNow = new Date(2026, 5, 21, 23, 30, 0);
    const afterDusk = classifySolarState(afterDuskNow, london.latitude, london.longitude);
    assert(afterDusk.scheme === SCHEME_DARK, 'After civil dusk in London should be dark');
    assert(afterDusk.period === 'after-dusk', 'After dusk period should be reported for London');
    assert(afterDusk.nextTransition > new Date(2026, 5, 22, 0, 0, 0),
        'London after dusk should transition at a future dawn');
    assertSolarStateShape(afterDusk, afterDuskNow, 'London after dusk');

    const dstStartNow = new Date(2026, 2, 29, 1, 30, 0);
    const dstStart = classifySolarState(dstStartNow, london.latitude, london.longitude);
    assertSolarStateShape(dstStart, dstStartNow, 'London DST start');

    const dstEndNow = new Date(2026, 9, 25, 1, 30, 0);
    const dstEnd = classifySolarState(dstEndNow, london.latitude, london.longitude);
    assertSolarStateShape(dstEnd, dstEndNow, 'London DST end');
}

function runAntarcticaSuite() {
    const mcmurdoWinterNow = new Date(2026, 5, 21, 12, 0, 0);
    const mcmurdoWinter = classifySolarState(mcmurdoWinterNow,
        mcmurdo.latitude, mcmurdo.longitude);
    assert(mcmurdoWinter.scheme === SCHEME_DARK,
        'McMurdo midwinter should request dark mode');
    assert(mcmurdoWinter.period === 'always-night',
        'McMurdo midwinter should report always-night');
    assertSolarStateShape(mcmurdoWinter, mcmurdoWinterNow, 'McMurdo midwinter');

    const mcmurdoSummerNow = new Date(2026, 11, 21, 12, 0, 0);
    const mcmurdoSummer = classifySolarState(mcmurdoSummerNow,
        mcmurdo.latitude, mcmurdo.longitude);
    assert(mcmurdoSummer.scheme === SCHEME_DEFAULT,
        'McMurdo midsummer should use the default scheme');
    assert(mcmurdoSummer.period === 'always-day',
        'McMurdo midsummer should report always-day');
    assertSolarStateShape(mcmurdoSummer, mcmurdoSummerNow, 'McMurdo midsummer');

    const poleWinterNow = new Date(2026, 5, 21, 12, 0, 0);
    const poleWinter = classifySolarState(poleWinterNow,
        southPole.latitude, southPole.longitude);
    assert(poleWinter.scheme === SCHEME_DARK,
        'South Pole midwinter should request dark mode');
    assert(poleWinter.period === 'always-night',
        'South Pole midwinter should report always-night');
    assertSolarStateShape(poleWinter, poleWinterNow, 'South Pole midwinter');

    const poleSummerNow = new Date(2026, 11, 21, 12, 0, 0);
    const poleSummer = classifySolarState(poleSummerNow,
        southPole.latitude, southPole.longitude);
    assert(poleSummer.scheme === SCHEME_DEFAULT,
        'South Pole midsummer should use the default scheme');
    assert(poleSummer.period === 'always-day',
        'South Pole midsummer should report always-day');
    assertSolarStateShape(poleSummer, poleSummerNow, 'South Pole midsummer');
}

function runAntarcticStationSuite() {
    const station = antarcticStations.find(([timeZone]) => timeZone === process.env.TZ);
    assert(station, `No Antarctic station coordinates for ${process.env.TZ}`);

    const [timeZone, latitude, longitude] = station;
    for (const now of stressDates) {
        const state = classifySolarState(now, latitude, longitude);
        assertSolarStateShape(state, now, `${timeZone} station on ${now.toDateString()}`);
    }
}

function runArcticLocationSuite() {
    const locations = arcticLocations.filter(([, aliases]) => aliases.includes(process.env.TZ));
    assert(locations.length > 0, `No Arctic location coordinates for ${process.env.TZ}`);

    for (const [name, aliases, latitude, longitude] of locations) {
        for (const now of stressDates) {
            const state = classifySolarState(now, latitude, longitude);
            assertSolarStateShape(state, now,
                `${name} ${aliases.join('/')} on ${now.toDateString()}`);
        }
    }
}

function runTzdataStressLocationSuite() {
    const location = tzdataStressLocations.find(([aliases]) => aliases.includes(process.env.TZ));
    assert(location, `No tzdata stress location coordinates for ${process.env.TZ}`);

    const [aliases, latitude, longitude] = location;
    for (const now of stressDates) {
        const state = classifySolarState(now, latitude, longitude);
        assertSolarStateShape(state, now, `${aliases.join('/')} on ${now.toDateString()}`);
    }
}

function runGoldenSolarFixtureSuite() {
    const fixtures = goldenSolarFixtures.filter(([, aliases]) => aliases.includes(process.env.TZ));
    assert(fixtures.length > 0, `No golden solar fixtures for ${process.env.TZ}`);

    for (const [name, _aliases, year, month, day, latitude, longitude, dawnRange, duskRange] of fixtures) {
        const solarDay = calculateSolarDay(new Date(year, month, day, 12, 0, 0), latitude, longitude);
        assert(solarDay.kind === 'normal', `${name}: should have civil dawn and dusk`);
        assertSameLocalDay(solarDay.dawn, new Date(year, month, day), `${name}: dawn local day`);
        assertSameLocalDay(solarDay.dusk, new Date(year, month, day), `${name}: dusk local day`);
        assertLocalMinutesBetween(solarDay.dawn, dawnRange, `${name}: civil dawn local time`);
        assertLocalMinutesBetween(solarDay.dusk, duskRange, `${name}: civil dusk local time`);
    }
}

function runTransitionBoundarySuite() {
    const solarDay = calculateSolarDay(new Date(2026, 5, 21, 12, 0, 0),
        london.latitude, london.longitude);
    assert(solarDay.kind === 'normal', 'London boundary test should have civil dawn and dusk');

    const oneSecond = 1000;
    const beforeDawn = classifySolarState(new Date(solarDay.dawn.getTime() - oneSecond),
        london.latitude, london.longitude);
    const atDawn = classifySolarState(solarDay.dawn, london.latitude, london.longitude);
    const afterDawn = classifySolarState(new Date(solarDay.dawn.getTime() + oneSecond),
        london.latitude, london.longitude);
    assert(beforeDawn.scheme === SCHEME_DARK, 'One second before civil dawn should be dark');
    assert(atDawn.scheme === SCHEME_DEFAULT, 'Exactly at civil dawn should switch to default');
    assert(afterDawn.scheme === SCHEME_DEFAULT, 'One second after civil dawn should be default');

    const beforeDusk = classifySolarState(new Date(solarDay.dusk.getTime() - oneSecond),
        london.latitude, london.longitude);
    const atDusk = classifySolarState(solarDay.dusk, london.latitude, london.longitude);
    const afterDusk = classifySolarState(new Date(solarDay.dusk.getTime() + oneSecond),
        london.latitude, london.longitude);
    assert(beforeDusk.scheme === SCHEME_DEFAULT, 'One second before civil dusk should be default');
    assert(atDusk.scheme === SCHEME_DARK, 'Exactly at civil dusk should switch to dark');
    assert(afterDusk.scheme === SCHEME_DARK, 'One second after civil dusk should be dark');
}

function findFirstNormalDay(year, latitude, longitude) {
    for (let month = 0; month < 12; month++) {
        for (let day = 1; day <= 31; day++) {
            const now = new Date(year, month, day, 12, 0, 0);
            if (now.getMonth() !== month)
                continue;

            const solarDay = calculateSolarDay(now, latitude, longitude);
            if (solarDay.kind === 'normal')
                return now;
        }
    }

    return null;
}

function runPolarTransitionScanSuite() {
    const cases = [
        ['Longyearbyen', 78.2232, 15.6267],
        ['Utqiagvik', 71.2906, -156.7886],
        ['McMurdo', mcmurdo.latitude, mcmurdo.longitude],
        ['Vostok', -78.4645, 106.8376],
    ];

    for (const [name, latitude, longitude] of cases) {
        const firstNormal = findFirstNormalDay(2026, latitude, longitude);
        assert(firstNormal, `${name}: should have at least one normal civil twilight day`);

        for (let offset = -2; offset <= 2; offset++) {
            const now = new Date(firstNormal.getFullYear(), firstNormal.getMonth(),
                firstNormal.getDate() + offset, 12, 0, 0);
            const state = classifySolarState(now, latitude, longitude);
            assertSolarStateShape(state, now, `${name} polar transition scan ${now.toDateString()}`);
        }
    }
}

function runNorthernPolarSuite() {
    const highNorthSummerNow = new Date(2026, 5, 21, 12, 0, 0);
    const highNorthSummer = classifySolarState(highNorthSummerNow, 80, 0);
    assert(highNorthSummer.scheme === SCHEME_DEFAULT, '80N midsummer should not request dark mode');
    assert(highNorthSummer.period === 'always-day', '80N midsummer should report always-day');
    assertSolarStateShape(highNorthSummer, highNorthSummerNow, '80N midsummer');

    const highNorthWinterNow = new Date(2026, 11, 21, 12, 0, 0);
    const highNorthWinter = classifySolarState(highNorthWinterNow, 80, 0);
    assert(highNorthWinter.scheme === SCHEME_DARK, '80N midwinter should request dark mode');
    assert(highNorthWinter.period === 'always-night', '80N midwinter should report always-night');
    assertSolarStateShape(highNorthWinter, highNorthWinterNow, '80N midwinter');
}

function runLocationAgeSuite() {
    assert(describeLocationAge(1000, 1040) === 'location age under 2 minutes',
        'Short location ages should be rounded to a friendly phrase');
    assert(describeLocationAge(1000, 1000 + (58 * 60)) === 'location age 58 minutes',
        'Minute-scale location ages should be shown in minutes');
    assert(describeLocationAge(1000, 1000 + (7 * 24 * 60 * 60)) === 'location age 7 days',
        'Day-scale location ages should be shown in days');
}

function runKeyLatitudeStressSuite() {
    for (const latitude of keyLatitudes) {
        for (const longitude of keyLongitudes) {
            for (const now of stressDates) {
                const state = classifySolarState(now, latitude, longitude);
                assertSolarStateShape(state, now,
                    `${process.env.TZ} latitude ${latitude} longitude ${longitude} on ${now.toDateString()}`);
            }
        }
    }
}

function runWorkerSuite() {
    if (process.env.SOLAR_TEST_SUITE === 'london')
        runLondonSuite();
    else if (process.env.SOLAR_TEST_SUITE === 'antarctica')
        runAntarcticaSuite();
    else if (process.env.SOLAR_TEST_SUITE === 'antarctic-station')
        runAntarcticStationSuite();
    else if (process.env.SOLAR_TEST_SUITE === 'arctic-location')
        runArcticLocationSuite();
    else if (process.env.SOLAR_TEST_SUITE === 'tzdata-stress')
        runTzdataStressLocationSuite();
    else if (process.env.SOLAR_TEST_SUITE === 'golden-solar')
        runGoldenSolarFixtureSuite();
    else if (process.env.SOLAR_TEST_SUITE === 'invariants')
        runKeyLatitudeStressSuite();
    else
        throw new Error(`Unknown worker suite: ${process.env.SOLAR_TEST_SUITE}`);
}

function runWorker(timeZone, suite) {
    execFileSync(process.execPath, [thisFile], {
        env: {
            ...process.env,
            TZ: timeZone,
            SOLAR_TEST_WORKER: '1',
            SOLAR_TEST_SUITE: suite,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function runEveryTimeZoneSuite() {
    assert(typeof Intl.supportedValuesOf === 'function',
        'Node must expose Intl.supportedValuesOf to enumerate IANA timezones');

    const timeZones = Intl.supportedValuesOf('timeZone');
    assert(timeZones.includes('Europe/London'), 'Timezone list should include Europe/London');
    assert(timeZones.includes('Antarctica/McMurdo'), 'Timezone list should include Antarctica/McMurdo');

    for (const timeZone of timeZones)
        runWorker(timeZone, 'invariants');

    for (const [timeZone] of antarcticStations) {
        assert(timeZones.includes(timeZone), `Timezone list should include ${timeZone}`);
        runWorker(timeZone, 'antarctic-station');
    }

    for (const [, aliases] of arcticLocations) {
        const timeZone = resolveTimeZone(timeZones, aliases);
        runWorker(timeZone, 'arctic-location');
    }

    for (const [aliases] of tzdataStressLocations) {
        const timeZone = resolveTimeZone(timeZones, aliases);
        runWorker(timeZone, 'tzdata-stress');
    }

    const goldenTimeZones = new Set();
    for (const [, aliases] of goldenSolarFixtures)
        goldenTimeZones.add(resolveTimeZone(timeZones, aliases));
    for (const timeZone of goldenTimeZones)
        runWorker(timeZone, 'golden-solar');

    return timeZones.length;
}

if (process.env.SOLAR_TEST_WORKER === '1') {
    runWorkerSuite();
} else {
    runWorker('Europe/London', 'london');
    runTransitionBoundarySuite();
    runPolarTransitionScanSuite();
    runWorker('Antarctica/McMurdo', 'antarctica');
    runNorthernPolarSuite();
    runLocationAgeSuite();

    const timeZoneCount = runEveryTimeZoneSuite();
    log(`solar tests passed across ${timeZoneCount} timezones`);
}
