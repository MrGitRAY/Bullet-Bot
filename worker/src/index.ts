type TelegramUser = { id: number; username?: string };
type TelegramChat = { id: number };
type Message = { message_id: number; from?: TelegramUser; chat: TelegramChat; text?: string };
type CallbackQuery = { id: string; from: TelegramUser; message?: Message; data?: string };
type Update = { update_id: number; message?: Message; callback_query?: CallbackQuery };

type SessionData = {
  kind?: "one_time" | "weekly";
  title?: string;
  priority?: "low" | "medium" | "high";
  weekdays?: number[];
  habitTitle?: string;
  deadlineDate?: string;
  noDeadline?: boolean;
};

type TaskRow = {
  id: number;
  title: string;
  priority: "low" | "medium" | "high";
  kind: "one_time" | "weekly";
  deadline: string | null;
  weekdays: string | null;
  completed: number;
};

type TelegramResult = { ok: boolean; description?: string };
type InlineButton = { text: string; callback_data: string };
type ReplyMarkup = {
  inline_keyboard?: InlineButton[][];
  keyboard?: { text: string }[][];
  resize_keyboard?: boolean;
};

const MENU = {
  inline_keyboard: [[{ text: "📒 برنامه امروز", callback_data: "menu:today" }, { text: "📅 برنامه هفتگی", callback_data: "menu:week" }], [{ text: "➕ تسک جدید", callback_data: "menu:task" }, { text: "📋 همه تسک‌ها", callback_data: "menu:all" }], [{ text: "➕ عادت جدید", callback_data: "menu:habit" }, { text: "🌱 همه عادت‌ها", callback_data: "menu:habits" }], [{ text: "📊 گزارش‌ها", callback_data: "menu:stats" }, { text: "⚙️ تنظیمات", callback_data: "menu:settings" }]],
} satisfies ReplyMarkup;

const MENU_EN: ReplyMarkup = {
  inline_keyboard: [[{ text: "📒 Today's Plan", callback_data: "menu:today" }, { text: "📅 Weekly Plan", callback_data: "menu:week" }], [{ text: "➕ New task", callback_data: "menu:task" }, { text: "📋 All tasks", callback_data: "menu:all" }], [{ text: "➕ New habit", callback_data: "menu:habit" }, { text: "🌱 All habits", callback_data: "menu:habits" }], [{ text: "📊 Reports", callback_data: "menu:stats" }, { text: "⚙️ Settings", callback_data: "menu:settings" }]],
};

const PRIORITIES: Record<string, string> = {
  low: "🟢 کم",
  medium: "🟡 متوسط",
  high: "🔴 زیاد",
};

const WEEKDAYS = [
  [6, "شنبه"],
  [7, "یکشنبه"],
  [1, "دوشنبه"],
  [2, "سه‌شنبه"],
  [3, "چهارشنبه"],
  [4, "پنجشنبه"],
  [5, "جمعه"],
] as const;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "bullet-bot" });
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("Not found", { status: 404 });
    }

    const suppliedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!(await secretsEqual(suppliedSecret, env.WEBHOOK_SECRET))) {
      return new Response("Unauthorized", { status: 401 });
    }

    const update = await request.json<Update>();
    ctx.waitUntil(
      handleUpdate(update, env).catch((error: unknown) => {
        console.error(JSON.stringify({ event: "update_failed", error: String(error) }));
      }),
    );
    return new Response("OK");
  },
} satisfies ExportedHandler<Env>;

async function handleUpdate(update: Update, env: Env): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query, env);
    return;
  }
  if (update.message?.from && update.message.text) {
    await handleMessage(update.message, env);
  }
}

