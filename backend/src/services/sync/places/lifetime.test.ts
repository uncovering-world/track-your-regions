/**
 * #2578, #1719: a place's periods as its item states them, read through the subset's
 * reader from the statements the development subset holds (dump of
 * 2026-10-26, read on 2026-11-16), cut to what the rule and the gone rules
 * read: the dated statements (P571, P1619, P576, P3999), the state of use
 * (P5817) and of conservation (P5816), the heritage designations (P1435) and
 * the significant events of a destruction or a rebuilding (P793) with the
 * qualifiers that date them and the one that names a part (P518). Times keep
 * their calendar model only where it is Julian.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactStatement } from '../../dumps/wikidata/compactEntity.js';

const claimsOf = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('../subset/entities.js', () => ({
  entitiesOf: vi.fn(async (ids: string[]) => new Map(ids.filter((id) => claimsOf.has(id)).map((id) => [id, {
    sitelinks: 0, entity: { id, labels: {}, descriptions: {}, claims: claimsOf.get(id) as Record<string, CompactStatement[]> },
  }]))),
}));

import { subsetStandingFacts } from '../subset/standing.js';
import { goneReason, goneWorkReason } from './gone.js';
import { lifetimeOf, readLifetimes } from './lifetime.js';

const JULIAN = 'http://www.wikidata.org/entity/Q1985786';

const STATEMENTS: Record<string, Record<string, unknown>> = {
  // Göbekli Tepe
  Q214944: {"P571": [{"id": "Q214944$899b45c8-40f2-5adb-2e34-0709364b6161", "value": {"time": "-9999-01-01T00:00:00Z", "precision": 6}, "qualifiers": {"P1480": ["Q5727902"]}}], "P576": [{"id": "Q214944$50d835b9-4a90-f4cb-aade-f9eaac2895ac", "value": {"time": "-7000-00-00T00:00:00Z", "precision": 6, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P1435": [{"id": "Q214944$f32e1a26-4f99-a263-2974-ef727e96d039", "value": "Q9259", "rank": "preferred", "qualifiers": {"P580": [{"time": "+2018-07-01T00:00:00Z", "precision": 11}]}}, {"id": "Q214944$f78ebcc9-460c-e12d-d7fc-0dc4ea3a80b4", "value": "Q1459900", "rank": "deprecated", "qualifiers": {"P580": [{"time": "+2011-04-15T00:00:00Z", "precision": 11}], "P582": [{"time": "+2018-06-30T00:00:00Z", "precision": 11}]}}], "P5816": [{"id": "Q214944$F223D3CB-5D4F-420A-AA8D-B7A61F6FCE2D", "value": "Q56557591"}]},
  // Pergamon Museum
  Q157298: {"P571": [{"id": "Q157298$65DE6523-3836-443C-BE8F-F3086D3CB287", "value": {"time": "+1910-01-01T00:00:00Z", "precision": 9}}], "P1435": [{"id": "Q157298$48E724EB-DA6E-493F-8EFF-23E3262A9024", "value": "Q811165"}], "P1619": [{"id": "Q157298$A6DA5594-656C-479F-8B3B-E050F84BE7D2", "value": {"time": "+1910-00-00T00:00:00Z", "precision": 9}}]},
  // Nelson's Pillar
  Q2350741: {"P571": [{"id": "Q2350741$588C6C07-E5DD-4A68-B793-D270B9FDD5C4", "value": {"time": "+1808-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q2350741$e0964237-4486-5bd4-7a4f-6633f7856e35", "value": {"time": "+1966-03-08T00:00:00Z", "precision": 11}}], "P793": [{"id": "Q2350741$1333e4a7-4020-c552-75e0-9f467d1dd2b4", "value": "Q331483"}], "P1619": [{"id": "Q2350741$409e90d1-46ab-7d18-8527-20fa02a9516e", "value": {"time": "+1809-10-21T00:00:00Z", "precision": 11}}], "P3999": [{"id": "Q2350741$7F3F88C1-F0D2-482B-84BF-EA1612809197", "value": {"time": "+1966-03-08T00:00:00Z", "precision": 11}}]},
  // Arch of Reunification
  Q94731: {"P571": [{"id": "Q94731$b76f4bd3-4c52-094b-2c00-875000cd3606", "value": {"time": "+2001-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q94731$3df03b58-4015-4cb2-211a-fe043c4ba908", "value": {"time": "+2024-01-00T00:00:00Z", "precision": 10}}], "P793": [{"id": "Q94731$db319ee6-4763-2e11-3f30-add81a1a0f22", "value": "Q17781833"}], "P1619": [{"id": "Q94731$f23a86eb-4c48-e88d-d0e3-d907a46a8171", "value": {"time": "+2001-08-00T00:00:00Z", "precision": 10}}], "P5816": [{"id": "Q94731$c612a1b9-42d6-e3f4-66e1-7b7369c17ae2", "value": "Q56556915"}]},
  // Cathedral of Christ the Saviour
  Q194474: {"P571": [{"id": "Q194474$0D32E330-80AF-431D-A6FB-257E18677920", "value": {"time": "+2000-08-19T00:00:00Z", "precision": 11}}], "P576": [{"id": "Q194474$cb21ee04-40c9-437a-d682-4cc31e439511", "value": {"time": "+1931-12-05T00:00:00Z", "precision": 11}}], "P793": [{"id": "Q194474$497b8e02-4250-fc15-fd13-b549db5375c6", "value": "Q1650581", "qualifiers": {"P585": [{"time": "+1931-12-05T00:00:00Z", "precision": 11}]}}], "P1435": [{"id": "Q194474$B153B509-0823-4526-940D-87F8EFBC4F50", "value": "Q105835774"}], "P1619": [{"id": "Q194474$903BF5EC-F2AC-49AD-9037-EFFF5E0E42D8", "value": {"time": "+1883-00-00T00:00:00Z", "precision": 9}}], "P5816": [{"id": "Q194474$3449F2D7-3743-4AC2-AFFB-1C5340F3A7DF", "value": "Q56556915"}, {"id": "Q194474$64675777-43b7-5597-b5d6-4031abefe1c7", "value": "Q1370468", "qualifiers": {"P580": [{"time": "+1995-00-00T00:00:00Z", "precision": 9}]}}]},
  // Notre-Dame de Paris
  Q2981: {"P571": [{"id": "Q2981$14AB2599-D418-4F62-8805-73DB2B5FB80A", "value": {"time": "+1163-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P1435": [{"id": "Q2981$BBB99B60-359B-40E6-8856-FAB034CA8D3C", "value": "Q10387684", "qualifiers": {"P580": [{"time": "+1862-00-00T00:00:00Z", "precision": 9}]}}], "P1619": [{"id": "Q2981$fb067d68-4cab-e6b3-3362-82be53a1b4f0", "value": {"time": "+2024-12-07T00:00:00Z", "precision": 11}}]},
  // Registan
  Q1373583: {"P571": [{"id": "Q1373583$c479308e-4ab3-e7c5-4397-8fad4b6f2dda", "value": {"time": "+1417-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P576": [{"id": "Q1373583$b0c92fe5-4730-7cde-019c-cb40d489b03a", "value": {"time": "+1420-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P1435": [{"id": "Q1373583$AB1BEA44-0104-4D5E-88E8-80F0B10E5AB2", "value": "Q122215934"}]},
  // Bath Abbey
  Q334399: {"P571": [{"id": "Q334399$A6C38473-BB77-4107-9F2F-08CC86634D0B", "value": {"time": "+1572-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P576": [{"id": "Q334399$0DF2237F-613A-4AB5-A855-2F94161C62E7", "value": {"time": "+1539-01-01T00:00:00Z", "precision": 9}}], "P1435": [{"id": "Q334399$513BDEEA-7A09-4EDE-A9C0-62833794FD99", "value": "Q15700818", "qualifiers": {"P580": [{"time": "+1950-06-12T00:00:00Z", "precision": 11}]}}]},
  // Kakhovka Dam
  Q119210467: {"P571": [{"id": "Q119210467$38569E6A-AE3D-4017-9598-DEAC94E8B15C", "value": {"time": "+1950-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q119210467$C57C1910-6CCB-4A6A-A5E4-3E41A1F24056", "value": {"time": "+2023-06-06T00:00:00Z", "precision": 11}}], "P5816": [{"id": "Q119210467$3EDFA098-6334-45F9-AAAE-CBE30A703448", "value": "Q56556915"}]},
  // Dohány Street Synagogue
  Q754397: {"P571": [{"id": "Q754397$196619EF-823C-444E-8444-F22C5E1E4817", "value": {"time": "+1854-00-00T00:00:00Z", "precision": 9}}], "P580": [{"id": "Q754397$9b09786e-462c-48f7-9c7d-7d48e8ae452a", "value": {"time": "+1854-00-00T00:00:00Z", "precision": 9}}], "P582": [{"id": "Q754397$a9aa9c03-4265-d07f-33d2-0b04db5bffab", "value": {"time": "+1859-00-00T00:00:00Z", "precision": 9}}], "P1619": [{"id": "Q754397$72d55406-4d17-e17a-7793-d404dd69eecc", "value": {"time": "+1859-09-06T00:00:00Z", "precision": 11}}]},
  // Not items: a Julian leap day the Gregorian calendar lacks, and a day the Julian calendar lacks.
  Q9719001: {"P571": [{"id": "Q9719001$aa01", "value": {"time": "+1500-02-29T00:00:00Z", "precision": 11, "calendarmodel": JULIAN}}]},
  Q9719002: {"P571": [{"id": "Q9719002$aa02", "value": {"time": "+1500-02-30T00:00:00Z", "precision": 11, "calendarmodel": JULIAN}}, {"id": "Q9719002$aa03", "value": {"time": "+1501-00-00T00:00:00Z", "precision": 9}}]},
  // Not items: Mohenjo-daro's end time about 1700 BC, alone; the Arch of Neutrality's 1998, 2010 and end in 2010.
  Q9719004: {"P582": [{"id": "Q9719004$aa05", "value": {"time": "-1700-00-00T00:00:00Z", "precision": 7}, "qualifiers": {"P1480": ["Q5727902"]}}]},
  Q9719005: {"P571": [{"id": "Q9719005$aa06", "value": {"time": "+1998-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719005$aa07", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719005$aa08", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}]},
  // Not an item: begun in 1854, ended in 1859 stated to the year, and opened on 6 September 1859.
  Q9719006: {"P571": [{"id": "Q9719006$aa09", "value": {"time": "+1854-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719006$aa10", "value": {"time": "+1859-00-00T00:00:00Z", "precision": 9}}], "P1619": [{"id": "Q9719006$aa11", "value": {"time": "+1859-09-06T00:00:00Z", "precision": 11}}]},
  // Not items: a work set up in 2019 (to the year) and removed on 14 June 2019; an inception in 1800, an end in
  // the 1950s and an opening in 1955; an inception to the 1600s century and an end in 1550; an inception on a
  // 30 February of the Julian calendar beside the start and end of a building.
  Q9719007: {"P571": [{"id": "Q9719007$aa12", "value": {"time": "+2019-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719007$aa13", "value": {"time": "+2019-06-14T00:00:00Z", "precision": 11}}]},
  Q9719008: {"P571": [{"id": "Q9719008$aa14", "value": {"time": "+1800-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719008$aa15", "value": {"time": "+1950-00-00T00:00:00Z", "precision": 8}}], "P1619": [{"id": "Q9719008$aa16", "value": {"time": "+1955-00-00T00:00:00Z", "precision": 9}}]},
  Q9719009: {"P571": [{"id": "Q9719009$aa17", "value": {"time": "+1600-00-00T00:00:00Z", "precision": 7}}], "P576": [{"id": "Q9719009$aa18", "value": {"time": "+1550-00-00T00:00:00Z", "precision": 9}}]},
  Q9719010: {"P571": [{"id": "Q9719010$aa19", "value": {"time": "+1500-02-30T00:00:00Z", "precision": 11, "calendarmodel": JULIAN}}], "P580": [{"id": "Q9719010$aa20", "value": {"time": "+1854-00-00T00:00:00Z", "precision": 9}}], "P582": [{"id": "Q9719010$aa21", "value": {"time": "+1859-00-00T00:00:00Z", "precision": 9}}]},
  // Not an item: begun 1800, ended 1900, started 1950, ended 2010 and started 2010, all to the year.
  Q9719011: {"P571": [{"id": "Q9719011$aa22", "value": {"time": "+1800-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719011$aa23", "value": {"time": "+1950-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719011$aa24", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719011$aa25", "value": {"time": "+1900-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719011$aa26", "value": {"time": "+2010-00-00T00:00:00Z", "precision": 9}}]},
  // Not an item: begun 1800, ended 2000, started 2000 and again 2005, all to the year.
  Q9719012: {"P571": [{"id": "Q9719012$aa27", "value": {"time": "+1800-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719012$aa28", "value": {"time": "+2000-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719012$aa29", "value": {"time": "+2005-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719012$aa30", "value": {"time": "+2000-00-00T00:00:00Z", "precision": 9}}]},
  // Not items: begun 1900, ended 1950, started 1960, ended 1990 and started 2000; begun 1900, ended 1990 and
  // started 2000; begun 1900 and ended on 25 December 2026, a day still ahead of the day the tests read on;
  // begun 1900 and ended in 2027, the year after it.
  Q9719013: {"P571": [{"id": "Q9719013$aa31", "value": {"time": "+1900-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719013$aa32", "value": {"time": "+1960-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719013$aa33", "value": {"time": "+2000-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719013$aa34", "value": {"time": "+1950-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719013$aa35", "value": {"time": "+1990-00-00T00:00:00Z", "precision": 9}}]},
  Q9719014: {"P571": [{"id": "Q9719014$aa36", "value": {"time": "+1900-00-00T00:00:00Z", "precision": 9}}, {"id": "Q9719014$aa37", "value": {"time": "+2000-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719014$aa38", "value": {"time": "+1990-00-00T00:00:00Z", "precision": 9}}]},
  Q9719015: {"P571": [{"id": "Q9719015$aa39", "value": {"time": "+1900-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719015$aa40", "value": {"time": "+2026-12-25T00:00:00Z", "precision": 11}}]},
  Q9719016: {"P571": [{"id": "Q9719016$aa41", "value": {"time": "+1900-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719016$aa42", "value": {"time": "+2027-00-00T00:00:00Z", "precision": 9}}]},
  // Ponte Santa Trinita
  Q545578: {"P571": [{"id": "Q545578$4079b346-45a2-32b5-2fc6-c2cc3ea04cfb", "value": {"time": "+1252-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P576": [{"id": "Q545578$8c07d366-453c-6414-1ee7-615bdc26fe79", "value": {"time": "+1944-00-00T00:00:00Z", "precision": 9}}, {"id": "Q545578$05b3fba1-4b15-01f7-167d-b9fa1064207e", "value": {"time": "+1557-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P1619": [{"id": "Q545578$2E5A247A-1156-4C18-AACC-B919BA1DB4C9", "value": {"time": "+1569-00-00T00:00:00Z", "precision": 9}}, {"id": "Q545578$b0b4dfc1-4472-ca8f-00ad-4bdc01172305", "value": {"time": "+1958-03-16T00:00:00Z", "precision": 11}}]},
  // Stari Most, the Old Bridge in Mostar
  Q188528: {"P571": [{"id": "Q188528$ab2eae0b-4351-f207-8f0d-27cd0c7b6495", "value": {"time": "+1566-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P793": [{"id": "Q188528$91085467-475f-7108-7015-7d324aaf6575", "value": "Q385378", "qualifiers": {"P580": [{"time": "+1557-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}], "P582": [{"time": "+1566-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}]}}, {"id": "Q188528$9c39edd7-4700-2bdd-b181-5c66539235c5", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+1993-11-09T00:00:00Z", "precision": 11}]}}, {"id": "Q188528$eabd5cdc-4fa2-abcf-a537-254cbf2bcb8a", "value": "Q1370468", "qualifiers": {"P580": [{"time": "+2001-06-07T00:00:00Z", "precision": 11}], "P582": [{"time": "+2004-07-23T00:00:00Z", "precision": 11}]}}], "P1435": [{"id": "Q188528$DEB4A152-D517-43A7-8EE0-CBFD7CD2F976", "value": "Q12637954"}], "P1619": [{"id": "Q188528$DE8ACCDD-07AC-4FE4-AF36-652669766F4D", "value": {"time": "+1567-00-00T00:00:00Z", "precision": 9}}]},
  // Kintai Bridge
  Q1196460: {"P571": [{"id": "Q1196460$82618FC9-12BC-420E-98BB-9AB1AB9A7966", "value": {"time": "+1673-00-00T00:00:00Z", "precision": 9}}], "P793": [{"id": "Q1196460$1063075a-4616-9d62-5283-21d0a0d6d870", "value": "Q331483", "qualifiers": {"P585": [{"time": "+1950-09-14T00:00:00Z", "precision": 11}]}}, {"id": "Q1196460$c619a92e-4a98-17df-36e4-d07a9d96edfa", "value": "Q2478058", "qualifiers": {"P585": [{"time": "+1953-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q1196460$dc7b359e-415d-37e0-6365-42ff235d2b75", "value": "Q2478058", "qualifiers": {"P585": [{"time": "+1674-11-30T00:00:00Z", "precision": 11}]}}, {"id": "Q1196460$01306f48-45a6-9534-77d9-620bf3937c0a", "value": "Q2144402", "qualifiers": {"P585": [{"time": "+2004-00-00T00:00:00Z", "precision": 9}]}}], "P1619": [{"id": "Q1196460$6988aa36-4c69-c35d-5744-e6a5f1761070", "value": {"time": "+1679-00-00T00:00:00Z", "precision": 9}}]},
  // Ponte Pietra
  Q540546: {"P571": [{"id": "Q540546$bbb41e14-4ec4-082b-bc88-f676a51570c8", "value": {"time": "-0100-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}, "qualifiers": {"P1480": ["Q5727902"]}}], "P793": [{"id": "Q540546$9fe832c5-49fd-74cc-f332-c1596b6d68e1", "value": "Q1650581", "qualifiers": {"P585": [{"time": "+1945-04-24T00:00:00Z", "precision": 11}]}}], "P1619": [{"id": "Q540546$922FDD11-82DE-462E-922A-C68C22D0F67D", "value": {"time": "+1959-00-00T00:00:00Z", "precision": 9}}]},
  // Church of Our Lady, Dresden
  Q157229: {"P571": [{"id": "Q157229$A23A7520-B5C3-4013-AC71-A6A813D5FBFF", "value": {"time": "+1726-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q157229$A36E22E2-BC91-45C7-9DFE-BCC55B2CC6B4", "value": {"time": "+1945-02-15T00:00:00Z", "precision": 11}}], "P793": [{"id": "Q157229$e6685d19-4253-6dac-fae7-32699baf1a4f", "value": "Q1370468", "qualifiers": {"P585": [{"time": "+2005-10-30T00:00:00Z", "precision": 11}]}}], "P1435": [{"id": "Q157229$d4392b38-41d1-1397-0a56-e6c511ab7d48", "value": "Q811165"}]},
  // Vizcaya Bridge
  Q331996: {"P793": [{"id": "Q331996$695d8d10-4d0f-956a-ee42-7b64be2b48a6", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+1937-06-17T00:00:00Z", "precision": 11}]}}, {"id": "Q331996$cc4a2242-4bb3-2b3f-ba91-4ccef9fc1199", "value": "Q16571590", "qualifiers": {"P585": [{"time": "+1941-06-19T00:00:00Z", "precision": 11}]}}], "P1619": [{"id": "Q331996$6AB7B9F3-98CA-4AA2-BE68-6490EA5BF3D3", "value": {"time": "+1893-00-00T00:00:00Z", "precision": 9}}]},
  // Cedar Covered Bridge
  Q5018318: {"P571": [{"id": "Q5018318$c1c6ed2f-407a-74f9-b868-7d9654d42dab", "value": {"time": "+1883-00-00T00:00:00Z", "precision": 9}}], "P793": [{"id": "Q5018318$c7109a45-400a-5a8d-127f-fa8fa4b93044", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+2002-09-03T00:00:00Z", "precision": 11}]}}, {"id": "Q5018318$3597951f-4264-2e89-804e-21eac3a0d517", "value": "Q2478058", "qualifiers": {"P585": [{"time": "+2004-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q5018318$9d646573-440f-eb4a-8b22-783bba2e29c4", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+2017-04-15T00:00:00Z", "precision": 11}]}}, {"id": "Q5018318$61d6525e-4c73-f1dc-9b46-630dca07525e", "value": "Q2478058", "qualifiers": {"P585": [{"time": "+2019-00-00T00:00:00Z", "precision": 9}]}}]},
  // Berlin Cathedral
  Q154563: {"P571": [{"id": "Q154563$951D0EF2-3A21-40AF-906E-ABE49218F544", "value": {"time": "+1894-00-00T00:00:00Z", "precision": 9}}], "P793": [{"id": "Q154563$a73364b3-4b2a-a5cd-ec67-26a95632b04d", "value": "Q678146", "qualifiers": {"P585": [{"time": "+1944-05-24T00:00:00Z", "precision": 11}]}}, {"id": "Q154563$c4063bf6-45cf-38a3-dd71-5a4e1fb2544f", "value": "Q1370468", "qualifiers": {"P580": [{"time": "+1975-00-00T00:00:00Z", "precision": 9}], "P582": [{"time": "+1993-00-00T00:00:00Z", "precision": 9}]}}], "P1619": [{"id": "Q154563$6A947212-93FA-4751-9106-C8E626900EDA", "value": {"time": "+1905-02-26T00:00:00Z", "precision": 11}}]},
  // Kinkaku-ji
  Q270983: {"P571": [{"id": "Q270983$6998f3a9-432c-477c-fad6-d92b706efba8", "value": {"time": "+1397-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P793": [{"id": "Q270983$374153a3-4201-d0ce-196a-eb76e1c8477f", "value": "Q168983", "qualifiers": {"P585": [{"time": "+1950-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q270983$59a6011b-4e0b-2c77-1f96-b586c90ab71c", "value": "Q1370468", "qualifiers": {"P585": [{"time": "+1955-00-00T00:00:00Z", "precision": 9}]}}]},
  // Hirano Shrine
  Q738971: {"P571": [{"id": "Q738971$3a4e66d5-4633-db3d-9a28-82d2f27b61a4", "value": {"time": "+0782-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P793": [{"id": "Q738971$fd225362-4b4c-cd1a-869b-4dedac187d71", "value": "Q17781833", "qualifiers": {"P518": ["Q3125745"], "P585": [{"time": "+2018-09-04T00:00:00Z", "precision": 11}]}}, {"id": "Q738971$73ed2d85-4404-ad55-72a9-8914f8544dca", "value": "Q1370468", "qualifiers": {"P518": ["Q3125745"], "P582": [{"time": "+2021-09-00T00:00:00Z", "precision": 10}]}}]},
  // Bebelplatz
  Q699504: {"P571": [{"id": "Q699504$EFBCC925-8B24-45CC-A23D-B8E2535C5A55", "value": {"time": "+1740-00-00T00:00:00Z", "precision": 9}}], "P793": [{"id": "Q699504$3ed37f57-4fac-f777-a53f-a0acde216c8d", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+1928-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q699504$e757453b-419b-9bc1-9186-7467091591b3", "value": "Q2478058", "qualifiers": {"P585": [{"time": "+1928-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q699504$7bcfdf8c-482f-4ded-5846-a4d2374f2b95", "value": "Q17781833"}]},
  // Buddhas of Bamiyan
  Q484458: {"P793": [{"id": "Q484458$17fb2bd3-4f2e-630d-e745-c98e8daf7bc3", "value": "Q331483", "qualifiers": {"P585": [{"time": "+2001-00-00T00:00:00Z", "precision": 9}]}}], "P1435": [{"id": "Q484458$8B4B1305-0D29-4336-A87A-0ACCD852D6A6", "value": "Q43113623"}], "P5816": [{"id": "Q484458$6b3b28cf-4e3a-8beb-6115-5f5cb1644133", "value": "Q56556915"}]},
  // Pembroke Castle
  Q1422235: {"P571": [{"id": "Q1422235$15099439-44c4-5949-685a-8b3c587d5a04", "value": {"time": "+1093-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P793": [{"id": "Q1422235$1e43e61c-4934-f0a1-0f87-ac4ecc5c308c", "value": "Q2238935", "qualifiers": {"P585": [{"time": "+1648-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q1422235$54e78d45-49c9-2d0c-2a84-76b6c4a96cd1", "value": "Q1370468", "qualifiers": {"P580": [{"time": "+1928-00-00T00:00:00Z", "precision": 9}]}}]},
  // Byōdō-in
  Q61094: {"P571": [{"id": "Q61094$00d98890-45fd-de40-ca0f-415990b5d953", "value": {"time": "+1052-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P793": [{"id": "Q61094$a062435e-448d-fe06-d5c8-bd1da4603aa5", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+1336-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}]}}]},
  // Odeon of Herodes Atticus
  Q1328165: {"P571": [{"id": "Q1328165$b14399e4-44b9-a65a-fd10-d197a62192b9", "value": {"time": "+0161-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P793": [{"id": "Q1328165$8e7fad9b-41e4-93b2-a79e-d98c8db8d1fd", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+0267-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}]}}, {"id": "Q1328165$88c70b2c-4df0-da12-ce1a-d495f0521af3", "value": "Q1370468", "qualifiers": {"P580": [{"time": "+1952-00-00T00:00:00Z", "precision": 9}], "P582": [{"time": "+1953-00-00T00:00:00Z", "precision": 9}]}}]},
  // Stuttgart Collegiate Church
  Q321819: {"P571": [{"id": "Q321819$29887567-D6CA-40AC-A836-DB52FC0D24BB", "value": {"time": "+1321-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}}], "P793": [{"id": "Q321819$f2ce1d7d-4b50-472f-bc1e-ba5e182fe908", "value": "Q2478058", "qualifiers": {"P518": ["Q207707"], "P585": [{"time": "+1826-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q321819$a9934859-4ded-f749-1712-5514b3d6105a", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+1944-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q321819$9cabb694-4415-9e2c-ebf2-fc76f089c5a7", "value": "Q2478058", "qualifiers": {"P585": [{"time": "+1950-00-00T00:00:00Z", "precision": 8}]}}, {"id": "Q321819$571f539f-4320-55d2-0a72-b0a0ffba9312", "value": "Q2478058", "qualifiers": {"P518": ["Q179232"], "P580": [{"time": "+1999-00-00T00:00:00Z", "precision": 9}], "P582": [{"time": "+2003-00-00T00:00:00Z", "precision": 9}]}}]},
  // Bronislaw Malinowski Bridge
  Q11785886: {"P571": [{"id": "Q11785886$1786cd8b-441a-3ec5-d2b5-d4e0dd011aa3", "value": {"time": "+1879-00-00T00:00:00Z", "precision": 9}}], "P793": [{"id": "Q11785886$dc151541-4215-e50f-4fce-cab4c5c3061b", "value": "Q331483", "qualifiers": {"P585": [{"time": "+1939-09-02T00:00:00Z", "precision": 11}]}}, {"id": "Q11785886$322590e1-436f-004a-3e04-c5bb623dc1f2", "value": "Q52385658", "qualifiers": {"P585": [{"time": "+1940-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q11785886$9f2f7f82-4956-6528-aaa3-fbbcd50b8e94", "value": "Q331483", "qualifiers": {"P585": [{"time": "+1945-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q11785886$6ef645d6-44cf-b0e5-3de9-c08514a61420", "value": "Q52385658", "qualifiers": {"P582": [{"time": "+1951-08-26T00:00:00Z", "precision": 11}], "P585": [{"time": "+1947-00-00T00:00:00Z", "precision": 9}]}}], "P1619": [{"id": "Q11785886$00885248-45fb-e4be-f1e0-e5001e6e1e9e", "value": {"time": "+1879-00-00T00:00:00Z", "precision": 9}}, {"id": "Q11785886$d71b8c95-4605-24e3-8e3a-74731bea5272", "value": {"time": "+1951-08-26T00:00:00Z", "precision": 11}}]},
  // Mosque of Amr ibn al-As
  Q683511: {"P793": [{"id": "Q683511$27de1751-4192-6c44-a24b-b0a3e251bfaa", "value": "Q1370468", "qualifiers": {"P585": [{"time": "+0827-00-00T00:00:00Z", "precision": 9, "calendarmodel": "http://www.wikidata.org/entity/Q1985786"}]}}]},
  // Not items: a rebuilding dated before the destruction it would answer, and one on 25 December 2026, a day
  // still ahead of the day the tests read on; a work ended in 1940 whose item states a later destruction and a rebuilding after that.
  Q9719017: {"P571": [{"id": "Q9719017$aa43", "value": {"time": "+1800-00-00T00:00:00Z", "precision": 9}}], "P793": [{"id": "Q9719017$aa44", "value": "Q1370468", "qualifiers": {"P585": [{"time": "+1940-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q9719017$aa45", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+1945-00-00T00:00:00Z", "precision": 9}]}}, {"id": "Q9719017$aa46", "value": "Q1370468", "qualifiers": {"P585": [{"time": "+2026-12-25T00:00:00Z", "precision": 11}]}}]},
  Q9719018: {"P571": [{"id": "Q9719018$aa47", "value": {"time": "+1900-00-00T00:00:00Z", "precision": 9}}], "P576": [{"id": "Q9719018$aa48", "value": {"time": "+1940-00-00T00:00:00Z", "precision": 9}}], "P793": [{"id": "Q9719018$aa49", "value": "Q17781833", "qualifiers": {"P585": [{"time": "+1945-03-02T00:00:00Z", "precision": 11}]}}, {"id": "Q9719018$aa50", "value": "Q1370468", "qualifiers": {"P585": [{"time": "+1960-00-00T00:00:00Z", "precision": 9}]}}]},
  // Not an item: the Tomb of the Unknown Soldier's 11 November 1920, stated to ten thousand years.
  Q9719003: {"P571": [{"id": "Q9719003$aa04", "value": {"time": "+1920-11-11T00:00:00Z", "precision": 5}}]},
};

beforeEach(() => {
  claimsOf.clear();
  for (const [qid, claims] of Object.entries(STATEMENTS)) claimsOf.set(qid, claims);
});

const TODAY = { year: 2026, month: 11, day: 16 };

/** Each item's periods as the run would report them: a place kind's gone rule, or a works kind's. */
async function lifetimes(qids: string[], works = false) {
  const facts = await subsetStandingFacts(qids);
  return Object.fromEntries(qids.map((qid) => {
    const known = facts.get(qid);
    if (!known) return [qid, 'unread'];
    return [qid, lifetimeOf(known, works ? goneWorkReason(known) : goneReason(known), TODAY)];
  }));
}

