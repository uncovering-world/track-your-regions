import { pool } from '../index.js';
import { seedE2eFixture } from './e2eFixture.js';

// db/index.ts defaults to localhost:5432/track_regions - the developer's
// dev database - when no environment is set. Log the target before
// touching it; seedE2eFixture() itself refuses to run when the name
// doesn't look like a test database.
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || '5432';
const dbName = process.env.DB_NAME || 'track_regions';

console.log(`Seeding E2E fixture into ${dbHost}:${dbPort}/${dbName}`);

seedE2eFixture()
  .then(() => {
    console.log('E2E fixture seeded');
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('E2E fixture seeding failed:', error);
    process.exit(1);
  });
