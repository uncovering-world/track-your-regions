import { describe, expect, it, vi } from 'vitest';
import { articleLead, LEAD_CHARS, VISIT_READINGS, visitQuestion } from './visitReading.js';

const LUPANAR = {
  name: 'Lupanar', countries: ['Italy'], kinds: ['Archaeology'],
  map: 'historic=archaeological_site', article: 'https://en.wikipedia.org/wiki/Lupanar_(Pompeii)',
};

const answering = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json' },
})) as unknown as typeof fetch;

describe("Jev's reading of what a visitor finds (#1768)", () => {
  it('asks over the six readings, with the lead and the tag where there are any', () => {
    const question = visitQuestion(LUPANAR, 'The Lupanar is a ruined building in Pompeii.');

    expect(Object.keys(question.criteria)).toEqual([...VISIT_READINGS]);
    expect(question.state).toEqual({
      name: 'Lupanar', countries: ['Italy'], kinds: ['Archaeology'],
      openstreetmap_tag: 'historic=archaeological_site', wikipedia_lead: 'The Lupanar is a ruined building in Pompeii.',
    });
    expect(visitQuestion({ ...LUPANAR, map: null }, null).state).toEqual({
      name: 'Lupanar', countries: ['Italy'], kinds: ['Archaeology'],
    });
  });

  it("reads the lead of the place's English article, cut to the measured length", async () => {
    const fetchImpl = answering({ query: { pages: [{ title: 'Lupanar (Pompeii)', extract: `  ${'x'.repeat(2000)}  ` }] } });

    const lead = await articleLead(LUPANAR.article, fetchImpl);

    expect(lead).toBe('x'.repeat(LEAD_CHARS));
    const body = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toContain('prop=extracts');
    expect(body).toContain('titles=Lupanar+%28Pompeii%29');
  });

  it('reads no lead of an article in another language or a missing page, and fails on a failed call', async () => {
    const never = vi.fn() as unknown as typeof fetch;
    expect(await articleLead('https://it.wikipedia.org/wiki/Lupanare', never)).toBeNull();
    expect(await articleLead(null, never)).toBeNull();
    expect(never).not.toHaveBeenCalled();

    expect(await articleLead(LUPANAR.article, answering({ query: { pages: [{ title: 'Lupanar', missing: true }] } }))).toBeNull();
    const failing = vi.fn(async () => { throw new Error('refused'); }) as unknown as typeof fetch;
    await expect(articleLead(LUPANAR.article, failing)).rejects.toThrow(/the lead of Lupanar \(Pompeii\)/);
  });

  it('asks once and never waits out a refusal, since a curator is waiting', async () => {
    const throttled = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '1' } })) as unknown as typeof fetch;

    await expect(articleLead(LUPANAR.article, throttled)).rejects.toThrow(/the lead of Lupanar/);
    expect(throttled).toHaveBeenCalledTimes(1);
  });
});
