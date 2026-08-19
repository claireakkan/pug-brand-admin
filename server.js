const express = require('express');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const path = require('path');

// ─── Firebase init ───────────────────────────────────────────────────────────
// Reads credentials from env var (production) or local file (dev)
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require('./serviceAccount.json');
}

admin.initializeApp({ credential: admin.cert(serviceAccount) });
const db = getFirestore();
const auth = getAuth();

const app = express();
app.use(express.json());

// ─── Simple password protection ──────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'popupgrocer2024';

// Login page (public)
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Brand Admin — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f9f8f6;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border: 1px solid #e8e8e8;
      border-radius: 12px;
      padding: 40px;
      width: 360px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    }
    h1 { font-size: 18px; margin-bottom: 6px; }
    p { color: #888; font-size: 13px; margin-bottom: 28px; }
    input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      margin-bottom: 14px;
    }
    button {
      width: 100%;
      padding: 11px;
      background: #1a1a1a;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .error { color: #dc2626; font-size: 13px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Pop Up Grocer</h1>
    <p>Brand Admin Tool</p>
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Password" autofocus />
      <button type="submit">Sign in</button>
      ${req.query.error ? '<p class="error">Incorrect password.</p>' : ''}
    </form>
  </div>
</body>
</html>`);
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('auth', ADMIN_PASSWORD, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('auth');
  res.redirect('/login');
});

// Auth middleware for all other routes
const cookieParser = require('cookie-parser');
app.use(cookieParser());

app.use((req, res, next) => {
  if (req.path === '/login') return next();
  if (req.cookies?.auth === ADMIN_PASSWORD) return next();
  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── GET all rotations ───────────────────────────────────────────────────────
app.get('/api/rotations', async (req, res) => {
  try {
    const snap = await db.collection('rotations').orderBy('createdAt', 'desc').get();
    const rotations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(rotations);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET brands for a rotation + Firebase Auth status ───────────────────────
app.get('/api/rotations/:rotId/brands', async (req, res) => {
  try {
    const { rotId } = req.params;
    const snap = await db.collection(`rotations/${rotId}/brands`).orderBy('name').get();
    const brands = snap.docs.map(d => ({ docId: d.id, ...d.data() }));

    const allEmails = [...new Set(brands.flatMap(b => b.emails || []))];

    const authStatus = {};
    await Promise.all(allEmails.map(async email => {
      try {
        const user = await auth.getUserByEmail(email);
        authStatus[email] = { exists: true, uid: user.uid };
      } catch (e) {
        authStatus[email] = { exists: false };
      }
    }));

    res.json({ brands, authStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CREATE missing Firebase Auth users for a rotation ──────────────────────
app.post('/api/rotations/:rotId/sync-users', async (req, res) => {
  try {
    const { rotId } = req.params;
    const snap = await db.collection(`rotations/${rotId}/brands`).get();
    const brands = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    const allEmails = [...new Set(brands.flatMap(b => b.emails || []))];

    const created = [];
    const alreadyExisted = [];
    const errors = [];

    for (const email of allEmails) {
      try {
        await auth.getUserByEmail(email);
        alreadyExisted.push(email);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          try {
            await auth.createUser({ email, password: email, emailVerified: false });
            created.push(email);
          } catch (createErr) {
            errors.push({ email, error: createErr.message });
          }
        } else {
          errors.push({ email, error: e.message });
        }
      }
    }

    res.json({ created, alreadyExisted, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── UPDATE emails on a brand doc ───────────────────────────────────────────
app.put('/api/rotations/:rotId/brands/:brandDocId/emails', async (req, res) => {
  try {
    const { rotId, brandDocId } = req.params;
    const { emails } = req.body;

    const cleaned = emails.map(e => e.trim().toLowerCase()).filter(Boolean);
    await db.doc(`rotations/${rotId}/brands/${brandDocId}`).update({ emails: cleaned });

    const created = [];
    const errors = [];
    for (const email of cleaned) {
      try {
        await auth.getUserByEmail(email);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          try {
            await auth.createUser({ email, password: email, emailVerified: false });
            created.push(email);
          } catch (createErr) {
            errors.push({ email, error: createErr.message });
          }
        }
      }
    }

    res.json({ success: true, emails: cleaned, created, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Copy emails from previous rotation ─────────────────────────────────────
app.post('/api/rotations/:newRotId/copy-from/:oldRotId', async (req, res) => {
  try {
    const { newRotId, oldRotId } = req.params;

    const [newSnap, oldSnap] = await Promise.all([
      db.collection(`rotations/${newRotId}/brands`).get(),
      db.collection(`rotations/${oldRotId}/brands`).get(),
    ]);

    const oldEmailsByName = {};
    oldSnap.forEach(doc => {
      const d = doc.data();
      if (d.name && d.emails?.length) {
        oldEmailsByName[d.name.toLowerCase()] = d.emails;
      }
    });

    const copied = [];
    const notFound = [];
    const batch = db.batch();

    newSnap.forEach(doc => {
      const d = doc.data();
      const key = (d.name || '').toLowerCase();
      if (oldEmailsByName[key]) {
        batch.update(doc.ref, { emails: oldEmailsByName[key] });
        copied.push({ brand: d.name, emails: oldEmailsByName[key] });
      } else {
        notFound.push(d.name);
      }
    });

    await batch.commit();
    res.json({ copied, notFound });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Auth stats ──────────────────────────────────────────────────────────────
app.get('/api/auth/stats', async (req, res) => {
  try {
    let total = 0;
    let pageToken;
    do {
      const result = await auth.listUsers(1000, pageToken);
      total += result.users.length;
      pageToken = result.pageToken;
    } while (pageToken);
    res.json({ totalUsers: total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`\n✅  Nicole's Brand Admin running at http://localhost:${PORT}\n`);
});
