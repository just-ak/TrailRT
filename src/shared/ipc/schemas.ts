import { z } from 'zod';
import { MAX_ITINERARY_STOPS, MAX_OTHER_MINUTES, MAX_STAY_DAYS, MAX_STOP_MINUTES } from '../domain/itinerary';
import { POI_CATEGORY_IDS } from '../poi/categories';
import { checkRoutingOrigin } from '../net/origin';
import { isValidDate, isValidTime } from '../time/zoned';

/**
 * Request schemas for every IPC channel. The main process validates against
 * these before touching a service, so a malformed or hostile payload from a
 * compromised renderer is rejected at the boundary.
 */

export const idSchema = z.uuid();

/** Trip and folder names. Duplicates are allowed, as in BaseCamp. */
export const nameSchema = z.string().trim().min(1).max(200);

export const optionalTextSchema = z.string().max(10_000).nullable();

export const latSchema = z.number().finite().min(-90).max(90);
export const lonSchema = z.number().finite().min(-180).max(180);

export const tripStatusSchema = z.enum(['active', 'archived']);
export const tripSortKeySchema = z.enum(['name', 'updatedAt', 'createdAt']);
export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const emptySchema = z.object({}).strict();

export const transportModeSchema = z.enum([
  'auto',
  'motorcycle',
  'bicycle',
  'pedestrian',
]);

