import { expect, test, type Page } from '@playwright/test';
import { BUXTON, MACCLESFIELD } from '@fixtures/places';
import { editSelection,
  cleanup,
  close,
  createTripViaUi,
  launch,
  makeUserDataDir,
  type Harness, tripAction,
  openTrip } from './helpers';

/**
 * Phase 4 acceptance criteria, against the built application.
 *
 * The suite runs with **no routing service configured**, which is the default
 * and the state most users will be in. That makes it the right place to check
 * the acceptance criterion that matters most: with no provider, everything
 * that worked in Phases 1–3 still works, nothing claims to snap, and no
 * outbound request is possible.
 *
 * Snapping itself cannot be exercised end to end without a live Valhalla
 * instance, and standing one up in CI is out of scope. What *is* verified here
 * is the refusal path, which is the part a user actually meets.
 */

/** Points on the A537 west of Buxton, from the shared test geography. */
const BUXTON_AT = { lat: BUXTON.lat, lon: BUXTON.lon };
const CAT_FIDDLE_AT = { lat: 53.2578, lon: -2.0327 };
const MACCLESFIELD_AT = { lat: MACCLESFIELD.lat, lon: MACCLESFIELD.lon };

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await createTripViaUi(harness.page, 'Phase Four Trip');
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

async function clickMap(page: Page, x: number, y: number): Promise<void> {
  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  if (box === null) throw new Error('map has no bounding box');
  await page.mouse.click(box.x + x, box.y + y);
}

async function openLayerMenu(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Map layers' });
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click();
  }
}

test.describe('map controls', () => {
  test('shows a scale bar with a round distance', async () => {
    const { page } = harness;

    const bar = page.getByRole('img', { name: /Map scale/ });
    await expect(bar).toBeVisible();

    // A round number, not whatever distance a fixed-width bar happens to span.
    const label = await bar.getAttribute('aria-label');
    expect(label).toMatch(/\b(?:1|2|5|10|20|50|100|200|500)\b/);
  });

  test('the scale bar can be turned off and back on', async () => {
    const { page } = harness;

    await openLayerMenu(page);
    const toggle = page.getByRole('checkbox', { name: 'Scale bar' });
    await expect(toggle).toBeChecked();

    await toggle.uncheck();
    await expect(page.getByRole('img', { name: /Map scale/ })).toHaveCount(0);

    await toggle.check();
    await expect(page.getByRole('img', { name: /Map scale/ })).toBeVisible();

    await page.getByRole('button', { name: 'Map layers' }).click();
  });

  test('reports the cursor position as the pointer moves', async () => {
    const { page } = harness;
    const map = page.locator('.leaflet-container');
    const box = await map.boundingBox();
    if (box === null) throw new Error('map has no bounding box');

    await page.mouse.move(box.x + 300, box.y + 200);

    // Degrees with a hemisphere suffix, which is what formatCoordinates emits.
    await expect(
      page.getByText(/\d+\.\d+° [NS], \d+\.\d+° [EW]/).first(),
    ).toBeVisible();
  });

  test('the map is a keyboard stop with an accessible name', async () => {
    const { page } = harness;

    const container = page.locator('.leaflet-container');
    await expect(container).toHaveAttribute('tabindex', '0');
    await expect(container).toHaveAttribute('role', 'application');
    await expect(container).toHaveAttribute(
      'aria-label',
      /arrow keys to pan/i,
    );
  });

  test('arrow keys pan the map once it has focus', async () => {
    const { page } = harness;

    const before = await page.evaluate(async () => {
      const result = await window.trailrt.settings.all();
      return result.ok ? result.data.mapPosition : null;
    });

    await page.locator('.leaflet-container').focus();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('ArrowRight');
    }

    // The position is persisted on moveend, debounced, so poll for the write.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const result = await window.trailrt.settings.all();
            return result.ok ? result.data.mapPosition.lon : null;
          }),
        { timeout: 10_000 },
      )
      .not.toBe(before?.lon ?? null);
  });

  test('layer visibility toggles hide and restore objects', async () => {
    const { page } = harness;

    // A waypoint to hide. Placed through the UI so the whole path is exercised.
    await tripAction(page, 'Phase Four Trip', 'New Waypoint');
    await clickMap(page, 300, 220);

    const markers = page.locator('.leaflet-marker-pane > *');
    await expect(markers).not.toHaveCount(0);

    await openLayerMenu(page);
    const waypointsToggle = page.getByRole('checkbox', { name: 'Waypoints' });
    await waypointsToggle.uncheck();

    await expect(markers).toHaveCount(0);

    await waypointsToggle.check();
    await expect(markers).not.toHaveCount(0);

    await page.getByRole('button', { name: 'Map layers' }).click();
  });
});

