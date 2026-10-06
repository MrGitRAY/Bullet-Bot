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
  taskId?: number;
  renameType?: "task" | "habit";
  renameId?: number;
};

type TaskRow = {
  id: number;
  title: string;
  priority: "low" | "medium" | "high";
  kind: "one_time" | "weekly";
  deadline: string | null;
  weekdays: string | null;
  completed: number;
  doneToday?: number;
  skippedToday?: number;
};

type TelegramResult = { ok: boolean; description?: string };
type InlineButton = { text: string; callback_data: string };
type ReplyMarkup = {
  inline_keyboard?: InlineButton[][];
  keyboard?: { text: string }[][];
  resize_keyboard?: boolean;
};

const MENU = {
  inline_keyboard: [[{ text: "📒 برنامه امروز", callback_data: "menu:today" }, { text: "📅 برنامه هفتگی", callback_data: "menu:week" }], [{ text: "➕ تسک جدید", callback_data: "menu:task" }, { text: "📋 همه تسک‌ها", callback_data: "menu:all" }], [{ text: "➕ عادت جدید", callback_data: "menu:habit" }, { text: "🌱 همه عادت‌ها", callback_data: "menu:habits" }], [{ text: "📊 آمار", callback_data: "menu:stats" }, { text: "🏆 لیدربرد", callback_data: "menu:leaderboard" }], [{ text: "راهنما", callback_data: "menu:help" }, { text: "⚙️ تنظیمات", callback_data: "menu:settings" }]],
} satisfies ReplyMarkup;

const MENU_EN: ReplyMarkup = {
  inline_keyboard: [[{ text: "📒 Today's Plan", callback_data: "menu:today" }, { text: "📅 Weekly Plan", callback_data: "menu:week" }], [{ text: "➕ New task", callback_data: "menu:task" }, { text: "📋 All tasks", callback_data: "menu:all" }], [{ text: "➕ New habit", callback_data: "menu:habit" }, { text: "🌱 All habits", callback_data: "menu:habits" }], [{ text: "📊 Reports", callback_data: "menu:stats" }, { text: "🏆 Leaderboard", callback_data: "menu:leaderboard" }], [{ text: "Help", callback_data: "menu:help" }, { text: "⚙️ Settings", callback_data: "menu:settings" }]],
};

const BOTTOM_MENU: ReplyMarkup = { keyboard: [[{ text: "📒 برنامه امروز" }, { text: "📅 برنامه هفتگی" }], [{ text: "➕ تسک جدید" }, { text: "📋 همه تسک‌ها" }], [{ text: "➕ عادت جدید" }, { text: "🌱 همه عادت‌ها" }], [{ text: "📊 آمار" }, { text: "🏆 لیدربرد" }], [{ text: "راهنما" }, { text: "⚙️ تنظیمات" }]], resize_keyboard: true };
const BOTTOM_MENU_EN: ReplyMarkup = { keyboard: [[{ text: "📒 Today's Plan" }, { text: "📅 Weekly Plan" }], [{ text: "➕ New task" }, { text: "📋 All tasks" }], [{ text: "➕ New habit" }, { text: "🌱 All habits" }], [{ text: "📊 Reports" }, { text: "🏆 Leaderboard" }], [{ text: "Help" }, { text: "⚙️ Settings" }]], resize_keyboard: true };