export const layerVisibilitySchema = z
  .object({
    routes: z.boolean(),
    tracks: z.boolean(),
    waypoints: z.boolean(),
    pois: z.boolean().optional(),
    photos: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------- library

export const libraryTreeRequest = z
  .object({
    includeArchived: z.boolean().default(false),
    /**
     * Ordering within the cross-trip views.
     *
     * Distance became meaningful in Phase 3, when tracks joined routes as
     * objects that have one.
     */
    sortKey: z.enum(['name', 'distance', 'updatedAt']).default('name'),
    /** Phase 11: the Photos view's Year and Trip filters (design §8.2). */
    photos: z
      .object({
        year: z.union([z.number().int().min(1800).max(2200), z.literal('none')]).optional(),
        tripId: z.uuid().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ------------------------------------------------------------------ trips

export const tripListRequest = z
  .object({
    folderId: idSchema.nullable().optional(),
    includeArchived: z.boolean().default(false),
    sortKey: tripSortKeySchema.default('updatedAt'),
    sortDirection: sortDirectionSchema.default('desc'),
  })
  .strict();

export const tripGetRequest = z.object({ id: idSchema }).strict();

export const tripCreateRequest = z
  .object({
    name: nameSchema,
    folderId: idSchema.nullable().default(null),
    description: optionalTextSchema.default(null),
    notes: optionalTextSchema.default(null),
  })
  .strict();

export const tripUpdateRequest = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    description: optionalTextSchema.optional(),
    notes: optionalTextSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.notes !== undefined,
    { message: 'At least one field must be provided' },
  );

export const tripDuplicateRequest = z.object({ id: idSchema }).strict();

export const tripMoveRequest = z
  .object({ id: idSchema, folderId: idSchema.nullable() })
  .strict();

export const tripSetStatusRequest = z
  .object({ id: idSchema, status: tripStatusSchema })
  .strict();

export const tripDeleteRequest = z.object({ id: idSchema }).strict();

export const tripSearchRequest = z
  .object({ query: z.string().trim().max(200) })
  .strict();

// ---------------------------------------------------------------- folders

export const folderGetRequest = z.object({ id: idSchema }).strict();

export const folderCreateRequest = z
  .object({ name: nameSchema, parentId: idSchema.nullable().default(null) })
  .strict();

export const folderRenameRequest = z
  .object({ id: idSchema, name: nameSchema })
  .strict();

export const folderMoveRequest = z
  .object({ id: idSchema, parentId: idSchema.nullable() })
  .strict();

export const folderDeleteRequest = z.object({ id: idSchema }).strict();

// --------------------------------------------------------------- settings

export const themeSchema = z.enum(['light', 'dark', 'system']);
export const unitSystemSchema = z.enum(['metric', 'imperial']);

export const windowGeometrySchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().int().min(640).max(20_000),
    height: z.number().int().min(480).max(20_000),
  })
  .strict();

export const mapPositionSchema = z
  .object({
    lat: latSchema,
    lon: lonSchema,
    zoom: z.number().int().min(0).max(24),
  })
  .strict();

export const panelLayoutSchema = z
  .object({
    libraryWidth: z.number().int().min(0).max(2000),
    propertiesWidth: z.number().int().min(0).max(2000),
    libraryVisible: z.boolean(),
    propertiesVisible: z.boolean(),
    drawerHeight: z.number().int().min(0).max(4000).optional(),
    drawerVisible: z.boolean().optional(),
  })
  .strict();

/**
 * Settings are written one key at a time through a discriminated union, so each
 * value is validated against its own schema rather than a loose `unknown`.
 */
export const settingsSetRequest = z.discriminatedUnion('key', [
  z.object({ key: z.literal('theme'), value: themeSchema }).strict(),
  z.object({ key: z.literal('units'), value: unitSystemSchema }).strict(),
  z
    .object({ key: z.literal('mapProviderId'), value: z.string().min(1).max(64) })
    .strict(),
  z
    .object({
      key: z.literal('backupIntervalHours'),
      value: z.number().int().min(1).max(720),
    })
    .strict(),
  z
    .object({
      key: z.literal('backupRetention'),
      value: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      key: z.literal('planningSpeedKmh'),
      value: z.number().finite().min(0.5).max(100),
    })
    .strict(),
  z.object({ key: z.literal('tripSortKey'), value: tripSortKeySchema }).strict(),
  z
    .object({ key: z.literal('tripSortDirection'), value: sortDirectionSchema })
    .strict(),
  z.object({ key: z.literal('panelLayout'), value: panelLayoutSchema }).strict(),
  z
    .object({
      key: z.literal('windowGeometry'),
      value: windowGeometrySchema.nullable(),
    })
    .strict(),
  z.object({ key: z.literal('mapPosition'), value: mapPositionSchema }).strict(),

  // ------------------------------------------------- Phase 4: mapping, routing

  z
    .object({ key: z.literal('mapOverlayId'), value: z.string().max(64) })
    .strict(),
  /*
   * A tile template, not a URL: it contains `{z}/{x}/{y}` placeholders, so it
   * cannot be validated with `z.url()`. Length-bounded here and resolved to an
   * origin by `tileTemplateOrigin`, which is what decides whether it
   * contributes a CSP entry.
   */
  z
    .object({ key: z.literal('customTileUrl'), value: z.string().max(2048) })
    .strict(),
  z
    .object({ key: z.literal('customOverlayUrl'), value: z.string().max(2048) })
    .strict(),
  /*
   * The routing endpoint. An empty string is valid and means "no provider",
   * which is the default and the state in which the app needs no network.
   *
   * Anything else must satisfy `checkRoutingOrigin` — https anywhere, http
   * only for loopback, no credentials. Validating it here rather than only in
   * the handler means the renderer can reject a bad endpoint in the settings
   * field before it is ever sent, and the main process still re-checks it when
   * it builds the CSP and when it makes a request. The schema is the first of
   * three gates, not the only one.
   */
  z
    .object({
      key: z.literal('routingEndpoint'),
      value: z
        .string()
        .max(2048)
        .superRefine((value, ctx) => {
          if (value.trim().length === 0) return;
          const check = checkRoutingOrigin(value);
          if (check.ok) return;
          ctx.addIssue({
            code: 'custom',
            // The policy's own message, so the user is told which rule they
            // broke rather than "invalid input".
            message:
              check.message ?? 'That routing endpoint is not acceptable.',
          });
        }),
    })
    .strict(),
  z
    .object({ key: z.literal('routingConsentAccepted'), value: z.boolean() })
    .strict(),
  z
    .object({ key: z.literal('transportMode'), value: transportModeSchema })
    .strict(),
  z.object({ key: z.literal('showScaleBar'), value: z.boolean() }).strict(),
  z.object({ key: z.literal('photoUnavailable'), value: z.enum(['show', 'hide']) }).strict(),
  z.object({ key: z.literal('routeAlternatives'), value: z.boolean() }).strict(),
  z.object({ key: z.literal('ukDefaultSpeedLimits'), value: z.boolean() }).strict(),
  z
    .object({ key: z.literal('layerVisibility'), value: layerVisibilitySchema })
    .strict(),
  z
    .object({
      key: z.literal('expandedNodeIds'),
      value: z.array(z.string().max(128)).max(5000),
    })
    .strict(),
  z.object({ key: z.literal('showArchivedTrips'), value: z.boolean() }).strict(),
]);

// ----------------------------------------------------------------- backup

export const backupRestoreRequest = z
  .object({ fileName: z.string().min(1).max(256) })
  .strict();

// -------------------------------------------------------------------- app

/**
 * External links are restricted to https and an explicit host allowlist. The
 * host check lives in the main process (`security/navigation.ts`); this only
 * enforces the shape.
 */
export const openExternalRequest = z
  .object({ url: z.string().url().max(2048) })
  .strict();

export type LibraryTreeRequest = z.infer<typeof libraryTreeRequest>;
export type TripListRequest = z.infer<typeof tripListRequest>;
export type TripCreateRequest = z.infer<typeof tripCreateRequest>;
export type TripUpdateRequest = z.infer<typeof tripUpdateRequest>;
export type TripMoveRequest = z.infer<typeof tripMoveRequest>;
export type TripSetStatusRequest = z.infer<typeof tripSetStatusRequest>;
export type TripSearchRequest = z.infer<typeof tripSearchRequest>;
export type FolderCreateRequest = z.infer<typeof folderCreateRequest>;
export type FolderRenameRequest = z.infer<typeof folderRenameRequest>;
export type FolderMoveRequest = z.infer<typeof folderMoveRequest>;
export type SettingsSetRequest = z.infer<typeof settingsSetRequest>;
export type BackupRestoreRequest = z.infer<typeof backupRestoreRequest>;
export type OpenExternalRequest = z.infer<typeof openExternalRequest>;

// ------------------------------------------------- Phase 2: routes, waypoints

export const elevationSchema = z
  .number()
  .finite()
  // Dead Sea shore to above the troposphere: wide enough for any real datum,
  // narrow enough to catch a unit mix-up or a parsing error.
  .min(-500)
  .max(12_000)
  .nullable();

export const routePointSchema = z
  .object({
    lat: latSchema,
    lon: lonSchema,
    ele: elevationSchema.default(null),
    name: z.string().max(200).nullable().default(null),
    symbol: z.string().max(64).nullable().default(null),
    notes: z.string().max(10_000).nullable().default(null),
  })
  .strict();

/**
 * A route's complete geometry.
 *
 * Capped at 10,000 points: a human-placed route is tens to low hundreds, and
 * the cap keeps a single undo entry bounded. Recorded tracks, which are far
 * larger, use a different storage path entirely (ADR 0003).
 */
export const routePointsSchema = z.array(routePointSchema).max(10_000);

export const routeColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour such as #2563eb')
  .nullable();

export const routeListForTripRequest = z.object({ tripId: idSchema }).strict();
export const routeGetRequest = z.object({ id: idSchema }).strict();

export const routeCreateRequest = z
  .object({
    tripId: idSchema,
    name: nameSchema,
    colour: routeColourSchema.default(null),
    points: routePointsSchema.default([]),
  })
  .strict();

export const routeUpdateRequest = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    colour: routeColourSchema.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.colour !== undefined, {
    message: 'At least one field must be provided',
  });

export const routeSetGeometryRequest = z
  .object({ id: idSchema, points: routePointsSchema })
  .strict();

export const routeReverseRequest = z.object({ id: idSchema }).strict();
export const routeDuplicateRequest = z.object({ id: idSchema }).strict();
export const routeDeleteRequest = z.object({ id: idSchema }).strict();

export const routeMoveRequest = z
  .object({ id: idSchema, tripId: idSchema })
  .strict();

// ------------------------------------------------------------- waypoints

export const waypointListForTripRequest = z
  .object({ tripId: idSchema })
  .strict();

export const waypointGetRequest = z.object({ id: idSchema }).strict();

export const waypointCreateRequest = z
  .object({
    tripId: idSchema,
    name: nameSchema,
    lat: latSchema,
    lon: lonSchema,
    eleM: elevationSchema.default(null),
    description: optionalTextSchema.default(null),
    symbol: z.string().max(64).default('pin'),
    notes: optionalTextSchema.default(null),
    groupId: idSchema.nullable().default(null),
  })
  .strict();

export const waypointUpdateRequest = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    lat: latSchema.optional(),
    lon: lonSchema.optional(),
    eleM: elevationSchema.optional(),
    description: optionalTextSchema.optional(),
    symbol: z.string().max(64).optional(),
    notes: optionalTextSchema.optional(),
    groupId: idSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) => Object.keys(v).some((k) => k !== 'id'),
    { message: 'At least one field must be provided' },
  );

