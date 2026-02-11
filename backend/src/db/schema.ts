import { pgTable, serial, varchar, integer, boolean, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Database Schema for Track Your Regions
 *
 * Terminology:
 * - administrativeDivisions: Official GADM boundaries (countries, states, cities)
 * - worldViews: Custom hierarchies for organizing regions
 * - regions: User-defined groupings within a WorldView
 * - regionMembers: Links regions to administrative divisions
 */

// =============================================================================
// Administrative Divisions (GADM boundaries)
// =============================================================================

export const administrativeDivisions = pgTable('administrative_divisions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle ORM requires `any` for self-referencing foreign keys
  parentId: integer('parent_id').references((): any => administrativeDivisions.id),
  hasChildren: boolean('has_children').notNull().default(false),
  gadmUid: integer('gadm_uid'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  parentIdx: index('idx_admin_divisions_parent').on(table.parentId),
  nameIdx: index('idx_admin_divisions_name').on(table.name),
}));

export const administrativeDivisionsRelations = relations(administrativeDivisions, ({ one, many }) => ({
  parent: one(administrativeDivisions, {
    fields: [administrativeDivisions.parentId],
    references: [administrativeDivisions.id],
    relationName: 'parentChild',
  }),
  children: many(administrativeDivisions, { relationName: 'parentChild' }),
}));

// =============================================================================
// Views (saved collections of divisions)
// =============================================================================

