// @vitest-environment node
/**
 * The screen-text lint (#2433) against the web app's own `eslint.config.mjs`:
 * each measurable rule of docs/tech/interface-writing.md refuses its plain case,
 * and what a person did not write for this screen passes — a licence credit, a
 * proper name, a quoted title, a curator's own note, styling and wiring. The
 * allowance's count is asserted both ways, since it is what keeps the list
 * shrinking.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

// The web app's own directory, whose eslint.config.mjs is the one asserted.
const cwd = decodeURIComponent(new URL('../..', import.meta.url).pathname);
const FIXTURE = 'src/lint-fixture.tsx';

const HEADER = [
  "import Tooltip from '@mui/material/Tooltip';",
  "import TextField from '@mui/material/TextField';",
  "import Box from '@mui/material/Box';",
  "import Typography from '@mui/material/Typography';",
  'declare const experience: { curator_note: string; name: string };',
  'declare const count: number;',
  'declare const editions: number;',
  'declare const readers: number;',
  'declare const barReaders: number;',
  'declare const when: Date;',
  '',
].join('\n');

/** The screen-text messages for one snippet, linted as a file of the web app. */
async function reported(code: string, eslint = new ESLint({ cwd })): Promise<string[]> {
  const [result] = await eslint.lintText(`${HEADER}${code}\n`, { filePath: FIXTURE });
  return result.messages.filter(message => message.ruleId === 'screen-text/guideline').map(message => message.message);
}

const LONG = 'A run asks about it again because either it says something else, or it turns the place down '
  + 'for a different reason, or its rule would now take in what you kept out after all';

describe('the screen-text lint refuses', () => {
  // The first lint loads the whole config and its plugins; pay it once.
  beforeAll(async () => {
    await reported('export const x = 1;');
  }, 60000);

  it.each([
    ['a long compound sentence in JSX', `export const A = () => <Typography>${LONG}.</Typography>;`, 'rule 1'],
    ['a semicolon in a label', "export const A = () => <TextField label=\"Saved; reload to see it\" />;", 'rule 2'],
    ['a spaced dash in JSX text', 'export const A = () => <Typography>{experience.name} — mark as seen</Typography>;', 'rule 2'],
    ['parentheses around an aside', "export const s = 'Nothing was placed (the run stopped before it got there).';", 'rule 2'],
    ['three figures in one sentence',
      'export const s = `${editions} editions and ${readers} readers a year, under the bar of ${barReaders} readers`;', 'rule 3'],
    ['five digits with no separator', "export const s = 'It holds 46234 readers a year.';", 'rule 4'],
    ['a date written in numbers', 'export const s = when.toLocaleDateString();', 'rule 5'],
    ['a date and a time written in numbers', 'export const s = new Date().toLocaleString();', 'rule 5'],
    ['a tooltip over 75 characters',
      'export const A = () => <Tooltip title="Record this number as the debt this catalogue carries, and watch whether it grows later"><span /></Tooltip>;', 'rule 6'],
    ['a hint of two sentences', 'export const A = () => <TextField helperText="One group per line. Press Enter to add it." />;', 'rule 6'],
    ['four sentences in one text',
      "export const s = 'It was read. It was kept. It was shown to readers. Nothing else changed.';", 'rule 6'],
    ['an ADR number', 'export const A = () => <Typography>Kept by ADR-0101.</Typography>;', 'rule 7'],
    ['an issue number in a label', "export const A = () => <TextField label=\"Find duplicates (#1234)\" />;", 'rule 7'],
    ['a label, a colon and a semicolon in a bare string', "export const s = 'Not admitted: the article is read; the bar is higher.';", 'rule 2'],
    ['a one-word label, a colon and a semicolon in a bare string', "export const s = 'Note: the article is read; the bar is higher.';", 'rule 2'],
    ['a date written with a locale and no options', "export const s = when.toLocaleDateString('en-GB');", 'rule 5'],
    ['a short text a JSX child chooses', "export const A = ({ done }: { done: boolean }) => <Box>{done ? 'Saved; reload' : 'Ready'}</Box>;", 'rule 2'],
  ])('%s', async (_name, code, rule) => {
    const messages = await reported(code);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain(rule);
  });
});

