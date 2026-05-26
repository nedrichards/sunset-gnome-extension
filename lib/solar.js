export const CIVIL_ZENITH_DEGREES = 96;
export const SCHEME_DARK = 'prefer-dark';
export const SCHEME_DEFAULT = 'default';

const DAY_MS = 24 * 60 * 60 * 1000;

function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

function toDegrees(radians) {
    return radians * 180 / Math.PI;
}

function sinDegrees(degrees) {
    return Math.sin(toRadians(degrees));
}

function cosDegrees(degrees) {
    return Math.cos(toRadians(degrees));
}

function tanDegrees(degrees) {
    return Math.tan(toRadians(degrees));
}

function acosDegrees(value) {
    return toDegrees(Math.acos(value));
}

function atanDegrees(value) {
    return toDegrees(Math.atan(value));
}

function normalizeDegrees(degrees) {
    return ((degrees % 360) + 360) % 360;
}

function normalizeHours(hours) {
    return ((hours % 24) + 24) % 24;
}

function dayOfYearUtc(year, month, day) {
    const utcMidnight = Date.UTC(year, month, day, 0, 0, 0, 0);
    const utcDate = new Date(utcMidnight);
    const yearStart = Date.UTC(utcDate.getUTCFullYear(), 0, 0, 0, 0, 0, 0);
    return Math.floor((utcMidnight - yearStart) / DAY_MS);
}

function isSameLocalDay(date, year, month, day) {
    return date.getFullYear() === year &&
        date.getMonth() === month &&
        date.getDate() === day;
}

function addLocalDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12, 0, 0, 0);
}

function nextLocalMidnight(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
}

export function isValidCoordinate(latitude, longitude) {
    return Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
}

export function calculateSolarEvent(date, latitude, longitude, event, zenith = CIVIL_ZENITH_DEGREES) {
    if (!isValidCoordinate(latitude, longitude))
        throw new Error(`Invalid coordinates: ${latitude}, ${longitude}`);

    if (event !== 'dawn' && event !== 'dusk')
        throw new Error(`Unknown solar event: ${event}`);

    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const candidates = [];
    const uneventfulKinds = [];

    for (let dayOffset = -2; dayOffset <= 2; dayOffset++) {
        const candidate = calculateSolarEventForUtcDay(year, month, day + dayOffset,
            latitude, longitude, event, zenith);
        if (candidate.kind !== 'event') {
            uneventfulKinds.push(candidate.kind);
            continue;
        }

        if (isSameLocalDay(candidate.date, year, month, day))
            candidates.push(candidate);
    }

    if (candidates.length > 0) {
        candidates.sort((left, right) => left.date - right.date);
        return event === 'dawn' ? candidates[0] : candidates[candidates.length - 1];
    }

    if (uneventfulKinds.includes('never-rises')) {
        return {
            kind: 'never-rises',
            date: null,
        };
    }

    if (uneventfulKinds.includes('never-sets')) {
        return {
            kind: 'never-sets',
            date: null,
        };
    }

    return {
        kind: 'never-rises',
        date: null,
    };
}

function calculateSolarEventForUtcDay(year, month, day, latitude, longitude, event, zenith) {
    const utcMidnight = Date.UTC(year, month, day, 0, 0, 0, 0);
    const utcDate = new Date(utcMidnight);
    const utcYear = utcDate.getUTCFullYear();
    const utcMonth = utcDate.getUTCMonth();
    const utcDay = utcDate.getUTCDate();
    const n = dayOfYearUtc(year, month, day);
    const longitudeHour = longitude / 15;
    const approximateTime = n + (((event === 'dawn' ? 6 : 18) - longitudeHour) / 24);
    const meanAnomaly = (0.9856 * approximateTime) - 3.289;

    let trueLongitude = meanAnomaly +
        (1.916 * sinDegrees(meanAnomaly)) +
        (0.020 * sinDegrees(2 * meanAnomaly)) +
        282.634;
    trueLongitude = normalizeDegrees(trueLongitude);

    let rightAscension = atanDegrees(0.91764 * tanDegrees(trueLongitude));
    rightAscension = normalizeDegrees(rightAscension);

    const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
    const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90;
    rightAscension += longitudeQuadrant - rightAscensionQuadrant;
    rightAscension /= 15;

    const sinDeclination = 0.39782 * sinDegrees(trueLongitude);
    const cosDeclination = Math.cos(Math.asin(sinDeclination));

    const cosHourAngle = (cosDegrees(zenith) - (sinDeclination * sinDegrees(latitude))) /
        (cosDeclination * cosDegrees(latitude));

    if (cosHourAngle > 1) {
        return {
            kind: 'never-rises',
            date: null,
        };
    }

    if (cosHourAngle < -1) {
        return {
            kind: 'never-sets',
            date: null,
        };
    }

    let hourAngle = event === 'dawn'
        ? 360 - acosDegrees(cosHourAngle)
        : acosDegrees(cosHourAngle);
    hourAngle /= 15;

    const localMeanTime = hourAngle + rightAscension - (0.06571 * approximateTime) - 6.622;
    const utcHour = normalizeHours(localMeanTime - longitudeHour);
    const timestamp = Date.UTC(utcYear, utcMonth, utcDay, 0, 0, 0, 0) +
        (utcHour * 60 * 60 * 1000);

    return {
        kind: 'event',
        date: new Date(timestamp),
    };
}