async function handleMessage(message: Message, env: Env): Promise<void> {
  const from = message.from;
  if (!from || !isAllowed(from.id, env.ALLOWED_USER_IDS)) {
    return;
  }
  const userId = await ensureUser(env.DB, from);
  const language = await getLanguage(env.DB, userId);
  const text = normalizeDigits(message.text ?? "").trim();

  if (["/start", "/menu"].includes(text)) {
    await clearSession(env.DB, userId);
    const profile = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(userId).first<{ display_name: string | null }>();
    if (!profile?.display_name) {
      await setSession(env.DB, userId, "await_display_name", {});
      await sendMessage(env, message.chat.id, language === "en" ? "Welcome! What name should I use for you?" : "خوش آمدی! دوست داری با چه نامی صدایت کنم؟");
      return;
    }
    await sendMessage(env, message.chat.id, language === "en" ? "Welcome to Bullet Journal. Choose an option:" : "به Bullet Journal خوش آمدی. از منوی زیر شروع کن:", language === "en" ? MENU_EN : MENU);
    return;
  }
  if (["/name", "✏️ تغییر نام", "✏️ Change name"].includes(text)) {
    await setSession(env.DB, userId, "await_display_name", {});
    await sendMessage(env, message.chat.id, language === "en" ? "Send your new display name:" : "نام نمایشی جدیدت را بفرست:");
    return;
  }
  if (["/help", "راهنما", "Help"].includes(text)) {
    const help = language === "en"
      ? "<b>Menu guide</b>\n\n📒 Today's Plan — execute today's tasks and habits\n📅 Weekly Plan — view the weekly schedule\n➕ New task — create a task\n📋 All tasks — manage open tasks\n➕ New habit — create a daily habit\n🌱 All habits — manage habits\n📊 Reports — tasks, habits and chart\n⚙️ Settings — profile and language\n\n────────────\n\n<b>XP rules</b>\n• High priority task: 6 XP\n• Medium priority task: 4 XP\n• Low priority task: 2 XP\n• A task without a deadline gives no XP\n• Miss penalties: -3, -2, then -1 XP for consecutive misses\n• Habit chain rewards: 1, 2, 3, 4, then 5 XP per day\n• Breaking a habit chain deducts 2 XP\n• Repeating the same action on the same day gives XP once"
      : "<b>راهنمای منو</b>\n\n📒 برنامه امروز — اجرای تسک‌ها و عادت‌های امروز\n📅 برنامه هفتگی — نمایش برنامه هفته\n➕ تسک جدید — ساخت تسک\n📋 همه تسک‌ها — مدیریت تسک‌های باز\n➕ عادت جدید — ساخت عادت روزانه\n🌱 همه عادت‌ها — مدیریت عادت‌ها\n📊 گزارش‌ها — آمار تسک، عادت و نمودار\n⚙️ تنظیمات — نام و زبان\n\n────────────\n\n<b>قوانین امتیازدهی</b>\n• تسک مهم: ۶ XP\n• تسک متوسط: ۴ XP\n• تسک کم‌اهمیت: ۲ XP\n• تسک بدون ددلاین XP ندارد\n• جریمه انجام ندادن متوالی: ۳-، ۲- و سپس ۱- XP\n• پاداش زنجیره عادت: روز اول ۱، روز دوم ۲، روز سوم ۳، روز چهارم ۴ و از روز پنجم به بعد روزی ۵ XP\n• قطع زنجیره عادت: ۲ XP منفی\n• انجام دوباره یک مورد در همان روز XP اضافه نمی‌دهد";
    await sendMessage(env, message.chat.id, help);
    return;
  }
  if (text === "/cancel") {
    await clearSession(env.DB, userId);
    await sendMessage(env, message.chat.id, "عملیات لغو شد.");
    return;
  }
  if (["🌐 تغییر زبان", "🌐 زبان فارسی", "🌐 English"].includes(text)) {
    await sendMessage(env, message.chat.id, "زبان / Language:", { inline_keyboard: [[{ text: "English", callback_data: "lang:en" }, { text: "فارسی", callback_data: "lang:fa" }]] });
    return;
  }
  if (["/task", "➕ تسک جدید", "🔴➕ تسک جدید", "➕ New task", "🔴➕ New task"].includes(text)) {
    await showTaskType(env, message.chat.id, userId);
    return;
  }
  if (["📒 برنامه امروز", "📒 Today's Plan", "📋 تسک‌های امروز", "📋 Today's tasks", "/today"].includes(text)) {
    await showTasks(env, message.chat.id, userId, true);
    return;
  }
  if (["🗂 همه تسک‌ها", "🗂 All tasks", "/tasks"].includes(text)) {
    await showTasks(env, message.chat.id, userId, false);
    return;
  }
  if (["📊 آمار", "📊 Statistics", "/stats"].includes(text)) {
    await showStats(env, message.chat.id, userId);
    return;
  }
  if (["✅ عادت جدید", "🟢➕ عادت جدید", "✅ New habit", "🟢➕ New habit", "/habit"].includes(text)) {
    await startHabitCreation(env, message.chat.id, userId);
    return;
  }
  if (["✅ عادت‌ها", "📋 عادت‌ها", "✅ Habits", "📋 Habits", "/habits"].includes(text)) {
    await showHabits(env, message.chat.id, userId);
    return;
  }
  if (["📅 برنامه هفتگی", "📅 Weekly plan", "/week"].includes(text)) {
    await showWeeklyPlan(env, message.chat.id, userId);
    return;
  }
  if (["🏆 لیدربرد", "🏆 Leaderboard", "/leaderboard", "/top"].includes(text)) {
    await showLeaderboard(env, message.chat.id, userId);
    return;
  }

  const session = await getSession(env.DB, userId);
  if (!session) {
    await sendMessage(env, message.chat.id, "از منو یکی از گزینه‌ها را انتخاب کن.");
    return;
  }
  const data = JSON.parse(session.data) as SessionData;
  if (session.state === "await_display_name") {
    if (text.length < 1 || text.length > 80) {
      await sendMessage(env, message.chat.id, language === "en" ? "Name must be between 1 and 80 characters." : "نام باید بین ۱ تا ۸۰ نویسه باشد.");
      return;
    }
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(text, userId).run();
    await clearSession(env.DB, userId);
    await sendMessage(env, message.chat.id, language === "en" ? `✅ Nice to meet you, ${escapeHtml(text)}.` : `✅ خوشحالم که با نام ${escapeHtml(text)} می‌شناسمت.`);
    return;
  }
  if (session.state === "await_title") {
    if (text.length < 1 || text.length > 500) {
      await sendMessage(env, message.chat.id, (await getLanguage(env.DB, userId)) === "en" ? "Title must be between 1 and 500 characters." : "عنوان باید بین ۱ تا ۵۰۰ نویسه باشد.");
      return;
    }
    data.title = text;
    await setSession(env.DB, userId, "await_priority", data);
    const en = (await getLanguage(env.DB, userId)) === "en";
    await sendMessage(env, message.chat.id, en ? "Choose priority:" : "اولویت را انتخاب کن:", {
      inline_keyboard: [[
        { text: en ? "🟢 Low" : "🟢 کم", callback_data: "new:priority:low" },
        { text: en ? "🟡 Medium" : "🟡 متوسط", callback_data: "new:priority:medium" },
        { text: en ? "🔴 High" : "🔴 زیاد", callback_data: "new:priority:high" },
      ]],
    });
    return;
  }
  if (session.state === "await_habit_title") {
    if (text.length < 1 || text.length > 200) {
      await sendMessage(env, message.chat.id, "نام عادت باید بین ۱ تا ۲۰۰ نویسه باشد.");
      return;
    }
    await env.DB.prepare("INSERT INTO habits (user_id, title, weekdays) VALUES (?, ?, ?)")
      .bind(userId, text, JSON.stringify([1, 2, 3, 4, 5, 6, 7])).run();
    await clearSession(env.DB, userId);
    await sendMessage(env, message.chat.id, "✅ عادت روزانه ذخیره شد.");
    return;
  }
  if (session.state === "await_deadline") {
    const deadline = parseLocalDeadline(data.deadlineDate ? `${data.deadlineDate} ${text}` : text);
    if (!deadline) {
      await sendMessage(env, message.chat.id, "فرمت معتبر نیست. نمونه: 2026-10-15 18:30");
      return;
    }
    await createTask(env.DB, userId, data, deadline);
    await clearSession(env.DB, userId);
    await sendMessage(env, message.chat.id, "✅ تسک یک‌باره ذخیره شد.");
    return;
  }
  if (session.state === "await_deadline_time") {
    const deadline = parseLocalDeadline(`${data.deadlineDate ?? ""} ${text}`);
    if (!deadline) { await sendMessage(env, message.chat.id, "ساعت معتبر نیست. نمونه: 18:30"); return; }
    await createTask(env.DB, userId, data, deadline);
    await clearSession(env.DB, userId);
    await sendMessage(env, message.chat.id, "✅ تسک یک‌باره ذخیره شد.");
    return;
  }
  await sendMessage(env, message.chat.id, "لطفاً از دکمه‌های پیام قبلی استفاده کن یا /cancel را بفرست.");
}

