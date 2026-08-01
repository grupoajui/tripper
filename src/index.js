/**
 * AJUI Travel — API (Cloudflare Worker)
 *
 * Fase actual: ESQUELETO con datos MOCK.
 * Cuando tengamos las claves reales, sustituimos las funciones
 * getMockFlights() y getMockHotels() por llamadas reales a
 * Amadeus y Google Places (dejo los stubs preparados abajo).
 *
 * Endpoints:
 *   GET  /api/health
 *   POST /api/flights/search
 *   POST /api/hotels/search
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // en producción: restringir al dominio de la PWA
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", mode: env.ENVIRONMENT || "unknown" });
    }

    if (url.pathname === "/api/flights/search" && request.method === "POST") {
      const body = await request.json();
      return handleFlightSearch(body, env);
    }

    if (url.pathname === "/api/flights/cheapest" && request.method === "POST") {
      const body = await request.json();
      return handleCheapestFromOrigin(body, env);
    }

    if (url.pathname === "/api/hotels/search" && request.method === "POST") {
      const body = await request.json();
      return handleHotelSearch(body, env);
    }

    return jsonResponse({ error: "Ruta no encontrada" }, 404);
  },
};

// ---------------------------------------------------------------------------
// VUELOS
// ---------------------------------------------------------------------------

async function handleFlightSearch(body, env) {
  const { origin, destination, departureDate, returnDate, adults } = body;

  if (!origin || !destination || !departureDate) {
    return jsonResponse(
      { error: "Faltan campos: origin, destination, departureDate son obligatorios" },
      400
    );
  }

  if (!env.TRAVELPAYOUTS_TOKEN) {
    // Sin token configurado todavía -> devolvemos mock para no romper el flujo
    return jsonResponse(getMockFlights({ origin, destination, departureDate, returnDate, adults }));
  }

  try {
    const data = await fetchTravelpayoutsCheapFlights({ origin, destination, departureDate, returnDate, env });
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: "Fallo al consultar Travelpayouts", detail: String(err) }, 502);
  }
}

// Modo mapa: destinos más baratos desde un origen, SIN destino fijo.
async function handleCheapestFromOrigin(body, env) {
  const { origin, currency = "EUR" } = body;
  if (!origin) return jsonResponse({ error: "Falta origin" }, 400);
  if (!env.TRAVELPAYOUTS_TOKEN) {
    return jsonResponse({ origin, source: "mock", destinations: [] });
  }
  const url = new URL("https://api.travelpayouts.com/v2/prices/latest");
  url.searchParams.set("origin", origin);
  url.searchParams.set("currency", currency);
  url.searchParams.set("sorting", "price");
  url.searchParams.set("limit", "30");
  url.searchParams.set("show_to_affiliates", "true");

  const res = await fetch(url, { headers: { "X-Access-Token": env.TRAVELPAYOUTS_TOKEN } });
  const json = await res.json();
  return jsonResponse({ origin, source: "travelpayouts", raw: json });
}

async function fetchTravelpayoutsCheapFlights({ origin, destination, departureDate, returnDate, env }) {
  // v1/prices/cheap acepta mes o día exacto (yyyy-mm-dd o yyyy-mm)
  const url = new URL("https://api.travelpayouts.com/v1/prices/cheap");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("depart_date", departureDate);
  if (returnDate) url.searchParams.set("return_date", returnDate);
  url.searchParams.set("currency", "EUR");

  const res = await fetch(url, {
    headers: { "X-Access-Token": env.TRAVELPAYOUTS_TOKEN },
  });
  const json = await res.json();

  return {
    origin,
    destination,
    departureDate,
    returnDate: returnDate || null,
    source: "travelpayouts",
    raw: json, // de momento devolvemos crudo; en el siguiente paso lo normalizamos
    // NOTA: esta API de "cheap" da precio total del billete, NO desglosa
    // mano/facturada. Para ese desglose necesitaremos, en fase posterior,
    // enriquecer con la Search API en tiempo real (requiere aprobación,
    // igual que la de hoteles) o mostrar el precio total + link para
    // verificar el desglose en destino.
  };
}

function getMockFlights({ origin, destination, departureDate, returnDate, adults = 1 }) {
  return {
    origin,
    destination,
    departureDate,
    returnDate: returnDate || null,
    adults,
    source: "mock",
    offers: [
      {
        airline: "Ryanair",
        flightNumber: "FR1234",
        departureTime: `${departureDate}T07:15:00`,
        arrivalTime: `${departureDate}T09:40:00`,
        priceHandLuggageOnly: 39.99,
        priceWithCheckedBag: 64.99,
        currency: "EUR",
        bookingUrl: "https://www.ryanair.com/es/es",
      },
      {
        airline: "Vueling",
        flightNumber: "VY4455",
        departureTime: `${departureDate}T13:05:00`,
        arrivalTime: `${departureDate}T15:20:00`,
        priceHandLuggageOnly: 45.5,
        priceWithCheckedBag: 78.0,
        currency: "EUR",
        bookingUrl: "https://www.vueling.com",
      },
      {
        airline: "Iberia",
        flightNumber: "IB3321",
        departureTime: `${departureDate}T19:30:00`,
        arrivalTime: `${departureDate}T21:50:00`,
        priceHandLuggageOnly: 62.0,
        priceWithCheckedBag: 62.0, // incluida en tarifa
        currency: "EUR",
        bookingUrl: "https://www.iberia.com",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// HOTELES
// ---------------------------------------------------------------------------

async function handleHotelSearch(body, env) {
  const { destination, checkIn, checkOut, adults } = body;

  if (!destination || !checkIn || !checkOut) {
    return jsonResponse(
      { error: "Faltan campos: destination, checkIn, checkOut son obligatorios" },
      400
    );
  }

  if (!env.TRAVELPAYOUTS_TOKEN) {
    return jsonResponse(getMockHotels({ destination, checkIn, checkOut, adults }));
  }

  try {
    // 1) Buscar el ID de localización de Hotellook para la ciudad destino
    const locationId = await hotellookLookupCity(destination, env);
    if (!locationId) {
      return jsonResponse({ destination, hotels: [], note: "No se encontró la ciudad en Hotellook" });
    }

    // 2) Pedir la colección "4-stars" (ya filtrada por Hotellook, sin coste extra)
    const collectionUrl = new URL("https://yasen.hotellook.com/tp/public/widget_location_dump.json");
    collectionUrl.searchParams.set("id", locationId);
    collectionUrl.searchParams.set("type", "4-stars");
    collectionUrl.searchParams.set("check_in", checkIn);
    collectionUrl.searchParams.set("check_out", checkOut);
    collectionUrl.searchParams.set("currency", "eur");
    collectionUrl.searchParams.set("language", "es");
    collectionUrl.searchParams.set("limit", "15");
    collectionUrl.searchParams.set("token", env.TRAVELPAYOUTS_TOKEN);

    const res = await fetch(collectionUrl);
    const raw = await res.json();

    const hotels = (Array.isArray(raw) ? raw : []).map((h) => ({
      name: h.name,
      stars: h.stars,
      pricePerRoomTotal: h.priceFrom ?? h.price ?? null,
      currency: "EUR",
      googleMapsUrl: buildGoogleMapsLink(h.name, destination),
      bookingUrl: h.url || `https://search.hotellook.com/?hotelId=${h.hotelId}`,
      source: "hotellook",
      // NOTA: "privado con baño propio" no viene marcado en esta colección;
      // Hotellook trabaja con hoteles/aparthoteles (no alberga hostels de
      // habitación compartida en sus colecciones por estrellas), pero si
      // quieres una garantía estricta habría que cruzarlo con la Search API
      // en tiempo real (la que pedimos por aprobación).
    }));

    return jsonResponse({ destination, checkIn, checkOut, adults, source: "hotellook", hotels });
  } catch (err) {
    return jsonResponse({ error: "Fallo al consultar Hotellook", detail: String(err) }, 502);
  }
}

async function hotellookLookupCity(query, env) {
  const url = new URL("https://engine.hotellook.com/api/v2/lookup.json");
  url.searchParams.set("query", query);
  url.searchParams.set("lang", "es");
  url.searchParams.set("lookFor", "city");
  url.searchParams.set("limit", "1");
  url.searchParams.set("token", env.TRAVELPAYOUTS_TOKEN);

  const res = await fetch(url);
  const json = await res.json();
  return json?.results?.locations?.[0]?.id || null;
}

function buildGoogleMapsLink(hotelName, city) {
  const query = encodeURIComponent(`${hotelName} ${city}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function getMockHotels({ destination, checkIn, checkOut, adults = 1 }) {
  return {
    destination,
    checkIn,
    checkOut,
    adults,
    source: "mock",
    hotels: [
      {
        name: "Hotel Centro Plaza",
        rating: 4.3,
        reviewsSource: "Google",
        privateRoom: true,
        ownBathroom: true,
        pricePerRoomTotal: 210.0,
        currency: "EUR",
        bookingUrl: "https://www.booking.com",
      },
      {
        name: "Boutique Suites Downtown",
        rating: 4.6,
        reviewsSource: "Google",
        privateRoom: true,
        ownBathroom: true,
        pricePerRoomTotal: 265.0,
        currency: "EUR",
        bookingUrl: "https://www.booking.com",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// STUBS PARA FASE 2 (Amadeus real) — de momento sin implementar
// ---------------------------------------------------------------------------

// async function getAmadeusToken(env) {
//   const res = await fetch("https://test.api.amadeus.com/v1/security/oauth2/token", {
//     method: "POST",
//     headers: { "Content-Type": "application/x-www-form-urlencoded" },
//     body: new URLSearchParams({
//       grant_type: "client_credentials",
//       client_id: env.AMADEUS_API_KEY,
//       client_secret: env.AMADEUS_API_SECRET,
//     }),
//   });
//   const data = await res.json();
//   return data.access_token;
// }
