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
});