/** Dragging a marker: coordinates only, so the undo label can say "Move". */
export const waypointMoveRequest = z
  .object({ id: idSchema, lat: latSchema, lon: lonSchema })
  .strict();

export const waypointDeleteRequest = z.object({ id: idSchema }).strict();
export const waypointDuplicateRequest = z.object({ id: idSchema }).strict();

export const waypointMoveToTripRequest = z
  .object({ id: idSchema, tripId: idSchema })
  .strict();

export const waypointSearchRequest = z
  .object({ query: z.string().trim().max(200) })
  .strict();

export const waypointGroupsRequest = z.object({ tripId: idSchema }).strict();

export const waypointCreateGroupRequest = z
  .object({ tripId: idSchema, name: nameSchema })
  .strict();

// -------------------------------------------------------------- geometry

export const geometryForTripRequest = z.object({ tripId: idSchema }).strict();

export type RoutePointInput = z.input<typeof routePointSchema>;
export type RouteCreateRequest = z.infer<typeof routeCreateRequest>;
export type RouteSetGeometryRequest = z.infer<typeof routeSetGeometryRequest>;
export type WaypointCreateRequest = z.infer<typeof waypointCreateRequest>;
export type WaypointUpdateRequest = z.infer<typeof waypointUpdateRequest>;

// --------------------------------------------------------------- tracks

