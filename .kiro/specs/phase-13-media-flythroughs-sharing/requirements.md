# Phase 13: Video, Flythroughs and Sharing — Requirements

Status: requirements only (12 November 2026), from the owner's direction.
Mostly investigation deliverables at this stage, like Phase 9, because the
central questions are which renderer, which terrain and tile data, and which
video encoder can be used under the project's licence and policies. Not
designed. Its design waits until Phases 11 and 12 are built and tested.

Depends on Phase 7 (terrain), Phase 11 (linked folders and photos) and
Phase 12 (owned files written into a linked folder).

## Introduction

The owner's direction, 12 November 2026:

> Sharing routes onto social media will be a further step, with flythroughs
> being created, so storing images, videos etc. organised becomes even more
> important.

A **flythrough** is a short video that flies the map along a route or track,
over the terrain, with the trip's photos and videos appearing at the places
they were taken. It is the kind of thing people share after a trip. This phase
makes them, adds video to what a linked folder holds, and gives the user a way
to share the result.

The trip's folder on disk (Phases 11 and 12) is where all of it is kept. Videos
are read from it, and what this phase produces is written into it as owned
files, under the rules of ADR 0020 §5.

### What the codebase and the project's policies establish

- **The map is 2D.** Leaflet draws raster tiles and has no camera tilt or
  terrain. A flythrough needs a 3D renderer. That is a new dependency, and the
  licence check comes first (`licensing.md`).
- **Terrain heights exist, as data.** Phase 7 reads the open Terrain Tiles
  dataset (`src/main/terrain/terrainStore.ts`) in its `skadi` height-file
  layout, for profiles. A 3D renderer usually wants terrain as image tiles. The
  same dataset publishes those, but it is a separate download with its own
  size and caching cost.
- **Base-map tiles have usage terms.** A video renders thousands of tile views.
  The public OpenStreetMap tile servers' usage policy is not written for that.
  Which tile sources may be used to render a video that is then published is a
  licensing question, not a technical one.
- **No accounts, no cloud dependency** (`licensing.md`, ADR 0007). Posting to a
  social network through its API needs an app registration and secret keys,
  which cannot be kept secret in GPL source. It also needs an account per user,
  and terms that change. Sharing has to work without TrailRT holding anyone's
  account.
- **macOS has a share sheet**, and Electron exposes it (`ShareMenu`). It hands a
  file to whatever the user has installed, including the social apps, Messages
  and AirDrop, with no account in TrailRT.
- **Phase 11 already indexes video files** (`kind = 'video'`) and counts them,
  without opening them.
- **Photos carry their location.** Sharing a photo as it is shares where it
  was taken, and a route that starts at home shares where the user lives.

## Requirements

### Requirement 1: Video in linked folders

#### Acceptance criteria

1. Phone videos (`.mov`, `.mp4`, `.m4v`) in a linked folder SHALL be read for
   their recorded location and capture time, and placed on the map like
   photos, distinguished from them.
2. THE preview box (Phase 11 Requirement 6) SHALL show a video's poster frame,
   duration and details. Playing it SHALL open it in the default app, unless
   the design shows in-app playback can be done without loading the file into
   the renderer by path.
3. Videos SHALL follow every Phase 11 rule for photos: never written, read
   only as much as needed, not-downloaded iCloud files not forced to download,
   and missing location kept missing.

### Requirement 2: Flythroughs (investigation first)

**Deliverable:** a findings document, then the feature if the findings
support it.

#### Acceptance criteria

1. THE investigation SHALL compare 3D map renderers that can tilt the camera
   over terrain, run inside the renderer process under the existing CSP or a
   documented change to it, and carry a licence compatible with GPL-3.0.
2. IT SHALL establish which terrain and base-map sources may lawfully be used
   to render a video for publication, and whether they can be cached for
   offline rendering.
3. IT SHALL compare ways to encode the video: the WebCodecs encoder built into
   Electron's Chromium, with a container writer, against a bundled encoder such
   as FFmpeg. It SHALL cover licence, size, signing under the hardened runtime
   (the ADR 0013 amendment), and speed.
4. IT SHALL measure the time to render a two-minute 1080p flythrough on the
   target hardware.
5. THE feature, if built, SHALL let the user pick a route or track, the
   length, the aspect (landscape, portrait for stories, and square), and which
   photos and videos appear. It SHALL render to a video file, show progress,
   and be cancellable.
6. A flythrough SHALL be rendered on this Mac. No cloud rendering service.

### Requirement 3: Sharing

#### Acceptance criteria

1. THE user SHALL be able to share a flythrough video, a still map image of a
   route or track, and its GPX file, through the macOS share sheet.
2. TrailRT SHALL NOT hold social network accounts, tokens or keys, and SHALL
   NOT post on the user's behalf. Sharing hands a file to the app the user
   chooses.
3. Everything produced for sharing SHALL be written as owned files into the
   trip's linked folder, in a subfolder for them, so it is kept with the trip.
   The design decides the name.

### Requirement 4: Privacy when sharing

#### Acceptance criteria

1. THE user SHALL be able to set privacy zones, places such as home, around
   which shared routes, tracks and flythroughs are trimmed or blurred. The
   design decides which.
2. Photos included in anything shared SHALL have their location removed from
   the shared copy by default. The original is never touched (ADR 0020 §5);
   only the copy written for sharing differs.
3. BEFORE anything is shared THE app SHALL show what it contains: the places
   it reveals, and whether photo locations are kept or removed.

## Out of scope

- **Posting through social network APIs**, and any TrailRT account
  (`licensing.md`).
- **Editing videos**, beyond choosing which appear in a flythrough.
- **Cloud rendering or storage.**

## Unresolved questions for the owner

1. **Which networks matter most?** That decides the aspect ratios and lengths
   to offer first (for example 9:16 under a minute for stories, 16:9 for
   longer videos).
2. **Music or narration** in flythroughs? Music brings licensing questions of
   its own.
3. **Privacy zones:** trim the line near a zone, or blur the map there?
4. **Is the share sheet enough**, given that it reaches any installed social
   app, or is a specific network wanted despite the account and policy cost?
