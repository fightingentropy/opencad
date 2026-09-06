# OpenCAD Electrical

Web-native CAD for electrical containment design, with engineering calculations baked in.

OpenCAD Electrical is a browser-first design tool for cable containment systems — trays, ladders, baskets, trunking and conduit — with traceable engineering seed calculations and a manufacturer product catalogue. It treats fill, derating, voltage drop and segregation as first-class model data. The calculator is design assistance, not certification software; a competent designer must verify outputs against the licensed standard, local amendments, installation method and manufacturer data.

![2D plan view](docs/screenshot-2d.png)

## What's inside

- **2D + 3D containment routing** with auto-fittings, support placement and slab/wall penetration detection
- **Versioned engineering calculation datasets** — fill, grouping derating, voltage drop, ampacity, segregation and basic overload coordination, with profile hashes in calculation results and exports
- **366-product manufacturer catalogue** covering Cablofil, Hilti, Schneider, Marshall-Tufflex, Univolt, Unistrut and Promat parts
- **Cable schedule** with auto-routing through the containment graph and per-cable pull cards
- **BS EN ISO 19650 drawing numbering** and ISO 7200 title blocks
- **IFC import/export**, DXF underlay import, and COBie, Excel-compatible CSV, PDF, PNG and SVG exports
- **Compliance dashboard** running project-wide checks against the active standards profile
- **Multi-floor 3D building scene** with floor isolation, system filters and live cross-sections
- **Installation workspace** with searchable components, progress colours, specifications, connected cables, site comments and a dated project timeline
- **Detailed equipment and containment** with hinged board doors, DIN rails, breakers, busbars, cable glands, mechanical equipment, perforated trays, basket wires, support fixings and fire-stop sleeves

![3D site view](docs/screenshot-3d.png)

## Inspect and record an installation

Open **3D → Model explorer**, search a tag or filter by floor/type/status, and select a component. The inspector shows its dimensions, electrical ratings, system and connected cable records. **Focus in 3D** locates the part; **Isolate part** removes surrounding context. The model itself also supports click selection, including equipment, fittings, supports and penetration seals.

The **Progress** view leaves completed parts in their full material colours. Planned parts are grey and in-progress parts are muted; neither state makes geometry transparent or changes its dimensions. **Materials** restores physical materials for inspection, while **Systems** helps trace services. Use **Open board doors**, **Remove covers**, and the layer controls to inspect internals, routed cables, fixings and fire stops. Project scope also supports separating floors. Legacy panel and single-sheet viewers have the same Progress/Materials states and part selection.

Each component can be marked **Planned**, **In progress**, or **Completed** and given site comments. Changes appear in its history and in the **Timeline** tab, with event filters and earlier-event loading. Undo/redo works in 3D. Status and comments travel with the entity through autosave, project JSON export/import and the existing collaboration transport. Viewers cannot write installation records. Regenerating routes preserves matched accessory identities and history; recorded accessories that no longer match are retained as manual parts for review. Reload migrations preserve recorded parts and their geometry.

Equipment internals are representative procedural models, not manufacturer-certified CAD or a circuit assembly schedule. Sizes, ratings, route elevations, cable assignments and seal records come from the project; missing catalogue/manufacturer details are not inferred as verified. Conduit needs an explicit elevation to be exposed in the site view. Automatically generated hanger assemblies that physically clash with a route are omitted from the rendered scene and retain their records for coordination; this is not a substitute for a support design check. Fire-stop geometry illustrates the recorded opening and seal without certifying its installation. Installation completion is separate from electrical testing, approval or energisation.

The bundled corporate sample includes dated **Demo team** progress and comments. Existing projects start unrecorded parts as planned and never receive those demonstration records. Activity history is stored per entity (up to 2,000 events and 4,000 characters per comment); the existing simultaneous same-entity collaboration conflict behaviour still applies.

## Try the demo

