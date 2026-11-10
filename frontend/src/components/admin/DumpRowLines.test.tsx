/**
 * The lines under a dump's name in *For developers* (#2415): a dump only a
 * copy's build reads names that copy, and a trial's step times sit behind an
 * expander.
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DumpBuild, DumpsDumpsItem } from '../../api/admin/dumps';
import { InputOfLine, SampleLine } from './DumpRowLines';

describe('the lines under a dump', () => {
  it('names the copy whose build reads a dump that keeps nothing of its own', () => {
    const input = { inputOf: 'enwiki-page' } as DumpsDumpsItem;
    const structure = { keeps: { title: "English Wikipedia's structure" } } as DumpsDumpsItem;
    render(<InputOfLine dump={input} copy={structure} />);
    expect(screen.getByText("Read by the build of English Wikipedia's structure, with its own dump of the same date")).toBeTruthy();
  });

  it("keeps a trial's step times behind an expander", () => {
    const tried = {
      status: 'success', startedAt: '2026-10-16T10:00:00Z', finishedAt: '2026-10-16T10:03:00Z',
      outcome: 'tried the build on sample.json.gz; kept 96,094 of 159,424 items; steps: Pass 1 of 2 40 s, Pass 2 of 2 1 min 21 s',
    } as DumpBuild;
    render(<SampleLine dump={{ sample: null, datedBy: 'day' } as unknown as DumpsDumpsItem} tried={tried} />);
    expect(screen.getByText(/tried the build on sample.json.gz; kept 96,094 of 159,424 items$/)).toBeTruthy();
    fireEvent.click(screen.getByText('Step times'));
    expect(screen.getByText('Pass 2 of 2 1 min 21 s')).toBeTruthy();
  });
});
