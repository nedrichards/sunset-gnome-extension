export function shouldApplyScheme({
    scheme,
    currentScheme,
    manualOverride,
    forceTransition,
    validSchemes,
}) {
    if (!validSchemes.includes(scheme)) {
        return {
            action: 'ignore',
            lastAppliedScheme: null,
            manualOverride,
        };
    }

    if (manualOverride && !forceTransition) {
        return {
            action: 'defer',
            lastAppliedScheme: null,
            manualOverride,
        };
    }

    if (currentScheme === scheme) {
        return {
            action: 'record',
            lastAppliedScheme: scheme,
            manualOverride,
        };
    }

    return {
        action: 'apply',
        lastAppliedScheme: scheme,
        manualOverride: false,
    };
}

export function didUserOverrideScheme(currentScheme, lastAppliedScheme) {
    return Boolean(lastAppliedScheme) && currentScheme !== lastAppliedScheme;
}

export function shouldRestoreOnDisable({
    manualOverride,
    lastAppliedScheme,
    baselineScheme,
    currentScheme,
}) {
    return !manualOverride &&
        Boolean(lastAppliedScheme) &&
        currentScheme === lastAppliedScheme &&
        baselineScheme !== currentScheme;
}
