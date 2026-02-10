-- Migration 003: Deactivate "Curator Picks" source
-- Curators now assign new experiences to existing sources (UNESCO, Top Museums, Public Art & Monuments).
-- The source row is kept (not deleted) to preserve FK references from any existing experiences.

UPDATE experience_sources SET is_active = false WHERE name = 'Curator Picks';
