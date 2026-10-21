import { describe, expect, it, vi } from 'vitest';
import { WaitBudget } from '../sourceRetry.js';
import { articleLead, articleLeads, LEAD_CHARS, LEADS_AT_ONCE, VISIT_READINGS, visitQuestion } from './visitReading.js';

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

describe("a run's leads, read together (#1770)", () => {
  const ROME = 'https://en.wikipedia.org/wiki/Catacombs_of_Rome';
  const EBORACUM = 'https://en.wikipedia.org/wiki/Eboracum';

  it('asks many titles at once, and files each lead under every URL that names its page', async () => {
    const fetchImpl = answering({
      query: {
        normalized: [{ from: 'Catacombs_of_Rome', to: 'Catacombs of Rome' }],
        pages: [
          { title: 'Catacombs of Rome', extract: 'The Catacombs of Rome are ancient catacombs.' },
          { title: 'Eboracum', extract: 'Eboracum was a fort and later a city.' },
        ],
      },
    });

    const leads = await articleLeads([ROME, EBORACUM, null], { userAgent: 'test', fetchImpl }, new WaitBudget(0));

    expect(leads.get(ROME)).toBe('The Catacombs of Rome are ancient catacombs.');
    expect(leads.get(EBORACUM)).toBe('Eboracum was a fort and later a city.');
    expect(leads.get(null)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it(`asks ${LEADS_AT_ONCE} titles per ask`, async () => {
    const urls = Array.from({ length: LEADS_AT_ONCE + 1 }, (_, i) => `https://en.wikipedia.org/wiki/Site_${i}`);
    const fetchImpl = answering({ query: { pages: urls.map((_, i) => ({ title: `Site ${i}` })) } });

    const leads = await articleLeads(urls, { userAgent: 'test', fetchImpl }, new WaitBudget(0));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Answered, with a page and no extract: no lead, which is an answer.
    expect(leads.get(urls[0])).toBeNull();
  });

  it('files nothing of an answer that holds no page for a title, or that Wikipedia cut short', async () => {
    const holdsNone = answering({ query: { pages: [{ title: 'Catacombs of Rome', extract: 'Catacombs.' }] } });
    const one = await articleLeads([ROME, EBORACUM], { userAgent: 'test', fetchImpl: holdsNone }, new WaitBudget(0));
    expect(one.get(ROME)).toBe('Catacombs.');
    expect(one.has(EBORACUM)).toBe(false);

    const cut = answering({ continue: { excontinue: '1', continue: '||' }, query: { pages: [{ title: 'Eboracum' }] } });
    expect((await articleLeads([EBORACUM], { userAgent: 'test', fetchImpl: cut }, new WaitBudget(0))).has(EBORACUM)).toBe(false);
  });

  it('leaves out the articles of an ask Wikipedia refused, rather than calling them leadless', async () => {
    const fetchImpl = vi.fn(async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch;

    const leads = await articleLeads([EBORACUM, null], { userAgent: 'test', fetchImpl }, new WaitBudget(0));

    expect(leads.has(EBORACUM)).toBe(false);
    expect(leads.get(null)).toBeNull();
  });
});
