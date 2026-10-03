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
  keyboard: [
    [{ text: "➕ تسک جدید" }, { text: "📋 تسک‌های امروز" }],
    [{ text: "🗂 همه تسک‌ها" }],
    [{ text: "📊 آمار" }, { text: "راهنما" }],
    [{ text: "✅ عادت جدید" }, { text: "✅ عادت‌ها" }],
    [{ text: "📅 برنامه هفتگی" }],
    [{ text: "🌐 تغییر زبان" }],
  ],
  resize_keyboard: true,
} satisfies ReplyMarkup;

const MENU_EN: ReplyMarkup = {
  keyboard: [[{ text: "➕ New task" }, { text: "📋 Today's tasks" }], [{ text: "🗂 All tasks" }], [{ text: "📊 Statistics" }, { text: "✅ New habit" }], [{ text: "✅ Habits" }, { text: "📅 Weekly plan" }], [{ text: "🌐 English" }]],
  resize_keyboard: true,
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
    await sendMessage(env, message.chat.id, language === "en" ? "Welcome to Bullet Journal. Choose an option:" : "به Bullet Journal خوش آمدی. از منوی زیر شروع کن:", language === "en" ? MENU_EN : MENU);
    return;
  }
  if (["/help", "راهنما"].includes(text)) {
    const help = language === "en"
      ? "Bullet Bot help:\n\n➕ New task or /task — create one-time or weekly tasks\n📋 Today's tasks or /today — tasks for today\n🗂 All tasks or /tasks — all open tasks\n📊 Statistics or /stats — progress summary\n✅ New habit or /habit — create a daily habit\n✅ Habits or /habits — habits and streaks\n📅 Weekly plan or /week — weekly table\n/cancel — cancel current operation"
      : "راهنمای Bullet Bot:\n\n➕ تسک جدید یا /task — ساخت تسک یک‌باره یا هفتگی\n📋 تسک‌های امروز یا /today — تسک‌های امروز\n🗂 همه تسک‌ها یا /tasks — همه تسک‌های باز\n📊 آمار یا /stats — خلاصه وضعیت\n✅ عادت جدید یا /habit — ساخت عادت روزانه\n✅ عادت‌ها یا /habits — عادت‌ها و streak\n📅 برنامه هفتگی یا /week — جدول هفتگی\n/cancel — لغو عملیات جاری";
    await sendMessage(env, message.chat.id, help, language === "en" ? MENU_EN : MENU);
    return;
  }
  if (text === "/cancel") {
    await clearSession(env.DB, userId);
    await sendMessage(env, message.chat.id, "عملیات لغو شد.", MENU);
    return;
  }
  if (["🌐 تغییر زبان", "🌐 زبان فارسی", "🌐 English"].includes(text)) {
    await sendMessage(env, message.chat.id, "زبان / Language:", { inline_keyboard: [[{ text: "English", callback_data: "lang:en" }, { text: "فارسی", callback_data: "lang:fa" }]] });
    return;
  }
  if (["/task", "➕ تسک جدید", "➕ New task"].includes(text)) {
    await showTaskType(env, message.chat.id, userId);
    return;
  }
  if (["📋 تسک‌های امروز", "📋 Today's tasks", "/today"].includes(text)) {
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
  if (["✅ عادت جدید", "✅ New habit", "/habit"].includes(text)) {
    await startHabitCreation(env, message.chat.id, userId);
    return;
  }
  if (["✅ عادت‌ها", "✅ Habits", "/habits"].includes(text)) {
    await showHabits(env, message.chat.id, userId);
    return;
  }
  if (["📅 برنامه هفتگی", "📅 Weekly plan", "/week"].includes(text)) {
    await showWeeklyPlan(env, message.chat.id, userId);
    return;
  }

  const session = await getSession(env.DB, userId);
  if (!session) {
    await sendMessage(env, message.chat.id, "از منو یکی از گزینه‌ها را انتخاب کن.", MENU);
    return;
  }
  const data = JSON.parse(session.data) as SessionData;
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
    await sendMessage(env, message.chat.id, "✅ عادت روزانه ذخیره شد.", MENU);
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
    await sendMessage(env, message.chat.id, "✅ تسک یک‌باره ذخیره شد.", MENU);
    return;
  }
  if (session.state === "await_deadline_time") {
    const deadline = parseLocalDeadline(`${data.deadlineDate ?? ""} ${text}`);
    if (!deadline) { await sendMessage(env, message.chat.id, "ساعت معتبر نیست. نمونه: 18:30"); return; }
    await createTask(env.DB, userId, data, deadline);
    await clearSession(env.DB, userId);
    await sendMessage(env, message.chat.id, "✅ تسک یک‌باره ذخیره شد.", MENU);
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

  if (data.startsWith("lang:")) {
    const language = data.slice(5) === "en" ? "en" : "fa";
    await env.DB.prepare("UPDATE users SET language = ? WHERE id = ?").bind(language, userId).run();
    await sendMessage(env, chatId, language === "en" ? "✅ Language changed to English." : "✅ زبان به فارسی تغییر کرد.", language === "en" ? MENU_EN : MENU);
    return;
  }

  if (data === "new:one_time" || data === "new:weekly") {
    const kind = data === "new:one_time" ? "one_time" : "weekly";
    await setSession(env.DB, userId, "await_title", { kind });
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
    if (sessionData.kind === "one_time") {
      await setSession(env.DB, userId, "await_deadline_date", sessionData);
      await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Choose the deadline date:" : "روز ددلاین را انتخاب کن:", deadlineKeyboard());
    } else {
      sessionData.weekdays = [];
      await setSession(env.DB, userId, "await_weekdays", sessionData);
      await sendMessage(env, chatId, (await getLanguage(env.DB, userId)) === "en" ? "Choose recurring days:" : "روزهای تکرار را انتخاب کن:", weekdayKeyboard([]));
    }
    return;
  }
  if (data.startsWith("new:deadline:")) {
    const date = data.slice("new:deadline:".length);
    const session = await getSession(env.DB, userId);
    if (!session || session.state !== "await_deadline_date") return;
    const sessionData = JSON.parse(session.data) as SessionData;
    sessionData.deadlineDate = date;
    await setSession(env.DB, userId, "await_deadline_time", sessionData);
    await sendMessage(env, chatId, `Enter deadline time for ${date} (for example 18:30):`);
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
    await sendMessage(env, chatId, "✅ تسک تکرارشونده ذخیره شد.", MENU);
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
    await sendMessage(env, chatId, "✅ عادت ذخیره شد.", MENU);
    return;
  }
  if (data.startsWith("habit:complete:")) {
    const habitId = Number(data.split(":")[2]);
    await env.DB.prepare("INSERT INTO habit_completions (habit_id, user_id, occurrence_date) SELECT id, user_id, ? FROM habits WHERE id = ? AND user_id = ? AND active = 1 ON CONFLICT(habit_id, occurrence_date) DO NOTHING")
      .bind(tehranDate(), habitId, userId).run();
    await sendMessage(env, chatId, "✅ عادت امروز ثبت شد.");
    return;
  }
  if (data.startsWith("habit:skip:")) {
    const habitId = Number(data.split(":")[2]);
    await env.DB.prepare("INSERT INTO habit_skips (habit_id, user_id, occurrence_date) SELECT id, user_id, ? FROM habits WHERE id = ? AND user_id = ? AND active = 1 ON CONFLICT(habit_id, occurrence_date) DO NOTHING").bind(tehranDate(), habitId, userId).run();
    await sendMessage(env, chatId, "⏭️ عادت امروز انجام‌نشده ثبت شد.");
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
    await env.DB.prepare(
      "INSERT INTO task_skips (task_id, user_id, occurrence_date) SELECT id, user_id, ? FROM tasks WHERE id = ? AND user_id = ? AND completed = 0 ON CONFLICT(task_id, occurrence_date) DO NOTHING",
    ).bind(tehranDate(), taskId, userId).run();
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
    await sendMessage(env, chatId, todayOnly ? (en ? "You have no open tasks for today. ✨" : "برای امروز تسک بازی نداری. ✨") : (en ? "You have no open tasks. ✨" : "تسک بازی وجود ندارد. ✨"));
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
  if (!row || row.total === 0) {
    await sendMessage(env, chatId, en ? "You have not created any tasks yet. Choose New task to begin." : "هنوز تسکی ثبت نکرده‌ای. از «➕ تسک جدید» شروع کن.");
    return;
  }
  const today = tehranDate();
  const doneToday = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM task_completions WHERE user_id = ? AND occurrence_date = ?",
  ).bind(userId, today).first<{ count: number }>();
  const skippedToday = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM task_skips WHERE user_id = ? AND occurrence_date = ?",
  ).bind(userId, today).first<{ count: number }>();
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
      ? `📊 Task statistics\n\nTotal tasks: ${row.total}\nCompleted: ${row.completed}\nOpen one-time: ${row.one_time}\nRecurring: ${row.weekly}\nRecurring completed today: ${doneToday?.count ?? 0}\nSkipped today: ${skippedToday?.count ?? 0}\n\nCompletion chart (last 7 days):\n${chart}`
      : `📊 آمار تسک‌ها\n\nکل تسک‌ها: ${row.total}\nتکمیل‌شده: ${row.completed}\nیک‌باره باز: ${row.one_time}\nتکرارشونده: ${row.weekly}\nتکرارشونده انجام‌شده امروز: ${doneToday?.count ?? 0}\nانجام‌نشده امروز: ${skippedToday?.count ?? 0}\n\nنمودار تکمیل ۷ روز اخیر:\n${chart}`,
    en ? MENU_EN : MENU);
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
    await sendMessage(env, chatId, en ? "You have no habits yet. Choose New habit to create one." : "هنوز عادتی ثبت نکرده‌ای. از «✅ عادت جدید» شروع کن.", en ? MENU_EN : MENU);
    return;
  }
  const weekday = tehranWeekday();
  await sendMessage(env, chatId, en ? "✅ Your habits:" : "✅ عادت‌های امروز:");
  for (const habit of habits.results) {
    const days = parseWeekdays(habit.weekdays);
    const scheduled = days.includes(weekday);
    const done = scheduled ? await env.DB.prepare("SELECT 1 FROM habit_completions WHERE habit_id = ? AND occurrence_date = ?")
      .bind(habit.id, tehranDate()).first() : null;
    const streak = await habitStreak(env.DB, habit.id, tehranDate());
    await sendMessage(env, chatId, `${done ? "✅" : scheduled ? "⬜" : "▫️"} ${escapeHtml(habit.title)}\n🔥 ${en ? "Current streak" : "streak فعلی"}: ${streak} ${en ? "days" : "روز"}`,
      scheduled && !done ? { inline_keyboard: [[{ text: en ? "✅ Done" : "✅ انجام شد", callback_data: `habit:complete:${habit.id}` }, { text: en ? "⏭️ Skipped" : "⏭️ انجام نشد", callback_data: `habit:skip:${habit.id}` }]] } : undefined);
  }
}