/** A colour is a 6-digit hex string, or null for the default. */
export const trackColourSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable();

/** Line width in CSS pixels. Bounded so a stray value cannot blank the map. */
export const trackWidthSchema = z.number().int().min(1).max(12).nullable();

export const trackListForTripRequest = z.object({ tripId: idSchema }).strict();
export const trackGetRequest = z.object({ id: idSchema }).strict();

/**
 * Geometry for the map.
 *
 * The zoom decides whether the simplified render cache or the real points are
 * returned, so the renderer asks for what it is drawing rather than being told
 * which representation to use.
 */
export const trackGeometryRequest = z
  .object({ id: idSchema, zoom: z.number().int().min(0).max(24) })
  .strict();

export const trackUpdateRequest = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    colour: trackColourSchema.optional(),
    width: trackWidthSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined || v.colour !== undefined || v.width !== undefined,
    { message: 'At least one field must be provided' },
  );

export const trackMoveRequest = z
  .object({ id: idSchema, tripId: idSchema })
  .strict();

export const trackReverseRequest = z.object({ id: idSchema }).strict();
export const trackDeleteRequest = z.object({ id: idSchema }).strict();
export const trackHasOriginalRequest = z.object({ id: idSchema }).strict();
export const trackRestoreOriginalRequest = z.object({ id: idSchema }).strict();

/**
 * Simplification tolerance in metres.
 *
 * Positive and bounded: zero would be a no-op dressed as an edit, and an
 * unbounded value would reduce a track to its endpoints without warning.
 */
export const trackSimplifyRequest = z
  .object({ id: idSchema, toleranceM: z.number().finite().min(0.1).max(10_000) })
  .strict();

export const trackPreviewSimplifyRequest = trackSimplifyRequest;

export const trackSplitRequest = z
  .object({ id: idSchema, pointIndex: z.number().int().min(0) })
  .strict();

export const trackJoinRequest = z
  .object({
    firstId: idSchema,
    secondId: idSchema,
    name: nameSchema.optional(),
  })
  .strict();

export const trackDeleteRangeRequest = z
  .object({
    id: idSchema,
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  })
  .strict();

// -------------------------------------- Phase 5: object and point management

/**
 * A recorded timestamp, epoch milliseconds.
 *
 * Bounded to 1900–2100 rather than left open: every value outside that is a
 * unit mix-up (seconds mistaken for milliseconds lands in 1970) or a parsing
 * failure, and accepting one would put a point on the map's time axis that no
 * recording could have produced. Nullable, because untimed is a real state.
 */
export const recordedAtSchema = z
  .number()
  .int()
  .min(-2_208_988_800_000)
  .max(4_102_444_800_000)
  .nullable();

/**
 * How many points one paged read returns.
 *
 * Capped well below the 10,000-row route limit: this backs a virtualised table
 * whose viewport is a few dozen rows, so a large window would defeat the point
 * of paging at all.
 */
export const trackPointsPageRequest = z
  .object({
    id: idSchema,
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(2_000).default(200),
  })
  .strict();

export const trackEditPointRequest = z
  .object({
    id: idSchema,
    index: z.number().int().min(0),
    lat: latSchema,
    lon: lonSchema,
    ele: elevationSchema.default(null),
    time: recordedAtSchema.default(null),
  })
  .strict();

/**
 * Flat point indices to delete, possibly non-contiguous.
 *
 * Bounded at the same 10,000 the undo inverse carries, so a request that could
 * never be recorded as one step is refused at the boundary rather than applied
 * and then reported as irreversible.
 */
export const trackDeletePointsRequest = z
  .object({
    id: idSchema,
    indices: z.array(z.number().int().min(0)).min(1).max(10_000),
  })
  .strict();

export const batchKindSchema = z.enum(['route', 'track', 'waypoint']);

export const batchMemberSchema = z
  .object({ kind: batchKindSchema, id: idSchema })
  .strict();

/**
 * Members of a batch.
 *
 * The 500 cap matches `batchService.MAX_BATCH_MEMBERS`, deliberately
 * duplicated: the schema refuses an oversized payload before any row is read,
 * and the service refuses it again for callers that are not the IPC layer.
 */
export const batchMembersSchema = z.array(batchMemberSchema).min(1).max(500);

export const batchAssessRequest = z
  .object({
    members: batchMembersSchema,
    operation: z.enum(['delete', 'move']),
  })
  .strict();

export const batchDeleteRequest = z
  .object({ members: batchMembersSchema })
  .strict();

export const batchMoveRequest = z
  .object({ members: batchMembersSchema, tripId: idSchema })
  .strict();

export type BatchMemberInput = z.infer<typeof batchMemberSchema>;
export type TrackPointsPageRequest = z.infer<typeof trackPointsPageRequest>;
export type TrackEditPointRequest = z.infer<typeof trackEditPointRequest>;

// -------------------------------------------------------- import / export

