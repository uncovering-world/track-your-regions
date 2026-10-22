-- The OpenStreetMap layer's flex style (ADR-0134): which objects of the cut
-- become rows of the layer, with every tag and their full geometry.
--
-- The cut osm2pgsql reads holds the selected objects, the objects the
-- catalogue names, and what those are drawn from: a kept way's nodes and a
-- kept relation's members. Only the first two become rows. The selection is
-- the same expression file `osmium tags-filter` cut with (layerSelection.ts),
-- and the named objects are the file `osmium getid` read, so the rows and the
-- cut cannot disagree. layerBuild.ts names the three through the environment.

local function required(name)
  local value = os.getenv(name)
  if value == nil or value == '' then error(name .. ' is not set') end
  return value
end

-- key -> true for any value, or a set of the values that select.
local selected = {}
for line in io.lines(required('OSM_LAYER_SELECTION')) do
  local expression = line:match('^nwr/(.+)$')
  if expression then
    local key, values = expression:match('^([^=]+)=(.+)$')
    if key then
      local set = {}
      for value in values:gmatch('[^,]+') do set[value] = true end
      selected[key] = set
    else
      selected[expression] = true
    end
  end
end

-- 'n123', 'w45', 'r6': the objects kept whatever their tags.
local pinned = {}
for line in io.lines(required('OSM_LAYER_PINS')) do
  if line ~= '' then pinned[line] = true end
end

local objects = osm2pgsql.define_table({
  name = required('OSM_LAYER_TABLE'),
  schema = 'workbench',
  ids = { type = 'any', type_column = 'osm_type', id_column = 'osm_id' },
  columns = {
    { column = 'tags', type = 'jsonb', not_null = true },
    { column = 'wikidata', type = 'text' },
    { column = 'wikipedia', type = 'text' },
    { column = 'geom', type = 'geometry', projection = 4326 },
  },
  -- The build gives the table the live table's indexes once it is loaded.
  indexes = {},
  -- No spatial clustering: the layer is read by item and by tag, never by
  -- nearness, and clustering copies the whole loaded table into a sorted one
  -- (22 GB on the first build, 2026-10-22).
  cluster = 'no',
})

local function selects(tags)
  for key, values in pairs(selected) do
    local value = tags[key]
    if value ~= nil and (values == true or values[value]) then return true end
  end
  return false
end

local function keep(object, kind, geometry)
  if not (selects(object.tags) or pinned[kind .. object.id]) then return end
  objects:insert({
    tags = object.tags,
    wikidata = object.tags.wikidata,
    wikipedia = object.tags.wikipedia,
    geom = geometry,
  })
end

function osm2pgsql.process_node(object)
  keep(object, 'n', object:as_point())
end

-- A closed way is drawn as the area it encloses, and as its line where that
-- area is not valid; an open way as its line.
function osm2pgsql.process_way(object)
  local geometry = nil
  if object.is_closed then geometry = object:as_polygon() end
  if geometry == nil or geometry:is_null() then geometry = object:as_linestring() end
  keep(object, 'w', geometry)
end

-- An area relation as its multipolygon; any other (a site, a route) as the
-- collection of its members' geometries.
function osm2pgsql.process_relation(object)
  local kind = object.tags.type
  local geometry
  if kind == 'multipolygon' or kind == 'boundary' then
    geometry = object:as_multipolygon()
  else
    geometry = object:as_geometrycollection()
  end
  keep(object, 'r', geometry)
end
