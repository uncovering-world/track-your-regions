/**
 * The review queue's rules both sides apply.
 *
 * `QUEUE_MAP_NAMES_MAX` is the most places one read of the map's names answers
 * (#2501): the request schema refuses a longer list, and the map's short list
 * asks for no more than this. The short list names the places under one pin
 * once the map is as close as it frames, or those standing on one point: a
 * square and the fountain in it, a museum and its courtyard. A hundred is the
 * queue's own page maximum, already more than one popover can be read
 * through, and it keeps the statement's id array small.
 */

export const QUEUE_MAP_NAMES_MAX = 100;