export const importFormatSchema = z.enum([
  'gpx',
  'kml',
  'kmz',
  'tcx',
  'fit',
  'csv',
  'json',
]);

export const exportFormatSchema = z.enum(['gpx', 'kml', 'kmz', 'csv', 'json']);

/**
 * A staged-file token.
 *
 * Opaque to the renderer by design: it identifies a parsed file held in the
 * main process, which is what lets the renderer confirm an import without ever
 * holding a path.
 */
export const importTokenSchema = z.string().min(1).max(200);

/** Selection within one staged file. Omitting an index list means "all". */
export const importFileSelectionSchema = z
  .object({
    token: importTokenSchema,
    destinationTripId: idSchema.nullable().default(null),
    routeIndices: z.array(z.number().int().min(0)).max(100_000).optional(),
    trackIndices: z.array(z.number().int().min(0)).max(100_000).optional(),
    waypointIndices: z.array(z.number().int().min(0)).max(1_000_000).optional(),
    retainOriginal: z.boolean().default(true),
  })
  .strict();

export const importCommitRequest = z
  .object({
    files: z.array(importFileSelectionSchema).min(1).max(200),
  })
  .strict();

export const importDiscardRequest = z
  .object({ tokens: z.array(importTokenSchema).max(200).default([]) })
  .strict();

export const importHistoryRequest = z
  .object({ limit: z.number().int().min(1).max(1000).default(100) })
  .strict();

/**
 * Paths from a drag-and-drop.
 *
 * The renderer cannot produce these itself: the preload bridge resolves them
 * from the dropped `File` objects with `webUtils.getPathForFile` and passes
 * them straight through, so a path originates from a real user gesture rather
 * than from renderer-side string construction.
 */
export const importAddPathsRequest = z
  .object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200) })
  .strict();

export const exportScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('route'), id: idSchema }).strict(),
  z.object({ kind: z.literal('track'), id: idSchema }).strict(),
  z.object({ kind: z.literal('waypoint'), id: idSchema }).strict(),
  z
    .object({
      kind: z.literal('trips'),
      tripIds: z.array(idSchema).min(1).max(10_000),
    })
    .strict(),
  z.object({ kind: z.literal('everything') }).strict(),
]);

export const exportOptionsRequest = z
  .object({ scope: exportScopeSchema })
  .strict();

export const exportRunRequest = z
  .object({ scope: exportScopeSchema, format: exportFormatSchema })
  .strict();

export type TrackUpdateRequest = z.infer<typeof trackUpdateRequest>;
export type ImportFileSelection = z.infer<typeof importFileSelectionSchema>;
export type ExportScopeRequest = z.infer<typeof exportScopeSchema>;

// --------------------------------------------- Phase 4: routing, attributes

/**
 * Which geometry a road-attribute or profile request is about.
 *
 * A single owner type plus id rather than separate route and track channels:
 * the services treat them uniformly, and duplicating every channel would
 * double the surface for no gain.
 */
export const attributeOwnerSchema = z
  .object({
    ownerType: z.enum(['route', 'track']),
    ownerId: idSchema,
  })
  .strict();

export const transportModeRequestSchema = transportModeSchema.optional();

/**
 * Snapping an existing route.
 *
 * `controlPoints` is optional and bounded by the same 10,000 as
 * `routePointsSchema`, because when the renderer supplies them it is handing
 * over an array that becomes an undo payload. Omitting it is the normal case:
 * the service then uses the route's stored control points, or its current
 * geometry if it has never been snapped.
 */
export const routingSnapRequest = z
  .object({
    routeId: idSchema,
    mode: transportModeRequestSchema,
    controlPoints: z
      .array(z.object({ lat: latSchema, lon: lonSchema }).strict())
      .min(2)
      .max(10_000)
      .optional(),
  })
  .strict();

export const routingProvenanceRequest = z
  .object({ routeId: idSchema })
  .strict();

export const routingMatchRequest = attributeOwnerSchema.extend({
  mode: transportModeRequestSchema,
  /** Re-match even when the cache is fresh. An explicit user refresh. */
  force: z.boolean().optional(),
});

export const routingAttributesRequest = attributeOwnerSchema;
export const routingClearAttributesRequest = attributeOwnerSchema;

export const routingProfileRequest = attributeOwnerSchema.extend({
  maxSamples: z.number().int().min(2).max(5000).optional(),
});

/**
 * Speed distribution.
 *
 * `source` is required rather than defaulted, because posted limits and
 * recorded speeds are different facts and ADR 0011 forbids merging them. A
 * caller has to say which one it is asking for, so a UI cannot drift into
 * showing one labelled as the other.
 */
export const routingSpeedDistributionRequest = attributeOwnerSchema.extend({
  source: z.enum(['posted', 'recorded']),
});

/** Terrain tiles for one geometry's profile. ADR 0018. */
export const routingDownloadTerrainRequest = attributeOwnerSchema;

