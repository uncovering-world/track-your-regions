/**
 * The OpenAPI 3.1 document, computed from the route declarations (ADR-0071,
 * ADR-0072).
 *
 * A declaration already says everything a client generator asks: the method
 * and path, who may call, what the parameters and the body are, and what comes
 * back. So nothing here is written twice: the paths come from `routes/mounts.ts`,
 * and the components are the response schemas under their export names and the
 * request bodies under the names the modules in `types/` export them by.
 *
 * `zod-openapi` turns the schemas into the document: parameters from the path
 * and query objects, `$ref`s wherever a named schema is nested, and each schema
 * rendered as what a client sends where it is a request and as what it gets
 * back where it is a response. What stays here is what no library knows: how
 * a declaration reads as an operation.
 */

import { z } from 'zod/v4';
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponseObject,
  type ZodOpenApiResponsesObject,
} from 'zod-openapi';
import type { Mount } from '../routes/mounts.js';
import { isImage, isRedirect, isStream, NO_BODY, type Route } from './route.js';

/** The named schemas a component can be: the response schemas and the request schemas, each by export name. */
export interface NamedSchemas {
  readonly responses: ReadonlyArray<readonly [string, z.ZodType]>;
  readonly requests: ReadonlyArray<readonly [string, z.ZodType]>;
}

/**
 * Every failure answers with a sentence under `error` (`middleware/errorHandler.ts`).
 * Some carry more beside it — a validation error its `details`, a refusal the
 * row as it now stands — so the rest is left open.
 */
const ErrorBody = z.looseObject({
  error: z.string().describe('What went wrong, written for the reader.'),
  code: z.string().optional().describe('A cause the reader can act on, where there is one.'),
});

const ACCESS_NOTE: Record<Route['access'], string | undefined> = {
  public: undefined,
  optional: 'A signed-in caller may get a different answer.',
  'signed-in': 'Requires a signed-in caller.',
  curator: 'Requires a curator or an admin.',
  admin: 'Requires an admin.',
};

/**
 * `/api/world-views` + `/:id/regions` → `/api/world-views/{id}/regions`. A route
 * at `/` is the prefix itself: Express answers both spellings, and a path
 * with a trailing slash reads to a client generator as another route.
 */
export function openApiPath(prefix: string, path: string): string {
  const base = prefix.replace(/\/$/, '');
  const joined = path === '/' && base !== '' ? base : `${base}${path}`;
  if (/[?*()+]/.test(joined)) throw new Error(`${joined} is not a path OpenAPI can state`);
  return joined.replace(/:(\w+)/g, '{$1}');
}

const pascal = (word: string) => word.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');

/** `get` + `/api/world-views/{id}/regions` → `getWorldViewsByIdRegions`. */
export function operationIdOf(method: string, path: string): string {
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== 'api');
  return method + segments.map((segment) => (
    segment.startsWith('{') ? `By${pascal(segment.slice(1, -1))}` : pascal(segment)
  )).join('');
}

/** `wvImportWaterReviewBodySchema` → `WvImportWaterReviewBody`; `renameRegionSchema` → `RenameRegionBody`. */
export function bodyComponentName(exportName: string): string {
  const base = pascal(exportName.replace(/Schema$/, ''));
  return base.endsWith('Body') ? base : `${base}Body`;
}

/**
 * A server-sent stream's body is framed text, `event:` and `data:` lines, so
 * that is its schema. What each `data:` line holds has no place of its own in
 * OpenAPI 3.1 (3.2 adds `itemSchema`), so the event schema is named beside it
 * in `x-event-schema`, as a component a client can generate the type from.
 */
function streamAnswer(events: z.ZodType, nameOf: (schema: z.ZodType) => string | undefined): ZodOpenApiResponseObject {
  const name = nameOf(events);
  if (!name) throw new Error('A stream\'s event schema has no name: export it from a module in responses/');
  return {
    description: 'A server-sent event stream. Each `data:` line is one event of the schema `x-event-schema` names, as JSON.',
    content: {
      'text/event-stream': {
        schema: z.string().describe('Server-sent events, framed as the EventSource format defines.'),
        'x-event-schema': { $ref: `#/components/schemas/${name}` },
      },
    },
  };
}

function answersOf(route: Route, nameOf: (schema: z.ZodType) => string | undefined): ZodOpenApiResponsesObject {
  const answer = route.response;
  const failure = { description: 'A failure.', content: { 'application/json': { schema: ErrorBody } } };
  if (isStream(answer)) return { 200: streamAnswer(answer.events, nameOf), default: failure };
  if (isRedirect(answer)) return { 302: { description: 'A redirect, to the address in `Location`.' }, default: failure };
  if (isImage(answer)) return { 200: { description: 'The image.', content: { 'image/*': {} } }, default: failure };
  if (answer === NO_BODY) return { 204: { description: 'Done; there is no body.' }, default: failure };
  const status = route.status ?? 200;
  return {
    [status]: {
      description: status === 201 ? 'Created.' : 'The answer.',
      content: { 'application/json': { schema: answer as z.ZodType } },
    },
    ...(route.noContent ? { 204: { description: 'There is none.' } } : {}),
    default: failure,
  };
}

