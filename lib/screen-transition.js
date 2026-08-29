// GNOME Shell 51 exposes this on Main; releases 45–50 expose it through the
// layout manager. Keep the version-specific lookup isolated and testable.
export function runScreenTransition(shellMain) {
    const screenTransition = shellMain.screenTransition ??
        shellMain.layoutManager.screenTransition;
    screenTransition.run();
}
