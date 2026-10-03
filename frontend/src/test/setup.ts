import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// How long a `findBy…` or `waitFor` waits before giving up. Testing Library's
// default is one second, and under the full unit lane — every spec file in
// parallel beside the backend lane — the review page's first card can take
// longer than that to draw: specs that wait for it failed on a timing margin
// and passed alone (#1239). Three seconds keeps a wait that never resolves
// quick to report while giving a busy runner room to render; a spec's own
// ceiling (`testTimeout`, vite.config.ts) sits above several such waits.
configure({ asyncUtilTimeout: 3000 });
