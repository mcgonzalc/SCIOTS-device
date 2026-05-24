/**
 * SCIOTS-device — Servidor HTTP del Device
 *
 * Rol en el diagrama de secuencia:
 *   - Expone una interfaz web al User y lo redirige a Energética (paso 1).
 *   - Recibe el auth_code en el callback (paso 3), lo canjea por el access
 *     token (paso 4) y lo verifica con la pública de Energética (paso 5).
 *
 * Toda la criptografía RSA (modPow, firma, verificación) vive en la
 * librería `rsa` (mcgonzalc/RSA-TS); aquí solo se consume.
 */

import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { RsaPublicKey, verifyMessage } from 'rsa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- "Identidad" del Device ----------
const DEVICE = {
  id: 'A8F9F9D2',
  serial: 'BC704A540DAB',
};

const ENERGETICA_URL = process.env.ENERGETICA_URL || 'http://localhost:4000';
const DEVICE_CALLBACK = `http://localhost:${PORT}/callback`;

// ---------- Estado en memoria del Device (se pierde al reiniciar) ----------
const session = {
  authCode: null,
  accessToken: null,
  accessTokenSignature: null,
};

// ---------- Middlewares ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Clave pública de Energética (cacheada) ----------
let energeticaPubKey = null;
async function getEnergeticaPubKey() {
  if (energeticaPubKey) return energeticaPubKey;
  const r = await fetch(`${ENERGETICA_URL}/pubKey`);
  const { n, e } = await r.json();
  energeticaPubKey = new RsaPublicKey(BigInt(n), BigInt(e));
  return energeticaPubKey;
}

// ---------- Canje del auth_code por el access token (paso 4-5) ----------
async function requestAccessToken(code) {
  const r = await fetch(`${ENERGETICA_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) throw new Error(`token endpoint respondió ${r.status}`);

  const { access_token, signature } = await r.json();
  const pub = await getEnergeticaPubKey();

  // Paso 5: verificar la firma con la pública (función de la librería rsa).
  if (!verifyMessage(pub, access_token, BigInt(signature))) {
    throw new Error('firma del access token inválida');
  }

  const payload = JSON.parse(Buffer.from(access_token, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new Error('access token expirado');
  }

  session.accessToken = access_token;
  session.accessTokenSignature = signature;
  console.log('[Device] Paso 5 → access token verificado con la pública y guardado.');
}

// ---------- Rutas ----------

// Página principal: el User "se conecta al dispositivo".
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Datos del Device para la SPA.
app.get('/api/device', (req, res) => {
  res.json(DEVICE);
});

// Paso 1: el User pulsa "Registrar". El Device construye la registration
// request y redirige al User al endpoint de registro de Energética.
app.post('/register', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    device_id: DEVICE.id,
    serial: DEVICE.serial,
    callback: DEVICE_CALLBACK,
    state,
  });

  const target = `${ENERGETICA_URL}/register?${params.toString()}`;
  console.log(`[Device] Paso 1 → redirigiendo User a: ${target}`);

  res.redirect(302, target);
});

// Paso 3-5: Energética devuelve aquí al User con el auth_code; el Device lo
// guarda, lo canjea por el access token y lo verifica.
app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.warn(`[Device] Consentimiento denegado: ${error}`);
    return res.status(403).sendFile(path.join(__dirname, 'public', 'callback.html'));
  }

  session.authCode = code;
  console.log(`[Device] auth_code guardado en memoria: ${code}`);

  try {
    await requestAccessToken(code);
  } catch (e) {
    console.error('[Device] Error obteniendo el access token:', e.message);
    return res.status(502).sendFile(path.join(__dirname, 'public', 'callback.html'));
  }

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