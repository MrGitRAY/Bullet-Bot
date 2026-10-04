# راهنمای ساختار پروژه Bullet Bot

این پروژه فقط با TypeScript، Cloudflare Workers، Wrangler و Cloudflare D1 اجرا می‌شود. مسیر اصلی تولید `worker/` است؛ کد Python، polling و SQLite محلی دیگر بخشی از پروژه نیستند.

## نقشه سریع

```text
Telegram Webhook
      ↓
worker/src/index.ts       ← منطق بات و فرمان‌ها
      ↓
worker/migrations/*.sql   ← ساختار دیتابیس D1
      ↓
Cloudflare D1             ← کاربران، تسک‌ها، عادت‌ها و امتیازها
```

## پوشه‌ها

### `worker/`

تنها برنامه فعال پروژه است. هر قابلیت جدید بات باید در این پوشه توسعه داده شود.

### `worker/src/`

کد TypeScript Worker در این مسیر قرار دارد.

### `worker/migrations/`

تمام تغییرات ساختار D1 به‌صورت migration شماره‌دار نگهداری می‌شوند. migrationها را حذف یا ویرایش نکنید؛ برای تغییر جدید یک فایل شماره‌دار بعدی بسازید.

### `docs/`

مستندات پروژه، معماری، استقرار و این راهنمای ساختار در این مسیر هستند.

### `.github/workflows/`

تنظیمات بررسی خودکار GitHub Actions در این مسیر قرار دارد.

## فایل‌های اصلی ریشه پروژه

| فایل | کاربرد |
|---|---|
| `README.md` | معرفی پروژه، معماری و شروع سریع |
| `CONTRIBUTING.md` | قواعد توسعه و بررسی کد |
| `LICENSE` | مجوز پروژه |
| `.gitignore` | فایل‌ها و secrets که نباید وارد Git شوند |
| `.github/workflows/tests.yml` | اجرای بررسی TypeScript در push و pull request |

## فایل‌های `worker/`

| فایل | کاربرد |
|---|---|
| `src/index.ts` | نقطه ورود Worker و تمام منطق فعلی Telegram Bot |
| `wrangler.jsonc` | نام Worker، اتصال D1، متغیرهای محیطی و تنظیمات Wrangler |
| `package.json` | وابستگی‌ها و فرمان‌های `check`، `dev`، `deploy` و migration |
| `package-lock.json` | نسخه دقیق وابستگی‌های npm؛ هنگام تغییر dependency همراه package.json به‌روزرسانی شود |
| `tsconfig.json` | تنظیمات بررسی TypeScript و strict mode |
| `README.md` | راهنمای اختصاصی استقرار Worker |
| `.dev.vars.example` | نمونه secrets موردنیاز اجرای محلی؛ مقدار واقعی secrets در Git قرار نمی‌گیرد |
| `migrations/` | migrationهای دیتابیس D1 |

## `worker/src/index.ts` را کجا تغییر بدهم؟

| نیاز | بخش مناسب |
|---|---|
| اضافه کردن فرمان یا دکمه | `handleMessage` و ثابت‌های `MENU` / `MENU_EN` |
| پردازش دکمه‌های inline | `handleCallback` |
| ساخت تسک | sessionهای `await_title`، `await_priority` و `createTask` |
| ساخت عادت | `startHabitCreation` و sessionهای `await_habit_title` |
| فهرست تسک‌ها | `showTasks` |
| فهرست عادت‌ها و زنجیره | `showHabits` و `habitStreak` |
| برنامه هفتگی | `showWeeklyPlan` |
| آمار و نمودار | `showStats` |
| لیدربرد و XP | `showLeaderboard` و افزایش XP در `completeTask` و ثبت انجام عادت |
| تغییر زبان | `getLanguage` و callbackهای `lang:en` / `lang:fa` |
| تغییر نام کاربر | session `await_display_name` و ستون `display_name` |
| پیام به Telegram | `sendMessage` و تابع `telegram` |
| اعتبارسنجی webhook | ابتدای handler `fetch` و `secretsEqual` |
| تاریخ و ساعت ایران | `tehranDate`، `tehranWeekday` و `parseLocalDeadline` |

## جدول‌های D1

| جدول | داده |
|---|---|
| `users` | شناسه تلگرام، زبان، نام نمایشی و XP |
| `tasks` | تسک‌های یک‌باره و هفتگی |
| `task_completions` | انجام تسک‌های تکرارشونده |
| `task_skips` | ثبت انجام‌نشدن تسک در هر روز |
| `habits` | عادت‌های روزانه فعال |
| `habit_completions` | انجام عادت‌ها و محاسبه زنجیره |
| `habit_skips` | ثبت انجام‌نشدن عادت |
| `sessions` | مرحله موقت گفت‌وگوی کاربر هنگام ساخت داده |

## اجرای محلی و استقرار

```powershell
cd worker
npm install
npm run check
npm run dev
```

برای اعمال migration روی دیتابیس production:

```powershell
npx wrangler d1 migrations apply bullet-bot --remote
```

برای انتشار Worker:

```powershell
npx wrangler deploy
```

`BOT_TOKEN` و `WEBHOOK_SECRET` باید با `wrangler secret put` در Cloudflare ذخیره شوند و هرگز در فایل، log یا commit قرار نگیرند.

## روش پیشنهادی برای افزودن قابلیت جدید

1. منطق ورودی و دکمه را در `worker/src/index.ts` اضافه کنید.
2. اگر ساختار داده تغییر می‌کند، یک migration جدید در `worker/migrations/` بسازید.
3. با `npm run check` بررسی TypeScript را اجرا کنید.
4. migration production را اعمال کنید.
5. با `npx wrangler deploy` منتشر کنید.
6. با `/start` یا `/menu` در Telegram رفتار را بررسی کنید.

## فایل‌های قدیمی

`docs/deployment-render.md` مربوط به تلاش قدیمی برای Render است و مسیر فعلی production محسوب نمی‌شود. استقرار فعلی فقط Cloudflare Worker و D1 است.