const PRIORITIES: Record<string, string> = {
  low: "🟢",
  medium: "🟡",
  high: "🔴",
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
    await sendMessage(env, message.chat.id, language === "en" ? "Quick menu:" : "منوی سریع:", language === "en" ? BOTTOM_MENU_EN : BOTTOM_MENU);
    return;
  }
  if (["/name", "✏️ تغییر نام", "✏️ Change name"].includes(text)) {
    await setSession(env.DB, userId, "await_display_name", {});
    await sendMessage(env, message.chat.id, language === "en" ? "Send your new display name:" : "نام نمایشی جدیدت را بفرست:");
    return;
  }
  if (["/help", "راهنما", "Help"].includes(text)) {
    const help = language === "en"
      ? "<b>Menu guide</b>\n\n📒 Today's Plan — execute today's tasks and habits\n📅 Weekly Plan — view the weekly schedule\n➕ New task — create a task\n📋 All tasks — manage open tasks\n➕ New habit — create a daily habit\n🌱 All habits — manage habits\n📊 Reports — tasks, habits and chart\n⚙️ Settings — profile and language\n\n────────────\n\n<b>XP rules</b>\n• High priority task: 6 XP\n• Medium priority task: 4 XP\n• Low priority task: 2 XP\n• No-deadline tasks: 1 XP low, 2 XP medium, 3 XP high\n• Miss penalties: -3, -2, then -1 XP for consecutive misses\n• Habit chain rewards: 1, 2, 3, 4, then 5 XP per day\n• Breaking a habit chain deducts 2 XP\n• Repeating the same action on the same day gives XP once"
      : "<b>----- راهنما -----</b>\n\n<b>گزینه های منو</b>\n📒 برنامه امروز — نمایش تسک و عادت‌های امروز\n📅 برنامه هفتگی — نمایش برنامه هفته\n➕ تسک جدید — ساخت تسک\n📋 همه تسک‌ها — مدیریت تسک‌ها\n➕ عادت جدید — ساخت عادت روزانه\n🌱 همه عادت‌ها — مدیریت عادت‌ها\n📊 گزارش‌ها — مشاهده پیشرفت\n🏆 لیدربرد — رتبه‌بندی بر اساس امتیاز\n⚙️ تنظیمات — نام و زبان\n\n\u200F────────────\u200F\n\n\u200F<b>قوانین کسب امتیاز</b>\u200F\n• تسک با اهمیت بالا: 6 امتیاز\n• تسک با اهمیت متوسط: 4امتیاز\n• تسک با اهمیت کم: 2 امتیاز\n• تسک بدون ددلاین: کم 1، متوسط 2، زیاد 3 امتیاز\n• جریمه: به ازای انجام ندادن تسک با اهمیت بالا، متوسط، کم به ترتیب 3، 2، 1 امتیاز منفی\n• پاداش زنجیره برای هر عادت به ازای روز اول 1 امتیاز، روز دوم 2 امتیاز و به همین ترتیب. روز پنجم به بعد هر روز 5 امتیاز.\n• هر بار شکستن زنجیره برای هر عادت 2 امتیاز منفی";
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
    await showDailyPlan(env, message.chat.id, userId);
    return;
  }
  if (["📋 همه تسک‌ها", "🗂 همه تسک‌ها", "📋 All tasks", "🗂 All tasks", "/tasks"].includes(text)) {
    await showTasks(env, message.chat.id, userId, false);
    return;
  }
  if (["🌱 همه عادت‌ها", "🌱 All habits"].includes(text)) { await showHabits(env, message.chat.id, userId); return; }
  if (["⚙️ تنظیمات", "⚙️ Settings"].includes(text)) {
    await showSettings(env, message.chat.id, userId);
    return;
  }
  if (["📊 آمار", "📊 Reports", "📊 Statistics", "/stats"].includes(text)) {
    await showStats(env, message.chat.id, userId);
    return;
  }
  if (["➕ عادت جدید", "➕ New habit", "✅ عادت جدید", "🟢➕ عادت جدید", "✅ New habit", "🟢➕ New habit", "/habit"].includes(text)) {
    await startHabitCreation(env, message.chat.id, userId);
    return;
  }
  if (["✅ عادت‌ها", "📋 عادت‌ها", "✅ Habits", "📋 Habits", "/habits"].includes(text)) {
    await showHabits(env, message.chat.id, userId);
    return;
  }
  if (["📅 برنامه هفتگی", "📅 Weekly Plan", "📅 Weekly plan", "/week"].includes(text)) {
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
  if (session.state === "await_rename") {
    if (text.length < 1 || text.length > 500) {
      await sendMessage(env, message.chat.id, language === "en" ? "Name must be between 1 and 500 characters." : "نام باید بین ۱ تا ۵۰۰ نویسه باشد.");
      return;
    }
    const table = data.renameType === "habit" ? "habits" : "tasks";
    await env.DB.prepare(`UPDATE ${table} SET title = ? WHERE id = ? AND user_id = ?${table === "habits" ? " AND active = 1" : ""}`).bind(text, data.renameId, userId).run();
    await clearSession(env.DB, userId);
    await sendMessage(env, message.chat.id, language === "en" ? "✅ Name updated." : "✅ نام با موفقیت تغییر کرد.");
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
    const deadline = parseLocalDeadline((data.deadlineDate ?? "") + " " + text);
    const en = language === "en";
    if (!deadline) {
      await sendMessage(env, message.chat.id, en ? "Invalid time. Send HH:MM, for example 20:00." : "ساعت معتبر نیست. به شکل ساعت:دقیقه بفرست؛ مثلاً 20:00.");
      return;
    }
    await createTask(env.DB, userId, data, deadline);
    await clearSession(env.DB, userId);
    const calendar = await getCalendar(env.DB, userId);
    await sendMessage(env, message.chat.id, en ? "✅ Task saved with deadline " + formatDeadline(deadline, en, calendar) : "✅ تسک با ددلاین " + formatDeadline(deadline, en, calendar) + " ذخیره شد.");
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
    else if (action === "settings") {
      await showSettings(env, chatId, userId);
    }
    else if (action === "name") { await setSession(env.DB, userId, "await_display_name", {}); await sendMessage(env, chatId, "نام نمایشی جدیدت را بفرست:"); }
    else if (action === "language") await sendMessage(env, chatId, "زبان / Language:", { inline_keyboard: [[{ text: "English", callback_data: "lang:en" }, { text: "فارسی", callback_data: "lang:fa" }]] });
    else if (action === "help") {
      const en = (await getLanguage(env.DB, userId)) === "en";
      await sendMessage(env, chatId, en ? "<b>Menu guide</b>\n\n📒 Today's Plan — execute today's tasks and habits\n📅 Weekly Plan — view the weekly schedule\n➕ New task — create a task\n📋 All tasks — manage open tasks\n➕ New habit — create a daily habit\n🌱 All habits — manage habits\n📊 Reports — tasks, habits and chart\n⚙️ Settings — profile and language\n\n────────────\n\n<b>XP rules</b>\n• High priority task: 6 XP\n• Medium priority task: 4 XP\n• Low priority task: 2 XP\n• No-deadline tasks: 1 XP low, 2 XP medium, 3 XP high\n• Miss penalties: -3, -2, then -1 XP for consecutive misses\n• Habit chain rewards: 1, 2, 3, 4, then 5 XP per day\n• Breaking a habit chain deducts 2 XP\n• Repeating the same action on the same day gives XP once" : "<b>----- راهنما -----</b>\n\n<b>گزینه های منو</b>\n📒 برنامه امروز — نمایش تسک و عادت‌های امروز\n📅 برنامه هفتگی — نمایش برنامه هفته\n➕ تسک جدید — ساخت تسک\n📋 همه تسک‌ها — مدیریت تسک‌ها\n➕ عادت جدید — ساخت عادت روزانه\n🌱 همه عادت‌ها — مدیریت عادت‌ها\n📊 گزارش‌ها — مشاهده پیشرفت\n🏆 لیدربرد — رتبه‌بندی بر اساس امتیاز\n⚙️ تنظیمات — نام و زبان\n\n\u200F────────────\u200F\n\n\u200F<b>قوانین کسب امتیاز</b>\u200F\n• تسک با اهمیت بالا: 6 امتیاز\n• تسک با اهمیت متوسط: 4امتیاز\n• تسک با اهمیت کم: 2 امتیاز\n• تسک بدون ددلاین: کم 1، متوسط 2، زیاد 3 امتیاز\n• جریمه: به ازای انجام ندادن تسک با اهمیت بالا، متوسط، کم به ترتیب 3، 2، 1 امتیاز منفی\n• پاداش زنجیره برای هر عادت به ازای روز اول 1 امتیاز، روز دوم 2 امتیاز و به همین ترتیب. روز پنجم به بعد هر روز 5 امتیاز.\n• هر بار شکستن زنجیره برای هر عادت 2 امتیاز منفی");
    }
    return;
  }

  if (data.startsWith("lang:")) {
    const language = data.slice(5) === "en" ? "en" : "fa";
    await env.DB.prepare("UPDATE users SET language = ? WHERE id = ?").bind(language, userId).run();
    await sendMessage(env, chatId, language === "en" ? "✅ Language changed to English." : "✅ زبان به فارسی تغییر کرد.");
    await sendMessage(env, chatId, language === "en" ? "Quick menu:" : "منوی سریع:", language === "en" ? BOTTOM_MENU_EN : BOTTOM_MENU);
    return;
  }

  if (data.startsWith("calendar:set:")) {
    const calendar = data.slice("calendar:set:".length) === "persian" ? "persian" : "gregorian";
    await env.DB.prepare("UPDATE users SET calendar = ? WHERE id = ?").bind(calendar, userId).run();
    await showSettings(env, chatId, userId, true);
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
      const en = (await getLanguage(env.DB, userId)) === "en";
      const calendar = await getCalendar(env.DB, userId);
      await sendMessage(env, chatId, en ? "Choose a deadline date or a quick option:" : "روز ددلاین یا گزینه سریع را انتخاب کن:", deadlineKeyboard(en, calendar));
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
  if (data === "new:noop") return;
  if (data.startsWith("new:calendar:")) {
    const parts = data.split(":");
    const direction = parts.length > 3 ? parts[2] : "";
    const monthKey = parts.length > 3 ? parts[3] : parts[2];
    let selectedMonth = monthKey;
    const calendar = await getCalendar(env.DB, userId);
    if (direction === "prev" || direction === "next") selectedMonth = shiftMonth(monthKey, direction === "prev" ? -1 : 1, calendar);
    if (query.message) await editMarkup(env, chatId, query.message.message_id, calendarKeyboard(selectedMonth, (await getLanguage(env.DB, userId)) === "en", calendar));
    return;
  }
  if (data.startsWith("new:quick:")) {
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_deadline_date") return;
    const quick = data.slice("new:quick:".length);
    const date = tehranDateOffset(quick === "tomorrow" || quick === "tomorrow_end" ? 1 : 0);
    const sessionData = JSON.parse(session.data) as SessionData;
    sessionData.deadlineDate = date;
    const en = (await getLanguage(env.DB, userId)) === "en";
    const calendar = await getCalendar(env.DB, userId);
    if (quick === "tonight" || quick === "tomorrow_end") {
      await createTask(env.DB, userId, sessionData, date + " 23:59");
      await clearSession(env.DB, userId);
      await sendMessage(env, chatId, en ? "✅ Task saved with deadline " + formatDeadline(date + " 23:59", en, calendar) : "✅ تسک با ددلاین " + formatDeadline(date + " 23:59", en, calendar) + " ذخیره شد.");
    } else {
      await setSession(env.DB, userId, "await_deadline_time", sessionData);
      await sendMessage(env, chatId, en ? "Send the deadline time in HH:MM format." : "ساعت ددلاین را به شکل ساعت:دقیقه بفرست (مثلاً 20:00).");
    }
    return;
  }
  if (data.startsWith("new:date:")) {
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_deadline_date") return;
    const sessionData = JSON.parse(session.data) as SessionData;
    sessionData.deadlineDate = data.slice("new:date:".length);
    await setSession(env.DB, userId, "await_deadline_time", sessionData);
    const en = (await getLanguage(env.DB, userId)) === "en";
    await sendMessage(env, chatId, en ? "Send the deadline time in HH:MM format." : "ساعت ددلاین را به شکل ساعت:دقیقه بفرست (مثلاً 20:00).");
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
  if (data.startsWith("habit:rename:")) {
    const habitId = Number(data.split(":")[2]);
    await setSession(env.DB, userId, "await_rename", { renameType: "habit", renameId: habitId });
    await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Send the new habit name:" : "نام جدید عادت را بفرست:");
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
  if (data.startsWith("task:editdays:")) {
    const taskId = Number(data.split(":")[2]);
    const task = await env.DB.prepare("SELECT weekdays FROM tasks WHERE id = ? AND user_id = ? AND kind = 'weekly' AND completed = 0").bind(taskId, userId).first<{ weekdays: string | null }>();
    if (!task) return;
    const weekdays = parseWeekdays(task.weekdays);
    await setSession(env.DB, userId, "await_task_days", { taskId, weekdays });
    const en = (await getLanguage(env.DB, userId)) === "en";
    await sendMessage(env, chatId, en ? "Choose the recurring days:" : "روزهای انجام این تسک را انتخاب کن:", weekdayKeyboard(weekdays, "task_edit"));
    return;
  }
  if (data.startsWith("task:editday:")) {
    const day = Number(data.split(":")[2]);
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_task_days" || day < 1 || day > 7) return;
    const sessionData = JSON.parse(session.data) as SessionData;
    const selected = new Set(sessionData.weekdays ?? []);
    selected.has(day) ? selected.delete(day) : selected.add(day);
    sessionData.weekdays = [...selected].sort();
    await setSession(env.DB, userId, "await_task_days", sessionData);
    if (query.message) await editMarkup(env, chatId, query.message.message_id, weekdayKeyboard(sessionData.weekdays, "task_edit"));
    return;
  }
  if (data === "task:editdays_done") {
    const session = await getSession(env.DB, userId);
    const sessionData = session ? JSON.parse(session.data) as SessionData : {};
    if (!session || session.state !== "await_task_days" || !sessionData.taskId || !sessionData.weekdays?.length) {
      await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Choose at least one day." : "حداقل یک روز را انتخاب کن.");
      return;
    }
    await env.DB.prepare("UPDATE tasks SET weekdays = ? WHERE id = ? AND user_id = ? AND kind = 'weekly' AND completed = 0")
      .bind(JSON.stringify(sessionData.weekdays), sessionData.taskId, userId).run();
    await clearSession(env.DB, userId);
    await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "✅ Task days updated." : "✅ روزهای تسک به‌روزرسانی شد.");
    return;
  }
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
    return;
  }
  if (data.startsWith("task:rename:")) {
    const taskId = Number(data.split(":")[2]);
    await setSession(env.DB, userId, "await_rename", { renameType: "task", renameId: taskId });
    await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Send the new task name:" : "نام جدید تسک را بفرست:");
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

async function sendSummary(env: Env, chatId: number, title: string, entries: string[], emptyText: string): Promise<void> {
  if (!entries.length) {
    await sendMessage(env, chatId, title + (emptyText ? "\n" + emptyText : ""));
    return;
  }
  let message = title;
  for (const entry of entries) {
    if (message.length + entry.length + 2 > 3500 && message !== title) {
      await sendMessage(env, chatId, message);
      message = title + "\n<i>" + (title.includes("برنامه") || title.includes("همه") ? "ادامه" : "continued") + "</i>";
    }
    message += "\n\n" + entry;
  }
  await sendMessage(env, chatId, message);
}
async function showTasks(env: Env, chatId: number, userId: number, todayOnly: boolean): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const calendar = await getCalendar(env.DB, userId);
  const today = tehranDate();
  const weekday = tehranWeekday();
  const result = await env.DB.prepare(
    "SELECT t.id, t.title, t.priority, t.kind, t.deadline, t.weekdays, t.completed, " +
    "EXISTS (SELECT 1 FROM task_completions c WHERE c.task_id = t.id AND c.occurrence_date = ?) AS doneToday, " +
    "EXISTS (SELECT 1 FROM task_skips s WHERE s.task_id = t.id AND s.occurrence_date = ?) AS skippedToday " +
    "FROM tasks t WHERE t.user_id = ? AND (t.kind = 'weekly' OR (t.kind = 'one_time' AND t.completed = 0)) " +
    "ORDER BY t.deadline IS NULL, t.deadline, t.id",
  ).bind(today, today, userId).all<TaskRow>();
  const tasks = result.results.filter((task) => !todayOnly ||
    ((task.kind === "one_time" || parseWeekdays(task.weekdays).includes(weekday)) && !task.doneToday && !task.skippedToday));
  const title = todayOnly ? (en ? "📋 Today's Open tasks" : "📋 تسک‌های باز امروز") : (en ? "🗂 All tasks" : "🗂 همه تسک‌ها");
  if (!tasks.length) {
    await sendMessage(env, chatId, title + "\n" + (en ? "No tasks to show. ✨" : "تسکی برای نمایش وجود ندارد. ✨"));
    return;
  }
  const summary = tasks.map((task) => {
    const details = task.kind === "one_time"
      ? (task.deadline ? (en ? "Deadline: " : "ددلاین: ") + formatDeadline(task.deadline, en, calendar) : (en ? "No deadline" : "بدون ددلاین"))
      : (en ? "Days: " : "روزها: ") + formatWeekdays(parseWeekdays(task.weekdays));
    const closed = task.doneToday || task.skippedToday
      ? "\n" + (en ? "Today's status: " : "وضعیت امروز: ") + (task.doneToday ? (en ? "Done" : "انجام شد") : (en ? "Skipped" : "انجام‌نشده"))
      : "";
    return PRIORITIES[task.priority] + " " + escapeHtml(shorten(task.title, 70)) + "\n<blockquote>" + details + closed + "</blockquote>";
  });
  await sendSummary(env, chatId, "<b>" + title + " (" + tasks.length + ")</b>", summary, en ? "No tasks to show." : "تسکی برای نمایش نیست.");
  for (const task of tasks) {
    const scheduledToday = task.kind === "one_time" || parseWeekdays(task.weekdays).includes(weekday);
    const closedToday = Boolean(task.doneToday || task.skippedToday);
    const schedule = task.kind === "one_time"
      ? (en ? "Deadline: " : "ددلاین: ") + (task.deadline ? formatDeadline(task.deadline, en, calendar) : (en ? "No deadline" : "بدون ددلاین"))
      : (en ? "Days: " : "روزها: ") + formatWeekdays(parseWeekdays(task.weekdays));
    const actions: InlineButton[][] = [];
    if (scheduledToday && !closedToday) actions.push([
      { text: en ? "✅ Done" : "✅ انجام شد", callback_data: "task:complete:" + task.id },
      { text: en ? "⏭️ Skipped" : "⏭️ انجام نشد", callback_data: "task:skip:" + task.id },
    ]);
    actions.push([
      { text: en ? "🗑 Delete" : "🗑 حذف", callback_data: "task:delete:" + task.id },
      { text: en ? "✏️ Rename" : "✏️ تغییر نام", callback_data: "task:rename:" + task.id },
    ]);
    if (task.kind === "weekly") actions.push([{ text: en ? "📅 Change days" : "📅 تغییر روزها", callback_data: "task:editdays:" + task.id }]);
    const status = closedToday ? "\n" + (en ? "Today's status: " : "وضعیت امروز: ") + (task.doneToday ? (en ? "Done" : "انجام شد") : (en ? "Skipped" : "انجام‌نشده")) : "";
    await sendMessage(env, chatId,
      PRIORITIES[task.priority] + " " + escapeHtml(task.title) + "\n<blockquote>" + schedule + status + "</blockquote>",
      { inline_keyboard: actions },
    );
  }
}
async function showDailyPlan(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const calendar = await getCalendar(env.DB, userId);
  const today = tehranDate();
  const weekday = tehranWeekday();
  const tasks = await env.DB.prepare(
    "SELECT t.id, t.title, t.priority, t.kind, t.deadline, t.weekdays, t.completed, " +
    "EXISTS (SELECT 1 FROM task_completions c WHERE c.task_id = t.id AND c.occurrence_date = ?) AS doneToday, " +
    "EXISTS (SELECT 1 FROM task_skips s WHERE s.task_id = t.id AND s.occurrence_date = ?) AS skippedToday " +
    "FROM tasks t WHERE t.user_id = ? AND (t.kind = 'weekly' OR (t.kind = 'one_time' AND t.completed = 0)) " +
    "ORDER BY t.deadline IS NULL, t.deadline, t.id",
  ).bind(today, today, userId).all<TaskRow>();
  const habits = await env.DB.prepare("SELECT id, title FROM habits WHERE user_id = ? AND active = 1 ORDER BY id").bind(userId).all<{ id: number; title: string }>();
  const habitStates = await Promise.all(habits.results.map(async (habit) => {
    const done = await env.DB.prepare("SELECT 1 FROM habit_completions WHERE habit_id = ? AND occurrence_date = ?").bind(habit.id, today).first();
    const skipped = await env.DB.prepare("SELECT 1 FROM habit_skips WHERE habit_id = ? AND occurrence_date = ?").bind(habit.id, today).first();
    const streak = await habitStreak(env.DB, habit.id, today);
    return { ...habit, done: Boolean(done), skipped: Boolean(skipped), streak };
  }));
  const activeToday = (task: TaskRow) => {
    const scheduled = task.kind === "weekly"
      ? parseWeekdays(task.weekdays).includes(weekday)
      : Boolean(task.deadline && task.deadline.slice(0, 10) === today);
    return scheduled && !task.doneToday && !task.skippedToday;
  };
  const dailyTasks = tasks.results.filter((task) =>
    task.kind === "one_time" || parseWeekdays(task.weekdays).includes(weekday),
  );
  const activeWeeklyAndDue = dailyTasks.filter((task) =>
    (task.kind === "weekly" || Boolean(task.deadline && task.deadline.slice(0, 10) === today)) && activeToday(task),
  );
  const noDeadlineOneTime = tasks.results.filter((task) => task.kind === "one_time" && task.deadline === null && !task.doneToday && !task.skippedToday);
  const openHabits = habitStates.filter((habit) => !habit.done && !habit.skipped);
  const summaryTasks = dailyTasks.map((task) => {
    const details = task.kind === "weekly"
      ? (en ? "Weekly · " : "هفتگی · ") + formatWeekdays(parseWeekdays(task.weekdays))
      : task.deadline ? (en ? "Deadline · " : "ددلاین · ") + formatDeadline(task.deadline, en, calendar) : (en ? "No deadline" : "بدون ددلاین");
    return PRIORITIES[task.priority] + " " + escapeHtml(shorten(task.title, 55)) + "\n<blockquote>" + details + "</blockquote>";
  });
  const summaryHabits = habitStates.map((habit) =>
    "🌱 " + escapeHtml(shorten(habit.title, 55)) + "\n<blockquote>" +
    (habit.done ? (en ? "✅ Done today" : "✅ امروز انجام‌شده")
      : habit.skipped ? (en ? "⏭️ Skipped today" : "⏭️ امروز انجام‌نشده")
      : (en ? "⬜ Not done today" : "⬜ امروز انجام نشده")) + "\n" +
    (en ? "Current streak: " : "زنجیره فعلی: ") + habit.streak +
    "</blockquote>",
  );
  const summaryEntries = [
    "📋 <b>" + (en ? "Tasks" : "تسک‌ها") + " (" + dailyTasks.length + ")</b>",
    ...(summaryTasks.length ? summaryTasks : [en ? "No tasks." : "تسکی ثبت نشده است."]),
    "🌱 <b>" + (en ? "Habits" : "عادت‌ها") + " (" + habitStates.length + ")</b>",
    ...(summaryHabits.length ? summaryHabits : [en ? "No habits." : "عادتی ثبت نشده است."]),
  ];
  await sendSummary(env, chatId, en ? "📒 <b>Today's Plan — overview</b>" : "📒 <b>برنامه امروز — خلاصه</b>", summaryEntries, "");

  await sendMessage(env, chatId, en
    ? "📋 <b>Open weekly and due-today tasks (" + activeWeeklyAndDue.length + ")</b>"
    : "📋 <b>تسک‌های هفتگی و ددلاین‌دارِ امروز (" + activeWeeklyAndDue.length + ")</b>");
  if (!activeWeeklyAndDue.length) await sendMessage(env, chatId, en ? "Nothing to check off here." : "موردی برای تیک‌زدن نیست.");
  for (const task of activeWeeklyAndDue) {
    const details = task.kind === "weekly"
      ? (en ? "Weekly · " : "هفتگی · ") + formatWeekdays(parseWeekdays(task.weekdays))
      : (en ? "Deadline · " : "ددلاین · ") + formatDeadline(task.deadline!, en, calendar);
    await sendMessage(env, chatId,
      PRIORITIES[task.priority] + " " + escapeHtml(task.title) + "\n<blockquote>" + details + "</blockquote>",
      { inline_keyboard: [[{ text: en ? "✅ Complete" : "✅ انجام شد", callback_data: "task:complete:" + task.id }, { text: en ? "⏭️ Skip" : "⏭️ انجام نشد", callback_data: "task:skip:" + task.id }]] },
    );
  }

  await sendMessage(env, chatId, en
    ? "📝 <b>One-time tasks without a deadline (" + noDeadlineOneTime.length + ")</b>"
    : "📝 <b>تسک‌های یک‌باره بدون ددلاین (" + noDeadlineOneTime.length + ")</b>");
  if (!noDeadlineOneTime.length) await sendMessage(env, chatId, en ? "No open tasks without a deadline." : "تسک بازِ بدون ددلاین نداری.");
  for (const task of noDeadlineOneTime) {
    await sendMessage(env, chatId,
      PRIORITIES[task.priority] + " " + escapeHtml(task.title) + "\n<blockquote>" + (en ? "One-time · No deadline" : "یک‌باره · بدون ددلاین") + "</blockquote>",
      { inline_keyboard: [[{ text: en ? "✅ Complete" : "✅ انجام شد", callback_data: "task:complete:" + task.id }, { text: en ? "⏭️ Skip" : "⏭️ انجام نشد", callback_data: "task:skip:" + task.id }]] },
    );
  }

  await sendMessage(env, chatId, en ? "🌱 <b>Habits (" + openHabits.length + " open)</b>" : "🌱 <b>عادت‌ها (" + openHabits.length + " باز)</b>");
  if (!openHabits.length) await sendMessage(env, chatId, en ? "No open habits today." : "عادت بازی برای امروز نداری.");
  for (const habit of openHabits) {
    await sendMessage(env, chatId,
      "🌱 " + escapeHtml(habit.title) + "\n<blockquote>" + (en ? "⬜ Not done today" : "⬜ امروز انجام نشده") + "\n" +
      (en ? "Current streak: " : "زنجیره فعلی: ") + habit.streak + "</blockquote>",
      { inline_keyboard: [[{ text: en ? "✅ Done" : "✅ انجام شد", callback_data: "habit:complete:" + habit.id }, { text: en ? "⏭️ Skip" : "⏭️ انجام نشد", callback_data: "habit:skip:" + habit.id }]] },
    );
  }
}
async function startHabitCreation(env: Env, chatId: number, userId: number): Promise<void> {
  await setSession(env.DB, userId, "await_habit_title", {});
  await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Send the daily habit name (for example: Read 20 minutes):" : "نام عادت روزانه را بفرست (مثلاً: مطالعه ۲۰ دقیقه):");
}

async function showStats(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const today = tehranDate();
  const weekday = tehranWeekday();
  const taskTotals = await env.DB.prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN kind = 'one_time' AND completed = 1 THEN 1 ELSE 0 END), 0) AS completedOneTime FROM tasks WHERE user_id = ?",
  ).bind(userId).first<{ total: number; completedOneTime: number }>();
  const weeklyDone = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM task_completions c JOIN tasks t ON t.id = c.task_id WHERE c.user_id = ? AND t.kind = 'weekly'",
  ).bind(userId).first<{ count: number }>();
  const taskMissed = await env.DB.prepare("SELECT COUNT(*) AS count FROM task_skips WHERE user_id = ?").bind(userId).first<{ count: number }>();
  const taskDoneToday = await env.DB.prepare("SELECT COUNT(*) AS count FROM task_completions WHERE user_id = ? AND occurrence_date = ?").bind(userId, today).first<{ count: number }>();
  const taskSkippedToday = await env.DB.prepare("SELECT COUNT(*) AS count FROM task_skips WHERE user_id = ? AND occurrence_date = ?").bind(userId, today).first<{ count: number }>();
  const taskOpenToday = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM tasks t WHERE t.user_id = ? AND ((t.kind = 'one_time' AND t.completed = 0) OR (t.kind = 'weekly' AND EXISTS (SELECT 1 FROM json_each(t.weekdays) WHERE value = ?))) AND NOT EXISTS (SELECT 1 FROM task_completions c WHERE c.task_id = t.id AND c.occurrence_date = ?) AND NOT EXISTS (SELECT 1 FROM task_skips s WHERE s.task_id = t.id AND s.occurrence_date = ?)",
  ).bind(userId, weekday, today, today).first<{ count: number }>();
  const completedTasks = (taskTotals?.completedOneTime ?? 0) + (weeklyDone?.count ?? 0);
  const totalTasks = taskTotals?.total ?? 0;
  const taskAttempts = Math.max(totalTasks, completedTasks + (taskMissed?.count ?? 0));
  const taskRate = taskAttempts ? Math.round((completedTasks / taskAttempts) * 100) : 0;
  const habitCounts = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM habits WHERE user_id = ? AND active = 1) AS total, (SELECT COUNT(*) FROM habit_completions WHERE user_id = ? AND occurrence_date = ?) AS doneToday, (SELECT COUNT(*) FROM habit_skips WHERE user_id = ? AND occurrence_date = ?) AS skippedToday",
  ).bind(userId, userId, today, userId, today).first<{ total: number; doneToday: number; skippedToday: number }>();
  const habits = await env.DB.prepare("SELECT id, title FROM habits WHERE user_id = ? AND active = 1 ORDER BY id").bind(userId).all<{ id: number; title: string }>();
  const habitMetrics = await Promise.all(habits.results.map(async (habit) => {
    const streak = await habitStreak(env.DB, habit.id, today);
    const bestStreak = await habitBestStreak(env.DB, habit.id);
    const week = await env.DB.prepare("SELECT COUNT(*) AS count FROM habit_completions WHERE habit_id = ? AND occurrence_date >= ? AND occurrence_date <= ?").bind(habit.id, tehranDateOffset(-6), today).first<{ count: number }>();
    const month = await env.DB.prepare("SELECT COUNT(*) AS count FROM habit_completions WHERE habit_id = ? AND occurrence_date >= ? AND occurrence_date <= ?").bind(habit.id, tehranDateOffset(-29), today).first<{ count: number }>();
    return { title: habit.title, streak, bestStreak, week: week?.count ?? 0, month: month?.count ?? 0 };
  }));
  const bestHabits = [...habitMetrics].sort((left, right) => right.bestStreak - left.bestStreak);
  const reportName = (value: string) => escapeHtml(value.length > 60 ? value.slice(0, 57) + "…" : value);
  const bestLines = bestHabits.map((habit) => "🌱 " + reportName(habit.title) + ": 🔥 " + habit.bestStreak);
  const weekLines = habitMetrics.map((habit) => "🌱 " + reportName(habit.title) + ": ▪️ " + habit.week + "/7 🔥 " + habit.streak);
  const monthLines = habitMetrics.map((habit) => "🌱 " + reportName(habit.title) + ": ▪️ " + habit.month + "/30 🔥 " + habit.streak);
  const separator = "─────────────────────────";
  const report = en
    ? "📊 <b>Personal Report</b>\n" + separator +
      "\n📝 <b>Task statistics</b>\n📌 Tasks created: " + totalTasks +
      "\n📌 Tasks completed: " + completedTasks +
      "\n📌 Tasks missed: " + (taskMissed?.count ?? 0) +
      "\n📈 Task completion rate: " + taskRate + "%" +
      "\n📎 Open tasks today: " + (taskOpenToday?.count ?? 0) +
      "\n📎 Tasks completed today: " + (taskDoneToday?.count ?? 0) +
      "\n" + separator + "\n🌱 <b>Habit statistics</b>\n⬜ Total habits: " + (habitCounts?.total ?? 0) +
      "\n🟥 Not done today: " + (habitCounts?.skippedToday ?? 0) +
      "\n🟩 Done today: " + (habitCounts?.doneToday ?? 0) +
      "\n" + separator + "\n🌿 <b>Best habit streaks</b>\n" + (bestLines.join("\n") || "No habits yet.") +
      "\n" + separator + "\n📈 <b>Habit completions — last 7 days</b>\n" + (weekLines.join("\n") || "No habit data yet.") +
      "\n" + separator + "\n📉 <b>Habit completions — last 30 days</b>\n" + (monthLines.join("\n") || "No habit data yet.")
    : "📊 <b>گزارش فردی</b>\n" + separator +
      "\n📝 <b>آمار تسک‌ها</b>\n📌 تعداد تسک‌های ساخته‌شده: " + totalTasks +
      "\n📌 تعداد تسک‌های انجام‌شده: " + completedTasks +
      "\n📌 تعداد تسک‌های انجام‌نشده: " + (taskMissed?.count ?? 0) +
      "\n📈 نرخ انجام تسک: " + taskRate + "%" +
      "\n📎 تسک‌های باز امروز: " + (taskOpenToday?.count ?? 0) +
      "\n📎 تسک‌های انجام‌شده امروز: " + (taskDoneToday?.count ?? 0) +
      "\n" + separator + "\n🌱 <b>آمار عادت‌ها</b>\n⬜ تعداد کل عادت‌ها: " + (habitCounts?.total ?? 0) +
      "\n🟥 انجام‌نشده امروز: " + (habitCounts?.skippedToday ?? 0) +
      "\n🟩 انجام‌شده امروز: " + (habitCounts?.doneToday ?? 0) +
      "\n" + separator + "\n🌿 <b>بهترین زنجیره عادت</b>\n" + (bestLines.join("\n") || "هنوز عادتی ثبت نشده است.") +
      "\n" + separator + "\n📈 <b>تکمیل عادت‌ها در ۷ روز اخیر</b>\n" + (weekLines.join("\n") || "هنوز داده‌ای ثبت نشده است.") +
      "\n" + separator + "\n📉 <b>تکمیل عادت‌ها در ۳۰ روز اخیر</b>\n" + (monthLines.join("\n") || "هنوز داده‌ای ثبت نشده است.");
  await sendMessage(env, chatId, report);
}
function weekdayKeyboard(selected: number[], mode: "task" | "habit" | "task_edit" = "task"): ReplyMarkup {
  const chosen = new Set(selected);
  const rows: InlineButton[][] = [];
  for (let index = 0; index < WEEKDAYS.length; index += 2) {
    rows.push(WEEKDAYS.slice(index, index + 2).map(([value, label]) => ({
      text: (chosen.has(value) ? "✅ " : "") + label,
      callback_data: (mode === "habit" ? "habit:day:" : mode === "task_edit" ? "task:editday:" : "new:day:") + value,
    })));
  }
  const doneText = mode === "task_edit" ? "ذخیره روزها" : "ثبت روزها";
  const doneCallback = mode === "habit" ? "habit:days_done" : mode === "task_edit" ? "task:editdays_done" : "new:days_done";
  rows.push([{ text: doneText, callback_data: doneCallback }]);
  return { inline_keyboard: rows };
}
async function showHabits(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const today = tehranDate();
  const weekday = tehranWeekday();
  const rows = await env.DB.prepare("SELECT id, title, weekdays FROM habits WHERE user_id = ? AND active = 1 ORDER BY id DESC")
    .bind(userId).all<{ id: number; title: string; weekdays: string }>();
  const habits = await Promise.all(rows.results.map(async (habit) => {
    const scheduled = parseWeekdays(habit.weekdays).includes(weekday);
    const done = scheduled ? await env.DB.prepare("SELECT 1 FROM habit_completions WHERE habit_id = ? AND occurrence_date = ?").bind(habit.id, today).first() : null;
    const skipped = scheduled ? await env.DB.prepare("SELECT 1 FROM habit_skips WHERE habit_id = ? AND occurrence_date = ?").bind(habit.id, today).first() : null;
    const streak = await habitStreak(env.DB, habit.id, today);
    const bestStreak = await habitBestStreak(env.DB, habit.id);
    return { ...habit, scheduled, done: Boolean(done), skipped: Boolean(skipped), streak, bestStreak };
  }));
  const heading = en ? "🪴 All habits" : "🪴 همه عادت‌ها";
  if (!habits.length) {
    await sendMessage(env, chatId, "<b>" + heading + " (0)</b>\n" + (en ? "No habits yet. Choose New habit to create one." : "هنوز عادتی ثبت نکرده‌ای. از «➕ عادت جدید» شروع کن."));
    return;
  }
  const summary = habits.map((habit) =>
    "🌱 " + escapeHtml(shorten(habit.title, 70)) + "\n<blockquote>" +
    (habit.done ? (en ? "✅ Done today" : "✅ امروز انجام‌شده")
      : habit.skipped ? (en ? "⏭️ Skipped today" : "⏭️ امروز انجام‌نشده")
      : habit.scheduled ? (en ? "⬜ Not done today" : "⬜ امروز انجام نشده")
      : (en ? "▫️ Not scheduled today" : "▫️ امروز زمان‌بندی نشده")) + "\n" +
    (en ? "Current streak: " : "زنجیره فعلی: ") + habit.streak + "\n" +
    (en ? "Best streak: " : "بهترین زنجیره: ") + habit.bestStreak + "</blockquote>",
  );
  await sendSummary(env, chatId, "<b>" + heading + " (" + habits.length + ")</b>", summary, en ? "No habits yet." : "هنوز عادتی ثبت نشده است.");
  for (const habit of habits) {
    const todayStatus = habit.done
      ? (en ? "✅ Done today" : "✅ امروز انجام‌شده")
      : habit.skipped ? (en ? "⏭️ Skipped today" : "⏭️ امروز انجام‌نشده")
      : habit.scheduled ? (en ? "⬜ Open today" : "⬜ امروز باز")
      : (en ? "▫️ Not scheduled today" : "▫️ امروز زمان‌بندی نشده");
    const actions: InlineButton[][] = [];
    if (habit.scheduled && !habit.done && !habit.skipped) actions.push([
      { text: en ? "✅ Done" : "✅ انجام شد", callback_data: "habit:complete:" + habit.id },
      { text: en ? "⏭️ Skipped" : "⏭️ انجام نشد", callback_data: "habit:skip:" + habit.id },
    ]);
    actions.push([
      { text: en ? "🗑 Delete" : "🗑 حذف", callback_data: "habit:delete:" + habit.id },
      { text: en ? "✏️ Rename" : "✏️ تغییر نام", callback_data: "habit:rename:" + habit.id },
    ]);
    await sendMessage(env, chatId,
      "🌱 " + escapeHtml(habit.title) + "\n<blockquote>" + todayStatus + "\n🔥 " +
      (en ? "Current streak: " : "زنجیره فعلی: ") + habit.streak + "\n" +
      (en ? "Best streak: " : "بهترین زنجیره: ") + habit.bestStreak + "</blockquote>",
      { inline_keyboard: actions },
    );
  }
}
function shorten(value: string, maximum: number): string {
  return value.length > maximum ? value.slice(0, maximum - 1) + "…" : value;
}
function deadlineKeyboard(en: boolean, calendar: "gregorian" | "persian"): ReplyMarkup {
  const rows: InlineButton[][] = [
    [{ text: en ? "Until tonight (23:59 today)" : "تا آخر امشب (امروز ساعت ۲۳:۵۹)", callback_data: "new:quick:tonight" }],
    [{ text: en ? "Until tomorrow (23:59 tomorrow)" : "تا پایان فردا (فردا ساعت ۲۳:۵۹)", callback_data: "new:quick:tomorrow_end" }],
    [{ text: en ? "Today, enter time" : "امروز، وارد کردن ساعت", callback_data: "new:quick:today" }, { text: en ? "Tomorrow, enter time" : "فردا، وارد کردن ساعت", callback_data: "new:quick:tomorrow" }],
    [{ text: en ? "Choose another date" : "انتخاب روز دیگر", callback_data: "new:calendar:" + calendarMonthKey(tehranDate(), calendar) }],
    [{ text: en ? "No deadline" : "بدون ددلاین", callback_data: "new:deadline:none" }],
  ];
  return { inline_keyboard: rows };
}