export const views = pgTable('views', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 1000 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const viewDivisionMapping = pgTable('view_division_mapping', {
  id: serial('id').primaryKey(),
  viewId: integer('view_id').notNull().references(() => views.id, { onDelete: 'cascade' }),
  divisionId: integer('division_id').notNull().references(() => administrativeDivisions.id, { onDelete: 'cascade' }),
}, (table) => ({
  viewIdx: index('idx_view_mapping_view').on(table.viewId),
  divisionIdx: index('idx_view_mapping_division').on(table.divisionId),
}));

export const viewsRelations = relations(views, ({ many }) => ({
  divisionMappings: many(viewDivisionMapping),
}));

export const viewDivisionMappingRelations = relations(viewDivisionMapping, ({ one }) => ({
  view: one(views, {
    fields: [viewDivisionMapping.viewId],
    references: [views.id],
  }),
  division: one(administrativeDivisions, {
    fields: [viewDivisionMapping.divisionId],
    references: [administrativeDivisions.id],
  }),
}));

// =============================================================================
// World Views (custom hierarchies)
// =============================================================================

export const worldViews = pgTable('world_views', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 1000 }),
  source: varchar('source', { length: 1000 }),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  lastAssignmentAt: timestamp('last_assignment_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// Regions (user-defined groupings within a WorldView)
// =============================================================================

export const regions = pgTable('regions', {
  id: serial('id').primaryKey(),
  worldViewId: integer('world_view_id').notNull().references(() => worldViews.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 1000 }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle ORM requires `any` for self-referencing foreign keys
  parentRegionId: integer('parent_region_id').references((): any => regions.id, { onDelete: 'set null' }),
  color: varchar('color', { length: 7 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  worldViewIdx: index('idx_regions_world_view').on(table.worldViewId),
  parentIdx: index('idx_regions_parent').on(table.parentRegionId),
}));

// =============================================================================
// Region Members (links regions to administrative divisions)
// =============================================================================

export const regionMembers = pgTable('region_members', {
  id: serial('id').primaryKey(),
  regionId: integer('region_id').notNull().references(() => regions.id, { onDelete: 'cascade' }),
  divisionId: integer('division_id').notNull().references(() => administrativeDivisions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  regionIdx: index('idx_region_members_region').on(table.regionId),
  divisionIdx: index('idx_region_members_division').on(table.divisionId),
  uniqueMember: unique('unique_region_division').on(table.regionId, table.divisionId),
}));

// =============================================================================
// Relations
// =============================================================================

export const worldViewsRelations = relations(worldViews, ({ many }) => ({
  regions: many(regions),
}));

export const regionsRelations = relations(regions, ({ one, many }) => ({
  worldView: one(worldViews, {
    fields: [regions.worldViewId],
    references: [worldViews.id],
  }),
  parent: one(regions, {
    fields: [regions.parentRegionId],
    references: [regions.id],
    relationName: 'regionParentChild',
  }),
  children: many(regions, { relationName: 'regionParentChild' }),
  members: many(regionMembers),
}));

export const regionMembersRelations = relations(regionMembers, ({ one }) => ({
  region: one(regions, {
    fields: [regionMembers.regionId],
    references: [regions.id],
  }),
  division: one(administrativeDivisions, {
    fields: [regionMembers.divisionId],
    references: [administrativeDivisions.id],
  }),
}));

// =============================================================================
// Experience System (UNESCO World Heritage Sites and future sources)
// =============================================================================

/**
 * Experience categories (UNESCO, museums, landmarks, etc.)
 */
export const experienceCategories = pgTable('experience_categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: varchar('description', { length: 2000 }),
  apiEndpoint: varchar('api_endpoint', { length: 1000 }),
  // apiConfig stored as JSONB in DB, handled via raw SQL for complex queries
  isActive: boolean('is_active').default(true),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncStatus: varchar('last_sync_status', { length: 50 }),
  lastSyncError: varchar('last_sync_error', { length: 2000 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/**
 * Generic experiences from various sources
 * Note: Geometry columns (location, boundary) are handled via raw SQL
 */
export const experiences = pgTable('experiences', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => experienceCategories.id, { onDelete: 'cascade' }),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  // Names
  name: varchar('name', { length: 500 }).notNull(),
  // nameLocal stored as JSONB in DB
  // Descriptions
  description: varchar('description', { length: 10000 }),
  shortDescription: varchar('short_description', { length: 2000 }),
  // Classification
  category: varchar('category', { length: 100 }),
  // tags stored as JSONB in DB
  // Location geometry handled via raw SQL (location, boundary, area_km2)
  // Country info as arrays handled via raw SQL (country_codes, country_names)
  // Media
  imageUrl: varchar('image_url', { length: 1000 }),
  // metadata stored as JSONB in DB
  // Curation fields
  isManual: boolean('is_manual').notNull().default(false),
  createdBy: integer('created_by'),  // References users(id) - handled at DB level
  curatedFields: jsonb('curated_fields').default([]),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  isIconic: boolean('is_iconic').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  categoryIdx: index('idx_experiences_category_id').on(table.categoryId),
  categoryClassIdx: index('idx_experiences_category').on(table.category),
  uniqueCategoryExternal: unique('unique_category_external_id').on(table.categoryId, table.externalId),
}));

/**
 * Experience-Region junction table
 * Auto-computed via spatial containment queries
 */
export const experienceRegions = pgTable('experience_regions', {
  id: serial('id').primaryKey(),
  experienceId: integer('experience_id').notNull().references(() => experiences.id, { onDelete: 'cascade' }),
  regionId: integer('region_id').notNull().references(() => regions.id, { onDelete: 'cascade' }),
  assignmentType: varchar('assignment_type', { length: 20 }).default('auto'),
  assignedBy: integer('assigned_by'),  // References users(id) - handled at DB level
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  experienceIdx: index('idx_experience_regions_experience').on(table.experienceId),
  regionIdx: index('idx_experience_regions_region').on(table.regionId),
  uniqueExperienceRegion: unique('unique_experience_region').on(table.experienceId, table.regionId),
}));

/**
 * User visited experiences tracking
 * Note: user_id references users table which is not in Drizzle (raw SQL)
 */
export const userVisitedExperiences = pgTable('user_visited_experiences', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),  // References users(id) - handled at DB level
  experienceId: integer('experience_id').notNull().references(() => experiences.id, { onDelete: 'cascade' }),
  visitedAt: timestamp('visited_at', { withTimezone: true }).defaultNow(),
  notes: varchar('notes', { length: 2000 }),
  rating: integer('rating'),  // 1-5, constraint at DB level
}, (table) => ({
  userIdx: index('idx_user_visited_experiences_user').on(table.userId),
  experienceIdx: index('idx_user_visited_experiences_experience').on(table.experienceId),
  uniqueUserExperience: unique('unique_user_experience').on(table.userId, table.experienceId),
}));

/**
 * Sync audit log for tracking sync operations
 */
export const experienceSyncLogs = pgTable('experience_sync_logs', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => experienceCategories.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  status: varchar('status', { length: 50 }).default('running'),
  totalFetched: integer('total_fetched').default(0),
  totalCreated: integer('total_created').default(0),
  totalUpdated: integer('total_updated').default(0),
  totalErrors: integer('total_errors').default(0),
  // errorDetails stored as JSONB in DB
  triggeredBy: integer('triggered_by'),  // References users(id) - handled at DB level
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  categoryIdx: index('idx_experience_sync_logs_category').on(table.categoryId),
  statusIdx: index('idx_experience_sync_logs_status').on(table.status),
}));