A hosted build is available at **<https://opencad.pages.dev>**. First launch opens a simple 3D containment layout: open-top tray (300 × 50 mm), trunking (150 × 150 mm) and wire basket (300 × 54 mm), each with a 3 m run and 1.5 m return. Use Iso, Top and Fit to inspect the geometry. This is a generic section study, not a fabrication drawing. Saved projects reopen as before; File → New containment layout creates the new study after a replacement prompt, with an option to save the current project first.

## Collaboration (Beta)

OpenCAD ships with optional real-time multi-user editing. Open **File → Collaboration…** and share the generated 128-bit room link. Cursors, selection outlines and entity edits sync live.

- **Authenticated mode (production path).** A Cloudflare Access-protected Worker verifies the Access JWT, resolves owner/editor/viewer roles from configured emails or groups, and routes each room to its own SQLite-backed Durable Object. Viewers are rejected server-side if they attempt a document update. Hibernation WebSockets keep identity and role in serialized connection attachments; updates are persisted before acknowledgement/broadcast and compacted into bounded Yjs snapshots.
- **Anonymous WebRTC beta (explicit opt-in).** For local evaluation, `VITE_ENABLE_ANONYMOUS_COLLAB=true` enables the original peer-to-peer mode over public signalling servers. It is visually separate and is never used as a fallback when the authenticated backend is missing or unavailable.
- **Persistent by mode.** The authenticated Durable Object is authoritative and the browser does not reuse a room document cache across signed-in users. Anonymous beta documents use IndexedDB. Single-player autosave also uses IndexedDB with atomic current/backup rotation and a bounded journal.
- **Lazy-loaded.** The Yjs / WebRTC bundle (~60 kB gzipped) only loads when you actually open the Collaboration modal — pure single-player drawing pays nothing.
- **Per-entity merging.** Each entity syncs as its own CRDT record, so two peers editing different entities — even on the same sheet — both keep their changes. Only when two peers edit the *same* entity at the same time does last-writer-wins kick in, and it resolves atomically: you get one peer's full version of that entity, never a half-and-half blend.

The anonymous beta has **no authentication, role enforcement, or application-level payload encryption**: anyone with the room link can read and edit. Do not use that mode for sensitive projects.

## Run locally

```bash
git clone https://github.com/fightingentropy/opencad.git
cd opencad
npm install
npm run dev
```

The dev server runs on `http://localhost:5173`. To produce a production build:

```bash
npm run build
npm run preview
```

## Project structure

```
src/
├── calc/           BS 7671 / NEC calculation engine (fill, derating, vdrop, segregation, supports)
├── lib/            Geometry, snapping, autoroute, cable routing, fitting placement
├── three/          Three.js building scene, render kits and 3D viewer components
├── views/          Plan, section and elevation view generation
├── drawing/        Sheet templates, ISO 7200 title blocks, ISO 19650 numbering, revisions
├── io/             IFC / DXF / COBie / PDF / PNG / CSV I/O, BOM and schedules
├── models/         Domain types — site, cable, catalogue, fire, revision, standards
├── data/catalogues  Manufacturer product data (trays, ladders, baskets, trunking, conduit, supports, fittings, fire stops)
└── ui/             React panels, modals and ribbon — calculations, BOM, compliance, cable schedule
```

![Compliance dashboard](docs/screenshot-compliance.png)

## Built with

