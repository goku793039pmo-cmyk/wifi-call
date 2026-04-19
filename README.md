# Wi-Fi Call

Free app-to-app voice calling over Wi-Fi using the browser.

## Deploy On Render

This is the easiest way to get a public HTTPS URL that works on both your Chromebook and phone.

1. Put `/home/enderxd23/wifi-call` in a GitHub repo.
2. Go to Render and create a new `Web Service`.
3. Connect the GitHub repo.
4. Use these settings if you do it manually:

```text
Environment: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

You can also let Render read [render.yaml](/home/enderxd23/wifi-call/render.yaml).

After deploy, open the Render HTTPS URL on both devices.

Notes:
- Render already gives you HTTPS, so the local `certs/` files are not needed there.
- Room state, chat, and call history are in memory only, so they reset if the service restarts.

### Optional Render Environment Variables

For TURN relay support:

```text
TURN_URLS=turn:your-turn-host:3478?transport=udp,turn:your-turn-host:3478?transport=tcp
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-password
```

For external service hooks:

```text
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
FIREBASE_PROJECT_ID=...
FIREBASE_API_KEY=...
ONESIGNAL_APP_ID=...
CLOUDINARY_CLOUD_NAME=...
```

The app works without these, but with them it can move from local-only mode to provider-backed auth/push/media workflows.

## Push To GitHub

The repo is already initialized locally.

```bash
cd /home/enderxd23/wifi-call
git branch -m main
git add .
git commit -m "Initial wifi-call app"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

If you create the repo on GitHub first, replace `YOUR_USERNAME` and `YOUR_REPO` with the real values.

## Run

```bash
cd /home/enderxd23/wifi-call
node server.js
```

Open `http://127.0.0.1:3001`.

## Test On Another Device

Run the server on your Chromebook's LAN IP:

```bash
HOST=0.0.0.0 node server.js
```

Then open `http://YOUR_CHROMEBOOK_IP:3001` on both devices while they are on the same Wi-Fi.

## Optional HTTPS

If you create these files, the app will also serve HTTPS on port `3443`:

- `certs/localhost-key.pem`
- `certs/localhost-cert.pem`

One way to create them:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -keyout certs/localhost-key.pem -out certs/localhost-cert.pem -days 365 -nodes -subj "/CN=localhost"
```

After that:

```bash
HOST=0.0.0.0 node server.js
```

You can then test `https://YOUR_CHROMEBOOK_IP:3443` after trusting the local certificate on the device.