async function handleCallback(query: CallbackQuery, env: Env): Promise<void> {
  const chatId = query.message?.chat.id;
  const data = query.data;
  if (!chatId || !data || !isAllowed(query.from.id, env.ALLOWED_USER_IDS)) {
    await answerCallback(env, query.id);
    return;
  }
  const userId = await ensureUser(env.DB, query.from);
  await answerCallback(env, query.id);

  if (data.startsWith("menu:")) {
    const action = data.slice(5);
    if (action === "task") await showTaskType(env, chatId, userId);
    else if (action === "habit") await startHabitCreation(env, chatId, userId);
    else if (action === "today") await showDailyPlan(env, chatId, userId);
    else if (action === "all") await showTasks(env, chatId, userId, false);
    else if (action === "habits") await showHabits(env, chatId, userId);
    else if (action === "week") await showWeeklyPlan(env, chatId, userId);
    else if (action === "stats") await showStats(env, chatId, userId);
    else if (action === "leaderboard") await showLeaderboard(env, chatId, userId);
    else if (action === "settings") await sendMessage(env, chatId, "⚙️ تنظیمات / Settings\n\n✏️ Change name\n🌐 Change language");
    else if (action === "name") { await setSession(env.DB, userId, "await_display_name", {}); await sendMessage(env, chatId, "نام نمایشی جدیدت را بفرست:"); }
    else if (action === "language") await sendMessage(env, chatId, "زبان / Language:", { inline_keyboard: [[{ text: "English", callback_data: "lang:en" }, { text: "فارسی", callback_data: "lang:fa" }]] });
    else if (action === "help") await sendMessage(env, chatId, "راهنما در پیام /help قابل مشاهده است.");
    return;
  }

  if (data.startsWith("lang:")) {
    const language = data.slice(5) === "en" ? "en" : "fa";
    await env.DB.prepare("UPDATE users SET language = ? WHERE id = ?").bind(language, userId).run();
    await sendMessage(env, chatId, language === "en" ? "✅ Language changed to English." : "✅ زبان به فارسی تغییر کرد.");
    return;
  }

  if (data === "new:one_time" || data === "new:one_time_no_deadline" || data === "new:weekly") {
    const kind = data === "new:weekly" ? "weekly" : "one_time";
    await setSession(env.DB, userId, "await_title", { kind, noDeadline: data === "new:one_time_no_deadline" });
    await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Send the task title:" : "عنوان تسک را بفرست:");
    return;
  }
  if (data === "new:habit") {
    await startHabitCreation(env, chatId, userId);
    return;
  }
  if (data.startsWith("new:priority:")) {
    const priority = data.split(":")[2] as SessionData["priority"];
    if (!priority || !Object.hasOwn(PRIORITIES, priority)) return;
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_priority") return;
    const sessionData = JSON.parse(session.data) as SessionData;
    sessionData.priority = priority;
    if (sessionData.kind === "one_time" && sessionData.noDeadline) {
      await createTask(env.DB, userId, sessionData, null);
      await clearSession(env.DB, userId);
      await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "✅ One-time task saved." : "✅ تسک یک‌باره ذخیره شد.");
    } else if (sessionData.kind === "one_time") {
      await setSession(env.DB, userId, "await_deadline_date", sessionData);
      await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Choose a deadline date or a quick option:" : "روز ددلاین یا گزینه سریع را انتخاب کن:", deadlineKeyboard());
    } else {
      sessionData.weekdays = [];
      await setSession(env.DB, userId, "await_weekdays", sessionData);
      await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Choose recurring days:" : "روزهای تکرار را انتخاب کن:", weekdayKeyboard([]));
    }
    return;
  }
  if (data === "new:deadline:none") {
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_deadline_date") return;
    await createTask(env.DB, userId, JSON.parse(session.data) as SessionData, null);
    await clearSession(env.DB, userId);
    const en = (await getLanguage(env.DB, userId)) === "en";
    await sendMessage(env, chatId, en ? "✅ One-time task saved without a deadline." : "✅ تسک یک‌باره بدون ددلاین ذخیره شد.");
    return;
  }
  if (data.startsWith("new:quick:")) {
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_deadline_date") return;
    const quick = data.slice("new:quick:".length);
    const date = tehranDateOffset(quick === "tomorrow" || quick === "tomorrow_end" ? 1 : 0);
    const sessionData = JSON.parse(session.data) as SessionData;
    sessionData.deadlineDate = date;
    if (quick === "tonight" || quick === "tomorrow_end") {
      await createTask(env.DB, userId, sessionData, `${date} 23:59`);
      await clearSession(env.DB, userId);
      await sendMessage(env, chatId, "✅ تسک با ددلاین سریع ذخیره شد.");
    } else {
      await setSession(env.DB, userId, "await_deadline_hour", sessionData);
      await sendMessage(env, chatId, "ساعت را انتخاب کن:", hourKeyboard());
    }
    return;
  }
  if (data.startsWith("new:date:")) {
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_deadline_date") return;
    const sessionData = JSON.parse(session.data) as SessionData;
    sessionData.deadlineDate = data.slice("new:date:".length);
    await setSession(env.DB, userId, "await_deadline_hour", sessionData);
    await sendMessage(env, chatId, "ساعت را انتخاب کن:", hourKeyboard());
    return;
  }
  if (data.startsWith("new:hour:")) {
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_deadline_hour") return;
    const sessionData = JSON.parse(session.data) as SessionData;
    sessionData.deadlineDate = `${sessionData.deadlineDate} ${data.slice("new:hour:".length)}`;
    await setSession(env.DB, userId, "await_deadline_minute", sessionData);
    await sendMessage(env, chatId, "دقیقه را انتخاب کن:", minuteKeyboard());
    return;
  }
  if (data.startsWith("new:minute:")) {
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_deadline_minute") return;
    const sessionData = JSON.parse(session.data) as SessionData;
    await createTask(env.DB, userId, sessionData, `${sessionData.deadlineDate}:${data.slice("new:minute:".length)}`);
    await clearSession(env.DB, userId);
    await sendMessage(env, chatId, "✅ تسک با ددلاین ذخیره شد.");
    return;
  }
  if (data.startsWith("new:day:")) {
    const day = Number(data.split(":")[2]);
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_weekdays" || day < 1 || day > 7) return;
    const sessionData = JSON.parse(session.data) as SessionData;
    const selected = new Set(sessionData.weekdays ?? []);
    selected.has(day) ? selected.delete(day) : selected.add(day);
    sessionData.weekdays = [...selected].sort();
    await setSession(env.DB, userId, "await_weekdays", sessionData);
    if (query.message) {
      await editMarkup(env, chatId, query.message.message_id, weekdayKeyboard(sessionData.weekdays, "task"));
    }
    return;
  }
  if (data === "new:days_done") {
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_weekdays") return;
    const sessionData = JSON.parse(session.data) as SessionData;
    if (!(sessionData.weekdays?.length)) {
      await sendMessage(env, chatId, "حداقل یک روز را انتخاب کن.");
      return;
    }
    await createTask(env.DB, userId, sessionData, null);
    await clearSession(env.DB, userId);
    await sendMessage(env, chatId, "✅ تسک تکرارشونده ذخیره شد.");
    return;
  }
  if (data.startsWith("habit:day:")) {
    const day = Number(data.split(":")[2]);
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_habit_days" || day < 1 || day > 7) return;
    const sessionData = JSON.parse(session.data) as SessionData;
    const selected = new Set(sessionData.weekdays ?? []);
    selected.has(day) ? selected.delete(day) : selected.add(day);
    sessionData.weekdays = [...selected].sort();
    await setSession(env.DB, userId, "await_habit_days", sessionData);
    if (query.message) await editMarkup(env, chatId, query.message.message_id, weekdayKeyboard(sessionData.weekdays, "habit"));
    return;
  }
  if (data === "habit:days_done") {
    const session = await getSession(env.DB, userId);
    const sessionData = session ? JSON.parse(session.data) as SessionData : {};
    if (!session || session.state !== "await_habit_days" || !sessionData.habitTitle || !sessionData.weekdays?.length) {
      await sendMessage(env, chatId, "حداقل یک روز را انتخاب کن.");
      return;
    }
    await env.DB.prepare("INSERT INTO habits (user_id, title, weekdays) VALUES (?, ?, ?)")
      .bind(userId, sessionData.habitTitle, JSON.stringify(sessionData.weekdays)).run();
    await clearSession(env.DB, userId);
    await sendMessage(env, chatId, "✅ عادت ذخیره شد.");
    return;
  }
  if (data.startsWith("habit:delete:")) {
    const habitId = Number(data.split(":")[2]);
    await env.DB.prepare("UPDATE habits SET active = 0 WHERE id = ? AND user_id = ?").bind(habitId, userId).run();
    await sendMessage(env, chatId, "🗑 عادت حذف شد.");
    return;
  }
  if (data.startsWith("habit:complete:")) {
    const habitId = Number(data.split(":")[2]);
    const previousStreak = await habitStreak(env.DB, habitId, tehranDate());
    const completion = await env.DB.prepare("INSERT INTO habit_completions (habit_id, user_id, occurrence_date) SELECT id, user_id, ? FROM habits WHERE id = ? AND user_id = ? AND active = 1 ON CONFLICT(habit_id, occurrence_date) DO NOTHING")
      .bind(tehranDate(), habitId, userId).run();
    if (completion.meta.changes > 0) await env.DB.prepare("UPDATE users SET xp = xp + ? WHERE id = ?").bind(Math.min(previousStreak + 1, 5), userId).run();
    await sendMessage(env, chatId, "✅ عادت امروز ثبت شد.");
    return;
  }
  if (data.startsWith("habit:skip:")) {
    const habitId = Number(data.split(":")[2]);
    const skipped = await env.DB.prepare("INSERT INTO habit_skips (habit_id, user_id, occurrence_date) SELECT id, user_id, ? FROM habits WHERE id = ? AND user_id = ? AND active = 1 ON CONFLICT(habit_id, occurrence_date) DO NOTHING").bind(tehranDate(), habitId, userId).run();
    if (skipped.meta.changes > 0) await env.DB.prepare("UPDATE users SET xp = MAX(0, xp - 2) WHERE id = ?").bind(userId).run();
    await sendMessage(env, chatId, "⏭️ عادت امروز انجام‌نشده ثبت شد.");
    return;
  }
  // if (data.startsWith("habit:delete:")) {
  //   const habitId = Number(data.split(":")[2]);
  //   await env.DB.prepare(
  //     `
  //     UPDATE habits
  //     SET active = 0
  //     WHERE id = ?
  //       AND user_id = ?
  //     `
  //   )
  //     .bind(habitId, userId)
  //     .run()

  //   await answerCallbackQuery(
  //     env,
  //     callbackId,
  //     "Habit deleted"
  //   );  
  //   await sendMessage(
  //     env,
  //     chatId,
  //     "🗑 عادت حذف شد."
  //   );
  //   return;
  // }
  if (data.startsWith("task:complete:")) {
    const taskId = Number(data.split(":")[2]);
    await completeTask(env.DB, userId, taskId, tehranDate());
    await sendMessage(env, chatId, "✅ انجام شد.");
    return;
  }
  if (data.startsWith("task:skip:")) {
    const taskId = Number(data.split(":")[2]);
    const task = await env.DB.prepare("SELECT priority, kind, deadline FROM tasks WHERE id = ? AND user_id = ? AND completed = 0")
      .bind(taskId, userId).first<{ priority: "low" | "medium" | "high"; kind: string; deadline: string | null }>();
    const skipped = await env.DB.prepare(
      "INSERT INTO task_skips (task_id, user_id, occurrence_date) SELECT id, user_id, ? FROM tasks WHERE id = ? AND user_id = ? AND completed = 0 ON CONFLICT(task_id, occurrence_date) DO NOTHING",
    ).bind(tehranDate(), taskId, userId).run();
    if (task && skipped.meta.changes > 0 && (task.kind === "weekly" || task.deadline !== null)) {
      const user = await env.DB.prepare("SELECT consecutive_task_misses FROM users WHERE id = ?").bind(userId).first<{ consecutive_task_misses: number }>();
      const misses = (user?.consecutive_task_misses ?? 0) + 1;
      const penalty = misses === 1 ? 3 : misses === 2 ? 2 : 1;
      await env.DB.prepare("UPDATE users SET xp = MAX(0, xp - ?), consecutive_task_misses = ? WHERE id = ?").bind(penalty, misses, userId).run();
    }
    await sendMessage(env, chatId, "⏭️ برای امروز انجام‌نشده ثبت شد.");
    return;
  }
  if (data.startsWith("task:delete:")) {
    const taskId = Number(data.split(":")[2]);
    await env.DB.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").bind(taskId, userId).run();
    await sendMessage(env, chatId, "🗑 تسک حذف شد.");
  }
}