// =============================================================================
// Experience Relations
// =============================================================================

export const experienceCategoriesRelations = relations(experienceCategories, ({ many }) => ({
  experiences: many(experiences),
  syncLogs: many(experienceSyncLogs),
}));

export const experiencesRelations = relations(experiences, ({ one, many }) => ({
  category: one(experienceCategories, {
    fields: [experiences.categoryId],
    references: [experienceCategories.id],
  }),
  regionAssignments: many(experienceRegions),
  userVisits: many(userVisitedExperiences),
  locations: many(experienceLocations),
  treasureLinks: many(experienceTreasures),
}));

export const experienceRegionsRelations = relations(experienceRegions, ({ one }) => ({
  experience: one(experiences, {
    fields: [experienceRegions.experienceId],
    references: [experiences.id],
  }),
  region: one(regions, {
    fields: [experienceRegions.regionId],
    references: [regions.id],
  }),
}));

export const userVisitedExperiencesRelations = relations(userVisitedExperiences, ({ one }) => ({
  experience: one(experiences, {
    fields: [userVisitedExperiences.experienceId],
    references: [experiences.id],
  }),
  // Note: user relation not defined as users table is not in Drizzle
}));

export const experienceSyncLogsRelations = relations(experienceSyncLogs, ({ one }) => ({
  category: one(experienceCategories, {
    fields: [experienceSyncLogs.categoryId],
    references: [experienceCategories.id],
  }),
  // Note: triggeredBy user relation not defined as users table is not in Drizzle
}));

// =============================================================================
// Treasures (artworks, artifacts — can belong to multiple venues)
// =============================================================================

/**
 * Notable treasures (artworks, artifacts) that can belong to multiple venues.
 * Globally unique items linked to experiences via junction table.
 */
export const treasures = pgTable('treasures', {
  id: serial('id').primaryKey(),
  externalId: varchar('external_id', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 500 }).notNull(),
  treasureType: varchar('treasure_type', { length: 50 }).notNull(),
  artist: varchar('artist', { length: 500 }),
  year: integer('year'),
  imageUrl: varchar('image_url', { length: 1000 }),
  sitelinksCount: integer('sitelinks_count').notNull().default(0),
  isIconic: boolean('is_iconic').notNull().default(false),
  // metadata stored as JSONB in DB
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  treasureTypeIdx: index('idx_treasures_type').on(table.treasureType),
  sitelinksIdx: index('idx_treasures_sitelinks').on(table.sitelinksCount),
}));

/**
 * Junction table: many-to-many between experiences and treasures
 */
export const experienceTreasures = pgTable('experience_treasures', {
  id: serial('id').primaryKey(),
  experienceId: integer('experience_id').notNull().references(() => experiences.id, { onDelete: 'cascade' }),
  treasureId: integer('treasure_id').notNull().references(() => treasures.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  experienceIdx: index('idx_experience_treasures_experience').on(table.experienceId),
  treasureIdx: index('idx_experience_treasures_treasure').on(table.treasureId),
  uniqueExperienceTreasure: unique('unique_experience_treasure').on(table.experienceId, table.treasureId),
}));

export const treasuresRelations = relations(treasures, ({ many }) => ({
  experienceLinks: many(experienceTreasures),
}));

export const experienceTreasuresRelations = relations(experienceTreasures, ({ one }) => ({
  experience: one(experiences, {
    fields: [experienceTreasures.experienceId],
    references: [experiences.id],
  }),
  treasure: one(treasures, {
    fields: [experienceTreasures.treasureId],
    references: [treasures.id],
  }),
}));

// =============================================================================
// Experience Locations (Multi-Location Support)
// =============================================================================

/**
 * Individual locations for multi-location experiences
 * (e.g., UNESCO serial nominations with multiple components)
 */
export const experienceLocations = pgTable('experience_locations', {
  id: serial('id').primaryKey(),
  experienceId: integer('experience_id').notNull().references(() => experiences.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 500 }),
  externalRef: varchar('external_ref', { length: 255 }),
  ordinal: integer('ordinal').notNull().default(0),
  // location geometry handled via raw SQL
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  experienceIdx: index('idx_experience_locations_experience').on(table.experienceId),
  uniqueOrdinal: unique('unique_experience_ordinal').on(table.experienceId, table.ordinal),
}));

/**
 * User visited locations (individual location tracking)
 */