export const routingConsentNoticeRequest = z
  .object({ endpoint: z.string().max(2048) })
  .strict();

/**
 * Testing an endpoint.
 *
 * The endpoint is supplied rather than read from settings so an address can be
 * checked before it is saved — which is the point, since you want to know a
 * host works before agreeing to send it your routes.
 */
export const routingTestRequest = z
  .object({
    endpoint: z.string().min(1).max(2048),
    mode: transportModeRequestSchema,
  })
  .strict();

export type RoutingSnapRequest = z.infer<typeof routingSnapRequest>;
export type RoutingMatchRequest = z.infer<typeof routingMatchRequest>;
export type RoutingProfileRequest = z.infer<typeof routingProfileRequest>;
export type RoutingSpeedDistributionRequest = z.infer<
  typeof routingSpeedDistributionRequest
>;
export type AttributeOwnerRequest = z.infer<typeof attributeOwnerSchema>;

/**
 * A PNG the renderer rendered, on its way to a save dialog.
 *
 * Base64 rather than a `Uint8Array`: the context bridge clones structured data,
 * and a string survives that unambiguously where a typed array's backing buffer
 * is easy to get wrong. Capped at 8 MB of base64 — about 6 MB of image, far
 * above a chart and low enough that a bug cannot wedge the main process.
 */
export const savePngRequest = z
  .object({
    suggestedName: z.string().min(1).max(120),
    base64: z.string().min(1).max(8_000_000),
  })
  .strict();

// --------------------------------------- Phase 4: interactive snap routing

const latLonSchema = z
  .object({ lat: latSchema, lon: lonSchema })
  .strict();

/** One leg for the interactive tool: two points and a transport mode. */
export const routingRouteLegRequest = z
  .object({
    from: latLonSchema,
    to: latLonSchema,
    mode: transportModeRequestSchema,
  })
  .strict();

/**
 * A leg as previewed by the tool, on its way back to be saved.
 *
 * `shape` is capped at the whole-route editable limit rather than something
 * smaller: a single leg across a country legitimately carries thousands of
 * vertices, and the meaningful bound is on the finished route, which
 * `createSnappedRoute` enforces over the flattened total.
 */
const previewedLegSchema = z
  .object({
    matched: z.boolean(),
    shape: z.array(latLonSchema).min(2).max(10_000),
    distanceM: z.number().finite().nonnegative().nullable(),
    /**
     * How far the engine moved this leg's end to reach a road.
     *
     * Defaulted rather than required: it is a diagnostic the main process
     * measured and handed to the renderer, so a payload without it is a
     * tool that has not been told rather than a malformed request.
     */
    displacementM: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .default(null),
  })
  .strict();

// ------------------------------------------------- Phase 6: shaping

const sectionLocationSchema = z
  .object({ point: latLonSchema, passThrough: z.boolean() })
  .strict();

/** A section to route: an edit touches at most two legs, so three points. */
export const routingRouteSectionRequest = z
  .object({
    locations: z.array(sectionLocationSchema).min(2).max(5),
    mode: transportModeRequestSchema,
  })
  .strict();

export const routingAlternativesRequest = z
  .object({
    from: latLonSchema,
    to: latLonSchema,
    count: z.number().int().min(1).max(3).default(3),
    mode: transportModeRequestSchema,
  })
  .strict();

const controlRoleSchema = z.enum(['via', 'shaping']);

const legIndexSchema = z.number().int().min(0).max(999);
const controlIndexSchema = z.number().int().min(0).max(1000);

/** Every shaping edit, mirroring `RouteEdit` in `shared/routing/edit.ts`. */
const routeEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('append'), at: latLonSchema }).strict(),
  z.object({ kind: z.literal('move'), index: controlIndexSchema, to: latLonSchema }).strict(),
  z.object({ kind: z.literal('insert'), leg: legIndexSchema, at: latLonSchema }).strict(),
  z
    .object({
      kind: z.literal('insertOnLine'),
      leg: legIndexSchema,
      segmentEnd: z.number().int().min(1).max(25_000),
      at: latLonSchema,
    })
    .strict(),
  z.object({ kind: z.literal('remove'), index: controlIndexSchema }).strict(),
  z
    .object({ kind: z.literal('setRole'), index: controlIndexSchema, role: controlRoleSchema })
    .strict(),
  z
    .object({
      kind: z.literal('choose'),
      leg: legIndexSchema,
      candidate: z.array(latLonSchema).min(2).max(10_000),
      shaping: z.array(latLonSchema).max(3),
    })
    .strict(),
]);

/**
 * Committing a shaping edit.
 *
 * `expected` is the control-point state the renderer planned against; the
 * service compares it with the database and refuses on any difference.
 */