async function showTaskType(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  await sendMessage(env, chatId, en ? "Choose task type:" : "نوع تسک را انتخاب کن:", {
    inline_keyboard: [
      [{ text: en ? "⏰ One-time with deadline" : "⏰ یک‌باره با ددلاین", callback_data: "new:one_time" }],
      [{ text: en ? "📝 One-time without deadline" : "📝 یک‌باره بدون ددلاین", callback_data: "new:one_time_no_deadline" }],
      [{ text: en ? "🔁 Weekly recurring" : "🔁 تکرارشونده هفتگی", callback_data: "new:weekly" }],
    ],
  });
}

async function showTasks(env: Env, chatId: number, userId: number, todayOnly: boolean): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const today = tehranDate();
  const weekday = tehranWeekday();
  const result = await env.DB.prepare(
    `SELECT t.id, t.title, t.priority, t.kind, t.deadline, t.weekdays, t.completed
       FROM tasks t
      WHERE t.user_id = ? AND t.completed = 0
        AND NOT EXISTS (
          SELECT 1 FROM task_completions c
           WHERE c.task_id = t.id AND c.occurrence_date = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM task_skips s
           WHERE s.task_id = t.id AND s.occurrence_date = ?
        )
      ORDER BY t.deadline IS NULL, t.deadline, t.id
      LIMIT 30`,
  ).bind(userId, today, today).all<TaskRow>();
  const tasks = todayOnly
    ? result.results.filter((task) => task.kind === "one_time" || parseWeekdays(task.weekdays).includes(weekday))
    : result.results;
  if (!tasks.length) {
    await sendMessage(env, chatId, todayOnly ? (en ? "You have no open tasks for today. ✨" : "برای امروز تسکی نداری. ✨") : (en ? "You have no open tasks. ✨" : "تسکی وجود ندارد. ✨"));
    return;
  }
  await sendMessage(env, chatId, todayOnly ? (en ? "📋 Today's tasks:" : "📋 تسک‌های امروز:") : (en ? "🗂 Open tasks:" : "🗂 تسک‌های باز:"));
  for (const task of tasks) {
    const schedule = task.kind === "one_time"
      ? `${en ? "Deadline" : "ددلاین"}: ${task.deadline ?? "-"}`
      : `${en ? "Days" : "روزها"}: ${formatWeekdays(parseWeekdays(task.weekdays))}`;
    await sendMessage(
      env,
      chatId,
      `${PRIORITIES[task.priority]}  ${escapeHtml(task.title)}\n${schedule}`,
      {
        inline_keyboard: [[
          { text: en ? "✅ Done" : "✅ انجام شد", callback_data: `task:complete:${task.id}` },
          { text: en ? "⏭️ Skipped" : "⏭️ انجام نشد", callback_data: `task:skip:${task.id}` },
          { text: en ? "🗑 Delete" : "🗑 حذف", callback_data: `task:delete:${task.id}` },
        ]],
      },
    );
  }
}