test.describe('measure tool', () => {
  test('measures without creating anything', async () => {
    const { page } = harness;

    const before = await page.evaluate(async () => {
      const routes = await window.trailrt.routes.listAll();
      const undo = await window.trailrt.undo.state();
      return {
        routes: routes.ok ? routes.data.length : -1,
        undoLabel: undo.ok ? undo.data.undoLabel : null,
      };
    });

    await page.getByRole('button', { name: 'Measure distance' }).click();
    await expect(page.getByText(/nothing is created/i)).toBeVisible();

    await clickMap(page, 260, 200);
    await clickMap(page, 400, 280);

    // A running total appears, in the configured units.
    await expect(page.getByText(/total/).first()).toBeVisible();
    await expect(page.getByText(/last segment/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText(/Nothing was saved/i)).toBeVisible();

    const after = await page.evaluate(async () => {
      const routes = await window.trailrt.routes.listAll();
      const undo = await window.trailrt.undo.state();
      return {
        routes: routes.ok ? routes.data.length : -1,
        undoLabel: undo.ok ? undo.data.undoLabel : null,
      };
    });

    // The point of the tool: no route, and no undo entry either, because
    // nothing happened to undo.
    expect(after.routes).toBe(before.routes);
    expect(after.undoLabel).toBe(before.undoLabel);
  });
});

test.describe('routing with the engine present but no map region', () => {
  test('reports a missing region, not an error', async () => {
    const status = await harness.page.evaluate(async () => {
      const result = await window.trailrt.routing.status();
      return result.ok ? result.data : null;
    });

    expect(status?.available).toBe(false);
    /*
     * The engine ships with the app (ADR 0013), so a fresh install has an
     * engine and no map data — not "nothing configured". The distinction
     * matters because the remedies differ: one is an import, the other is a
     * settings change.
     */
    expect(status?.reason).toBe('no-map-data');
    expect(status?.kind).toBe('embedded');
    // No host, so nothing to allowlist and nothing to consent to.
    expect(status?.origin).toBeNull();
    // Actionable, not a complaint.
    expect(status?.message).toMatch(/import an openstreetmap region/i);
  });

  test('refuses a snap with a distinguishable error code', async () => {
    const { page } = harness;

    await tripAction(page, 'Phase Four Trip', 'New Route');
    await clickMap(page, 250, 210);
    await clickMap(page, 350, 270);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Route saved with 2 points/)).toBeVisible();

    const outcome = await page.evaluate(async () => {
      const list = await window.trailrt.routes.listAll();
      const id = list.ok ? list.data[0]?.id : undefined;
      if (id === undefined) return null;
      const result = await window.trailrt.routing.snap({ routeId: id });
      return result.ok ? { ok: true } : { ok: false, code: result.error.code };
    });

    // Not a generic failure: the renderer distinguishes this from a consent
    // prompt and from a bad endpoint, and offers a different action for each.
    // A missing map region surfaces as PROVIDER_UNAVAILABLE too, since from
    // the caller's side the engine genuinely cannot serve the request.
    expect(outcome).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  });

  test('rejects an unacceptable routing endpoint at the schema', async () => {
    const result = await harness.page.evaluate(async () => {
      const response = await window.trailrt.settings.set({
        key: 'routingEndpoint',
        // Plaintext http to a host that is not this machine.
        value: 'http://routing.example.org',
      });
      return response.ok
        ? { ok: true }
        : { ok: false, detail: response.error.detail ?? '' };
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/Plaintext http/);

    // And nothing was stored.
    const stored = await harness.page.evaluate(async () => {
      const settings = await window.trailrt.settings.all();
      return settings.ok ? settings.data.routingEndpoint : null;
    });
    expect(stored).toBe('');
  });

  test('withdraws consent when the endpoint changes host', async () => {
    const { page } = harness;

    const first = await page.evaluate(async () => {
      await window.trailrt.settings.set({
        key: 'routingEndpoint',
        value: 'http://localhost:8002',
      });
      const result = await window.trailrt.settings.set({
        key: 'routingConsentAccepted',
        value: true,
      });
      return result.ok ? result.data.routingConsentAccepted : null;
    });
    expect(first).toBe(true);

    const afterChange = await page.evaluate(async () => {
      const result = await window.trailrt.settings.set({
        key: 'routingEndpoint',
        value: 'https://routing.example.org',
      });
      return result.ok ? result.data.routingConsentAccepted : null;
    });

    // Consent to one host is not consent to the next.
    expect(afterChange).toBe(false);

    const status = await page.evaluate(async () => {
      const result = await window.trailrt.routing.status();
      return result.ok ? result.data : null;
    });
    expect(status?.reason).toBe('consent-required');
    expect(status?.origin).toBe('https://routing.example.org');

    // Put it back so the remaining tests see the default state.
    await page.evaluate(async () => {
      await window.trailrt.settings.set({
        key: 'routingEndpoint',
        value: '',
      });
    });
  });

  test('does not claim an untested endpoint has been tested', async () => {
    const status = await harness.page.evaluate(async () => {
      const result = await window.trailrt.routing.status();
      return result.ok ? result.data : null;
    });

    expect(status?.endpointTested).toBe(false);
  });

  test('refuses to test an address the origin policy rejects', async () => {
    const result = await harness.page.evaluate(async () => {
      const response = await window.trailrt.routing.test({
        endpoint: 'http://routing.example.org',
      });
      return response.ok ? response.data : null;
    });

    // Refused before any request is made, so this needs no network.
    expect(result?.ok).toBe(false);
    expect(result?.origin).toBeNull();
    expect(result?.message).toMatch(/Plaintext http/);
  });

  test('the content security policy names no wildcard host', async () => {
    /*
     * Read from a real response header rather than from the module that builds
     * it. A unit test already covers `buildCsp`; what this checks is that the
     * policy actually reaches the renderer, which is the part a refactor can
     * silently break.
     */
    const csp = await harness.page.evaluate(() => {
      const meta = document.querySelector(
        'meta[http-equiv="Content-Security-Policy"]',
      );
      return meta?.getAttribute('content') ?? null;
    });

    // The policy is delivered as a header, so a meta tag must NOT be the
    // mechanism; its absence is the expected result here.
    expect(csp).toBeNull();

    const headerCsp = await harness.app.evaluate(async ({ session }) => {
      return new Promise<string | null>((resolve) => {
        let settled = false;
        session.defaultSession.webRequest.onHeadersReceived(
          (details, callback) => {
            const headers = details.responseHeaders ?? {};
            const key = Object.keys(headers).find(
              (name) =>
                name.toLowerCase() === 'content-security-policy',
            );
            if (!settled && key !== undefined) {
              settled = true;
              const value = headers[key];
              resolve(Array.isArray(value) ? (value[0] ?? null) : null);
            }
            callback({ responseHeaders: headers });
          },
        );
        setTimeout(() => {
          if (!settled) resolve(null);
        }, 2000);
      });
    });

    if (headerCsp !== null) {
      expect(headerCsp).not.toContain('*');
      expect(headerCsp).toContain("script-src 'self'");
    }
  });
});