function calendarKeyboard(monthKey: string, en: boolean, calendar: "gregorian" | "persian"): ReplyMarkup {
  const parts = monthKey.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const monthDates = calendar === "persian"
    ? persianMonthDates(year, month)
    : Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, index + 1));
      return { day: index + 1, iso: date.toISOString().slice(0, 10) };
    });
  if (!monthDates.length) return { inline_keyboard: [] };
  const first = new Date(monthDates[0].iso + "T12:00:00Z");
  const locale = en
    ? calendar === "persian" ? "en-US-u-ca-persian" : "en-US-u-ca-gregory"
    : calendar === "persian" ? "fa-IR-u-ca-persian" : "fa-IR-u-ca-gregory";
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const rows: InlineButton[][] = [[
    { text: "‹", callback_data: "new:calendar:prev:" + monthKey },
    { text: title, callback_data: "new:noop" },
    { text: "›", callback_data: "new:calendar:next:" + monthKey },
  ]];
  const dayNames = en ? ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"] : ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  rows.push(dayNames.map((name) => ({ text: name, callback_data: "new:noop" })));
  const cells: InlineButton[] = [];
  const offset = (first.getUTCDay() + 1) % 7;
  for (let index = 0; index < offset; index++) cells.push({ text: "·", callback_data: "new:noop" });
  const today = tehranDate();
  for (const item of monthDates) {
    const enabled = item.iso >= today;
    cells.push({ text: (item.iso === today ? "• " : "") + item.day, callback_data: enabled ? "new:date:" + item.iso : "new:noop" });
  }
  while (cells.length % 7) cells.push({ text: "·", callback_data: "new:noop" });
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));
  rows.push([{ text: en ? "Today" : "امروز", callback_data: "new:date:" + today }]);
  return { inline_keyboard: rows };
}

