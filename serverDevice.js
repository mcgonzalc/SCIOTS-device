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
import { RsaPublicKey, verifyMessage, blind, unblind } from 'rsa';

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
const AGREGADOR_URL = process.env.AGREGADOR_URL || 'http://localhost:3001';
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

// Proceso estándar de firma a ciegas (cegar/descegar con el módulo RSA-TS).
// Reusa /pubKey y /blindsign ya existentes en la energética.
async function firmaCiega(m) {
  // 1. Pública de la energética
  const pkRes = await fetch(`${ENERGETICA_URL}/pubKey`);
  if (!pkRes.ok) throw new Error(`/pubKey respondió ${pkRes.status}`);
  const { n, e } = await pkRes.json();
  const pubs = new RsaPublicKey(BigInt(n), BigInt(e));

  // 2. Cegar: bm = m·r^e mod n  (genera el factor de cegado r).
  const { blinded: bm, r } = blind(m, pubs);

  // 3. Pedir la firma del cegado (ruta ya creada).
  const bsRes = await fetch(`${ENERGETICA_URL}/blindsign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blinded: bm.toString() }),
  });
  if (!bsRes.ok) throw new Error(`/blindsign respondió ${bsRes.status}`);
  const { blindSig } = await bsRes.json();

  // 4. Descegar: s = bs·r⁻¹ mod n.
  const s = unblind(BigInt(blindSig), r, pubs);

  // 5. Verificar: pubs.verify(s) === m.
  const ok = pubs.verify(s) === m;

  return {
    m: m.toString(),
    r: r.toString(),
    blinded: bm.toString(),
    blindSig,
    firma: s.toString(),
    verifica: ok,
  };
}

app.get('/api/firmar', async (req, res) => {
  try {
    const m = BigInt(req.query.m ?? '350');
    res.json(await firmaCiega(m));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/firmar', async (req, res) => {
  try {
    const m = BigInt(req.body.m ?? req.body.consumo ?? '350');
    res.json(await firmaCiega(m));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  console.log('────────────────────────────────────────────');
  console.log(`  SCIOTS-device listo en  http://localhost:${PORT}`);
  console.log(`  device_id:              ${DEVICE.id}`);
  console.log(`  energética URL:         ${ENERGETICA_URL}`);
  console.log('────────────────────────────────────────────');
});