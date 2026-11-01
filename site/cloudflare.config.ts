import { defineConfig } from "cf/config";

// Public static build of the app (no collaboration backend), served at opencad.erlin.org.
export default defineConfig({
  accountId: "9349e7e9527ec0aad29368255a686ec4",
  worker: {
    name: "opencad",
    compatibilityDate: "2026-08-01",
    assets: { notFoundHandling: "single-page-application" },
    domains: ["opencad.erlin.org"],
    previewUrls: false,
  },
});