const on = (y: number, rest: Record<string, unknown> = {}) =>
  expect.objectContaining({ year: y, month: null, day: null, span: null, circa: false, ...rest });
/** A period still open, and one that ended: at `end`, or at no date. */
const open = (from: unknown) => ({ from, ended: false, until: null, ending: null, what: null });
const until = (from: unknown, end: unknown, ending: string | null = null) => ({ from, ended: true, until: end, ending, what: null });

describe('a place\'s periods as its item states them (#2578, #1719)', () => {
  it('reads Göbekli Tepe as standing from about the 10th millennium BC, and in use until the 7th', async () => {
    expect((await lifetimes(['Q214944'])).Q214944).toEqual({
      stood: [open(on(-9999, { span: 'millennium', circa: true, property: 'P571', statement: 'Q214944$899b45c8-40f2-5adb-2e34-0709364b6161' }))],
      used: [until(null, on(-7000, { span: 'millennium', property: 'P576', statement: 'Q214944$50d835b9-4a90-f4cb-aade-f9eaac2895ac' }))],
    });
  });

  it('reads the Pergamon Museum as standing from 1910, and nothing of its closure, which Wikidata does not state', async () => {
    expect((await lifetimes(['Q157298'])).Q157298).toEqual({ stood: [open(on(1910, { property: 'P571' }))] });
  });

  it('reads the end of Nelson\'s Pillar and of the Arch of Reunification as the end of their standing, how they went with it', async () => {
    const read = await lifetimes(['Q2350741', 'Q94731'], true);
    expect(read.Q2350741).toEqual({
      stood: [until(on(1808, { property: 'P571' }), on(1966, { month: 3, day: 8, property: 'P576' }), 'destroyed')],
    });
    expect(read.Q94731).toEqual({
      stood: [until(on(2001, { property: 'P571' }), on(2024, { month: 1, property: 'P576' }), 'destroyed')],
    });
  });

  it('reads the Cathedral of Christ the Saviour as standing from 1883 until 5 December 1931, and again from 2000', async () => {
    expect((await lifetimes(['Q194474'])).Q194474).toEqual({
      stood: [
        until(on(1883, { property: 'P1619' }), on(1931, { month: 12, day: 5, property: 'P576', statement: 'Q194474$cb21ee04-40c9-437a-d682-4cc31e439511' })),
        open(on(2000, { month: 8, day: 19, property: 'P571' })),
      ],
    });
  });

  it('never reads Notre-Dame\'s reopening of 2024 as its beginning', async () => {
    expect((await lifetimes(['Q2981'])).Q2981).toEqual({ stood: [open(on(1163, { property: 'P571' }))] });
  });

  it('keeps the end of a role or a use apart from the place: the Registan stands', async () => {
    expect((await lifetimes(['Q1373583'])).Q1373583).toEqual({
      stood: [open(on(1417, { property: 'P571' }))],
      used: [until(null, on(1420, { property: 'P576' }))],
    });
  });

  it('drops an end before the beginning, which ends an earlier building: Bath Abbey\'s monastery, dissolved in 1539', async () => {
    expect((await lifetimes(['Q334399'])).Q334399).toEqual({ stood: [open(on(1572, { property: 'P571' }))] });
  });

  it('reads the Kakhovka Dam\'s destruction as an end of use, since no gone rule reads its state of conservation', async () => {
    expect((await lifetimes(['Q119210467'])).Q119210467).toEqual({
      stood: [open(on(1950, { property: 'P571' }))],
      used: [until(null, on(2023, { month: 6, day: 6, property: 'P576' }))],
    });
  });

  it('reads no start or end time on an item that states an inception: the Dohány Street Synagogue\'s are its building', async () => {
    expect((await lifetimes(['Q754397'])).Q754397).toEqual({ stood: [open(on(1854, { property: 'P571' }))] });
  });

  it('reads a start and an end time where the item states nothing else, and no standing period of a place with no beginning', async () => {
    expect((await lifetimes(['Q9719004'])).Q9719004).toEqual({
      used: [until(null, on(-1700, { span: 'century', circa: true, property: 'P582' }))],
    });
  });

  it('reads neither a gap nor an end of use where a start shares the last end\'s period, since the item does not say which came first', async () => {
    const read = await lifetimes(['Q9719005', 'Q9719006', 'Q9719008']);
    // Set up in 1998, taken down and set up again in 2010, and standing: the end and the second inception are one year.
    expect(read.Q9719005).toEqual({ stood: [open(on(1998, { property: 'P571' }))] });
    // An end known to the year and an opening that year known to the day.
    expect(read.Q9719006).toEqual({ stood: [open(on(1854, { property: 'P571' }))] });
    // An end in the 1950s and an opening in 1955.
    expect(read.Q9719008).toEqual({ stood: [open(on(1800, { property: 'P571' }))] });
  });

  it('still reads a gap whose order the item does state, beside a last end whose order it does not', async () => {
    const read = await lifetimes(['Q9719011', 'Q9719012']);
    expect(read.Q9719011).toEqual({
      stood: [until(on(1800, { property: 'P571' }), on(1900, { property: 'P576' })), open(on(1950, { property: 'P571' }))],
    });
    // The start of 2000 leaves its order with the end of 2000 unsaid; the start of 2005 does not.
    expect(read.Q9719012).toEqual({
      stood: [until(on(1800, { property: 'P571' }), on(2000, { property: 'P576' })), open(on(2005, { property: 'P571' }))],
    });
  });

  it('reads a gap before the end of a place that is gone, and no rebuild from a start after that end', async () => {
    const facts = await subsetStandingFacts(['Q9719013', 'Q9719014']);
    const read = (qid: string) => lifetimeOf(facts.get(qid) as NonNullable<ReturnType<typeof facts.get>>, 'destroyed in 1990', TODAY);
    expect(read('Q9719013')).toEqual({
      stood: [until(on(1900), on(1950)), until(on(1960), on(1990, { property: 'P576' }), 'destroyed')],
    });
    expect(read('Q9719014')).toEqual({ stood: [until(on(1900), on(1990), 'destroyed')] });
  });

  it('reads an end still ahead as no end yet, later this year or next: the place stands from its beginning', async () => {
    const facts = await subsetStandingFacts(['Q9719015', 'Q9719016']);
    for (const qid of ['Q9719015', 'Q9719016']) {
      const known = facts.get(qid) as NonNullable<ReturnType<typeof facts.get>>;
      // An announced demolition, on a place the gone rules do not read as gone: no end, and no end of use.
      expect([qid, lifetimeOf(known, null, TODAY)]).toEqual([qid, { stood: [open(on(1900))] }]);
      // And on one whose state they read as gone already: its only end lies ahead, so it stands until then.
      expect([qid, lifetimeOf(known, 'destroyed', TODAY)]).toEqual([qid, { stood: [open(on(1900))] }]);
    }
    // Read on the day itself, the end has come.
    const known = facts.get('Q9719015') as NonNullable<ReturnType<typeof facts.get>>;
    expect(lifetimeOf(known, 'destroyed', { year: 2026, month: 12, day: 25 })).toEqual({
      stood: [until(on(1900), on(2026, { month: 12, day: 25 }), 'destroyed')],
    });
    expect(lifetimeOf(known, null, { year: 2026, month: 12, day: 25 })).toEqual({
      stood: [open(on(1900))], used: [until(null, on(2026, { month: 12, day: 25 }))],
    });
  });

  it('still reads a place as gone by an end that has come, beside one dated ahead only where none is', async () => {
    // Nelson's Pillar's end of 1966 has come: gone, whatever day it is read on.
    const facts = await subsetStandingFacts(['Q2350741']);
    const known = facts.get('Q2350741') as NonNullable<ReturnType<typeof facts.get>>;
    expect(lifetimeOf(known, 'destroyed in 1966', TODAY).stood).toEqual([
      until(on(1808), on(1966, { month: 3, day: 8 }), 'destroyed'),
    ]);
    // A second end dated to 2027 beside it changes nothing: the end of 1966 has come.
    const later = { ...known.dated.find((d) => d.property === 'P576') as (typeof known.dated)[number] };
    later.time = { ...later.time, year: 2027, month: 0, day: 0, precision: 9 };
    expect(lifetimeOf({ ...known, dated: [...known.dated, later] }, 'destroyed in 1966', TODAY).stood).toEqual([
      until(on(1808), on(1966, { month: 3, day: 8 }), 'destroyed'),
    ]);
    // Gone with no dated end at all stays gone, when is not known.
    expect(lifetimeOf({ ...known, dated: known.dated.filter((d) => d.property === 'P571') }, 'destroyed', TODAY).stood)
      .toEqual([until(on(1808), null, 'destroyed')]);
  });

  it('keeps an end in the same period as the beginning: a work set up in 2019 and removed on 14 June 2019', async () => {
    expect((await lifetimes(['Q9719007'], true)).Q9719007).toEqual({
      stood: [until(on(2019, { property: 'P571' }), on(2019, { month: 6, day: 14, property: 'P576' }), 'removed')],
    });
  });

  it('keeps an end within the century the beginning is known to', async () => {
    expect((await lifetimes(['Q9719009'])).Q9719009).toEqual({
      stood: [open(on(1600, { span: 'century', property: 'P571' }))],
      used: [until(null, on(1550, { property: 'P576' }))],
    });
  });

  it('reads no start or end time on an item that states an inception, even one whose date cannot be read', async () => {
    expect((await lifetimes(['Q9719010'])).Q9719010).toEqual({});
  });

  it('turns a Julian day into the Gregorian day it is, and skips a day the Julian calendar lacks', async () => {
    const read = await lifetimes(['Q9719001', 'Q9719002']);
    expect(read.Q9719001).toEqual({ stood: [open(on(1500, { month: 3, day: 10, property: 'P571' }))] });
    expect(read.Q9719002).toEqual({ stood: [open(on(1501, { property: 'P571' }))] });
  });

  it('reads a recent date stated to ten thousand years as its year', async () => {
    expect((await lifetimes(['Q9719003'])).Q9719003).toEqual({ stood: [open(on(1920, { property: 'P571' }))] });
  });
});

