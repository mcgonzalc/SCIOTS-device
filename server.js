/**
 * SCIOTS-device — Servidor HTTP del Device
 *
 * Rol en el diagrama de secuencia:
 *   - Expone una interfaz web al User.
 *   - Cuando el User pulsa "Registrar", el Device construye la
 *     registration request (paso 1) y redirige al User a Energética
 *     para que continúe el flujo OAuth (consent, auth code, access token).
 *
 * Flujo del paso 1 del diagrama:
 *   User ── Connect (HTTP GET /) ──► Device
 *   User ── click "Registrar" ─────► Device  (POST /register)
 *   Device ── 302 Redirect ────────► Energética /register?device_id=...&callback=...
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- "Identidad" del Device ----------
// En un dispositivo real esto vendría de fábrica / EEPROM / TPM.
const DEVICE = {
  id: 'A8F9F9D2',
  serial: 'BC704A540DAB',
};

// URL base de Energética (paso 1: registration request).
// En producción vendría de la configuración del dispositivo.
const ENERGETICA_URL =
  process.env.ENERGETICA_URL || 'http://localhost:4000';

// Callback al que Energética devolverá al User tras el consent (paso 2).
const DEVICE_CALLBACK = `http://localhost:${PORT}/callback`;

// ---------- Middlewares ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Rutas ----------

// Página principal: el User "se conecta al dispositivo".
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint que la SPA llama para conocer los datos del Device.
app.get('/api/device', (req, res) => {
  res.json(DEVICE);
});

// Paso 1: el User pulsa "Registrar". El Device construye la
// registration request y redirige al User al endpoint de registro
// de Energética.
app.post('/register', (req, res) => {
  // Nonce / state para evitar CSRF en el retorno del paso 2.
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    device_id: DEVICE.id,
    serial: DEVICE.serial,
    callback: DEVICE_CALLBACK,
    state,
  });

  const target = `${ENERGETICA_URL}/register?${params.toString()}`;
  console.log(`[Device] Paso 1 → redirigiendo User a: ${target}`);

  // 302 — el navegador del User salta a Energética.
  res.redirect(302, target);
});

// Callback opcional: Energética devuelve aquí al User tras el consent (paso 2-3).
app.get('/callback', (req, res) => {
  console.log('[Device] Callback recibido:', req.query);
  res.sendFile(path.join(__dirname, 'public', 'callback.html'));
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  console.log('────────────────────────────────────────────');
  console.log(`  SCIOTS-device listo en  http://localhost:${PORT}`);
  console.log(`  device_id:              ${DEVICE.id}`);
  console.log(`  energética URL:         ${ENERGETICA_URL}`);
  console.log('────────────────────────────────────────────');
});