describe('the screen-text lint lets through', () => {
  it.each([
    ['a licence credit', 'export const A = () => <Typography>© Jane Doe · CC BY-SA 4.0</Typography>;'],
    ['a credit with its licence link',
      "export const s = 'Photo by Jane Doe, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)';"],
    ['a proper name in parentheses', "export const s = 'Read from the Church of the Holy Sepulchre (Jerusalem).';"],
    ['a quoted title',
      "export const s = 'Read from English Wikipedia’s category “Monuments and memorials to Horatio Nelson; the Admiral — (Battle of Trafalgar, Cape) 1805 1806 18050”.';"],
    ['a curator’s own note', 'export const A = () => <Typography>{experience.curator_note}</Typography>;'],
    ['styling', "export const A = () => <Typography sx={{ border: '1px solid #ccc; margin: 0 2px 4px 8px' }}>Saved</Typography>;"],
    ['a stylesheet', 'export const A = () => <style>{`.a { color: red; margin: 1px 2px 3px; }`}</style>;'],
    ['a log line', "console.log('The pass read 12 kinds, 34 sources and 56 pages; it took 78 seconds — fine (really, it is fine)');"],
    ['a comparison', "export const b = (s: string) => s === 'one; two — three (four five six seven)';"],
    ['a count in the reader’s locale', 'export const s = `${count.toLocaleString()} places`;'],
    ['a date in words', "export const s = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });"],
    ['a colour', "export const c = '#0008';"],
  ])('%s', async (_name, code) => {
    expect(await reported(code)).toEqual([]);
  });
});

describe('a text read as a person reads it', () => {
  it('reads lines apart, so short lines are not one long sentence', async () => {
    const line = 'every place of the kind within ten kilometres of it';
    expect(await reported(`export const s = '${line}\\n${line}\\n${line}';`)).toEqual([]);
  });

  it('counts a list of lines with no sentence end as no sentences', async () => {
    expect(await reported("export const s = 'Enter group names, one per line\\nfor example:\\nRalik Chain\\nRatak Chain';")).toEqual([]);
  });

  it('still counts four sentences written on four lines', async () => {
    const messages = await reported("export const s = 'It was saved.\\nThe page reloads.\\nThe list is new.\\nIt is sorted.';");
    expect(messages.join('\n')).toContain('rule 6');
  });

  it('reads a JSX text wrapped over source lines as the one sentence JSX renders', async () => {
    const wrapped = 'This work names nine makers\n          and the catalogue stores at most eight,\n          so its makers cannot be confirmed\n          or reordered until one comes off.';
    expect(await reported(`export const A = () => <Typography>\n          ${wrapped}\n        </Typography>;`)).toEqual([]);
  });

  it('measures a paragraph shown by a condition inside a text, which reads the condition as a placeholder', async () => {
    const messages = await reported(`export const A = ({ done }: { done: boolean }) => <Box>Status: {done && <Typography>${LONG}.</Typography>}</Box>;`);
    expect(messages.filter(message => message.includes('rule 1'))).toHaveLength(1);
  });

  it('reads a text property of a structured log line as no text', async () => {
    expect(await reported("console.log({ message: 'Saved; reload the page.' });")).toEqual([]);
  });

  it('reads a separator a JSX child chooses as no text', async () => {
    expect(await reported("export const A = ({ i }: { i: number }) => <Box>{i > 0 && '; '}<span>Shape</span></Box>;")).toEqual([]);
  });

  it('measures a fragment shown by a condition inside a text, and a fragment returned whole', async () => {
    const shown = await reported(`export const A = ({ done }: { done: boolean }) => <Box>Status: {done && <>${LONG}.</>}</Box>;`);
    expect(shown.filter(message => message.includes('rule 1'))).toHaveLength(1);
    const returned = await reported(`export const B = () => <>${LONG}.</>;`);
    expect(returned.filter(message => message.includes('rule 1'))).toHaveLength(1);
  });

  it('measures a text once, at the outermost element holding text, however deep the paragraph', async () => {
    const messages = await reported(`export const A = () => <Typography>Heading<Box><Typography>${LONG}.</Typography></Box></Typography>;`);
    expect(messages.filter(message => message.includes('rule 1'))).toHaveLength(1);
  });
});

describe("a file's allowance only goes down", () => {
  const allowing = (breaches: number) => new ESLint({
    cwd,
    overrideConfig: {
      files: ['src/**/*.tsx'],
      rules: { 'screen-text/guideline': ['error', { allow: { [FIXTURE]: { breaches, slice: '#2443' } } }] },
    },
  });
  const TWO = "export const a = 'It was saved; reload the page.';\nexport const b = 'It was kept; reload the page.';";

  it('is silent at its count', async () => {
    expect(await reported(TWO, allowing(2))).toEqual([]);
  });

  it('reports every breach over its count', async () => {
    expect(await reported(TWO, allowing(1))).toHaveLength(2);
  });

  it('asks for a lower count under it', async () => {
    const messages = await reported(TWO, allowing(3));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('lower it to 2');
  });

  it('never allows a development record', async () => {
    const messages = await reported("export const a = 'Saved (#1234).';", allowing(5));
    expect(messages.some(message => message.includes('rule 7'))).toBe(true);
  });
});