- [React 18](https://react.dev/) and [TypeScript](https://www.typescriptlang.org/) (version pinned in `package.json`)
- [Vite](https://vitejs.dev/) for the build pipeline
- [Three.js](https://threejs.org/) for the 3D building scene
- [Zustand](https://github.com/pmndrs/zustand) for state management
- [jsPDF](https://github.com/parallax/jsPDF) for PDF export

Every drawing, calculation and export runs in the browser. The optional authenticated collaboration service only coordinates and persists shared Yjs room state.

## Standards

The calculation engine and compliance checker implement selected rules and seed values from these profiles:

- **BS 7671:2018+A2:2022 + May 2023 Corrigendum** — the current OpenCAD calculation snapshot. It is intentionally version-locked and is not yet an implementation of BS 7671:2018+A4:2026.
- **NFPA 70 (NEC), 2023 edition** — partial profile, currently limited mainly to fill/design limits; BS-derived metric tables are identified as such in calculation traces.
- **IEC 60364 series** — partial profile metadata and design limits, not a complete IEC calculation implementation.
- **AS/NZS 3000:2018 through Amendment 3:2023** — partial profile metadata and design limits, not a complete AS/NZS calculation implementation.
- **BS EN 50174** — Information technology cabling installation
- **BS 8519 / BS 5839** — Fire-resistant cable selection and segregation
- **BS EN ISO 19650** — Information management for built assets (drawing numbering)
- **ISO 7200** — Title blocks for technical drawings
- **buildingSMART IFC4** — IFC export schema for handover
- **COBie 2.4** — Construction Operations Building Information Exchange

Every profile carries jurisdiction, document identifier, edition/amendments, effective-date status, unit system, an OpenCAD profile version and a SHA-256 digest of its canonical lookup dataset. Calculation results identify both the selected profile and the actual source tables used. Every exported artifact—including drawings, reports, schedules, BOMs, cost estimates, COBie and project JSON—embeds the profile version/hash together with units and coordinate-reference-system metadata.

The source standards are licensed publications and are not distributed by this repository. Lookup data and golden fixtures require independent review before a profile version/hash is changed.

![Bill of materials](docs/screenshot-bom.png)

## Deployment

The `dist/` output is a static SPA and can be hosted on any static host. The repository ships with a Cloudflare Pages configuration:

```bash
npm run build
npm run deploy
```

`npm run deploy` calls `wrangler pages deploy dist --project-name=opencad`. Install Wrangler globally (`npm i -g wrangler`) and `wrangler login` once before first deploy.

### Authenticated collaboration service

The service configuration is separate from the static Pages configuration in `wrangler.collab.jsonc`. Before any production rollout:

1. Put the collaboration Worker hostname behind a Cloudflare Access self-hosted application.
2. Confirm the deployed `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and exact `ALLOWED_ORIGINS` values before rolling out a different Access application or frontend hostname.
3. Map owners/editors with the encrypted Worker bindings `ACCESS_OWNER_EMAILS`, `ACCESS_EDITOR_EMAILS`, `ACCESS_OWNER_GROUPS`, and `ACCESS_EDITOR_GROUPS`; do not commit private email allowlists. Authenticated identities with no mapping are viewers.
4. Build the frontend with `VITE_COLLAB_BACKEND_URL=https://opencad-collaboration.erlinhoxha.workers.dev` and keep `VITE_ENABLE_ANONYMOUS_COLLAB=false` for production.

Run the complete local gate (including the Workers runtime tests and a Wrangler dry-run bundle) before rollout:

```bash
npm run collab:types
npm run check
```

The production Worker is restricted by the `opencad-collaboration - Cloudflare Workers` Access application. After reviewing its hostname, audience, policy, and role bindings, deploy with `wrangler deploy --config wrangler.collab.jsonc`. The Access audience and team domain are configuration rather than credentials; Access JWTs, service tokens, private keys, and private email allowlists do not belong in the repository.

The protocol deliberately caps one update at 1.5 MiB, one materialized room snapshot at 16 MiB, presence selection size, and per-connection message rate. Snapshots are split into 1 MiB SQLite rows so they stay below Durable Object row limits. Larger projects should be partitioned at the application layer rather than raising these values past platform limits.

## Contributing

Pull requests are welcome. GitHub Actions enforce TypeScript, ESLint/import boundaries, unit and golden tests, a production build, and a headless visual smoke test. Run `npm run check` locally before pushing. New catalogue entries should follow the schema in `src/models/catalogue.ts` and ship with a citation to a manufacturer datasheet.

## License

MIT — see `LICENSE`.
