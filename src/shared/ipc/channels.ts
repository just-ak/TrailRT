/**
 * IPC channel names. The renderer never sees these strings — the preload bridge
 * exposes named methods instead, so there is no generic passthrough to abuse.
 */
export const CHANNELS = {
  library: {
    tree: 'library:tree',
  },
  trips: {
    list: 'trips:list',
    get: 'trips:get',
    create: 'trips:create',
    update: 'trips:update',
    duplicate: 'trips:duplicate',
    move: 'trips:move',
    setStatus: 'trips:setStatus',
    delete: 'trips:delete',
    search: 'trips:search',
    /** Phase 14: every visible trip with its dates, length and counts. */
    overview: 'trips:overview',
  },
  folders: {
    list: 'folders:list',
    get: 'folders:get',
    create: 'folders:create',
    rename: 'folders:rename',
    move: 'folders:move',
    delete: 'folders:delete',
  },
  settings: {
    all: 'settings:all',
    set: 'settings:set',
  },
  backup: {
    list: 'backup:list',
    create: 'backup:create',
    createTo: 'backup:createTo',
    restore: 'backup:restore',
  },
  routes: {
    listForTrip: 'routes:listForTrip',
    listAll: 'routes:listAll',
    get: 'routes:get',
    create: 'routes:create',
    update: 'routes:update',
    setGeometry: 'routes:setGeometry',
    reverse: 'routes:reverse',
    duplicate: 'routes:duplicate',
    move: 'routes:move',
    delete: 'routes:delete',
  },
  /**
   * Phase 11: folders on disk linked to a trip. Named for folders, not photos,
   * because Phase 12 syncs GPX through the same links.
   */
  linkedFolders: {
    /** Opens the native chooser; returns a token, never a path to send back. */
    chooseFolder: 'linkedFolders:chooseFolder',
    link: 'linkedFolders:link',
    unlink: 'linkedFolders:unlink',
    /** Opens the chooser for a folder that has moved. */
    relink: 'linkedFolders:relink',
    setIncludeSubfolders: 'linkedFolders:setIncludeSubfolders',
    rescan: 'linkedFolders:rescan',
    cancelScan: 'linkedFolders:cancelScan',
    list: 'linkedFolders:list',
    get: 'linkedFolders:get',
  },
  /** Phase 11: photos in linked folders, always by id. */
  photos: {
    list: 'photos:list',
    mapPoints: 'photos:mapPoints',
    years: 'photos:years',
    get: 'photos:get',
    thumbnail: 'photos:thumbnail',
    open: 'photos:open',
    reveal: 'photos:reveal',
    /** Phase 14: every photo of a trip's linked folders, in taken order. */
    forTrip: 'photos:forTrip',
  },
  /** Phase 10: postcode and place search, answered on this machine. */
  search: {
    query: 'search:query',
    status: 'search:status',
  },
  /** Phase 10: points of interest from the region build's place data. */
  places: {
    status: 'places:status',
    /** Rebuilds the loaded regions, which also rebuilds their place data. */
    rebuild: 'places:rebuild',
    along: 'places:along',
    cancel: 'places:cancel',
    detour: 'places:detour',
    get: 'places:get',
    /** Adds a POI to a trip as a waypoint. */
    addWaypoint: 'places:addWaypoint',
  },
  /** Phase 10: Code-Point Open, fetched once on request. */
  postcodes: {
    listing: 'postcodes:listing',
    update: 'postcodes:update',
    cancel: 'postcodes:cancel',
  },
  itinerary: {
    get: 'itinerary:get',
    create: 'itinerary:create',
    remove: 'itinerary:remove',
    update: 'itinerary:update',
    addStop: 'itinerary:addStop',
    removeStop: 'itinerary:removeStop',
    moveStop: 'itinerary:moveStop',
    updateStop: 'itinerary:updateStop',
    linkLeg: 'itinerary:linkLeg',
    /** By road (planned automatically) or other transport ("don't link"). */
    setLegMode: 'itinerary:setLegMode',
    /** Plans every by-road leg that has no route: a retry. */
    planAll: 'itinerary:planAll',
    /** A POI as a stop: waypoint and stop in one undoable step. */
    addPoiStop: 'itinerary:addPoiStop',
    /** Routes the leg arriving at a stop, saves the route and links it. */
    planLeg: 'itinerary:planLeg',
    /** Routes the legs into and out of a stop inserted between two others. */
    planAround: 'itinerary:planAround',
    /** Saves the itinerary as an iCalendar file the user picks. */
    exportIcs: 'itinerary:exportIcs',
  },
  waypoints: {
    listForTrip: 'waypoints:listForTrip',
    listAll: 'waypoints:listAll',
    get: 'waypoints:get',
    create: 'waypoints:create',
    update: 'waypoints:update',
    move: 'waypoints:move',
    duplicate: 'waypoints:duplicate',
    moveToTrip: 'waypoints:moveToTrip',
    delete: 'waypoints:delete',
    search: 'waypoints:search',
    groups: 'waypoints:groups',
    createGroup: 'waypoints:createGroup',
  },
  tracks: {
    listForTrip: 'tracks:listForTrip',
    listAll: 'tracks:listAll',
    get: 'tracks:get',
    geometry: 'tracks:geometry',
    update: 'tracks:update',
    move: 'tracks:move',
    reverse: 'tracks:reverse',
    previewSimplify: 'tracks:previewSimplify',
    simplify: 'tracks:simplify',
    split: 'tracks:split',
    join: 'tracks:join',
    deleteRange: 'tracks:deleteRange',
    delete: 'tracks:delete',
    hasOriginal: 'tracks:hasOriginal',
    restoreOriginal: 'tracks:restoreOriginal',
    /**
     * One window of exact points, for the point table.
     *
     * Paged because a recording can hold 200,000 points and a table shows
     * forty. Always exact, never the render cache — an index from a simplified
     * payload would not identify the sample the user is editing.
     */
    points: 'tracks:points',
    /** Corrects one sample. The original file remains the way back. */
    editPoint: 'tracks:editPoint',
    /** Deletes points at arbitrary indices, preserving segment breaks. */
    deletePoints: 'tracks:deletePoints',
  },
  /**
   * Multi-object move and delete.
   *
   * One channel per operation plus a dry run, rather than looping the
   * single-object channels: a loop would give one undo entry, one library
   * refresh and one native-menu rebuild *per member*. See ADR 0014.
   */
  batch: {
    /** What the batch would do, including what it cannot reverse. */
    assess: 'batch:assess',
    delete: 'batch:delete',
    move: 'batch:move',
  },
  /**
   * Import is a three-step conversation, not one call: the main process opens
   * the dialog, parses, and hands back **opaque tokens** plus previews. The
   * renderer confirms a selection against those tokens, so it never holds a
   * filesystem path it could ask us to read.
   */
  importing: {
    choose: 'import:choose',
    addPaths: 'import:addPaths',
    commit: 'import:commit',
    discard: 'import:discard',
    history: 'import:history',
    clearHistory: 'import:clearHistory',
  },
  exporting: {
    options: 'export:options',
    run: 'export:run',
  },
  geometry: {
    forTrip: 'geometry:forTrip',
  },
  /**
   * Routing and road attributes — the only channels that can cause an outbound
   * network request. `status` and `consentNotice` are local reads, there so the
   * UI can describe the configuration without triggering a call.
   */
  routing: {
    status: 'routing:status',
    consentNotice: 'routing:consentNotice',
    /**
     * Tests an endpoint by routing two fixed sample points.
     *
     * The one routing call that is not gated on consent, because it transmits
     * no geometry of the user's — see `providerService.testConnection`.
     */
    test: 'routing:test',
    /**
     * Builds a routing graph from an OpenStreetMap extract the user picks.
     *
     * The only channel that runs a child process. One-shot, at import time
     * only — the engine itself is in-process. See ADR 0013.
     */
    importRegion: 'routing:importRegion',
    /** What region, if any, is currently loaded. */
    region: 'routing:region',
    /** Which downloadable extracts cover the current map view. */
    suggestRegions: 'routing:suggestRegions',
    /**
     * Downloads the chosen extracts, merges them when there are several, and
     * builds one graph. ADR 0018.
     */
    downloadRegion: 'routing:downloadRegion',
    /** The UK's downloadable regions, as shapes for the picker's map. */
    regionMap: 'routing:regionMap',
    /** Download sizes for a selection of regions. */
    regionSizes: 'routing:regionSizes',
    /** Terrain tiles covering one route or track, for its profile. */
    downloadTerrain: 'routing:downloadTerrain',
    snap: 'routing:snap',
    /**
     * Routes one leg and writes nothing. Backs the interactive snap routing
     * tool, where each click costs exactly one provider call.
     */
    routeLeg: 'routing:routeLeg',
    /** Saves a route built with the tool, as previewed. */
    createSnapped: 'routing:createSnapped',
    /** Routes a section through shaping points and writes nothing. Phase 6. */
    routeSection: 'routing:routeSection',
    /** The routes the engine offers between two points. Writes nothing. */
    alternatives: 'routing:alternatives',
    /** Commits a shaping edit to a saved route, as previewed. */
    applyEdit: 'routing:applyEdit',
    provenance: 'routing:provenance',
    match: 'routing:match',
    attributes: 'routing:attributes',
    clearAttributes: 'routing:clearAttributes',
    profile: 'routing:profile',
    speedDistribution: 'routing:speedDistribution',
  },
  undo: {
    state: 'undo:state',
    undo: 'undo:undo',
    redo: 'undo:redo',
    clear: 'undo:clear',
  },
  app: {
    info: 'app:info',
    licences: 'app:licences',
    openExternal: 'app:openExternal',
    /**
     * Saves a PNG the renderer rendered, through a save dialog.
     *
     * The renderer rasterises because only it has a DOM; the main process owns
     * the dialog and the filesystem. The renderer never receives a path, only
     * the basename for its confirmation message.
     */
    savePng: 'app:savePng',
  },
} as const;