describe('every gap of a place\'s standing (#2578)', () => {
  const destroyed = (from: unknown, end: unknown) => until(from, end, 'destroyed');
  const event = { property: 'P793' };

  it('reads Ponte Santa Trinita\'s three standing periods from its two ends and its two openings', async () => {
    expect((await lifetimes(['Q545578'])).Q545578).toEqual({
      stood: [
        until(on(1252, { property: 'P571' }), on(1557, { property: 'P576', statement: 'Q545578$05b3fba1-4b15-01f7-167d-b9fa1064207e' })),
        until(on(1569, { property: 'P1619' }), on(1944, { property: 'P576', statement: 'Q545578$8c07d366-453c-6414-1ee7-615bdc26fe79' })),
        open(on(1958, { month: 3, day: 16, property: 'P1619' })),
      ],
    });
  });

  it('reads the Old Bridge in Mostar as destroyed on 9 November 1993 and standing again from the day its rebuilding ended', async () => {
    expect((await lifetimes(['Q188528'])).Q188528).toEqual({
      stood: [
        destroyed(on(1566, { property: 'P571' }), on(1993, { month: 11, day: 9, ...event, statement: 'Q188528$9c39edd7-4700-2bdd-b181-5c66539235c5' })),
        open(on(2004, { month: 7, day: 23, ...event, statement: 'Q188528$eabd5cdc-4fa2-abcf-a537-254cbf2bcb8a' })),
      ],
    });
  });

  it('reads the Kintai Bridge\'s gap of 1950 to 1953, and none from its rebuilding of 1674, which no destruction precedes', async () => {
    expect((await lifetimes(['Q1196460'])).Q1196460).toEqual({
      stood: [destroyed(on(1673, { property: 'P571' }), on(1950, { month: 9, day: 14, ...event })), open(on(1953, event))],
    });
  });

  it('pairs an event with a statement either way round: Ponte Pietra\'s implosion and opening, the Frauenkirche\'s end and reconstruction', async () => {
    const read = await lifetimes(['Q540546', 'Q157229']);
    expect(read.Q540546).toEqual({
      stood: [destroyed(on(-100, { circa: true, property: 'P571' }), on(1945, { month: 4, day: 24, ...event })), open(on(1959, { property: 'P1619' }))],
    });
    // Its end of 1945 was read as the end of a use while nothing said it was rebuilt.
    expect(read.Q157229).toEqual({
      stood: [until(on(1726, { property: 'P571' }), on(1945, { month: 2, day: 15, property: 'P576' })), open(on(2005, { month: 10, day: 30, ...event }))],
    });
  });

  it('reads a reopening after a destruction as standing again: the Vizcaya Bridge, 1937 to 1941', async () => {
    expect((await lifetimes(['Q331996'])).Q331996).toEqual({
      stood: [destroyed(on(1893, { property: 'P1619' }), on(1937, { month: 6, day: 17, ...event })), open(on(1941, { month: 6, day: 19, ...event }))],
    });
  });

  it('reads as many gaps as the events state: the Cedar Covered Bridge, burnt in 2002 and in 2017', async () => {
    expect((await lifetimes(['Q5018318'])).Q5018318).toEqual({
      stood: [
        destroyed(on(1883, { property: 'P571' }), on(2002, { month: 9, day: 3, ...event })),
        destroyed(on(2004, event), on(2017, { month: 4, day: 15, ...event })),
        open(on(2019, event)),
      ],
    });
  });

  it('dates a rebuilding by the day it ended where it states one: the Malinowski Bridge, rebuilt in 1947 and done on 26 August 1951', async () => {
    expect((await lifetimes(['Q11785886'])).Q11785886).toEqual({
      stood: [
        destroyed(on(1879, { property: 'P571' }), on(1939, { month: 9, day: 2, ...event })),
        destroyed(on(1940, event), on(1945, event)),
        // The opening of that day, a statement, is read before the event that ended then; 1947 is neither.
        open(on(1951, { month: 8, day: 26, property: 'P1619' })),
      ],
    });
  });

  it('reads no beginning from a rebuilding: the Mosque of Amr ibn al-As, rebuilt in 827, states no inception', async () => {
    expect((await lifetimes(['Q683511'])).Q683511).toEqual({});
  });

  it('keeps the Cathedral of Christ the Saviour\'s end as its end statement\'s beside the implosion event of that day', async () => {
    const { stood } = (await lifetimes(['Q194474'])).Q194474 as { stood: unknown[] };
    expect(stood).toEqual([
      until(on(1883, { property: 'P1619' }), on(1931, { month: 12, day: 5, property: 'P576', statement: 'Q194474$cb21ee04-40c9-437a-d682-4cc31e439511' })),
      open(on(2000, { month: 8, day: 19, property: 'P571' })),
    ]);
  });

  it('opens no gap for work on a building that never fell: Berlin Cathedral\'s bombardment, Kinkaku-ji\'s fire, Pembroke Castle\'s slighting', async () => {
    const read = await lifetimes(['Q154563', 'Q270983', 'Q1422235']);
    expect(read.Q154563).toEqual({ stood: [open(on(1894, { property: 'P571' }))] });
    // The Golden Pavilion did burn down in 1950; its item says only that there was a fire.
    expect(read.Q270983).toEqual({ stood: [open(on(1397, { property: 'P571' }))] });
    // A reconstruction that states only when it started gives no day the castle stood again.
    expect(read.Q1422235).toEqual({ stood: [open(on(1093, { property: 'P571' }))] });
  });

  it('reads nothing of the place from an event that names a part: Hirano Shrine\'s worship hall, Stuttgart\'s collegiate church', async () => {
    const read = await lifetimes(['Q738971', 'Q321819']);
    expect(read.Q738971).toEqual({ stood: [open(on(782, { property: 'P571' }))] });
    // Its reconstruction of the 1950s may be either side of 1944, and the one that ended in 2003 was the roof's.
    expect(read.Q321819).toEqual({ stood: [open(on(1321, { property: 'P571' }))] });
  });

  it('reads no boundary from an event with no date, and no gap from two events of one year: Bebelplatz', async () => {
    expect((await lifetimes(['Q699504'])).Q699504).toEqual({ stood: [open(on(1740, { property: 'P571' }))] });
  });

  it('reads no end of the place and no end of a use from a destruction nothing follows: the Buddhas of Bamiyan, Byōdō-in', async () => {
    const read = await lifetimes(['Q484458', 'Q61094']);
    expect(read.Q484458).toEqual({});
    expect(read.Q61094).toEqual({ stood: [open(on(1052, { property: 'P571' }))] });
  });

  it('reports the gap an item states however long it is, for the gate to ask about: the Odeon of Herodes Atticus, 267 to 1953', async () => {
    expect((await lifetimes(['Q1328165'])).Q1328165).toEqual({
      stood: [destroyed(on(161, { property: 'P571' }), on(267, event)), open(on(1953, event))],
    });
  });

  it('pairs nothing out of order and never throws: a rebuilding before the destruction, and one still ahead', async () => {
    expect((await lifetimes(['Q9719017'])).Q9719017).toEqual({ stood: [open(on(1800, { property: 'P571' }))] });
  });

  it('ends a gone place at the latest end its item states, a destruction among them, whatever is dated after it', async () => {
    const facts = await subsetStandingFacts(['Q9719018']);
    expect(lifetimeOf(facts.get('Q9719018') as NonNullable<ReturnType<typeof facts.get>>, 'destroyed in 1940', TODAY)).toEqual({
      stood: [destroyed(on(1900), on(1945, { month: 3, day: 2, ...event }))],
    });
  });

  it('reads the dates of an event once each, and the one qualifier that tells its day', async () => {
    const facts = await subsetStandingFacts(['Q188528', 'Q738971', 'Q699504']);
    expect(facts.get('Q188528')?.datedEvents).toEqual([
      expect.objectContaining({ event: 'Q17781833', qualifier: 'P585', time: { year: 1993, month: 11, day: 9, precision: 11 } }),
      expect.objectContaining({ event: 'Q1370468', qualifier: 'P582', time: { year: 2004, month: 7, day: 23, precision: 11 } }),
    ]);
    expect(facts.get('Q738971')?.datedEvents).toEqual([]);
    expect(facts.get('Q699504')?.datedEvents).toHaveLength(2);
  });
});

