-- Migration 012: Add coordinates_valid flag to search_bar_locations
-- Allows stale coordinate entries to be soft-invalidated while preserving
-- the discovered_resource_id so the learned resource-ID registry survives
-- cache invalidations and server restarts.

ALTER TABLE search_bar_locations
  ADD COLUMN IF NOT EXISTS coordinates_valid BOOLEAN NOT NULL DEFAULT TRUE;