export const routingApplyEditRequest = z
  .object({
    routeId: idSchema,
    expected: z
      .array(
        z
          .object({
            lat: latSchema,
            lon: lonSchema,
            role: controlRoleSchema,
            shapeIndex: z.number().int().min(0).nullable(),
          })
          .strict(),
      )
      .min(2)
      .max(1000),
    edit: routeEditSchema,
    legs: z.array(previewedLegSchema).min(0).max(4).nullable(),
  })
  .strict();

/**
 * Saving a route built click by click.
 *
 * The leg count is checked against the control-point count here as well as in
 * the service. Catching it at the schema means the mismatch is reported as the
 * request problem it is, with the field path, rather than reaching a service
 * that has to decide what a half-described route means.
 */
export const routingCreateSnappedRequest = z
  .object({
    tripId: idSchema,
    name: nameSchema,
    colour: routeColourSchema.default(null),
    controlPoints: z.array(latLonSchema).min(2).max(1000),
    legs: z.array(previewedLegSchema).min(1).max(999),
    /** Phase 6: parallel to `controlPoints`. Absent means every point is a via. */
    roles: z.array(controlRoleSchema).max(1000).optional(),
    mode: transportModeRequestSchema,
  })
  .strict()
  .refine((value) => value.legs.length === value.controlPoints.length - 1, {
    message:
      'There must be exactly one leg between each pair of points.',
    path: ['legs'],
  });

export type RoutingRouteLegRequest = z.infer<typeof routingRouteLegRequest>;
export type RoutingCreateSnappedRequest = z.infer<
  typeof routingCreateSnappedRequest
>;

/**
 * The visible map area, for matching against downloadable regions.
 *
 * Bounds rather than centre-and-zoom: the renderer already has the bounds from
 * Leaflet, and re-deriving them in the main process from a zoom level would
 * need the viewport pixel size too.
 */
export const routingSuggestRegionsRequest = z
  .object({
    minLat: latSchema,
    minLon: lonSchema,
    maxLat: latSchema,
    maxLon: lonSchema,
  })
  .strict()
  .refine((v) => v.maxLat > v.minLat && v.maxLon > v.minLon, {
    message: 'The visible area is empty.',
  });

/** Region ids as the Geofabrik index names them. */
const regionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9-]+$/, 'Not a region id.');

/**
 * One or more regions to build into a single graph. Capped well above the 50
 * UK regions; past that, the 2 GB build limit refuses it anyway.
 */
export const routingDownloadRegionRequest = z
  .object({ regionIds: z.array(regionIdSchema).min(1).max(64) })
  .strict()
  .refine((v) => new Set(v.regionIds).size === v.regionIds.length, {
    message: 'A region is listed twice.',
  });

export const routingRegionSizesRequest = z
  .object({ regionIds: z.array(regionIdSchema).min(1).max(64) })
  .strict();

export type RoutingSuggestRegionsRequest = z.infer<
  typeof routingSuggestRegionsRequest
>;

// --------------------------------------------------------- Phase 10: search

export const searchQueryRequest = z
  .object({
    text: z.string().max(200),
    lat: latSchema,
    lon: lonSchema,
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

// --------------------------------------------------------- Phase 10: places

export const poiCategorySchema = z.enum(POI_CATEGORY_IDS);

export const alongScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('route'), routeId: idSchema }).strict(),
  z.object({ kind: z.literal('itinerary'), tripId: idSchema }).strict(),
]);

const distanceAlongSchema = z.number().finite().min(0).max(10_000_000);

export const alongSectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('range'), fromM: distanceAlongSchema, toM: distanceAlongSchema }).strict(),
  z
    .object({ kind: z.literal('near'), lat: latSchema, lon: lonSchema, radiusM: z.number().min(100).max(50_000) })
    .strict(),
  // A local date of the itinerary; validated as a real date below.
  z.object({ kind: z.literal('day'), date: z.string().max(10) }).strict(),
]);

export const placesAlongRequest = z
  .object({
    requestId: z.string().min(1).max(64),
    scope: alongScopeSchema,
    categories: z.array(poiCategorySchema).min(1).max(POI_CATEGORY_IDS.length),
    widthM: z.number().min(100).max(10_000),
    section: alongSectionSchema,
  })
  .strict();

export const placesCancelRequest = z.object({ requestId: z.string().min(1).max(64) }).strict();

export const placesDetourRequest = z
  .object({ scope: alongScopeSchema, poiId: z.number().int().positive() })
  .strict();

export const placesGetRequest = z.object({ poiId: z.number().int().positive() }).strict();

export const placesAddWaypointRequest = z
  .object({ poiId: z.number().int().positive(), tripId: idSchema })
  .strict();

// ------------------------------------------------------ Phase 10: itinerary

/** A real calendar date, `YYYY-MM-DD`. A pattern alone would let 2026-02-30 through. */
export const dateSchema = z.string().refine(isValidDate, { message: 'Expected a real date, YYYY-MM-DD' });