export const userVisitedLocations = pgTable('user_visited_locations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),  // References users(id) - handled at DB level
  locationId: integer('location_id').notNull().references(() => experienceLocations.id, { onDelete: 'cascade' }),
  visitedAt: timestamp('visited_at', { withTimezone: true }).defaultNow(),
  notes: varchar('notes', { length: 2000 }),
}, (table) => ({
  userIdx: index('idx_user_visited_locations_user').on(table.userId),
  locationIdx: index('idx_user_visited_locations_location').on(table.locationId),
  uniqueUserLocation: unique('unique_user_location').on(table.userId, table.locationId),
}));

/**
 * Experience Location-Region junction table
 * Auto-computed via spatial containment queries
 */
export const experienceLocationRegions = pgTable('experience_location_regions', {
  id: serial('id').primaryKey(),
  locationId: integer('location_id').notNull().references(() => experienceLocations.id, { onDelete: 'cascade' }),
  regionId: integer('region_id').notNull().references(() => regions.id, { onDelete: 'cascade' }),
  assignmentType: varchar('assignment_type', { length: 20 }).default('auto'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  locationIdx: index('idx_experience_location_regions_location').on(table.locationId),
  regionIdx: index('idx_experience_location_regions_region').on(table.regionId),
  uniqueLocationRegion: unique('unique_location_region').on(table.locationId, table.regionId),
}));

// =============================================================================
// Experience Location Relations
// =============================================================================

export const experienceLocationsRelations = relations(experienceLocations, ({ one, many }) => ({
  experience: one(experiences, {
    fields: [experienceLocations.experienceId],
    references: [experiences.id],
  }),
  regionAssignments: many(experienceLocationRegions),
  userVisits: many(userVisitedLocations),
}));

export const userVisitedLocationsRelations = relations(userVisitedLocations, ({ one }) => ({
  location: one(experienceLocations, {
    fields: [userVisitedLocations.locationId],
    references: [experienceLocations.id],
  }),
  // Note: user relation not defined as users table is not in Drizzle
}));

export const experienceLocationRegionsRelations = relations(experienceLocationRegions, ({ one }) => ({
  location: one(experienceLocations, {
    fields: [experienceLocationRegions.locationId],
    references: [experienceLocations.id],
  }),
  region: one(regions, {
    fields: [experienceLocationRegions.regionId],
    references: [regions.id],
  }),
}));

// =============================================================================
// Curator System
// =============================================================================

/**
 * Curator assignments (scoped permissions)
 */
export const curatorAssignments = pgTable('curator_assignments', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),  // References users(id) - handled at DB level
  scopeType: varchar('scope_type', { length: 20 }).notNull(),
  regionId: integer('region_id').references(() => regions.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id').references(() => experienceCategories.id, { onDelete: 'cascade' }),
  assignedBy: integer('assigned_by').notNull(),  // References users(id)
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow(),
  notes: varchar('notes', { length: 2000 }),
}, (table) => ({
  userIdx: index('idx_curator_assignments_user').on(table.userId),
}));

/**
 * Experience curation audit log
 */
export const experienceCurationLog = pgTable('experience_curation_log', {
  id: serial('id').primaryKey(),
  experienceId: integer('experience_id').notNull().references(() => experiences.id, { onDelete: 'cascade' }),
  curatorId: integer('curator_id').notNull(),  // References users(id)
  action: varchar('action', { length: 30 }).notNull(),
  regionId: integer('region_id').references(() => regions.id, { onDelete: 'set null' }),
  // details stored as JSONB in DB
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  experienceIdx: index('idx_curation_log_experience').on(table.experienceId),
  curatorIdx: index('idx_curation_log_curator').on(table.curatorId),
  createdIdx: index('idx_curation_log_created').on(table.createdAt),
}));

/**
 * Experience rejections (per region)
 */
export const experienceRejections = pgTable('experience_rejections', {
  id: serial('id').primaryKey(),
  experienceId: integer('experience_id').notNull().references(() => experiences.id, { onDelete: 'cascade' }),
  regionId: integer('region_id').notNull().references(() => regions.id, { onDelete: 'cascade' }),
  rejectedBy: integer('rejected_by').notNull(),  // References users(id)
  reason: varchar('reason', { length: 2000 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  experienceIdx: index('idx_experience_rejections_experience').on(table.experienceId),
  regionIdx: index('idx_experience_rejections_region').on(table.regionId),
  uniqueRejection: unique('unique_experience_rejection').on(table.experienceId, table.regionId),
}));