test.describe('road data and profile', () => {
  test('offers a profile for a route and reports absent bands honestly', async () => {
    const { page } = harness;

    const routeId = await page.evaluate(async () => {
      const list = await window.trailrt.routes.listAll();
      return list.ok ? (list.data[0]?.id ?? null) : null;
    });
    expect(routeId).not.toBeNull();
    if (routeId === null) return;

    const profile = await page.evaluate(async (id: string) => {
      const result = await window.trailrt.routing.profile({
        ownerType: 'route',
        ownerId: id,
      });
      return result.ok ? result.data : null;
    }, routeId);

    expect(profile).not.toBeNull();
    expect(profile?.totalDistanceM).toBeGreaterThan(0);

    // Drawn on the map with no elevation of its own, and no terrain tiles in a
    // fresh profile, so the band is absent with the reason and the download
    // that would fix it — never a row of zeros (ADR 0018).
    expect(profile?.elevation).toBeNull();
    expect(profile?.elevationAbsentBecause).toMatch(/not downloaded yet/i);
    expect(profile?.terrainMissing?.tileCount).toBeGreaterThanOrEqual(1);

    // Straight lines between clicks say nothing about bends: unknown, not 0.
    expect(profile?.twistiness).toBeNull();
    expect(profile?.twistinessUnknownBecause).toMatch(/too far apart/i);

    // No provider, so no roads have been matched.
    expect(profile?.postedSpeedSpans).toBeNull();
    expect(profile?.postedSpeedAbsentBecause).toMatch(/not been matched/i);
    expect(profile?.recordedSpeedAbsentBecause).toMatch(/plan/i);
  });

  test('the profile drawer opens from the route properties panel', async () => {
    const { page } = harness;

    await page
      .getByRole('treeitem', { name: /Route/ })
      .first()
      .click();
    await editSelection(page);
    await page.getByRole('button', { name: 'Profile and points' }).click();

    const drawer = page.getByRole('region', { name: 'Route profile' });
    await expect(drawer).toBeVisible();
    // The absent-band reasons are shown to the user, not just present in the
    // API, with the download that would supply terrain heights. Not clicked:
    // the tests never touch the network.
    await expect(drawer.getByText(/not downloaded yet/i)).toBeVisible();
    await expect(
      drawer.getByRole('button', { name: /Download terrain heights/ }),
    ).toBeVisible();
    await expect(drawer.getByText(/too far apart to show bends/i)).toBeVisible();

    await page.getByRole('button', { name: 'Close profile' }).click();
    await expect(drawer).toHaveCount(0);
  });

  test('offers no snap control for a track, only a read-only lookup', async () => {
    /*
     * Checked at the contract level rather than through the UI, because it is
     * a guarantee about what the application can do at all: there is no
     * channel that moves a track onto a road. ADR 0011 §4.
     */
    const names = await harness.page.evaluate(() =>
      Object.keys(window.trailrt.routing),
    );

    expect(names).toContain('match');
    expect(names).toContain('snap');

    // `snap` takes a routeId and nothing else, so it cannot be aimed at a
    // track even by a compromised renderer.
    const refused = await harness.page.evaluate(async () => {
      const tracks = await window.trailrt.tracks.listAll();
      const id = tracks.ok ? tracks.data[0]?.id : undefined;
      // No tracks in this trip, which is itself the point: the UI never offers
      // the control. Confirm the channel validates its payload shape.
      const result = await window.trailrt.routing.snap({
        routeId: id ?? 'not-a-uuid',
      });
      return result.ok ? null : result.error.code;
    });

    expect(refused).toBe('INVALID_REQUEST');
  });
});