/** `HH:mm`, 00:00 to 23:59. */
export const timeSchema = z.string().refine(isValidTime, { message: 'Expected a time from 00:00 to 23:59' });

export const durationKindSchema = z.enum(['hours', 'days']);
const stopMinutesSchema = z.number().int().min(0).max(MAX_STOP_MINUTES);
const stayDaysSchema = z.number().int().min(1).max(MAX_STAY_DAYS);

export const itineraryGetRequest = z.object({ tripId: idSchema }).strict();

export const itineraryCreateRequest = z
  .object({ tripId: idSchema, startDate: dateSchema, startTime: timeSchema })
  .strict();

export const itineraryRemoveRequest = z.object({ tripId: idSchema }).strict();

export const itineraryUpdateRequest = z
  .object({
    tripId: idSchema,
    startDate: dateSchema.optional(),
    startTime: timeSchema.optional(),
    defaultDepart: timeSchema.optional(),
    maxDriveMinutes: z.number().int().min(30).max(24 * 60).nullable().optional(),
    rangeKm: z.number().finite().positive().max(5000).nullable().optional(),
    reservePct: z.number().int().min(0).max(90).optional(),
    energy: z.enum(['fuel', 'electric']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'tripId'), {
    message: 'At least one field must be provided',
  });

export const itineraryAddStopRequest = z
  .object({
    tripId: idSchema,
    waypointId: idSchema,
    index: z.number().int().min(0).max(MAX_ITINERARY_STOPS).optional(),
    durationKind: durationKindSchema.optional(),
    durationMinutes: stopMinutesSchema.nullable().optional(),
    durationDays: stayDaysSchema.nullable().optional(),
    notes: optionalTextSchema.optional(),
  })
  .strict();

export const itineraryStopRequest = z.object({ id: idSchema }).strict();

export const itineraryMoveStopRequest = z
  .object({ id: idSchema, toIndex: z.number().int().min(0).max(MAX_ITINERARY_STOPS - 1) })
  .strict();

export const itineraryUpdateStopRequest = z
  .object({
    id: idSchema,
    durationKind: durationKindSchema.optional(),
    durationMinutes: stopMinutesSchema.nullable().optional(),
    durationDays: stayDaysSchema.nullable().optional(),
    departTime: timeSchema.nullable().optional(),
    arriveBy: timeSchema.nullable().optional(),
    departAt: timeSchema.nullable().optional(),
    notes: optionalTextSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'id'), {
    message: 'At least one field must be provided',
  });

export const itineraryLinkLegRequest = z
  .object({ id: idSchema, routeId: idSchema.nullable() })
  .strict();

export const itineraryAddPoiStopRequest = z
  .object({
    poiId: z.number().int().positive(),
    tripId: idSchema,
    index: z.number().int().min(0).max(MAX_ITINERARY_STOPS).optional(),
  })
  .strict();

export const itineraryExportIcsRequest = z
  .object({ tripId: idSchema, includeLegs: z.boolean() })
  .strict();

/**
 * A chosen route is set with `itineraryLinkLegRequest`, which carries the
 * route; this sets the other two modes.
 */
export const itinerarySetLegModeRequest = z
  .object({
    id: idSchema,
    mode: z.enum(['road', 'other']),
    transport: z.enum(['ferry', 'train', 'flight', 'other']).nullable().optional(),
    minutes: z.number().int().min(1).max(MAX_OTHER_MINUTES).nullable().optional(),
    label: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

// --------------------------------------------- Phase 11: linked folders, photos

export const linkedFolderChooseRequest = z.object({ tripId: idSchema }).strict();

/** The token is the one `chooseFolder` returned; the path never comes back. */
export const linkedFolderLinkRequest = z
  .object({ token: idSchema, includeSubfolders: z.boolean() })
  .strict();

export const linkedFolderIdRequest = z.object({ folderId: idSchema }).strict();

export const linkedFolderSetIncludeSubfoldersRequest = z
  .object({ folderId: idSchema, include: z.boolean() })
  .strict();

export const linkedFolderListRequest = z.object({ tripId: idSchema.optional() }).strict();

export const photoListRequest = z.object({ folderId: idSchema }).strict();

/** A photo is named by its index row's id, never by a path (design §7.2). */
export const photoIdRequest = z.object({ photoId: idSchema }).strict();

/** A year the Photos view can filter on, or photos with no date. */
export const photoYearSchema = z.union([z.number().int().min(1800).max(2200), z.literal('none')]);

export const photoMapPointsRequest = z.union([
  z.object({ tripId: idSchema }).strict(),
  z
    .object({
      all: z.literal(true),
      includeArchived: z.boolean().default(false),
      year: photoYearSchema.optional(),
      tripId: idSchema.optional(),
    })
    .strict(),
]);

export const photoYearsRequest = z.object({ includeArchived: z.boolean().default(false) }).strict();