function deadlineKeyboard(): ReplyMarkup {
  const rows: InlineButton[][] = [];
  const now = new Date();
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(now.getTime() + i * 86400000);
    const value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    rows.push([{ text: i === 0 ? `امروز (${value})` : value, callback_data: `new:deadline:${value}` }]);
  }
  return { inline_keyboard: rows };
}

async function habitStreak(db: D1Database, habitId: number, today: string): Promise<number> {
  const rows = await db.prepare("SELECT occurrence_date FROM habit_completions WHERE habit_id = ? ORDER BY occurrence_date DESC LIMIT 365").bind(habitId).all<{ occurrence_date: string }>();
  let streak = 0;
  let cursor = new Date(`${today}T00:00:00Z`);
  const dates = new Set(rows.results.map((row) => row.occurrence_date));
  while (dates.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor = new Date(cursor.getTime() - 86400000); }
  return streak;
}

async function showWeeklyPlan(env: Env, chatId: number, userId: number): Promise<void> {
  const tasks = await env.DB.prepare("SELECT title, kind, deadline, weekdays FROM tasks WHERE user_id = ? AND completed = 0 ORDER BY id DESC LIMIT 100")
    .bind(userId).all<{ title: string; kind: string; deadline: string | null; weekdays: string | null }>();
  const habits = await env.DB.prepare("SELECT title, weekdays FROM habits WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 100")
    .bind(userId).all<{ title: string; weekdays: string }>();
  const lines = WEEKDAYS.map(([day, label]) => {
    const dayTasks = tasks.results.filter((task) => task.kind === "weekly" ? parseWeekdays(task.weekdays).includes(day) : false).map((task) => `• ${task.title}`);
    const dayHabits = habits.results.filter((habit) => parseWeekdays(habit.weekdays).includes(day)).map((habit) => `✓ ${habit.title}`);
    return `<b>${label}</b>\n${[...dayTasks, ...dayHabits].join("\n") || "—"}`;
  });
  const oneTime = tasks.results.filter((task) => task.kind === "one_time").map((task) => `• ${task.title} (${task.deadline ?? "بدون ددلاین"})`);
  await sendMessage(env, chatId, `📅 برنامه هفتگی\n\n${lines.join("\n\n")}${oneTime.length ? `\n\n<b>تسک‌های یک‌باره</b>\n${oneTime.join("\n")}` : ""}`, MENU);
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
    "SELECT id, kind FROM tasks WHERE id = ? AND user_id = ? AND completed = 0",
  ).bind(taskId, userId).first<{ id: number; kind: string }>();
  if (!task) return;
  if (task.kind === "one_time") {
    await db.prepare("UPDATE tasks SET completed = 1 WHERE id = ? AND user_id = ?").bind(taskId, userId).run();
  } else {
    await db.prepare(
      `INSERT INTO task_completions (task_id, user_id, occurrence_date) VALUES (?, ?, ?)
       ON CONFLICT(task_id, occurrence_date) DO NOTHING`,
    ).bind(taskId, userId, occurrenceDate).run();
  }
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
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
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
