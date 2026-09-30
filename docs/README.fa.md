# راه‌اندازی bullet-bot

این نسخه فقط زیرساخت اولیه را دارد: دیتابیس، ثبت کاربر، دستورهای `/start` و
`/menu`، منوی فارسی و انگلیسی، تنظیمات، لاگ و Docker. دکمه‌های قابلیت‌های آینده
فعلاً پیام «در نسخه‌های بعد» نشان می‌دهند.

## ویندوز

Python نسخهٔ ۳٫۱۲ یا بالاتر را نصب کنید. در PowerShell و پوشهٔ پروژه:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

فایل `.env` را باز کنید و توکن دریافتی از `@BotFather` را در `BOT_TOKEN` بگذارید.
برای استفادهٔ شخصی، `ALLOWED_USER_IDS` را به شکل `[123456789]` با شناسهٔ عددی
خودتان تنظیم کنید. مقدار `[]` دسترسی همهٔ کاربران در گفت‌وگوی خصوصی را مجاز می‌کند.
فایل `.env` و اطلاعات دفترچه نباید به GitHub ارسال شوند.

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.main
```

در تلگرام به ربات `/start` بفرستید. برای توقف از Ctrl+C استفاده کنید.
فعال‌سازی محیط مجازی اختیاری است: `.\.venv\Scripts\Activate.ps1`؛ دستورهای بالا
بدون فعال‌سازی هم کار می‌کنند. در VS Code همین محیط مجازی را انتخاب کنید.

در این فضای کاری، محیط آمادهٔ بررسی `.venv-win` است؛ برای اجرای مستقیم همین نسخه
می‌توانید در دستورها `.venv` را با `.venv-win` جایگزین کنید.

## Docker

پس از نصب Docker Desktop و ساخت `.env`:

```powershell
docker compose up --build -d
docker compose logs -f bot
docker compose down
```

دیتابیس داخل volume ذخیره می‌شود؛ گزینهٔ `-v` هنگام حذف سرویس، داده‌ها را پاک می‌کند.
هم‌زمان فقط یک نمونهٔ ربات برای هر توکن اجرا کنید. دسترسی خروجی به Telegram لازم است.

## تست و مراحل بعد

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
```

قدم بعدی، ساخت و تکمیل کارها با کنترل مالکیت و تاریخچهٔ تکمیل است؛ سپس ثبت عادت،
محاسبهٔ زنجیره، امتیاز و یادآوری‌های پایدار اضافه می‌شوند. فعلاً هوش مصنوعی پیاده نشده است.
تغییر آدرس دیتابیس به PostgreSQL داده‌های قبلی را خودکار منتقل نمی‌کند.
