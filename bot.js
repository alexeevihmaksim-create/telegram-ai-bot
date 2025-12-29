import os
from dotenv import load_dotenv

load_dotenv()  # Загружает переменные из .env

TELEGRAM_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
OPENAI_KEY = os.getenv('OPENAI_API_KEY')
const ADMIN_ID = 123456789;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const DATA_FILE = "./users.json";
const history = {};
const lastMessageTime = {};
const MESSAGE_COOLDOWN = 3000;

const TARIFFS = {
  free: { limit: 15 },
  pro: { limit: 500 },
  vip: { limit: 9999 }
};

function loadUsers() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  }
  return {};
}

function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

const users = loadUsers();

// ====== ВСПОМОГАТЕЛЬНО ======
function isSubActive(user) {
  return user.subUntil && Date.now() < user.subUntil;
}

function ensureUser(id) {
  if (!users[id]) {
    users[id] = {
      tariff: "free",
      limit: TARIFFS.free.limit,
      subUntil: null,
      banned: false,
      messages: 0
    };
    saveUsers();
  }

  if (users[id].tariff !== "free" && !isSubActive(users[id])) {
    users[id].tariff = "free";
    users[id].limit = TARIFFS.free.limit;
    users[id].subUntil = null;
    saveUsers();
  }
}

function menu() {
  return {
    reply_markup: {
      keyboard: [
        ["👤 Профиль", "📊 Осталось"],
        ["⭐ PRO (30 дней)", "👑 VIP (30 дней)"]
      ],
      resize_keyboard: true
    }
  };
}

// ====== КОМАНДЫ ======
bot.setMyCommands([
  { command: "start", description: "Запуск" },
  { command: "reset", description: "Очистить диалог" },
  { command: "help", description: "Помощь" }
]);

// ====== /start ======
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id;
  ensureUser(id);

  await bot.sendMessage(
    id,
    "👋 Привет!\nЯ — ИИ-ассистент 🤖\n\n🧠 Я могу:\n— отвечать на вопросы\n— помогать с идеями\n— объяснять сложные вещи простым языком"
  );

  await bot.sendMessage(
    id,
    "👉 Просто напиши вопрос текстом.\n\nНапример:\n— «Придумай идею для бизнеса»\n— «Объясни, что такое ИИ»\n— «Помоги с текстом»"
  );

  await bot.sendMessage(
    id,
    "🆓 У тебя есть бесплатные сообщения.\nПосмотреть статус можно в меню ниже ⬇️",
    menu() // клавиатура ТОЛЬКО ЗДЕСЬ
  );
});

// ====== /reset ======
bot.onText(/\/reset/, (msg) => {
  history[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "🧹 Диалог очищен");
});

// ====== /help ======
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, "Просто пиши сообщения 🙂");
});

// ====== СООБЩЕНИЯ ======
bot.on("message", async (msg) => {
  const id = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  ensureUser(id);

  if (users[id].banned) {
    return bot.sendMessage(id, "🚫 Вы заблокированы");
  }

  const now = Date.now();
  if (lastMessageTime[id] && now - lastMessageTime[id] < MESSAGE_COOLDOWN) {
    return bot.sendMessage(id, "⏳ Подожди пару секунд");
  }
  lastMessageTime[id] = now;

  // кнопки
  if (text === "👤 Профиль") {
    return bot.sendMessage(
      id,
      `👤 Профиль
Тариф: ${users[id].tariff.toUpperCase()}
Подписка до: ${users[id].subUntil ? new Date(users[id].subUntil).toLocaleDateString() : "—"}
Сообщений: ${users[id].messages}`,
      menu()
    );
  }

  if (text === "📊 Осталось") {
    return bot.sendMessage(id, `📊 Осталось: ${users[id].limit}`, menu());
  }

  if (text === "⭐ PRO (30 дней)") {
    return bot.sendInvoice(id, "PRO", "30 дней", "pro_30", "", "XTR", [
      { label: "PRO", amount: 50 }
    ]);
  }

  if (text === "👑 VIP (30 дней)") {
    return bot.sendInvoice(id, "VIP", "30 дней", "vip_30", "", "XTR", [
      { label: "VIP", amount: 100 }
    ]);
  }

  if (users[id].limit <= 0) {
    return bot.sendMessage(id, "❌ Лимит исчерпан");
  }

  users[id].limit--;
  users[id].messages++;
  saveUsers();

  if (!history[id]) history[id] = [];
  history[id].push({ role: "user", content: text });

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: history[id]
  });

  const answer = res.choices[0].message.content;
  history[id].push({ role: "assistant", content: answer });

  bot.sendMessage(id, answer);
});

// ====== ОПЛАТА ======
bot.on("pre_checkout_query", (q) => bot.answerPreCheckoutQuery(q.id, true));

bot.on("successful_payment", (msg) => {
  const id = msg.chat.id;
  ensureUser(id);

  const payload = msg.successful_payment.invoice_payload;
  const month = 30 * 24 * 60 * 60 * 1000;

  if (payload === "pro_30") {
    users[id].tariff = "pro";
    users[id].limit = TARIFFS.pro.limit;
    users[id].subUntil = Date.now() + month;
  }

  if (payload === "vip_30") {
    users[id].tariff = "vip";
    users[id].limit = TARIFFS.vip.limit;
    users[id].subUntil = Date.now() + month;
  }

  saveUsers();
  bot.sendMessage(id, "🎉 Подписка активирована", menu());
});

// ====== АДМИН ======
bot.onText(/\/ban (\d+)/, (msg, m) => {
  if (msg.chat.id !== ADMIN_ID) return;
  users[m[1]].banned = true;
  saveUsers();
  bot.sendMessage(msg.chat.id, "🚫 Забанен");
});

bot.onText(/\/unban (\d+)/, (msg, m) => {
  if (msg.chat.id !== ADMIN_ID) return;
  users[m[1]].banned = false;
  saveUsers();
  bot.sendMessage(msg.chat.id, "✅ Разбанен");
});

bot.onText(/\/stats/, (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;

  const total = Object.keys(users).length;
  const free = Object.values(users).filter(u => u.tariff === "free").length;
  const pro = Object.values(users).filter(u => u.tariff === "pro").length;
  const vip = Object.values(users).filter(u => u.tariff === "vip").length;

  bot.sendMessage(
    msg.chat.id,
    `📊 Статистика
Всего: ${total}
FREE: ${free}
PRO: ${pro}
VIP: ${vip}`
  );
});