async function showDailyPlan(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const today = tehranDate();
  const weekday = tehranWeekday();
  const tasks = await env.DB.prepare(`SELECT id, title, priority, kind, deadline, weekdays, completed FROM tasks WHERE user_id = ? AND completed = 0 AND (kind = 'one_time' OR (kind = 'weekly' AND EXISTS (SELECT 1 FROM json_each(tasks.weekdays) WHERE value = ?))) AND NOT EXISTS (SELECT 1 FROM task_completions WHERE task_id = tasks.id AND occurrence_date = ?) AND NOT EXISTS (SELECT 1 FROM task_skips WHERE task_id = tasks.id AND occurrence_date = ?) ORDER BY deadline IS NULL, deadline, id LIMIT 30`).bind(userId, weekday, today, today).all<TaskRow>();
  const habits = await env.DB.prepare("SELECT id, title FROM habits WHERE user_id = ? AND active = 1").bind(userId).all<{ id: number; title: string }>();
  await sendMessage(env, chatId, en ? "📒 <b>Today's Plan</b>\n\n📋 <b>Tasks</b>" : "📒 <b>برنامه امروز</b>\n\n📋 <b>تسک‌ها</b>");
  if (!tasks.results.length) await sendMessage(env, chatId, en ? "No tasks for today." : "امروز تسکی نداری.");
  for (const task of tasks.results) await sendMessage(env, chatId, `⬜ ${escapeHtml(task.title)}${task.deadline ? `\n${en ? "Deadline" : "ددلاین"}: ${task.deadline}` : ""}`, { inline_keyboard: [[{ text: en ? "✅ Complete" : "✅ انجام شد", callback_data: `task:complete:${task.id}` }]] });
  await sendMessage(env, chatId, en ? "🌱 <b>Habits</b>" : "🌱 <b>عادت‌ها</b>");
  for (const habit of habits.results) {
    const done = await env.DB.prepare("SELECT 1 FROM habit_completions WHERE habit_id = ? AND occurrence_date = ?").bind(habit.id, today).first();
    if (!done) await sendMessage(env, chatId, `🔥 ${escapeHtml(habit.title)}`, { inline_keyboard: [[{ text: en ? "✅ Done" : "✅ انجام شد", callback_data: `habit:complete:${habit.id}` }, { text: en ? "⏭️ Skip" : "⏭️ انجام نشد", callback_data: `habit:skip:${habit.id}` }]] });
  }
}

