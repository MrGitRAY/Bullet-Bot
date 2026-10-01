# Bullet Bot on Cloudflare Workers

نسخه رایگان و webhook-based بات برای Cloudflare Workers است. اطلاعات تسک‌ها در D1
ذخیره می‌شوند و نیازی به VPN، پردازش دائمی یا دیسک پولی وجود ندارد.

## استقرار

```powershell
cd worker
npm install
npx wrangler login
npx wrangler d1 create bullet-bot
```

شناسه دیتابیس خروجی را در `wrangler.jsonc` جایگزین `replace-after-d1-create` کنید و سپس:

```powershell
npx wrangler d1 migrations apply bullet-bot --remote
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

در پایان webhook تلگرام را با URL خروجی Worker و همان `WEBHOOK_SECRET` ثبت کنید:

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
```

پارامترهای درخواست عبارت‌اند از `url=https://bullet-bot.<subdomain>.workers.dev/telegram`
و `secret_token=<WEBHOOK_SECRET>`.

توکن‌ها فقط به‌صورت Cloudflare Secret ذخیره می‌شوند و نباید وارد Git شوند.