function securityOf(access: Route['access']): Array<Record<string, string[]>> {
  if (access === 'public') return [];
  if (access === 'optional') return [{}, { bearer: [] }];
  return [{ bearer: [] }];
}

function operationOf(
  id: string,
  tag: string,
  route: Route,
  nameOf: (schema: z.ZodType) => string | undefined,
): ZodOpenApiOperationObject {
  const note = ACCESS_NOTE[route.access];
  return {
    operationId: id,
    tags: [tag],
    ...(note ? { description: note } : {}),
    'x-access': route.access,
    requestParams: {
      ...(route.params ? { path: route.params as z.ZodObject } : {}),
      ...(route.query ? { query: route.query as z.ZodObject } : {}),
    },
    ...(route.body ? { requestBody: { required: true, content: { 'application/json': { schema: route.body } } } } : {}),
    responses: answersOf(route, nameOf),
    security: securityOf(route.access),
  };
}

/** The document, as `packages/shared/src/openapi.generated.json` holds it. */
export function openApiDocumentOf(mounts: readonly Mount[], named: NamedSchemas, version: string): Record<string, unknown> {
  const bodyNames = new Map(named.requests.map(([name, schema]) => [schema, bodyComponentName(name)]));
  const responseNames = new Map(named.responses.map(([name, schema]) => [schema, name]));
  const nameOf = (schema: z.ZodType) => responseNames.get(schema);
  const bodies = new Map<string, z.ZodType>();
  const paths: ZodOpenApiPathsObject = {};
  const operationIds = new Set<string>();
  for (const { prefix, routes } of mounts) {
    for (const route of routes) {
      const path = openApiPath(prefix, route.path);
      const id = operationIdOf(route.method, path);
      if (operationIds.has(id)) throw new Error(`Two routes make the operation ${id}; rename one of the paths`);
      operationIds.add(id);
      const bodyName = route.body && bodyNames.get(route.body);
      if (route.body && bodyName) bodies.set(bodyName, route.body);
      const tag = path.split('/').find((segment) => segment !== '' && segment !== 'api') ?? '';
      paths[path] = { ...paths[path], [route.method]: operationOf(id, tag, route, nameOf) };
    }
  }

  const document = createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Track Your Regions API',
      version,
      description: 'Generated from the route declarations (ADR-0071) by `npm --prefix backend run api:openapi`; do not edit.',
    },
    // Relative, so the document describes whichever deployment serves it.
    servers: [{ url: '/' }],
    paths,
    components: {
      schemas: { ...Object.fromEntries(named.responses), ...Object.fromEntries(bodies), Error: ErrorBody },
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
  });
  // A schema the library meets twice without a name, or one that holds
  // itself, gets a made-up `__schemaN`, which a generated client would then
  // carry as a type name. Every such schema is named where it is declared.
  const schemas = document.components?.schemas ?? {};
  const madeUp = Object.keys(schemas).filter((name) => name.startsWith('__'));
  if (madeUp.length > 0) {
    throw new Error(`${madeUp.join(', ')} got no name of its own: give the schema one with .meta({ id }) where it is declared`);
  }
  // A component registered by name is rendered in both directions, so a
  // named schema inside a request body also leaves an `…Output` twin nobody
  // refers to; and a response schema no route answers with has no reader.
  // Sorted, since the library emits them in the order it meets them, which is
  // not stable from one run to the next, and the committed document is diffed.
  const reached = reachedFrom(JSON.stringify(document.paths), schemas);
  const kept = Object.fromEntries(Object.keys(schemas).filter((name) => reached.has(name)).sort()
    .map((name) => [name, schemas[name]]));
  return { ...document, components: { ...document.components, schemas: kept } } as unknown as Record<string, unknown>;
}

/** The components the paths refer to, and the ones those refer to in turn. */
function reachedFrom(paths: string, schemas: Record<string, unknown>): Set<string> {
  const refsIn = (text: string) => [...text.matchAll(/"#\/components\/schemas\/([^"]+)"/g)].map((match) => match[1]);
  const reached = new Set<string>();
  const waiting = refsIn(paths);
  for (let name = waiting.pop(); name !== undefined; name = waiting.pop()) {
    if (reached.has(name)) continue;
    reached.add(name);
    if (name in schemas) waiting.push(...refsIn(JSON.stringify(schemas[name])));
  }
  return reached;
}