describe('the lifetimes a run reads on the live service (#1719)', () => {
  it('reads an item that states no date as an empty view, and leaves one the service does not answer unread', async () => {
    const e = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
    // Q9719201 exists and states no date any more; Q9719202 is a redirect, which the service answers with no row.
    const sparql = vi.fn(async () => [{ e: e('Q9719201'), known: { type: 'literal', value: '3' } }]);
    const read = await readLifetimes(sparql, [{ key: 'kept', qid: 'Q9719201' }, { key: 'gone', qid: 'Q9719202' }]);
    expect(read.get('kept')).toEqual({});
    expect(read.has('gone')).toBe(false);
  });

  it('reads the Old Bridge in Mostar from the service\'s rows as the subset reads it from the item (#2578)', async () => {
    const e = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
    const lit = (value: string) => ({ type: 'literal', value });
    const node = (id: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/statement/${id}` });
    const destruction = node('Q188528-9c39edd7-4700-2bdd-b181-5c66539235c5');
    const rebuilding = node('Q188528-eabd5cdc-4fa2-abcf-a537-254cbf2bcb8a');
    const sparql = vi.fn(async (_query: string) => [
      { e: e('Q188528'), known: lit('120') },
      { e: e('Q188528'), datedProperty: lit('P571'), datedStatement: node('Q188528-ab2eae0b-4351-f207-8f0d-27cd0c7b6495'), dated: lit('1566-01-01T00:00:00Z'), datedPrecision: lit('9') },
      { e: e('Q188528'), datedProperty: lit('P1619'), datedStatement: node('Q188528-DE8ACCDD-07AC-4FE4-AF36-652669766F4D'), dated: lit('1567-01-01T00:00:00Z'), datedPrecision: lit('9') },
      { e: e('Q188528'), event: e('Q17781833') },
      { e: e('Q188528'), datedEvent: e('Q17781833'), eventStatement: destruction, eventQualifier: lit('P585'), eventAt: lit('1993-11-09T00:00:00Z'), eventAtPrecision: lit('11') },
      // The answer carries every dated event: the bridge's construction is none that is read, and neither is
      // an event that names a part. It names the rebuilding's end twice; its start is not asked for.
      { e: e('Q188528'), datedEvent: e('Q385378'), eventStatement: node('Q188528-91085467-475f-7108-7015-7d324aaf6575'), eventQualifier: lit('P582'), eventAt: lit('1566-01-01T00:00:00Z'), eventAtPrecision: lit('9') },
      { e: e('Q188528'), datedEvent: e('Q17781833'), eventStatement: node('Q188528-AAAA-not-a-statement-of-the-item'), eventQualifier: lit('P585'), eventAt: lit('1700-01-01T00:00:00Z'), eventAtPrecision: lit('9'), eventPart: e('Q3125745') },
      { e: e('Q188528'), datedEvent: e('Q1370468'), eventStatement: rebuilding, eventQualifier: lit('P582'), eventAt: lit('2004-07-23T00:00:00Z'), eventAtPrecision: lit('11') },
      { e: e('Q188528'), datedEvent: e('Q1370468'), eventStatement: rebuilding, eventQualifier: lit('P582'), eventAt: lit('2004-07-23T00:00:00Z'), eventAtPrecision: lit('11') },
    ]);
    const live = (await readLifetimes(sparql, [{ key: 'bridge', qid: 'Q188528' }], goneReason)).get('bridge');
    const subset = await subsetStandingFacts(['Q188528']);
    expect(live).toEqual(lifetimeOf(subset.get('Q188528') as NonNullable<ReturnType<typeof subset.get>>, null));
    expect(live?.stood).toHaveLength(2);
    // One query, as before: the events are two more branches of it, each from the item to its own event
    // statements by fixed predicates.
    expect(sparql).toHaveBeenCalledTimes(1);
    const query = sparql.mock.calls[0][0].replace(/\s+/g, ' ');
    for (const qualifier of ['P585', 'P582']) {
      expect(query).toContain(`UNION { ?e p:P793 ?eventStatement . ?eventStatement a wikibase:BestRank ; ps:P793 ?datedEvent ; pqv:${qualifier} [`);
    }
    expect(query).toContain('OPTIONAL { ?eventStatement pq:P518 ?eventPart }');
    expect(query).not.toContain('VALUES ?datedEvent');
  });
});