function shiftMonth(monthKey: string, amount: number, calendar: "gregorian" | "persian"): string {
  const parts = monthKey.split("-").map(Number);
  if (calendar === "persian") {
    const shiftedMonth = parts[1] - 1 + amount;
    const year = parts[0] + Math.floor(shiftedMonth / 12);
    const month = ((shiftedMonth % 12) + 12) % 12 + 1;
    return year + "-" + String(month).padStart(2, "0");
  }
  const shifted = new Date(Date.UTC(parts[0], parts[1] - 1 + amount, 1));
  return shifted.getUTCFullYear() + "-" + String(shifted.getUTCMonth() + 1).padStart(2, "0");
}

function calendarMonthKey(isoDate: string, calendar: "gregorian" | "persian"): string {
  const [year, month] = calendarDateParts(isoDate, calendar);
  return year + "-" + String(month).padStart(2, "0");
}

function calendarDateParts(isoDate: string, calendar: "gregorian" | "persian"): [number, number, number] {
  if (calendar === "gregorian") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!match) throw new Error("Invalid ISO date");
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC",
  }).formatToParts(new Date(isoDate + "T12:00:00Z"));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return [get("year"), get("month"), get("day")];
}

function persianMonthDates(persianYear: number, persianMonth: number): Array<{ day: number; iso: string }> {
  if (persianMonth < 1 || persianMonth > 12) return [];
  const start = Date.UTC(persianYear + 621, 0, 1);
  let first: Date | null = null;
  for (let offset = 0; offset < 470; offset += 1) {
    const candidate = new Date(start + offset * 86400000);
    const [year, month, day] = calendarDateParts(candidate.toISOString().slice(0, 10), "persian");
    if (year === persianYear && month === persianMonth && day === 1) {
      first = candidate;
      break;
    }
  }
  if (!first) return [];
  const dates: Array<{ day: number; iso: string }> = [];
  for (let offset = 0; offset < 32; offset += 1) {
    const candidate = new Date(first.getTime() + offset * 86400000);
    const iso = candidate.toISOString().slice(0, 10);
    const [year, month, day] = calendarDateParts(iso, "persian");
    if (year !== persianYear || month !== persianMonth) break;
    dates.push({ day, iso });
  }
  return dates;
}

