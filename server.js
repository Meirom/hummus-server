const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
const dbUrl =
  process.env.FIREBASE_DATABASE_URL ||
  'https://hummus-pasta-default-rtdb.firebaseio.com';

if (!serviceAccountRaw) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT environment variable');
} else {
  const serviceAccount = JSON.parse(serviceAccountRaw);
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: dbUrl,
    });
  }
}

app.get('/', (req, res) => {
  res.status(200).send('hummus-server is running');
});

app.post('/send-push', async (req, res) => {
  try {
    const { targetUid, title, body } = req.body || {};
    if (!targetUid) {
      return res.status(400).json({ ok: false, error: 'Missing targetUid' });
    }

    const snap = await admin.database().ref(`users/${targetUid}/fcmToken`).get();
    const token = snap.val();

    if (!token) {
      return res.status(200).json({ ok: false, reason: 'No FCM token for user' });
    }

    await admin.messaging().send({
      token,
      notification: {
        title: title || 'חומוס על פסטה 🦐',
        body: body || 'יש לך צפצוף חדש!',
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Push error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
