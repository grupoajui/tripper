# AJUI Travel API — Esqueleto (Fase 1: mock)

## Qué es esto
Cloudflare Worker que de momento devuelve datos **inventados** (mock) con la
misma forma que tendrán los datos reales de Amadeus/Google Places. Sirve para
probar el flujo completo (frontend → backend → respuesta) antes de conectar
las APIs de verdad.

## Probarlo en local
```bash
cd worker
npm install -g wrangler   # si no lo tienes
wrangler dev
```
Luego, en otra terminal:
```bash
curl -X POST http://localhost:8787/api/flights/search \
  -H "Content-Type: application/json" \
  -d '{"origin":"SVQ","destination":"MIL","departureDate":"2026-09-12","adults":1}'
```

## Desplegarlo en Cloudflare
```bash
wrangler login
wrangler deploy
```

## Configurar credenciales (solo Travelpayouts, ya no hace falta Google)
Ejecuta esto en tu terminal, en la carpeta `worker/`:
```bash
wrangler secret put TRAVELPAYOUTS_TOKEN
wrangler secret put TRAVELPAYOUTS_MARKER
```
Para probarlo en local (`wrangler dev`), crea un archivo `.dev.vars` (NO lo
subas nunca a git, añádelo a `.gitignore`) con:
```
TRAVELPAYOUTS_TOKEN=tu_token
TRAVELPAYOUTS_MARKER=tu_marker
```

## Probar que funciona con datos reales
```bash
wrangler dev
```
En otra terminal:
```bash
# Vuelos
curl -X POST http://localhost:8787/api/flights/search \
  -H "Content-Type: application/json" \
  -d '{"origin":"SVQ","destination":"MIL","departureDate":"2026-09"}'

# Hoteles (4 estrellas, vía Hotellook)
curl -X POST http://localhost:8787/api/hotels/search \
  -H "Content-Type: application/json" \
  -d '{"destination":"Milan","checkIn":"2026-09-12","checkOut":"2026-09-15","adults":1}'
```
Si ves `"source":"travelpayouts"` o `"source":"hotellook"` (en vez de
`"mock"`) y datos con sentido, está funcionando de verdad.

## ⚠️ Limitación importante que hemos descubierto
La Data API de Travelpayouts (`/v1/prices/cheap`) da el **precio total** del
billete, pero NO desglosa mano vs facturada — eso solo lo da la API de
búsqueda en tiempo real, que requiere la misma aprobación manual que la de
hoteles (gratis, pero hay que solicitarla). Por ahora la app mostrará precio
total + link de compra, y el desglose de equipaje se verá al pinchar en el
link para completar la reserva. Cuando tengamos la aprobación, lo añadimos.

## Endpoints actuales
- `GET  /api/health` — comprobar que el Worker está vivo
- `POST /api/flights/search` — body: `{origin, destination, departureDate, returnDate?, adults}`
- `POST /api/hotels/search` — body: `{destination, checkIn, checkOut, adults}`
