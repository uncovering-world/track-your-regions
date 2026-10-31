/**
 * An official website on a review card, with whether it still answers (#2165), on
 * the dev catalogue's cases of 2026-10-30: Villa d'Este's proposed domain does not
 * resolve, Lourdes's new address answers, Santa Chiara's is for sale.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ReviewQueueItem } from '../../api/reviewQueue';

let onScreen = true;
vi.mock('../../hooks/useNearViewport', () => ({ useNearViewport: () => onScreen }));
vi.mock('../../api/curation', async original => ({
  ...(await original<typeof import('../../api/curation')>()),
  getWebsiteChecks: vi.fn(),
}));

import { getWebsiteChecks } from '../../api/curation';
import { CheckedWebsite, checkWords } from './CheckedWebsite';
import { ObjectContext } from './ObjectContext';
import { meaningOf } from './fieldMeaning';

const mockedChecks = getWebsiteChecks as unknown as ReturnType<typeof vi.fn>;
const CHECKED_AT = '2026-10-31T08:00:00.000Z';
const ON = new Date(CHECKED_AT).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function withQuery(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('a checked official website (#2165)', () => {
  beforeEach(() => {
    onScreen = true;
    mockedChecks.mockReset();
    mockedChecks.mockResolvedValue({ checks: [
      { url: 'http://www.villadestetivoli.info/', outcome: 'dead', reason: 'domain-not-found', status: null, checkedAt: CHECKED_AT },
      { url: 'https://www.lourdes-france.org', outcome: 'answers', reason: 'answered', status: 200, checkedAt: CHECKED_AT },
      { url: 'http://monasterodisantachiara.com', outcome: 'dead', reason: 'domain-parked', status: null, checkedAt: CHECKED_AT },
      { url: 'https://www.uffizi.it/', outcome: 'unclear', reason: 'refused-by-site', status: 403, checkedAt: CHECKED_AT },
    ] });
  });

  it('says why a dead site is dead, and when it was checked', async () => {
    render(withQuery(<CheckedWebsite experienceId={205} url="http://www.villadestetivoli.info/"><a href="http://www.villadestetivoli.info/">site</a></CheckedWebsite>));
    expect(await screen.findByText(`dead: domain not found, checked ${ON}`)).toBeInTheDocument();
    expect(mockedChecks).toHaveBeenCalledWith(205);
  });

  it('says a site answered on a date, and never that it is safe', async () => {
    render(withQuery(<CheckedWebsite experienceId={170} url="https://www.lourdes-france.org"><a href="https://www.lourdes-france.org">site</a></CheckedWebsite>));
    const mark = await screen.findByText(`answered on ${ON}`);
    expect(mark).toBeInTheDocument();
    expect(mark.textContent).not.toMatch(/safe|valid|correct/i);
  });

  it('calls a parked domain dead, and a refusal only unclear', () => {
    expect(checkWords({ outcome: 'dead', reason: 'domain-parked', checkedAt: CHECKED_AT })).toBe(`dead: domain for sale, checked ${ON}`);
    expect(checkWords({ outcome: 'unclear', reason: 'refused-by-site', checkedAt: CHECKED_AT })).toBe('could not be checked: the site refused the check');
    expect(checkWords({ outcome: 'dead', reason: 'page-not-found', checkedAt: CHECKED_AT })).toBe(`dead: page not found (404), checked ${ON}`);
  });

  it('asks once for a card whose links share a place', async () => {
    render(withQuery(
      <>
        <CheckedWebsite experienceId={205} url="http://www.villadestetivoli.info/"><span>one</span></CheckedWebsite>
        <CheckedWebsite experienceId={205} url="https://www.uffizi.it/"><span>two</span></CheckedWebsite>
      </>,
    ));
    expect(await screen.findByText('could not be checked: the site refused the check')).toBeInTheDocument();
    expect(mockedChecks).toHaveBeenCalledTimes(1);
  });

  it('asks nothing while the card is off screen', async () => {
    onScreen = false;
    render(withQuery(<CheckedWebsite experienceId={205} url="http://www.villadestetivoli.info/"><a href="http://www.villadestetivoli.info/">site</a></CheckedWebsite>));
    await waitFor(() => expect(mockedChecks).not.toHaveBeenCalled());
    expect(screen.queryByText(/dead:/)).not.toBeInTheDocument();
  });

  it('asks nothing without the place, and shows the link as it is', async () => {
    render(withQuery(<CheckedWebsite url="http://www.villadestetivoli.info/"><a href="http://www.villadestetivoli.info/">site</a></CheckedWebsite>));
    expect(screen.getByRole('link', { name: 'site' })).toBeInTheDocument();
    await waitFor(() => expect(mockedChecks).not.toHaveBeenCalled());
  });

  it("marks a proposed website in the fact table's row, and not a part's", async () => {
    const website = meaningOf('metadata.website');
    render(withQuery(<>{website.render?.('http://www.villadestetivoli.info/', { proposed: [], experienceId: 205 }, 'after')}</>));
    expect(screen.getByRole('link', { name: 'http://www.villadestetivoli.info/' })).toBeInTheDocument();
    expect(await screen.findByText(`dead: domain not found, checked ${ON}`)).toBeInTheDocument();
    mockedChecks.mockClear();
    render(withQuery(<>{website.render?.('https://www.uffizi.it/', { proposed: [], experienceId: 205, part: true }, 'after')}</>));
    await waitFor(() => expect(mockedChecks).not.toHaveBeenCalled());
  });

  it("marks the card heading's official site", async () => {
    const villa = {
      id: 205, external_id: '1025', name: "Villa d'Este, Tivoli", kind_id: 1, kind_name: 'World Heritage Sites',
      missing_since: null, source_membership: 'present', existence: 'extant', kind: 'held', proposed: null,
      website_url: 'http://www.villadestetivoli.info/',
    } as ReviewQueueItem;
    render(withQuery(<ObjectContext item={villa} />));
    expect(screen.getByRole('link', { name: 'official site' })).toHaveAttribute('href', 'http://www.villadestetivoli.info/');
    expect(await screen.findByText(`dead: domain not found, checked ${ON}`)).toBeInTheDocument();
  });
});
