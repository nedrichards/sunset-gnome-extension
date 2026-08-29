import {runScreenTransition} from '../lib/screen-transition.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

{
    let newApiRuns = 0;
    let legacyApiRuns = 0;
    runScreenTransition({
        screenTransition: {run: () => newApiRuns++},
        layoutManager: {
            screenTransition: {run: () => legacyApiRuns++},
        },
    });
    assert(newApiRuns === 1, 'Should use Main.screenTransition when it is available');
    assert(legacyApiRuns === 0, 'Should not use the legacy API when the new API is available');
}

{
    let legacyApiRuns = 0;
    runScreenTransition({
        layoutManager: {
            screenTransition: {run: () => legacyApiRuns++},
        },
    });
    assert(legacyApiRuns === 1,
        'Should fall back to Main.layoutManager.screenTransition on Shell 45 through 50');
}

(globalThis.print ?? console.log)('screen transition tests passed');