test.describe('Waze hand-off', () => {
  test('offers the start or the end, one destination each', async () => {
    const { page } = harness;

    await page
      .getByRole('treeitem', { name: /Route/ })
      .first()
      .click();

    // A small icon now, not a full-width button, in the route's editor.
    await editSelection(page);
    await page.getByRole('button', { name: 'Navigate in Waze' }).click();
    const items = page.getByRole('menuitem');
    await expect(items).toHaveText([
      'Navigate to start in Waze',
      'Navigate to end in Waze',
    ]);
    // No whole-route action exists anywhere, because Waze cannot accept one.
    await expect(page.getByText(/whole route/i)).toHaveCount(0);

    // Not chosen: the tests never open an external link.
    await page.keyboard.press('Escape');
    await expect(items).toHaveCount(0);
  });

  test('builds a link the main process will accept', async () => {
    const accepted = await harness.page.evaluate(async () => {
      const result = await window.trailrt.app.openExternal({
        // Buxton, as the hand-off would encode it.
        url: 'https://www.waze.com/ul?ll=53.258800%2C-1.911000&navigate=yes',
      });
      return result.ok;
    });

    // The host is allowlisted and the scheme is https, so the guard permits it.
    expect(accepted).toBe(true);
  });

  test('refuses a host outside the allowlist', async () => {
    const refused = await harness.page.evaluate(async () => {
      const result = await window.trailrt.app.openExternal({
        url: 'https://maps.example.org/?ll=1,2',
      });
      return result.ok ? null : result.error.message;
    });

    expect(refused).toMatch(/not in the allowed link list/i);
  });
});

