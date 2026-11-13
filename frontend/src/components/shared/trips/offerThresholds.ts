/**
 * When the date offered after a tick takes the tick as made on the spot and
 * when as a past travel being filled in (#2120). Starting values, to be tuned
 * on use; the browser tab is the only place they are read, since nothing
 * about a traveller's pace is sent to the server.
 */
export const OFFER = {
  /** Two ticks farther apart than this, made faster than SPEED_KMH allows, cannot both be on the spot. */
  JUMP_KM: 50,
  SPEED_KMH: 300,
  /** This many ticks within MANY_TICKS_MINUTES is a backfill: a day of sightseeing seldom passes ten places. */
  MANY_TICKS: 10,
  MANY_TICKS_MINUTES: 30,
  /** A new traveller almost always begins with where they have already been. */
  NEW_ACCOUNT_HOURS: 24,
  /** On a trip, a tick this close to the last answered place takes that answer's date rather than today's. */
  NEARBY_KM: 50,
  /** In past travels, a tick farther than this from the place that set the year asks again. */
  CARRIED_YEAR_KM: 1000,
  /** "Don't ask in this session" lasts this long, or until the tab closes. */
  SILENCE_HOURS: 12,
} as const;
