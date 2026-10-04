import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma CLI configuration.
 *
 * By default the standard (native) Prisma schema engine is used for migrations.
 * On networks where Prisma cannot download its engine binaries
 * (binaries.prisma.sh blocked), set PRISMA_JS_ENGINE=1 to run migrations
 * through the bundled JavaScript/WASM schema engine via the `pg` driver instead.
 */
const useJsEngine = process.env.PRISMA_JS_ENGINE === "1";

const common = {
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
};

export default useJsEngine
  ? defineConfig({
      ...common,
      experimental: { adapter: true },
      engine: "js",
      adapter: async () =>
        new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : defineConfig(common);
