import { LevelSwitcher } from 'frontend';

const fresh = {
  l1: { continents: 1, countries: 12, status: 'in_progress' },
  l2: { signedOff: 0, total: 12, status: 'empty' },
  l3: { leafResolved: 0, leafTotal: 0, status: 'empty' },
};

const midBuild = {
  l1: { continents: 6, countries: 192, status: 'done' },
  l2: { signedOff: 146, total: 192, status: 'in_progress' },
  l3: { leafResolved: 1204, leafTotal: 3880, status: 'in_progress' },
};

const signedOff = {
  l1: { continents: 6, countries: 192, status: 'done' },
  l2: { signedOff: 192, total: 192, status: 'done' },
  l3: { leafResolved: 3880, leafTotal: 3880, status: 'done' },
};

export const Fresh = () => <LevelSwitcher value="l1" progress={fresh} onChange={() => {}} />;
export const MidBuild = () => <LevelSwitcher value="l2" progress={midBuild} onChange={() => {}} />;
export const SignedOff = () => <LevelSwitcher value="l3" progress={signedOff} onChange={() => {}} />;