async function startHabitCreation(env: Env, chatId: number, userId: number): Promise<void> {
  await setSession(env.DB, userId, "await_habit_title", {});
  await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Send the daily habit name (for example: Read 20 minutes):" : "نام عادت روزانه را بفرست (مثلاً: مطالعه ۲۰ دقیقه):");
}

async function showStats(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS completed,
       COALESCE(SUM(CASE WHEN kind = 'weekly' AND completed = 0 THEN 1 ELSE 0 END), 0) AS weekly,
       COALESCE(SUM(CASE WHEN kind = 'one_time' AND completed = 0 THEN 1 ELSE 0 END), 0) AS one_time
     FROM tasks WHERE user_id = ?`,
  ).bind(userId).first<{ total: number; completed: number; weekly: number; one_time: number }>();
  if (!row) return;
  const today = tehranDate();
  const doneToday = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM task_completions WHERE user_id = ? AND occurrence_date = ?",
  ).bind(userId, today).first<{ count: number }>();
  const skippedToday = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM task_skips WHERE user_id = ? AND occurrence_date = ?",
  ).bind(userId, today).first<{ count: number }>();
  const habitStats = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM habits WHERE user_id = ? AND active = 1) AS total,
       (SELECT COUNT(*) FROM habit_completions WHERE user_id = ?) AS completed,
       (SELECT COUNT(*) FROM habit_skips WHERE user_id = ?) AS skipped,
       (SELECT COUNT(*) FROM habit_completions WHERE user_id = ? AND occurrence_date = ?) AS today_completed`,
  ).bind(userId, userId, userId, userId, today).first<{ total: number; completed: number; skipped: number; today_completed: number }>();
  const weeklyDone = await env.DB.prepare(
    `SELECT occurrence_date AS date, COUNT(*) AS count
       FROM task_completions WHERE user_id = ? AND occurrence_date >= date('now', '-6 day')
      GROUP BY occurrence_date ORDER BY occurrence_date`,
  ).bind(userId).all<{ date: string; count: number }>();
  const chart = weeklyDone.results.length
    ? weeklyDone.results.map((item) => `${item.date.slice(5)} ${"█".repeat(Math.min(item.count, 12))} ${item.count}`).join("\n")
    : (en ? "No completions recorded this week." : "برای این هفته هنوز تکمیلی ثبت نشده است.");
  await sendMessage(env, chatId,
    en
      ? `📊 Task statistics\n\nTotal tasks: ${row.total}\nCompleted: ${row.completed}\nOpen one-time: ${row.one_time}\nRecurring: ${row.weekly}\nRecurring completed today: ${doneToday?.count ?? 0}\nSkipped today: ${skippedToday?.count ?? 0}\n\n✅ Habit statistics\nActive habits: ${habitStats?.total ?? 0}\nHabit completions: ${habitStats?.completed ?? 0}\nHabit skips: ${habitStats?.skipped ?? 0}\nCompleted today: ${habitStats?.today_completed ?? 0}\n\nCompletion chart (last 7 days):\n${chart}`
      : `📊 آمار تسک‌ها\n\nکل تسک‌ها: ${row.total}\nتکمیل‌شده: ${row.completed}\nیک‌باره باز: ${row.one_time}\nتکرارشونده: ${row.weekly}\nتکرارشونده انجام‌شده امروز: ${doneToday?.count ?? 0}\nانجام‌نشده امروز: ${skippedToday?.count ?? 0}\n\n✅ آمار عادت‌ها\nعادت‌های فعال: ${habitStats?.total ?? 0}\nانجام عادت‌ها: ${habitStats?.completed ?? 0}\nعادت‌های انجام‌نشده: ${habitStats?.skipped ?? 0}\nانجام‌شده امروز: ${habitStats?.today_completed ?? 0}\n\nنمودار تکمیل ۷ روز اخیر:\n${chart}`,
    undefined);
}

