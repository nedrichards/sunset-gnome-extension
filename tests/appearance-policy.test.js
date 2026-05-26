import {
    didUserOverrideScheme,
    shouldApplyScheme,
    shouldRestoreOnDisable,
} from '../lib/appearance-policy.js';
import {
    SCHEME_DARK,
    SCHEME_DEFAULT,
} from '../lib/solar.js';

const log = globalThis.print ?? console.log;
const validSchemes = [SCHEME_DARK, SCHEME_DEFAULT];

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function applyDecision(options) {
    return shouldApplyScheme({
        validSchemes,
        ...options,
    });
}

{
    const decision = applyDecision({
        scheme: SCHEME_DARK,
        currentScheme: SCHEME_DEFAULT,
        manualOverride: false,
        forceTransition: false,
    });
    assert(decision.action === 'apply', 'Different valid scheme should be applied');
    assert(decision.lastAppliedScheme === SCHEME_DARK, 'Applied scheme should be recorded');
    assert(decision.manualOverride === false, 'Applying should clear manual override');
}

{
    const decision = applyDecision({
        scheme: SCHEME_DARK,
        currentScheme: SCHEME_DARK,
        manualOverride: false,
        forceTransition: false,
    });
    assert(decision.action === 'record', 'Matching valid scheme should only be recorded');
    assert(decision.lastAppliedScheme === SCHEME_DARK, 'Matching scheme should be recorded');
}

{
    const decision = applyDecision({
        scheme: SCHEME_DARK,
        currentScheme: SCHEME_DEFAULT,
        manualOverride: true,
        forceTransition: false,
    });
    assert(decision.action === 'defer', 'Manual override should defer routine changes');
    assert(decision.lastAppliedScheme === null, 'Deferred scheme should not be recorded as applied');
    assert(decision.manualOverride === true, 'Deferred scheme should preserve manual override');
}

{
    const decision = applyDecision({
        scheme: SCHEME_DARK,
        currentScheme: SCHEME_DEFAULT,
        manualOverride: true,
        forceTransition: true,
    });
    assert(decision.action === 'apply', 'Scheduled transition should override prior manual choice');
    assert(decision.manualOverride === false, 'Forced apply should clear manual override');
}

{
    const decision = applyDecision({
        scheme: 'invalid',
        currentScheme: SCHEME_DEFAULT,
        manualOverride: false,
        forceTransition: false,
    });
    assert(decision.action === 'ignore', 'Invalid scheme should be ignored');
    assert(decision.lastAppliedScheme === null, 'Invalid scheme should not be recorded');
}

{
    assert(didUserOverrideScheme(SCHEME_DEFAULT, SCHEME_DARK),
        'Changing away from the last applied scheme should count as manual override');
    assert(!didUserOverrideScheme(SCHEME_DARK, SCHEME_DARK),
        'Matching the last applied scheme should not count as manual override');
    assert(!didUserOverrideScheme(SCHEME_DEFAULT, null),
        'No last applied scheme means no manual override can be detected');
}

{
    assert(shouldRestoreOnDisable({
        manualOverride: false,
        lastAppliedScheme: SCHEME_DARK,
        baselineScheme: SCHEME_DEFAULT,
        currentScheme: SCHEME_DARK,
    }), 'Disable should restore baseline when current scheme is still extension-applied');

    assert(!shouldRestoreOnDisable({
        manualOverride: true,
        lastAppliedScheme: SCHEME_DARK,
        baselineScheme: SCHEME_DEFAULT,
        currentScheme: SCHEME_DARK,
    }), 'Disable should not restore after manual override');

    assert(!shouldRestoreOnDisable({
        manualOverride: false,
        lastAppliedScheme: SCHEME_DARK,
        baselineScheme: SCHEME_DEFAULT,
        currentScheme: SCHEME_DEFAULT,
    }), 'Disable should not restore if user already changed current scheme');

    assert(!shouldRestoreOnDisable({
        manualOverride: false,
        lastAppliedScheme: SCHEME_DARK,
        baselineScheme: SCHEME_DARK,
        currentScheme: SCHEME_DARK,
    }), 'Disable should not restore when baseline and current scheme already match');
}

log('appearance policy tests passed');
