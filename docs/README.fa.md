# راهنمای فارسی

این پروژه فقط با Cloudflare Workers و Cloudflare D1 اجرا می‌شود.

```text
Telegram Bot → Webhook → Cloudflare Worker → D1 (SQLite)
```

کد کامل تولید در پوشه `worker/` قرار دارد. مسیر Python/Aiogram، polling، SQLite محلی و Docker حذف شده‌اند.

برای استقرار، راهنمای [worker/README.md](../worker/README.md) را دنبال کنید.