function weekdayKeyboard(selected: number[], mode: "task" | "habit" = "task"): ReplyMarkup {
  const chosen = new Set(selected);
  const rows: InlineButton[][] = [];
  for (let index = 0; index < WEEKDAYS.length; index += 2) {
    rows.push(WEEKDAYS.slice(index, index + 2).map(([value, label]) => ({
      text: `${chosen.has(value) ? "✅ " : ""}${label}`,
      callback_data: `${mode === "habit" ? "habit" : "new"}:day:${value}`,
    })));
  }
  rows.push([{ text: "ثبت روزها", callback_data: mode === "habit" ? "habit:days_done" : "new:days_done" }]);
  return { inline_keyboard: rows };
}

async function showHabits(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const habits = await env.DB.prepare("SELECT id, title, weekdays FROM habits WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 30")
    .bind(userId).all<{ id: number; title: string; weekdays: string }>();
  if (!habits.results.length) {
    await sendMessage(env, chatId, en ? "You have no habits yet. Choose New habit to create one." : "هنوز عادتی ثبت نکرده‌ای. از «➕ عادت جدید» شروع کن.");
    return;
  }
  const weekday = tehranWeekday();
  await sendMessage(env, chatId, en ? "🪴 Your habits:" : "🪴 عادت‌های امروز:");
  for (const habit of habits.results) {
    const days = parseWeekdays(habit.weekdays);
    const scheduled = days.includes(weekday);
    const done = scheduled ? await env.DB.prepare("SELECT 1 FROM habit_completions WHERE habit_id = ? AND occurrence_date = ?")
      .bind(habit.id, tehranDate()).first() : null;
    const streak = await habitStreak(env.DB, habit.id, tehranDate());
    const actions: InlineButton[][] = [];
    if (scheduled && !done) actions.push([{ text: en ? "✅ Done" : "✅ انجام شد", callback_data: `habit:complete:${habit.id}` }, { text: en ? "⏭️ Skipped" : "⏭️ انجام نشد", callback_data: `habit:skip:${habit.id}` }]);
    actions.push([{ text: en ? "🗑 Delete" : "🗑 حذف", callback_data: `habit:delete:${habit.id}` }]);
    await sendMessage(env, chatId, `${done ? "✅" : scheduled ? "⬜" : "▫️"} ${escapeHtml(habit.title)}\n🔥 ${en ? "Current streak" : "زنجیره فعلی"}: ${streak}`, { inline_keyboard: actions });
  }
}

function deadlineKeyboard(): ReplyMarkup {
  const rows: InlineButton[][] = [
    [{ text: "تا آخر امشب (امروز ساعت ۲۳:۵۹)", callback_data: "new:quick:tonight" }],
    [{ text: "تا پایان فردا (فردا ساعت ۲۳:۵۹)", callback_data: "new:quick:tomorrow_end" }],
    [{ text: "امروز، انتخاب ساعت", callback_data: "new:quick:today" }, { text: "فردا، انتخاب ساعت", callback_data: "new:quick:tomorrow" }],
    [{ text: "انتخاب روز دیگر", callback_data: `new:date:${tehranDateOffset(2)}` }],
    [{ text: "بدون ددلاین", callback_data: "new:deadline:none" }],
  ];
  return { inline_keyboard: rows };
}

function hourKeyboard(): ReplyMarkup { return { inline_keyboard: Array.from({ length: 6 }, (_, row) => Array.from({ length: 4 }, (_, col) => { const hour = row * 4 + col; return { text: String(hour).padStart(2, "0"), callback_data: `new:hour:${String(hour).padStart(2, "0")}` }; })) }; }
function minuteKeyboard(): ReplyMarkup { return { inline_keyboard: [0, 15, 30, 45].map((minute) => [{ text: String(minute).padStart(2, "0"), callback_data: `new:minute:${String(minute).padStart(2, "0")}` }]) }; }
function tehranDateOffset(offset: number): string { const date = new Date(Date.now() + offset * 86400000); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }

async function habitStreak(db: D1Database, habitId: number, today: string): Promise<number> {
  const rows = await db.prepare("SELECT occurrence_date FROM habit_completions WHERE habit_id = ? ORDER BY occurrence_date DESC LIMIT 365").bind(habitId).all<{ occurrence_date: string }>();
  let streak = 0;
  let cursor = new Date(`${today}T00:00:00Z`);
  const dates = new Set(rows.results.map((row) => row.occurrence_date));
  while (dates.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor = new Date(cursor.getTime() - 86400000); }
  return streak;
}

async function showWeeklyPlan(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const tasks = await env.DB.prepare("SELECT title, kind, deadline, weekdays FROM tasks WHERE user_id = ? AND completed = 0 ORDER BY id DESC LIMIT 100")
    .bind(userId).all<{ title: string; kind: string; deadline: string | null; weekdays: string | null }>();
  const habits = await env.DB.prepare("SELECT title, weekdays FROM habits WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 100")
    .bind(userId).all<{ title: string; weekdays: string }>();
  const englishDays = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const lines = WEEKDAYS.map(([day, label], index) => {
    const dayTasks = tasks.results.filter((task) => task.kind === "weekly" ? parseWeekdays(task.weekdays).includes(day) : false).map((task) => `• ${task.title}`);
    const dayHabits = habits.results.filter((habit) => parseWeekdays(habit.weekdays).includes(day)).map((habit) => `✓ ${habit.title}`);
    return `<b>${en ? englishDays[index] : label}</b>\n${[...dayTasks, ...dayHabits].join("\n") || "—"}`;
  });
  const oneTime = tasks.results.filter((task) => task.kind === "one_time").map((task) => `• ${task.title} (${task.deadline ?? (en ? "no deadline" : "بدون ددلاین")})`);
  await sendMessage(env, chatId, `${en ? "📅 Weekly plan" : "📅 برنامه هفتگی"}\n\n${lines.join("\n\n")}${oneTime.length ? `\n\n<b>${en ? "One-time tasks" : "تسک‌های یک‌باره"}</b>\n${oneTime.join("\n")}` : ""}`);
}

