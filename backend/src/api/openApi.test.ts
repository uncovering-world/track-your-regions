/**
 * The OpenAPI document is what the route declarations render to (ADR-0072).
 *
 * A native client is generated from `packages/shared/src/openapi.generated.json`,
 * so a route or a schema changed without regenerating leaves that client
 * calling an API the backend no longer serves. The first spec is where that
 * fails, the way `apiTypes.test.ts` holds the web's types; the rest pin what
 * the builder makes of a declaration.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { repoFile } from '../testSupport/repoFile.js';
import { renderOpenApi, requestSchemasOf } from './generateOpenApi.js';
import { bodyComponentName, openApiDocumentOf, openApiPath, operationIdOf } from './openApi.js';
import { defineRoute, IMAGE, NO_BODY, REDIRECT, stream, type Route } from './route.js';

describe('the committed OpenAPI document', () => {
  it('is what the declarations render to', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed repository path, through repoFile()
    const committed = readFileSync(repoFile('packages', 'shared', 'src', 'openapi.generated.json'), 'utf8');
    expect(
      committed,
      'packages/shared/src/openapi.generated.json is not what the declarations render to: run `npm --prefix backend run api:openapi` and commit the result',
    ).toBe(await renderOpenApi());
  }, 30000);
});

const Place = z.strictObject({ id: z.number(), name: z.string().describe('What the place is called.') });
const PlaceList = z.strictObject({ places: z.array(Place) });
const renamePlaceSchema = z.object({ name: z.string().min(1) });
const Progress = z.strictObject({ done: z.number() });
const handler = async () => undefined as never;

type Operation = {
  operationId: string;
  summary?: string;
  tags: string[];
  'x-access': string;
  description?: string;
  parameters?: Array<{ name: string; in: string; required: boolean; description?: string; schema: unknown }>;
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
  security: unknown[];
};

function documentOf(routes: Route[], prefix = '/api/places') {
  const document = openApiDocumentOf(
    [{ prefix, routes }],
    { responses: [['Place', Place], ['PlaceList', PlaceList], ['Progress', Progress]], requests: [['renamePlaceSchema', renamePlaceSchema]] },
    '1.2.3',
  ) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Record<string, unknown>> } };
  return document;
}

describe('an operation from a declaration', () => {
  const routes = [
    defineRoute({
      method: 'get', path: '/', access: 'public', cache: 'shared-revalidate',
      summary: 'The GET / fixture',
      query: z.object({ near: z.string().describe('A place name.'), limit: z.coerce.number().int().optional() }),
      response: PlaceList, handler,
    }),
    defineRoute({
      method: 'put', path: '/:placeId', access: 'curator', cache: 'no-store',
      summary: 'The PUT /:placeId fixture',
      params: z.object({ placeId: z.coerce.number().int() }), body: renamePlaceSchema,
      response: Place, noContent: true, handler,
    }),
  ];
  const { paths, components } = documentOf(routes);

  it('is at the mounted path, with its parameters in braces', () => {
    expect(Object.keys(paths)).toEqual(['/api/places', '/api/places/{placeId}']);
    expect(paths['/api/places/{placeId}'].put.operationId).toBe('putPlacesByPlaceId');
    expect(paths['/api/places/{placeId}'].put.tags).toEqual(['places']);
  });

  it('reads its query and path parameters from the schemas, required as they are', () => {
    const [near, limit] = paths['/api/places'].get.parameters ?? [];
    expect(near).toMatchObject({ name: 'near', in: 'query', required: true, description: 'A place name.', schema: { type: 'string' } });
    expect(limit).toMatchObject({ name: 'limit', in: 'query', schema: { type: 'integer' } });
    expect(limit.required ?? false).toBe(false);
    expect(paths['/api/places/{placeId}'].put.parameters).toEqual([
      expect.objectContaining({ name: 'placeId', in: 'path', required: true }),
    ]);
  });

  it('names the body and the answer as components, and keeps the parameter objects out', () => {
    const put = paths['/api/places/{placeId}'].put;
    expect(put.requestBody?.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/RenamePlaceBody' });
    expect(put.responses['200'].content?.['application/json'].schema).toEqual({ $ref: '#/components/schemas/Place' });
    expect(put.responses).toHaveProperty('204');
    // Progress is a response schema no route here answers with, so it is left out.
    expect(Object.keys(components.schemas)).toEqual(['Error', 'Place', 'PlaceList', 'RenamePlaceBody']);
    expect(components.schemas.PlaceList).toMatchObject({ properties: { places: { items: { $ref: '#/components/schemas/Place' } } } });
    expect(components.schemas.Place).toMatchObject({ properties: { name: { description: 'What the place is called.' } } });
  });

  it('carries the summary the declaration states', () => {
    expect(paths['/api/places'].get.summary).toBe('The GET / fixture');
  });

  it('states who may call', () => {
    expect(paths['/api/places'].get.security).toEqual([]);
    expect(paths['/api/places/{placeId}'].put.security).toEqual([{ bearer: [] }]);
    expect(paths['/api/places/{placeId}'].put['x-access']).toBe('curator');
    expect(paths['/api/places/{placeId}'].put.description).toBe('Requires a curator or an admin.');
  });

  it('answers every failure with the error body', () => {
    expect(paths['/api/places'].get.responses.default.content?.['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/Error' });
  });
});

describe('the answers that are not a JSON body', () => {
  const { paths } = documentOf([
    defineRoute({ summary: 'The GET /progress fixture', method: 'get', path: '/progress', access: 'admin', cache: 'revalidate', response: stream(Progress), handler }),
    defineRoute({ summary: 'The GET /picture fixture', method: 'get', path: '/picture', access: 'admin', cache: { maxAge: 60 }, response: IMAGE, handler }),
    defineRoute({ summary: 'The GET /away fixture', method: 'get', path: '/away', access: 'public', cache: 'no-store', response: REDIRECT, handler }),
    defineRoute({ summary: 'The DELETE /mine fixture', method: 'delete', path: '/mine', access: 'signed-in', cache: 'no-store', response: NO_BODY, handler }),
  ]);

  it('are a stream of named events, an image, a redirect and a bare 204', () => {
    // The body of a stream is framed text; the schema of each event is named beside it.
    expect(paths['/api/places/progress'].get.responses['200'].content?.['text/event-stream']).toMatchObject({
      schema: { type: 'string' },
      'x-event-schema': { $ref: '#/components/schemas/Progress' },
    });
    expect(paths['/api/places/picture'].get.responses['200'].content).toHaveProperty('image/*');
    expect(Object.keys(paths['/api/places/away'].get.responses)).toEqual(['302', 'default']);
    expect(Object.keys(paths['/api/places/mine'].delete.responses)).toEqual(['204', 'default']);
  });
});

describe('what the builder refuses', () => {
  it('two routes that would make one operation', () => {
    const route = defineRoute({ summary: 'The GET /a-b fixture', method: 'get', path: '/a-b', access: 'public', cache: 'no-store', response: Place, handler });
    const other = defineRoute({ summary: 'The GET /a_b fixture', method: 'get', path: '/a_b', access: 'public', cache: 'no-store', response: Place, handler });
    expect(() => documentOf([route, other])).toThrow('Two routes make the operation getPlacesAB');
  });

  it('a schema that holds itself without a name, which no client could refer to', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a recursive schema needs the annotation
    const node: z.ZodType<any> = z.lazy(() => z.object({ name: z.string(), children: z.array(node) }));
    const route = defineRoute({
      method: 'post', path: '/tree', access: 'admin', cache: 'no-store',
      summary: 'The POST /tree fixture',
      body: z.object({ root: node }), response: Place, handler,
    });
    expect(() => documentOf([route])).toThrow('got no name of its own: give the schema one with .meta({ id })');
  });

  it('a stream whose event schema has no name, which x-event-schema could not refer to', () => {
    const route = defineRoute({
      method: 'get', path: '/ticks', access: 'admin', cache: 'revalidate',
      summary: 'The GET /ticks fixture',
      response: stream(z.strictObject({ tick: z.number() })), handler,
    });
    expect(() => documentOf([route])).toThrow("A stream's event schema has no name");
  });

  it('two routes described alike, which a client could not tell apart', () => {
    const one = defineRoute({ method: 'get', path: '/a', summary: 'Get the place', access: 'public', cache: 'no-store', response: Place, handler });
    const two = defineRoute({ method: 'get', path: '/b', summary: 'Get the place', access: 'public', cache: 'no-store', response: Place, handler });
    expect(() => documentOf([one, two])).toThrow('getPlacesB and getPlacesA have the same summary');
  });

  it('a path OpenAPI cannot state', () => {
    expect(() => openApiPath('/api', '/files/*')).toThrow('/api/files/* is not a path OpenAPI can state');
  });
});

describe('the request schemas the names come from', () => {
  const loginSchema = z.object({ email: z.string() });

  it('are every module\'s exports, a re-export counting once', () => {
    const schemas = requestSchemasOf([['auth.ts', { loginSchema, LIMIT: 5 }], ['index.ts', { loginSchema, renamePlaceSchema }]]);
    expect(schemas.map(([name]) => name)).toEqual(['loginSchema', 'renamePlaceSchema']);
  });

  it('refuse one name holding two different schemas', () => {
    expect(() => requestSchemasOf([['auth.ts', { loginSchema }], ['index.ts', { loginSchema: z.object({}) }]]))
      .toThrow('loginSchema is two different schemas, in types/auth.ts and types/index.ts');
  });
});

describe('the names', () => {
  it('join the prefix and turn a :param into {param}', () => {
    expect(openApiPath('/', '/health')).toBe('/health');
    expect(openApiPath('/api/world-views', '/')).toBe('/api/world-views');
    expect(openApiPath('/api/world-views', '/:worldViewId/regions')).toBe('/api/world-views/{worldViewId}/regions');
  });

  it('make an operation id from the method and the path', () => {
    expect(operationIdOf('get', '/health')).toBe('getHealth');
    expect(operationIdOf('post', '/api/admin/wv-import/matches/{worldViewId}/accept')).toBe('postAdminWvImportMatchesByWorldViewIdAccept');
  });

  it('name a request body after its export', () => {
    expect(bodyComponentName('renameRegionSchema')).toBe('RenameRegionBody');
    expect(bodyComponentName('wvImportWaterReviewBodySchema')).toBe('WvImportWaterReviewBody');
  });
});
