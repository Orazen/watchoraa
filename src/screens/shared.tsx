// Shared module-scope types for the screen components extracted from App.tsx.
// Only helpers/types needed by 2+ screens live here; everything else is
// imported in each screen from its canonical module (usually src/api.ts).
export type Tone = 'online' | 'busy' | 'warning' | 'error';
