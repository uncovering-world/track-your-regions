/**
 * The status a route answers when a service outside the stack fails it
 * (#2428): the outside service's failure, never the route's own 500, which
 * says the server itself failed.
 */

/** No answer at all: 504 where the route's own deadline ran out, 502 where the request failed otherwise. */
export function unreachedStatus(error: unknown): 502 | 504 {
  return error instanceof Error && error.name === 'TimeoutError' ? 504 : 502;
}

/** An answer the route passes on: a refusal keeps its own status, and a server error of the service's is a 502 of the route's. */
export function passedStatus(status: number): number {
  return status >= 500 ? 502 : status;
}