function tehranDateOffset(offset: number): string {
  const date = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
async function habitStreak(db: D1Database, habitId: number, today: string): Promise<number> {
  const rows = await db.prepare("SELECT occurrence_date FROM habit_completions WHERE habit_id = ? ORDER BY occurrence_date DESC LIMIT 365").bind(habitId).all<{ occurrence_date: string }>();
  const dates = new Set(rows.results.map((row) => row.occurrence_date));
  let cursor = new Date(today + "T00:00:00Z");
  if (!dates.has(today)) {
    const skippedToday = await db.prepare("SELECT 1 FROM habit_skips WHERE habit_id = ? AND occurrence_date = ?").bind(habitId, today).first();
    if (skippedToday) return 0;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  let streak = 0;
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}
async function habitBestStreak(db: D1Database, habitId: number): Promise<number> {
  const rows = await db.prepare("SELECT occurrence_date FROM habit_completions WHERE habit_id = ? ORDER BY occurrence_date").bind(habitId).all<{ occurrence_date: string }>();
  let best = 0;
  let current = 0;
  let previous: number | null = null;
  for (const row of rows.results) {
    const date = Date.parse(row.occurrence_date + "T00:00:00Z");
    current = previous !== null && date - previous === 86400000 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = date;
  }
  return best;
}
async function showWeeklyPlan(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const calendar = await getCalendar(env.DB, userId);
  const tasks = await env.DB.prepare("SELECT id, title, priority, kind, deadline, weekdays, completed FROM tasks WHERE user_id = ? AND ((kind = 'weekly') OR (kind = 'one_time' AND completed = 0)) ORDER BY id DESC LIMIT 100")
    .bind(userId).all<TaskRow>();
  const habits = await env.DB.prepare("SELECT title, weekdays FROM habits WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 100")
    .bind(userId).all<{ title: string; weekdays: string }>();
  const englishDays = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
      await sendMessage(env, chatId, en ? "📅 <b>Weekly Plan</b>" : "📅 <b>برنامه هفتگی</b>");
  for (let index = 0; index < WEEKDAYS.length; index++) {
    const day = WEEKDAYS[index][0];
    const label = WEEKDAYS[index][1];
    const dayTasks = tasks.results.filter((task) => task.kind === "weekly" && parseWeekdays(task.weekdays).includes(day));
    const dayHabits = habits.results.filter((habit) => parseWeekdays(habit.weekdays).includes(day));
    const taskLines = dayTasks.map((task) =>
      PRIORITIES[task.priority] + " " + escapeHtml(shorten(task.title, 80)) +
      "\n<blockquote>" + (en ? "Weekly task" : "تسک هفتگی") + "</blockquote>",
    );
    const habitLines = dayHabits.map((habit) =>
      "🌱 " + escapeHtml(shorten(habit.title, 80)) + "\n<blockquote>" + (en ? "Habit" : "عادت") + "</blockquote>",
    );
    const allLines = [...taskLines, ...habitLines];
    const visibleLines = allLines.slice(0, 20);
    if (allLines.length > visibleLines.length) visibleLines.push("… " + (allLines.length - visibleLines.length) + (en ? " more" : " مورد دیگر"));
    const heading = (index === 0 ? "🗓️" : "📆") + " <b>" + (en ? englishDays[index] : label) + "</b> · " +
      dayTasks.length + " " + (en ? "tasks" : "تسک") + " · " + dayHabits.length + " " + (en ? "habits" : "عادت");
    await sendMessage(env, chatId, heading + "\n\n" + (visibleLines.join("\n") || (en ? "No items." : "موردی ثبت نشده است.")));
  }
  const oneTime = tasks.results.filter((task) => task.kind === "one_time");
  if (oneTime.length) {
    const rows = oneTime.slice(0, 20).map((task) =>
      PRIORITIES[task.priority] + " " + escapeHtml(shorten(task.title, 80)) +
      "\n<blockquote>" + (task.deadline ? (en ? "Deadline: " : "ددلاین: ") + formatDeadline(task.deadline, en, calendar) : (en ? "No deadline" : "بدون ددلاین")) + "</blockquote>",
    );
    if (oneTime.length > rows.length) rows.push("… " + (oneTime.length - rows.length) + (en ? " more" : " مورد دیگر"));
    await sendMessage(env, chatId, "<b>📝 " + (en ? "One-time tasks" : "تسک‌های یک‌باره") + "</b>\n\n" + rows.join("\n"));
  }
}
function formatDeadline(value: string, en: boolean, calendar: "gregorian" | "persian"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})$/.exec(value);
  if (!match) return escapeHtml(value);
  const locale = en
    ? calendar === "persian" ? "en-US-u-ca-persian" : "en-US-u-ca-gregory"
    : calendar === "persian" ? "fa-IR-u-ca-persian" : "fa-IR-u-ca-gregory";
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(match[1] + "-" + match[2] + "-" + match[3] + "T12:00:00Z"));
  return escapeHtml(date) + " | " + match[4];
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

