# OpenCAD Electrical

Web-native CAD for electrical containment design, with engineering calculations baked in.

OpenCAD Electrical is a browser-first design tool for cable containment systems — trays, ladders, baskets, trunking and conduit — that ships with a real BS 7671 / NEC calculation engine and a manufacturer product catalogue. Where Revit MEP and AutoCAD demand a heavy desktop install and external add-ins for compliance, OpenCAD runs in any modern browser and treats fill, derating, voltage drop and segregation as first-class citizens of the model rather than after-the-fact validation.

![2D plan view](docs/screenshot-2d.png)

## What's inside

- **2D + 3D containment routing** with auto-fittings, support placement and slab/wall penetration detection
- **BS 7671 / NEC engineering calc engine** — fill, grouping derating, voltage drop, ampacity, segregation distances
- **366-product manufacturer catalogue** covering Cablofil, Hilti, Schneider, Marshall-Tufflex, Univolt, Unistrut and Promat parts
- **Cable schedule** with auto-routing through the containment graph and per-cable pull cards
- **BS EN ISO 19650 drawing numbering** and ISO 7200 title blocks
- **IFC, DXF, COBie and Excel** imports plus exports for the same formats, PDF and PNG
- **Compliance dashboard** running project-wide checks against the active standards profile
- **Multi-floor 3D building scene** with floor isolation, system filters and live cross-sections

![3D site view](docs/screenshot-3d.png)

## Try the demo

A hosted build is available at **<https://opencad.pages.dev>**. Open it directly in the browser — there's no install step and the sample whole-site project loads on first launch.

## Run locally

```bash
git clone https://github.com/your-org/opencad-electrical.git
cd opencad-electrical
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
├── io/             IFC / DXF / COBie / PDF / PNG / XLSX import + export, BOM, schedules
├── models/         Domain types — site, cable, catalogue, fire, revision, standards
├── data/catalogues  Manufacturer product data (trays, ladders, baskets, trunking, conduit, supports, fittings, fire stops)
└── ui/             React panels, modals and ribbon — calculations, BOM, compliance, cable schedule
```

![Compliance dashboard](docs/screenshot-compliance.png)

## Built with

- [React 18](https://react.dev/) and [TypeScript 5.5](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) for the build pipeline
- [Three.js](https://threejs.org/) for the 3D building scene
- [Zustand](https://github.com/pmndrs/zustand) for state management
- [jsPDF](https://github.com/parallax/jsPDF) for PDF export

No backend — every drawing, calculation and export runs in the browser.

## Standards

The calculation engine and compliance checker implement, in part:

- **BS 7671:2018+A2:2022** — Requirements for Electrical Installations (UK / IET Wiring Regulations)
- **IEC 60364** — Low-voltage electrical installations
- **NFPA 70 (NEC)** — National Electrical Code, US
- **BS EN 50174** — Information technology cabling installation
- **BS 8519 / BS 5839** — Fire-resistant cable selection and segregation
- **BS EN ISO 19650** — Information management for built assets (drawing numbering)
- **ISO 7200** — Title blocks for technical drawings
- **buildingSMART IFC4** — IFC export schema for handover
- **COBie 2.4** — Construction Operations Building Information Exchange

Standards profiles are switchable per project; the active profile drives derating tables, segregation rules and compliance checks.

![Bill of materials](docs/screenshot-bom.png)

## Deployment

The `dist/` output is a static SPA and can be hosted on any static host. The repository ships with a Cloudflare Pages configuration:

```bash
npm run build
npm run deploy
```

`npm run deploy` calls `wrangler pages deploy dist --project-name=opencad`. Install Wrangler globally (`npm i -g wrangler`) and `wrangler login` once before first deploy.

## Contributing

Pull requests are welcome. The repo enforces typecheck and build on every PR via GitHub Actions; please run `npm run lint && npm run build` locally before pushing. New catalogue entries should follow the schema in `src/models/catalogue.ts` and ship with a citation to a manufacturer datasheet.

## License

MIT — see `LICENSE`. Replace this stub with your own license file before publishing.
