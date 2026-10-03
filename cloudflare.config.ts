import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "opencad-collaboration",
    compatibilityDate: "2026-08-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "worker/src/index.ts",
    exports: {
      CollaborationRoom: exports.durableObject({ storage: "sqlite" }),
    },
    previewUrls: false,
    observability: {
      enabled: true,
      logs: {
        enabled: true,
        headSamplingRate: 1,
      },
      traces: {
        enabled: true,
        headSamplingRate: 0.05,
      },
    },
    env: {
      ACCESS_TEAM_DOMAIN: bindings.text(
        "https://fightingentropy.cloudflareaccess.com",
      ),
      ACCESS_AUD: bindings.text(
        "ea7d51e81a3c224451e7c81b4c8c6a17882911c455c56259db178201fe740aea",
      ),
      ALLOWED_ORIGINS: bindings.text("https://opencad.pages.dev"),
      COLLAB_ROOM: bindings.durableObject({
        worker: "opencad-collaboration",
        exportName: "CollaborationRoom",
      }),
    },
  },
});