async function getCalendar(db: D1Database, userId: number): Promise<"gregorian" | "persian"> {
  const row = await db.prepare("SELECT calendar FROM users WHERE id = ?").bind(userId).first<{ calendar: string }>();
  return row?.calendar === "persian" ? "persian" : "gregorian";
}

async function showSettings(env: Env, chatId: number, userId: number, changed = false): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const calendar = await getCalendar(env.DB, userId);
  const calendarName = calendar === "persian" ? (en ? "Persian" : "شمسی") : (en ? "Gregorian" : "میلادی");
  const title = en ? "⚙️ <b>Settings</b>" : "⚙️ <b>تنظیمات</b>";
  const confirmation = changed
    ? (en ? "\n✅ Calendar set to " : "\n✅ تقویم روی ") + calendarName + (en ? "." : " تنظیم شد.")
    : "";
  await sendMessage(env, chatId, title + confirmation, {
    inline_keyboard: [
      [{ text: en ? "✏️ Change name" : "✏️ تغییر نام", callback_data: "menu:name" }],
      [{ text: en ? "🌐 Change language" : "🌐 تغییر زبان", callback_data: "menu:language" }],
      [{ text: (calendar === "persian" ? "✅ " : "") + (en ? "📅 Persian calendar" : "📅 تقویم شمسی"), callback_data: "calendar:set:persian" }],
      [{ text: (calendar === "gregorian" ? "✅ " : "") + (en ? "📅 Gregorian calendar" : "📅 تقویم میلادی"), callback_data: "calendar:set:gregorian" }],
    ],
  });
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
    const result = await db.prepare("UPDATE tasks SET completed = 1 WHERE id = ? AND user_id = ? AND completed = 0").bind(taskId, userId).run();
    if (result.meta.changes === 0) return;
    await db.prepare("INSERT INTO task_completions (task_id, user_id, occurrence_date) VALUES (?, ?, ?) ON CONFLICT(task_id, occurrence_date) DO NOTHING").bind(taskId, userId, occurrenceDate).run();
    await db.prepare("UPDATE users SET xp = xp + ?, consecutive_task_misses = 0 WHERE id = ?").bind(taskXp(task.priority, task.deadline !== null), userId).run();
  } else {
    const result = await db.prepare(
      "INSERT INTO task_completions (task_id, user_id, occurrence_date) VALUES (?, ?, ?) ON CONFLICT(task_id, occurrence_date) DO NOTHING",
    ).bind(taskId, userId, occurrenceDate).run();
    if (result.meta.changes > 0) await db.prepare("UPDATE users SET xp = xp + ?, consecutive_task_misses = 0 WHERE id = ?").bind(taskXp(task.priority, true), userId).run();
  }
}

