const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://hummus-pasta-default-rtdb.firebaseio.com"
});

const db = admin.database();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN || !chatId) return;
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

function getIsraelDateParts(offsetDays = 0) {
  const base = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(base);

  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    key: `${map.year}-${map.month}-${map.day}`
  };
}

function getDaysUntilBirthday(bday) {
  if (!bday || !bday.day || !bday.month) return null;
  const now = getIsraelDateParts(0);
  const todayUtc = Date.UTC(now.year, now.month - 1, now.day);
  let targetUtc = Date.UTC(now.year, Number(bday.month) - 1, Number(bday.day));
  if (targetUtc < todayUtc) {
    targetUtc = Date.UTC(now.year + 1, Number(bday.month) - 1, Number(bday.day));
  }
  return Math.round((targetUtc - todayUtc) / 86400000);
}

async function checkBirthdaysAuto() {
  if (!BOT_TOKEN) return;
  try {
    const snap = await db.ref('users').once('value');
    const users = snap.val() || {};
    const entries = Object.entries(users).filter(([, u]) => u && u.name);
    const todayInfo = getIsraelDateParts(0);

    for (const [bdayUid, bdayUser] of entries) {
      if (!bdayUser.birthday) continue;
      const daysLeft = getDaysUntilBirthday(bdayUser.birthday);
      if (daysLeft === null || daysLeft > 7) continue;

      const msgText = daysLeft === 0
        ? `🎂 היום יום ההולדת של ${bdayUser.name}!! אל תשכחו לברך ולהפתיע 🎉🦐`
        : daysLeft === 1
        ? `🤫 מחר (עוד יום אחד!) יום ההולדת של ${bdayUser.name} (${bdayUser.birthday.day}.${bdayUser.birthday.month}) — תתארגנו על משהו מיוחד!`
        : `🤫 עוד ${daysLeft} ימים יום ההולדת של ${bdayUser.name} (${bdayUser.birthday.day}.${bdayUser.birthday.month}) — זמן לתכנן הפתעה!`;

      for (const [viewerUid, viewerUser] of entries) {
        if (viewerUid === bdayUid || !viewerUser.telegramChatId) continue;

        const sentRef = db.ref(`bdaySent/${todayInfo.key}/${bdayUid}_${viewerUid}`);
        const sentSnap = await sentRef.once('value');
        if (sentSnap.exists()) continue;

        await sendTelegram(viewerUser.telegramChatId, msgText);
        await sentRef.set(true);
      }
    }
  } catch (err) {
    console.error('Birthday check error:', err.message);
  }
}

// מאזין להודעות שנשלחות לבוט בטלגרם ומחבר אוטומטית למשתמשת ב-Firebase
let lastUpdateId = 0;
async function pollTelegram() {
  if (!BOT_TOKEN) return;
  try {
    const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=25`);
    const data = await res.json();
    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (text === '/start') {
          await sendTelegram(chatId, 'היי! 🦐 כדי לקבל צפצופים מחומוס על פסטה, שלחי לי עכשיו את כתובת המייל או השם שלך בדיוק כמו באפליקציה:');
          continue;
        }

        const snap = await db.ref('users').once('value');
        const users = snap.val() || {};
        const lower = text.toLowerCase();
        const foundEntry = Object.entries(users).find(([, u]) =>
          (u.email && u.email.toLowerCase() === lower) ||
          (u.name && u.name.trim().toLowerCase() === lower)
        );

        if (foundEntry) {
          const [uid, user] = foundEntry;
          await db.ref(`users/${uid}/telegramChatId`).set(chatId);
          await sendTelegram(chatId, `מעולה ${user.name || ''}! 🎉 החשבון חובר בהצלחה, מעכשיו כל צפצוף יקפוץ לך כאן 🦐🔥`);
        } else {
          await sendTelegram(chatId, 'לא מצאתי משתמשת עם השם או המייל הזה 🤔 נסי לכתוב בדיוק את המייל או השם שמופיעים לך באפליקציה.');
        }
      }
    }
  } catch (err) {
    console.error('Telegram poll error:', err.message);
  }
  setTimeout(pollTelegram, 1000);
}

app.get('/', (req, res) => res.send('Hummus Telegram Server is live! 🦐'));

app.post('/send-push', async (req, res) => {
  try {
    const { targetUid, senderName, title, body } = req.body;
    if (!targetUid) return res.status(400).json({ error: 'Missing targetUid' });

    const snap = await db.ref(`users/${targetUid}`).once('value');
    const targetUser = snap.val();

    if (!targetUser || !targetUser.telegramChatId) {
      return res.json({ ok: false, reason: 'User has not connected Telegram bot yet' });
    }

    const messageText = title && body
      ? `${title}\n${body}`
      : `🦐 צפצוף חדש מ-${senderName || 'חברה'} בחומוס על פסטה!\nhttps://meirom.github.io/hummus-app/`;

    await sendTelegram(targetUser.telegramChatId, messageText);
    res.json({ ok: true });
  } catch (err) {
    console.error('Send push error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  pollTelegram();
  checkBirthdaysAuto();
  setInterval(checkBirthdaysAuto, 60 * 60 * 1000);
});