export function calculateSolarDay(date, latitude, longitude, zenith = CIVIL_ZENITH_DEGREES) {
    const dawn = calculateSolarEvent(date, latitude, longitude, 'dawn', zenith);
    const dusk = calculateSolarEvent(date, latitude, longitude, 'dusk', zenith);

    if (dawn.kind === 'never-rises' || dusk.kind === 'never-rises') {
        return {
            kind: 'always-night',
            dawn: null,
            dusk: null,
        };
    }

    if (dawn.kind === 'never-sets' || dusk.kind === 'never-sets') {
        return {
            kind: 'always-day',
            dawn: null,
            dusk: null,
        };
    }

    return {
        kind: 'normal',
        dawn: dawn.date,
        dusk: dusk.date,
    };
}

export function classifySolarState(now, latitude, longitude, zenith = CIVIL_ZENITH_DEGREES) {
    const today = calculateSolarDay(now, latitude, longitude, zenith);

    if (today.kind === 'always-night') {
        return {
            isNight: true,
            scheme: SCHEME_DARK,
            period: 'always-night',
            dawn: null,
            dusk: null,
            nextTransition: null,
            nextCheck: nextLocalMidnight(now),
        };
    }

    if (today.kind === 'always-day') {
        return {
            isNight: false,
            scheme: SCHEME_DEFAULT,
            period: 'always-day',
            dawn: null,
            dusk: null,
            nextTransition: null,
            nextCheck: nextLocalMidnight(now),
        };
    }

    if (now < today.dawn) {
        return {
            isNight: true,
            scheme: SCHEME_DARK,
            period: 'before-dawn',
            dawn: today.dawn,
            dusk: today.dusk,
            nextTransition: today.dawn,
            nextCheck: today.dawn,
        };
    }

    if (now < today.dusk) {
        return {
            isNight: false,
            scheme: SCHEME_DEFAULT,
            period: 'daytime',
            dawn: today.dawn,
            dusk: today.dusk,
            nextTransition: today.dusk,
            nextCheck: today.dusk,
        };
    }

    const tomorrow = calculateSolarDay(addLocalDays(now, 1), latitude, longitude, zenith);
    const nextTransition = tomorrow.kind === 'normal' ? tomorrow.dawn : null;

    return {
        isNight: true,
        scheme: SCHEME_DARK,
        period: 'after-dusk',
        dawn: today.dawn,
        dusk: today.dusk,
        nextTransition,
        nextCheck: nextTransition || nextLocalMidnight(now),
    };
}

export function describeLocationAge(timestampSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
    const ageSeconds = Math.max(0, nowSeconds - timestampSeconds);

    if (ageSeconds < 90)
        return 'location age under 2 minutes';

    const ageMinutes = Math.round(ageSeconds / 60);
    if (ageMinutes < 120)
        return `location age ${ageMinutes} minutes`;

    const ageHours = Math.round(ageMinutes / 60);
    if (ageHours < 72)
        return `location age ${ageHours} hours`;

    const ageDays = Math.round(ageHours / 24);
    return `location age ${ageDays} days`;
}