/** Main → renderer pushes. */
export const EVENTS = {
  menuAction: 'event:menuAction',
  themeChanged: 'event:themeChanged',
  libraryChanged: 'event:libraryChanged',
  undoStateChanged: 'event:undoStateChanged',
  /** Coarse progress during a large import, pushed per file and per batch. */
  importProgress: 'event:importProgress',
  /** Coarse progress while a routing graph is being built. */
  regionProgress: 'event:regionProgress',
  /** Download-and-build progress for an automatically fetched region. */
  regionJobProgress: 'event:regionJobProgress',
  /** Phase 10: the postcode download. */
  postcodeProgress: 'event:postcodeProgress',
  /** Phase 11: a linked folder's scan, at most every 250 ms. */
  linkedFolderScanProgress: 'event:linkedFolderScanProgress',
  /** Phase 11: a folder's index or state changed; reload its counts and photos. */
  linkedFoldersChanged: 'event:linkedFoldersChanged',
} as const;

/**
 * Actions the native menu can dispatch into the renderer. Items whose feature
 * arrives in a later phase are present but disabled in the menu, so this list
 * is deliberately shorter than the menu itself.
 */
export const MENU_ACTIONS = [
  'trip:new',
  'folder:new',
  'route:new',
  'route:newStraight',
  'waypoint:new',
  'edit:undo',
  'edit:redo',
  'map:fitRoute',
  'map:returnToSelection',
  'trip:rename',
  'trip:duplicate',
  'trip:delete',
  'selection:delete',
  'selection:selectAll',
  'panel:toggleLibrary',
  'panel:togglePanelProperties',
  'map:layers',
  'map:zoomIn',
  'map:zoomOut',
  'map:fitTrip',
  'settings:open',
  'about:open',
  'backup:create',
  'backup:restore',
  'export:copy',
  'import:open',
  'export:open',
  /** Phase 11: links a folder on disk to the selected trip. */
  'trip:linkFolder',
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];
