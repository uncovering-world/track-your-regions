/**
 * The source that fills Bridges & engineering marvels, and the kind it fills
 * (migration 150): a module of its own, so a reader of the id alone (the
 * OpenStreetMap layer's build, which keeps the kind's objects whole and reads
 * their lines, ADR-0212) does not load the kind's classifier and its readers.
 */
export const BRIDGES_SOURCE_ID = 8;
