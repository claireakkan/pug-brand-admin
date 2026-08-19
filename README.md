# Pop Up Grocer — Brand Admin Tool

Internal admin tool for managing brand access on the brand dashboard.

## What it does

- Shows all rotations and their brands
- Checks which brand emails have Firebase Auth accounts (green = active, red = missing)
- Creates missing Firebase users in one click (default password = email address)
- Copies emails from a previous rotation to a new one
- Per-brand email editing

## Environment variables (required for deployment)

| Variable | Description |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Full contents of your Firebase service account JSON, as a single string |
| `ADMIN_PASSWORD` | Password to log into the admin tool |
| `PORT` | Set automatically by Railway/Render |

## Local development

1. Put your `serviceAccount.json` in this folder (never commit it)
2. `npm install`
3. `node server.js`
4. Open http://localhost:3333

## Deploy to Railway

See deployment instructions doc.
