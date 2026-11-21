const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT env variable');
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://hummus-pasta-default-rtdb.firebaseio.com',
});

const db = admin.database();
const messaging = admin.messaging();

app.get('/', (req, res) => {
  res.send('Hummus push server is alive 🦐');
});

app.post('/send-push', async (req, res) => {
  try {
    const { targetUid, title, body } = req.body || {};
    if (!targetUid || !title || !body) {
      return res.status(400).json({ error: 'Missing targetUid, title or body' });
    }

    const snap = await db.ref(`users/${targetUid}/fcmToken`).get();
    const token = snap.val();
    if (!token) {
      return res.status(404).json({ ok: false, reason: 'No FCM token for user' });
    }

    const messageId = await messaging.send({
      token,
      notification: { title, body },
      webpush: {
        notification: {
          title,
          body,
          dir: 'rtl',
          lang: 'he',
          vibrate: [200, 100, 200],
        },
      },
    });

    res.json({ ok: true, messageId });
  } catch (err) {
    console.error('Push error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
