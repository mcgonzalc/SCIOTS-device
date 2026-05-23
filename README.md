# SCIOTS-device

Implementa el rol **Device** del sistema SCIOTS, según el diagrama de secuencia: ofrece una interfaz web al **User**, y al pulsar "Registrar" lo redirige al endpoint de registro de **Energética** (paso 1).

## Instalación

```bash
cd SCIOTS-device
npm install
npm start
```

El servidor queda escuchando en `http://localhost:3000`.

## Uso

1. Abre `http://localhost:3000` en el navegador → eres el **User** conectándose al **Device**.
2. La página muestra la identidad del dispositivo (id, modelo, serie, firmware).
3. Pulsa **"Registrar dispositivo"**.
4. El Device hace `302 → http://localhost:4000/register?device_id=...&callback=...&state=...` → llegas a Energética.
5. Cuando Energética termine el flujo (consent → auth code → access token), te devolverá a `http://localhost:3000/callback`.

## Configuración

Variables de entorno:

| Variable          | Por defecto              | Descripción                       |
| ----------------- | ------------------------ | --------------------------------- |
| `PORT`            | `3000`                   | Puerto en el que escucha Device   |
| `ENERGETICA_URL`  | `http://localhost:4000`  | URL base de Energética            |

Ejemplo:

```bash
ENERGETICA_URL=https://mi-energetica.example.com npm start
```

## Endpoints

| Método | Ruta            | Descripción                                              |
| ------ | --------------- | -------------------------------------------------------- |
| GET    | `/`             | Interfaz web del Device                                  |
| GET    | `/api/device`   | Datos identificativos (JSON)                             |
| POST   | `/register`     | **Paso 1**: construye la registration request y redirige |
| GET    | `/callback`     | Retorno opcional desde Energética tras el consent        |

## Correspondencia con el diagrama

```
User ── HTTP GET / ─────────────► Device         (conexión inicial)
User ── click "Registrar" ──────► Device         (POST /register)
Device ── 302 redirect ─────────► Energética     (paso 1: registration request)
```

A partir de ahí continúa el flujo del diagrama (consent, auth code, access token...) en el lado de Energética.