function taskXp(priority: "low" | "medium" | "high", hasDeadline = true): number {
  if (!hasDeadline) return priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  return priority === "high" ? 6 : priority === "medium" ? 4 : 2;
}
async function showLeaderboard(env: Env, chatId: number, userId: number): Promise<void> {
  const en = (await getLanguage(env.DB, userId)) === "en";
  const rows = await env.DB.prepare("SELECT telegram_id, username, display_name, xp FROM users ORDER BY xp DESC, id ASC LIMIT 20").all<{ telegram_id: number; username: string | null; display_name: string | null; xp: number }>();
  const medals = ["🥇", "🥈", "🥉"];
  const scoreLabel = en ? "XP" : "امتیاز";
  const lines = rows.results.map((row, index) => {
    const rawName = row.display_name || (row.username ? "@" + row.username : "User " + row.telegram_id);
    const name = escapeHtml(rawName);
    const directionalName = en ? "\u200E" + name + "\u200E" : "\u200F" + name + "\u200F";
    const position = medals[index] ?? "•";
    return position + " <b>" + directionalName + "</b>  <code>" + row.xp + " " + scoreLabel + "</code>";
  });
  const title = en ? "🏆 <b>XP Leaderboard</b>\n<i>Top performers</i>" : "🏆 <b>لیدربرد بر اساس XP</b>\n<i>برترین کاربران</i>";
  await sendMessage(env, chatId, title + "\n\n" + (lines.join("\n") || (en ? "No users yet." : "هنوز کاربری ثبت نشده است.")));
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