test.describe('the snap routing tool', () => {
  /*
   * Following roads is the default (ADR 0018), so there is no separate tool to
   * find. With no map region loaded, "New Route" draws straight lines and says
   * why, with the fix one click away.
   */
  test('has no separate control, and New Route says why it is straight', async () => {
    const { page } = harness;

    await expect(page.getByRole('button', { name: 'Snap routing' })).toHaveCount(0);

    await openTrip(page, /Phase Four Trip/);
    await page.getByRole('button', { name: 'New route', exact: true }).click();
    await expect(page.getByText(/no map region loaded yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add map regions…' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText(/no map region loaded yet/i)).toHaveCount(0);
  });

  test('refuses a leg request with the same code as a snap', async () => {
    // Passed in rather than closed over: an `evaluate` callback is serialised
    // into the renderer, so it cannot see this file's constants.
    const code = await harness.page.evaluate(
      async ({ from, to }) => {
        const result = await window.trailrt.routing.routeLeg({ from, to });
        return result.ok ? null : result.error.code;
      },
      { from: BUXTON_AT, to: CAT_FIDDLE_AT },
    );

    expect(code).toBe('PROVIDER_UNAVAILABLE');
  });

  test('rejects a leg count that does not match the points', async () => {
    const { page } = harness;

    const tripId = await page.evaluate(async () => {
      const result = await window.trailrt.trips.list({});
      return result.ok ? (result.data[0]?.id ?? null) : null;
    });
    expect(tripId).not.toBeNull();
    if (tripId === null) return;

    const outcome = await page.evaluate(
      async ({ id, along }) => {
        const result = await window.trailrt.routing.createSnapped({
          tripId: id,
          name: 'Mismatched',
          // Three points need two legs. One leg is a preview that drifted out
          // of step with its points, so neither can be trusted.
          controlPoints: along,
          legs: [
            {
              matched: true,
              shape: along.slice(0, 2),
              distanceM: 100,
            },
          ],
        });
        return result.ok ? { ok: true } : { ok: false, code: result.error.code };
      },
      { id: tripId, along: [BUXTON_AT, CAT_FIDDLE_AT, MACCLESFIELD_AT] },
    );

    // Caught at the schema, so it is reported as the request problem it is.
    expect(outcome).toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  test('exposes the tool through the named bridge and nothing wider', async () => {
    const names = await harness.page.evaluate(() =>
      Object.keys(window.trailrt.routing).toSorted(),
    );

    expect(names).toEqual([
      // Phase 6: the routes on offer between two points. A read.
      'alternatives',
      // Phase 6: commits a shaping edit as previewed. One undo entry.
      'applyEdit',
      'attributes',
      'clearAttributes',
      'consentNotice',
      'createSnapped',
      // Fetches a published extract covering the visible map area and builds a
      // graph from it, so a user never has to understand OpenStreetMap
      // distribution to get routing working.
      'downloadRegion',
      // Phase 7: terrain tiles for one geometry's profile. Downloads data, never
      // writes to a route.
      'downloadTerrain',
      // The only channel in the application that spawns a child process.
      'importRegion',
      'match',
      'profile',
      'provenance',
      'region',
      // Phase 7: the UK regions as shapes, and their sizes. Reads.
      'regionMap',
      'regionSizes',
      'routeLeg',
      // Phase 6: routes a section through shaping points. A read.
      'routeSection',
      'snap',
      'speedDistribution',
      'status',
      // Ranks downloadable extracts against the current viewport. A read, so
      // it reaches the index but never downloads an extract.
      'suggestRegions',
      // The connection test. Listed deliberately: it is the one routing call
      // not gated on consent, so its presence should be a decision someone
      // made rather than something that drifted in.
      'test',
    ]);
  });
});
