# Contributing

All bot code lives in `worker/` and is written in TypeScript for Cloudflare Workers. Keep changes compatible with Wrangler and Cloudflare D1.

```powershell
cd worker
npm install
npm run typecheck
npm run dev
```

Do not add a Python runtime, polling implementation, local SQLite storage, or secrets to the repository.
