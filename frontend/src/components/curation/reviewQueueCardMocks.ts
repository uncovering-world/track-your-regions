/**
 * The calls a review card makes, as the card tests stub them, and what each answers until
 * a case says otherwise.
 *
 * The four `ReviewQueue*.test.tsx` files render the same page and ask it about different
 * cards. Each installs its own `vi.mock` of the API modules — a module mock belongs to the
 * file that installs it (`reviewQueueFixtures`) — and reads those mocks back from here: the
 * typed handles a case sets and asserts on, and `resetCardMocks`, which gives every call an
 * answer a case that is not about it can ignore. One copy, because four copies of these
 * defaults are what drifts when a card starts making one more call.
 */

import { vi } from 'vitest';
import { fetchExperience } from '../../api/experiences';
import {
  setExperienceState, setExperienceAdmission, setLocationState, acceptSourceValue,
  declineSourceValue, declineHeld, publishExperience, unrefuseContents,
} from '../../api/curation';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { MISSING, CONFLICT } from './reviewQueueFixtures';

export const mockedState = setExperienceState as unknown as ReturnType<typeof vi.fn>;
export const mockedAccept = acceptSourceValue as unknown as ReturnType<typeof vi.fn>;
export const mockedDecline = declineSourceValue as unknown as ReturnType<typeof vi.fn>;
export const mockedAdmission = setExperienceAdmission as unknown as ReturnType<typeof vi.fn>;
export const mockedLocationState = setLocationState as unknown as ReturnType<typeof vi.fn>;
export const mockedPublish = publishExperience as unknown as ReturnType<typeof vi.fn>;
export const mockedDeclineHeld = declineHeld as unknown as ReturnType<typeof vi.fn>;
export const mockedExperience = fetchExperience as unknown as ReturnType<typeof vi.fn>;
export const mockedInvalidate = invalidateExperiences as unknown as ReturnType<typeof vi.fn>;
export const mockedUnrefuse = unrefuseContents as unknown as ReturnType<typeof vi.fn>;

/** What `POST /:id/publish` answers when nothing but the row itself moved. */
export const PUBLISHED = {
  experienceId: 7,
  curationState: 'verified',
  appliedFields: ['name'],
  claimedFieldsSkipped: [],
  fromSyncLogId: 47,
  heldLeftOpen: 0,
  locationsPublished: 0,
  treasureLinksPublished: 0,
  treasuresPublished: 0,
  withdrawalsReleased: 0,
};

/**
 * The answers every card case starts from. `mockedFetch` is the calling file's own queue
 * read: it is `vi.hoisted` there, because that file's `vi.mock` factory needs it before any
 * import runs.
 */
export function resetCardMocks(mockedFetch: ReturnType<typeof vi.fn>): void {
  mockedFetch.mockReset();
  mockedState.mockReset().mockResolvedValue({ experienceId: 77 });
  mockedAccept.mockReset().mockResolvedValue({ experienceId: 88, applied: ['name'], released: [], fromSyncLogId: 9 });
  mockedDecline.mockReset().mockResolvedValue({ experienceId: 88, declined: ['name'], fromSyncLogId: 41 });
  mockedAdmission.mockReset().mockResolvedValue({
    experienceId: 99, admission: 'refused', published: false,
  });
  mockedLocationState.mockReset().mockResolvedValue({
    locationId: 13211, experienceId: 1592, offeredToReaders: true,
  });
  mockedPublish.mockReset().mockResolvedValue(PUBLISHED);
  mockedDeclineHeld.mockReset().mockResolvedValue({
    experienceId: 7, declinedFields: ['name'], declinedParts: [], fromSyncLogId: 47,
    heldLeftOpen: 0,
  });
  mockedInvalidate.mockReset();
  mockedUnrefuse.mockReset().mockResolvedValue({
    experienceId: 6188, locationsRestored: 0, treasureLinksRestored: 0,
    locationIds: [], treasureIds: [],
  });
  mockedExperience.mockReset().mockResolvedValue({
    id: 55, name: 'Museo Soumaya', description: 'The Slim family collection.',
    short_description: null, image_url: null, latitude: 19.4406, longitude: -99.2047,
    country_names: ['Mexico'], location_count: 1,
  });
  mockedFetch.mockResolvedValue({
    missing: [MISSING], refused: [], conflicts: [CONFLICT], limit: 25,
  });
}