async function ensureUser(db: D1Database, user: TelegramUser): Promise<number> {
  await db.prepare(
    `INSERT INTO users (telegram_id, username) VALUES (?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username`,
  ).bind(user.id, user.username ?? null).run();
  const row = await db.prepare("SELECT id FROM users WHERE telegram_id = ?").bind(user.id).first<{ id: number }>();
  if (!row) throw new Error("Failed to load user");
  return row.id;
}

async function getLanguage(db: D1Database, userId: number): Promise<"fa" | "en"> {
  const row = await db.prepare("SELECT language FROM users WHERE id = ?").bind(userId).first<{ language: string }>();
  return row?.language === "en" ? "en" : "fa";
}

async function createTask(db: D1Database, userId: number, data: SessionData, deadline: string | null): Promise<void> {
  if (!data.kind || !data.title || !data.priority) throw new Error("Incomplete task session");
  const weekdays = data.kind === "weekly" ? JSON.stringify(data.weekdays ?? []) : null;
  await db.prepare(
    "INSERT INTO tasks (user_id, title, priority, kind, deadline, weekdays) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(userId, data.title, data.priority, data.kind, deadline, weekdays).run();
}

async function completeTask(db: D1Database, userId: number, taskId: number, occurrenceDate: string): Promise<void> {
  const task = await db.prepare(
    "SELECT id, kind, deadline, priority FROM tasks WHERE id = ? AND user_id = ? AND completed = 0",
  ).bind(taskId, userId).first<{ id: number; kind: string; deadline: string | null; priority: "low" | "medium" | "high" }>();
  if (!task) return;
  if (task.kind === "one_time") {
    await db.prepare("UPDATE tasks SET completed = 1 WHERE id = ? AND user_id = ?").bind(taskId, userId).run();
    if (task.deadline !== null) await db.prepare("UPDATE users SET xp = xp + ?, consecutive_task_misses = 0 WHERE id = ?").bind(taskXp(task.priority), userId).run();
  } else {
    const result = await db.prepare(
      `INSERT INTO task_completions (task_id, user_id, occurrence_date) VALUES (?, ?, ?)
       ON CONFLICT(task_id, occurrence_date) DO NOTHING`,
    ).bind(taskId, userId, occurrenceDate).run();
    if (result.meta.changes > 0) await db.prepare("UPDATE users SET xp = xp + ?, consecutive_task_misses = 0 WHERE id = ?").bind(taskXp(task.priority), userId).run();
  }
}

function taskXp(priority: "low" | "medium" | "high"): number {
  return priority === "high" ? 6 : priority === "medium" ? 4 : 2;
}

async function showLeaderboard(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const rows = await env.DB.prepare("SELECT telegram_id, username, display_name, xp FROM users ORDER BY xp DESC, id ASC LIMIT 20").all<{ telegram_id: number; username: string | null; display_name: string | null; xp: number }>();
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.results.map((row, index) => {
    const rawName = row.display_name || (row.username ? `@${row.username}` : `User ${row.telegram_id}`);
    const name = escapeHtml(rawName);
    const directionalName = en ? `\u200E${name}\u200E` : `\u200F${name}\u200F`;
    return `${medals[index] ?? `🔹 ${index + 1}`} <b>${directionalName}</b>  <code>${row.xp} XP</code>`;
  });
  const title = en ? "🏆 <b>XP Leaderboard</b>\n<i>Top performers</i>" : "🏆 <b>لیدربرد XP</b>\n<i>برترین کاربران</i>";
  await sendMessage(env, chatId, `${title}\n\n${lines.join("\n") || (en ? "No users yet." : "هنوز کاربری ثبت نشده است.")}`);
}

async function getSession(db: D1Database, userId: number): Promise<{ state: string; data: string } | null> {
  return db.prepare("SELECT state, data FROM sessions WHERE user_id = ?").bind(userId).first();
}

async function setSession(db: D1Database, userId: number, state: string, data: SessionData): Promise<void> {
  await db.prepare(
    `INSERT INTO sessions (user_id, state, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, data = excluded.data,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(userId, state, JSON.stringify(data)).run();
}

async function clearSession(db: D1Database, userId: number): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

async function sendMessage(env: Env, chatId: number, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function answerCallback(env: Env, callbackQueryId: string): Promise<void> {
  await telegram(env, "answerCallbackQuery", { callback_query_id: callbackQueryId });
}

async function editMarkup(env: Env, chatId: number, messageId: number, replyMarkup: ReplyMarkup): Promise<void> {
  await telegram(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

async function telegram(env: Env, method: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json<TelegramResult>();
  if (!result.ok) throw new Error(`Telegram ${method} failed: ${result.description ?? response.status}`);
}

function isAllowed(telegramId: number, configured: string): boolean {
  try {
    const ids = JSON.parse(configured) as unknown;
    return Array.isArray(ids) && (ids.length === 0 || ids.some((id) => Number(id) === telegramId));
  } catch {
    return false;
  }
}

function normalizeDigits(value: string): string {
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  return [...value].map((char) => {
    const p = persian.indexOf(char);
    if (p >= 0) return String(p);
    const a = arabic.indexOf(char);
    return a >= 0 ? String(a) : char;
  }).join("");
}

function parseLocalDeadline(value: string): string | null {
  const normalized = value.trim().replaceAll("/", ".").replaceAll("-", ".");
  const match = /^(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText ?? new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", year: "numeric" }).format(new Date()));
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day || hour > 23 || minute > 59
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseWeekdays(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(Number).filter((day) => day >= 1 && day <= 7) : [];
  } catch {
    return [];
  }
}

function formatWeekdays(days: number[]): string {
  const labels = new Map<number, string>(WEEKDAYS);
  return days.map((day) => labels.get(day)).filter(Boolean).join("، ");
}

function tehranDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function tehranWeekday(): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", weekday: "short" }).format(new Date());
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[short] ?? 1;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function secretsEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0 && left.length === right.length;
}
