-- The OpenStreetMap layer's flex style (ADR-0134): which objects of the cut
-- become rows of the layer, with every tag, and the full geometry of the
-- objects a kind draws and a point for the rest (ADR-0136).
--
-- The cut osm2pgsql reads holds the selected objects, the objects the
-- catalogue names, and what those are drawn from: a kept way's nodes and a
-- kept relation's members. Only the first two become rows. The selection is
-- the same expression file `osmium tags-filter` cut with (layerSelection.ts),
-- and the named objects are the file `osmium getid` read, so the rows and the
-- cut cannot disagree. The drawn rule is layerSelection.ts's too. layerBuild.ts
-- names the four through the environment.

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

-- key -> true where any value but 'no' draws, or a set of the values that do.
local drawn = {}
for line in io.lines(required('OSM_LAYER_DRAWN')) do
  local key, values = line:match('^([^=]+)=(.+)$')
  if key then
    local set = {}
    for value in values:gmatch('[^,]+') do set[value] = true end
    drawn[key] = set
  elseif line ~= '' then
    drawn[line] = true
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

local function draws(tags)
  for key, values in pairs(drawn) do
    local value = tags[key]
    if value ~= nil then
      if values == true then
        if value ~= 'no' then return true end
      elseif values[value] then
        return true
      end
    end
  end
  return false
end

-- Where an object no kind draws is: a point inside its largest area, which
-- lies on the object, or else the centre of its line or of its members, which
-- may not. A reader locates the object by it and never places anything by it.
local function locator(geometry)
  if geometry == nil or geometry:is_null() then return geometry end
  local shape = geometry:geometry_type()
  if shape == 'POINT' then return geometry end
  if shape == 'POLYGON' then return geometry:pole_of_inaccessibility() end
  if shape == 'MULTIPOLYGON' or shape == 'GEOMETRYCOLLECTION' then
    local largest, size = nil, 0
    for part in geometry:geometries() do
      if part:geometry_type() == 'POLYGON' and part:area() > size then
        largest, size = part, part:area()
      end
    end
    if largest ~= nil then return largest:pole_of_inaccessibility() end
  end
  return geometry:centroid()
end

local function keep(object, kind, geometry)
  if not (selects(object.tags) or pinned[kind .. object.id]) then return end
  objects:insert({
    tags = object.tags,
    wikidata = object.tags.wikidata,
    wikipedia = object.tags.wikipedia,
    geom = draws(object.tags) and geometry or locator(geometry),
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
