# Changelog

## 1.0.0 — 2026-10-17

First packaged GitHub release of Sunset Appearance, for GNOME Shell 45–51.

- Switch GNOME's native appearance preference at civil dusk and dawn.
- Request a coarse GeoClue location fix, with Night Light coordinates as a fallback.
- Respect manual appearance changes and offer a temporary light or dark override.
- Show the current schedule and cached location in preferences.
- Restore the previous appearance on disable when no later manual change overrides it.
- Use Shell's appearance transition, including the API location used by Shell 51.
- Gate release packages on ESLint, solar and policy tests, strict schema validation,
  archive inspection, and shexli static analysis.
- Ship schema XML without compiled schemas; GNOME Shell compiles it on installation.

The shexli gate preserves its full report and permits only the documented false
positive concerning the GNOME 51 version declaration. Static checks do not replace
real-session compatibility testing on each supported Shell version.
