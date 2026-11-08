# TivaroMarket – notes for coding agents

- Monorepo (pnpm). Engine packages (`packages/*`, `apps/worker`, `apps/mcp`) are dependency-free TypeScript run directly by Node ≥ 22.18
  (type stripping): use only erasable syntax (no enums, namespaces, parameter properties) and import local files with `.ts` extensions.
- Storage is `node:sqlite` via `packages/db` (`Store`). The worker is the only writer; web and MCP go through the worker HTTP API.
- Never introduce look-ahead: briefs use closed candles before `now`; settlement uses candles that open at/after `decision.createdAt`.
- No invented data: a source without keys is reported as unavailable, never faked. Synthetic candles are only for tests/demo.
- UI text is Polish; prompts to models are English with Polish rationales.
- Run `pnpm test` and `pnpm typecheck` before committing. The web app is built in CI (`pnpm --filter @tivaro/web build`).
