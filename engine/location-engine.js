/**
 * FarmaTuya — Location Engine v2 (1000x Market Study)
 * ────────────────────────────────────────────────────
 * Real APIs: Nominatim (geocoding) + Overpass (POIs multi-radio)
 * Embedded: CONEVAL rezago social
 *
 * Multi-radius analysis: 500m, 1km, 2km
 * 11-factor scoring model
 * Chain detection for pharmacy competition
 * Traffic generators: schools, churches, markets, transport
 * Residential density estimation
 */
import { lookupRezago } from '../data/coneval-rezago.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

/* ══════════════════════════════════════════════════
   KNOWN PHARMACY CHAINS (for competition analysis)
   ══════════════════════════════════════════════════ */
const PHARMACY_CHAINS = [
  { pattern: /similares|dr.?\s*simi/i, chain: 'Farmacias Similares', threat: 'alta' },
  { pattern: /guadalajara|farma\s*g/i,  chain: 'Farmacias Guadalajara', threat: 'alta' },
  { pattern: /ahorro/i,                 chain: 'Farmacias del Ahorro', threat: 'alta' },
  { pattern: /benavides/i,              chain: 'Farmacias Benavides', threat: 'media' },
  { pattern: /san\s*pablo/i,            chain: 'San Pablo Farmacia', threat: 'alta' },
  { pattern: /walmart|superama|bodega\s*aurrer/i, chain: 'Walmart/Bodega Aurrerá', threat: 'baja' },
  { pattern: /soriana/i,                chain: 'Soriana', threat: 'baja' },
  { pattern: /chedraui/i,               chain: 'Chedraui', threat: 'baja' },
  { pattern: /oxxo/i,                   chain: 'OXXO', threat: 'baja' },
  { pattern: /7.?eleven|seven/i,        chain: '7-Eleven', threat: 'baja' },
  { pattern: /yza/i,                    chain: 'Farmacias YZA', threat: 'media' },
  { pattern: /gi\b|genéricos?\s*inter/i, chain: 'Genéricos Intercambiables', threat: 'media' },
  { pattern: /farmalisto/i,             chain: 'Farmalisto', threat: 'media' },
  { pattern: /la\s*más\s*barata/i,      chain: 'La Más Barata', threat: 'media' },
  { pattern: /derma/i,                  chain: 'Derma (especializada)', threat: 'baja' },
];

function detectChain(name) {
  if (!name) return { chain: 'Independiente', threat: 'media' };
  for (const c of PHARMACY_CHAINS) {
    if (c.pattern.test(name)) return { chain: c.chain, threat: c.threat };
  }
  return { chain: 'Independiente', threat: 'media' };
}

/* ══════════════════════════════════════════
   GEOCODING via Nominatim
   ══════════════════════════════════════════ */
export async function geocodeAddress(query) {
  const params = new URLSearchParams({
    q: query + ', México',
    format: 'json',
    addressdetails: '1',
    limit: '1',
    'accept-language': 'es'
  });

  const resp = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { 'User-Agent': 'FarmaTuya-Dashboard/2.0' }
  });

  if (!resp.ok) throw new Error(`Geocoding error: ${resp.status}`);
  const data = await resp.json();
  if (!data.length) throw new Error('No se encontró la dirección');

  const r = data[0];
  const addr = r.address || {};
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    displayName: r.display_name,
    municipio: addr.city || addr.town || addr.municipality || addr.county || null,
    estado: addr.state || null,
    colonia: addr.suburb || addr.neighbourhood || null,
    cp: addr.postcode || null,
    source: 'Nominatim/OSM',
    confidence: r.importance > 0.5 ? 'alta' : r.importance > 0.3 ? 'media' : 'baja',
    importance: r.importance
  };
}

/* ══════════════════════════════════════════
   MULTI-RADIUS POI QUERY via Overpass
   ══════════════════════════════════════════ */
export async function queryMultiRadius(lat, lng) {
  // Single comprehensive Overpass query for ALL categories at 2km radius
  // We'll classify by distance afterwards into 500m / 1km / 2km bands
  const radius = 2000;
  const query = `
    [out:json][timeout:25];
    (
      // Pharmacies
      node["amenity"="pharmacy"](around:${radius},${lat},${lng});
      way["amenity"="pharmacy"](around:${radius},${lat},${lng});

      // Health facilities
      node["amenity"~"clinic|hospital|doctors|dentist|veterinary"](around:${radius},${lat},${lng});
      way["amenity"~"clinic|hospital|doctors|dentist|veterinary"](around:${radius},${lat},${lng});

      // Schools & Education
      node["amenity"~"school|university|college|kindergarten"](around:${radius},${lat},${lng});
      way["amenity"~"school|university|college|kindergarten"](around:${radius},${lat},${lng});

      // Churches & Religious
      node["amenity"="place_of_worship"](around:${radius},${lat},${lng});
      way["amenity"="place_of_worship"](around:${radius},${lat},${lng});

      // Markets & Supermarkets
      node["shop"~"supermarket|convenience|mall|department_store|wholesale"](around:${radius},${lat},${lng});
      way["shop"~"supermarket|convenience|mall|department_store|wholesale"](around:${radius},${lat},${lng});

      // Other shops (density proxy)
      node["shop"](around:${radius},${lat},${lng});

      // Banks & ATMs (income proxy)
      node["amenity"~"bank|atm"](around:${radius},${lat},${lng});
      way["amenity"="bank"](around:${radius},${lat},${lng});

      // Restaurants (density + income proxy)
      node["amenity"~"restaurant|cafe|fast_food"](around:${radius},${lat},${lng});

      // Public transport
      node["highway"="bus_stop"](around:${radius},${lat},${lng});
      node["railway"~"station|halt"](around:${radius},${lat},${lng});
      node["station"="subway"](around:${radius},${lat},${lng});

      // Gas stations (traffic proxy)
      node["amenity"="fuel"](around:${radius},${lat},${lng});

      // Residential (density estimation)
      way["building"="apartments"](around:${radius},${lat},${lng});
      way["building"="residential"](around:${radius},${lat},${lng});
    );
    out center body;
  `;

  // Try primary + mirror Overpass servers with retry
  let data = null;
  let lastError = null;
  for (const url of OVERPASS_URLS) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (resp.ok) {
        data = await resp.json();
        break;
      }
      lastError = `Overpass ${url}: HTTP ${resp.status}`;
    } catch (e) {
      lastError = `Overpass ${url}: ${e.message}`;
    }
  }
  if (!data) throw new Error(lastError || 'All Overpass servers failed');
  const elements = data.elements || [];

  // Classify all elements
  const classified = {
    farmacias: [], salud: [], escuelas: [], iglesias: [],
    mercados: [], comercios: [], bancos: [], restaurantes: [],
    transporte: [], gasolineras: [], residencial: []
  };

  for (const el of elements) {
    const name = el.tags?.name || 'Sin nombre';
    const elLat = el.lat || el.center?.lat;
    const elLng = el.lon || el.center?.lon;
    const dist = elLat ? haversine(lat, lng, elLat, elLng) : null;
    const band = dist ? (dist <= 500 ? '500m' : dist <= 1000 ? '1km' : '2km') : '2km';
    const item = { name, lat: elLat, lng: elLng, distance: dist ? Math.round(dist) : null, band };

    const amenity = el.tags?.amenity;
    const shop = el.tags?.shop;

    if (amenity === 'pharmacy') {
      const chain = detectChain(name);
      classified.farmacias.push({ ...item, ...chain });
    } else if (['clinic', 'hospital', 'doctors', 'dentist'].includes(amenity)) {
      classified.salud.push({ ...item, type: amenity === 'hospital' ? 'Hospital' : amenity === 'clinic' ? 'Clínica' : amenity === 'dentist' ? 'Dentista' : 'Consultorio' });
    } else if (amenity === 'veterinary') {
      classified.salud.push({ ...item, type: 'Veterinaria' });
    } else if (['school', 'university', 'college', 'kindergarten'].includes(amenity)) {
      classified.escuelas.push({ ...item, type: amenity === 'university' ? 'Universidad' : amenity === 'college' ? 'Preparatoria' : amenity === 'kindergarten' ? 'Kinder' : 'Escuela' });
    } else if (amenity === 'place_of_worship') {
      classified.iglesias.push(item);
    } else if (['supermarket', 'convenience', 'mall', 'department_store', 'wholesale'].includes(shop)) {
      classified.mercados.push({ ...item, type: shop === 'supermarket' ? 'Supermercado' : shop === 'mall' ? 'Centro Comercial' : shop === 'convenience' ? 'Tienda' : 'Mayoreo' });
    } else if (shop) {
      classified.comercios.push({ ...item, type: shop });
    } else if (['bank', 'atm'].includes(amenity)) {
      classified.bancos.push({ ...item, type: amenity === 'bank' ? 'Banco' : 'ATM' });
    } else if (['restaurant', 'cafe', 'fast_food'].includes(amenity)) {
      classified.restaurantes.push({ ...item, type: amenity === 'fast_food' ? 'Comida rápida' : amenity === 'cafe' ? 'Cafetería' : 'Restaurante' });
    } else if (amenity === 'bus_stop' || el.tags?.highway === 'bus_stop') {
      classified.transporte.push({ ...item, type: 'Parada de bus' });
    } else if (el.tags?.railway || el.tags?.station === 'subway') {
      classified.transporte.push({ ...item, type: 'Estación metro/tren' });
    } else if (amenity === 'fuel') {
      classified.gasolineras.push(item);
    } else if (el.tags?.building === 'apartments' || el.tags?.building === 'residential') {
      classified.residencial.push({ ...item, type: el.tags.building });
    }
  }

  // Sort all by distance
  const sortByDist = arr => arr.sort((a, b) => (a.distance || 9999) - (b.distance || 9999));
  Object.values(classified).forEach(sortByDist);

  // Create multi-radius summary
  const radiusSummary = {};
  for (const r of ['500m', '1km', '2km']) {
    const inRadius = (arr) => arr.filter(x => {
      if (r === '500m') return (x.distance || 9999) <= 500;
      if (r === '1km') return (x.distance || 9999) <= 1000;
      return true; // 2km includes all
    });
    radiusSummary[r] = {
      farmacias: inRadius(classified.farmacias).length,
      salud: inRadius(classified.salud).length,
      escuelas: inRadius(classified.escuelas).length,
      iglesias: inRadius(classified.iglesias).length,
      mercados: inRadius(classified.mercados).length,
      comercios: inRadius(classified.comercios).length,
      bancos: inRadius(classified.bancos).length,
      restaurantes: inRadius(classified.restaurantes).length,
      transporte: inRadius(classified.transporte).length,
      gasolineras: inRadius(classified.gasolineras).length,
      residencial: inRadius(classified.residencial).length,
    };
  }

  return {
    classified,
    radiusSummary,
    totalElements: elements.length,
    source: 'OpenStreetMap / Overpass API',
    note: 'Datos comunitarios OSM — cobertura variable por zona'
  };
}

/* ══════════════════════════════════════════
   LEGACY COMPATIBILITY — queryNearby
   ══════════════════════════════════════════ */
export async function queryNearby(lat, lng, radiusMeters = 1000) {
  const result = await queryMultiRadius(lat, lng);
  const c = result.classified;
  return {
    farmacias: c.farmacias.filter(x => (x.distance||9999) <= radiusMeters).length,
    salud: c.salud.filter(x => (x.distance||9999) <= radiusMeters).length,
    comercios: c.comercios.filter(x => (x.distance||9999) <= radiusMeters).length,
    detalles: {
      farmacias: c.farmacias.filter(x => (x.distance||9999) <= radiusMeters).slice(0, 10),
      salud: c.salud.filter(x => (x.distance||9999) <= radiusMeters).slice(0, 10),
      comercios: c.comercios.filter(x => (x.distance||9999) <= radiusMeters).slice(0, 10)
    },
    source: result.source,
    note: result.note,
    // NEW: full data attached
    _full: result
  };
}

/* ══════════════════════════════════════════
   HAVERSINE DISTANCE (meters)
   ══════════════════════════════════════════ */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ══════════════════════════════════════════
   11-FACTOR SCORING MODEL
   ══════════════════════════════════════════ */
export function calcLocationScores(study) {
  const rs = study.radiusSummary || {};
  const r1 = rs['1km'] || {};
  const r500 = rs['500m'] || {};
  const r2 = rs['2km'] || {};
  const c = study.classified || {};

  // If API failed, return minimal scores
  if (study.nearby?.apiError && !study.radiusSummary) {
    let territorial = 50;
    if (study.rezago) {
      const map = { 'Muy bajo': 90, 'Bajo': 75, 'Medio': 55, 'Alto': 30, 'Muy alto': 10 };
      territorial = map[study.rezago.grado] ?? 50;
    }
    return {
      territorial, comercial: null, total: territorial,
      competencia: null, competenciaLabel: 'Sin dato',
      salud: null, comercios: null, apiError: true,
      factors: null
    };
  }

  // ── Factor 1: Rezago Social Territorial (CONEVAL) ──
  let f1_rezago = 50;
  if (study.rezago) {
    const map = { 'Muy bajo': 92, 'Bajo': 75, 'Medio': 55, 'Alto': 28, 'Muy alto': 8 };
    f1_rezago = map[study.rezago.grado] ?? 50;
  }

  // ── Factor 2: Competition Density (farmacias/km² at 1km) ──
  const pharm1km = r1.farmacias || 0;
  const pharmDensity = pharm1km / (Math.PI * 1); // per km²
  const f2_compDensity = pharmDensity <= 1 ? 95 : pharmDensity <= 3 ? 80 : pharmDensity <= 6 ? 60 : pharmDensity <= 10 ? 35 : 15;

  // ── Factor 3: Competition Quality (chain vs independent) ──
  const chains = (c.farmacias || []).filter(f => f.chain !== 'Independiente');
  const chainRatio = pharm1km > 0 ? chains.length / pharm1km : 0;
  const f3_compQuality = chainRatio <= 0.2 ? 85 : chainRatio <= 0.4 ? 70 : chainRatio <= 0.6 ? 50 : 30;

  // ── Factor 4: Health Corridor ──
  const health1km = r1.salud || 0;
  const hospitals = (c.salud || []).filter(s => s.type === 'Hospital' && (s.distance||9999) <= 1000).length;
  const f4_health = health1km >= 8 ? 95 : health1km >= 5 ? 85 : health1km >= 3 ? 70 : health1km >= 1 ? 50 : 25;

  // ── Factor 5: Foot Traffic Generators ──
  const schools = r1.escuelas || 0;
  const churches = r1.iglesias || 0;
  const markets = r1.mercados || 0;
  const gasolineras = r1.gasolineras || 0;
  const trafficPts = schools * 3 + churches * 2 + markets * 4 + gasolineras * 1;
  const f5_traffic = trafficPts >= 25 ? 95 : trafficPts >= 15 ? 80 : trafficPts >= 8 ? 65 : trafficPts >= 3 ? 45 : 20;

  // ── Factor 6: Commercial Density ──
  const shops1km = r1.comercios || 0;
  const f6_commercial = shops1km >= 50 ? 90 : shops1km >= 30 ? 78 : shops1km >= 15 ? 62 : shops1km >= 5 ? 42 : 20;

  // ── Factor 7: Transport Accessibility ──
  const transport1km = r1.transporte || 0;
  const f7_transport = transport1km >= 10 ? 95 : transport1km >= 5 ? 80 : transport1km >= 2 ? 60 : transport1km >= 1 ? 40 : 15;

  // ── Factor 8: Residential Density ──
  const resid1km = r1.residencial || 0;
  const f8_residential = resid1km >= 30 ? 90 : resid1km >= 15 ? 75 : resid1km >= 5 ? 55 : resid1km >= 1 ? 35 : 15;

  // ── Factor 9: Income Level Proxy ──
  const banks = r1.bancos || 0;
  const restaurants = r1.restaurantes || 0;
  const incomeProxy = banks * 2 + restaurants;
  const f9_income = incomeProxy >= 20 ? 90 : incomeProxy >= 10 ? 75 : incomeProxy >= 5 ? 55 : incomeProxy >= 2 ? 35 : 15;

  // ── Factor 10: Market Saturation Index ──
  // Ratio: pharmacies / (potential customers proxy)
  const potentialCustomers = resid1km * 10 + schools * 200 + health1km * 50 + markets * 100;
  const saturation = potentialCustomers > 0 ? pharm1km / (potentialCustomers / 1000) : pharm1km;
  const f10_saturation = saturation <= 0.5 ? 90 : saturation <= 1 ? 75 : saturation <= 2 ? 55 : saturation <= 4 ? 35 : 15;

  // ── Factor 11: Distance to Nearest Competitor ──
  const nearestPharm = (c.farmacias || [])[0];
  const nearestDist = nearestPharm?.distance || 9999;
  const f11_nearest = nearestDist >= 800 ? 95 : nearestDist >= 500 ? 82 : nearestDist >= 300 ? 65 : nearestDist >= 150 ? 45 : nearestDist >= 50 ? 25 : 10;

  // ── Weighted Total ──
  const weights = {
    rezago: 0.10, compDensity: 0.15, compQuality: 0.10, health: 0.12,
    traffic: 0.12, commercial: 0.08, transport: 0.08, residential: 0.10,
    income: 0.05, saturation: 0.05, nearest: 0.05
  };

  const factors = {
    rezago:      { score: f1_rezago,      weight: weights.rezago,      label: 'Rezago Social' },
    compDensity: { score: f2_compDensity, weight: weights.compDensity, label: 'Competencia (densidad)' },
    compQuality: { score: f3_compQuality, weight: weights.compQuality, label: 'Competencia (cadenas)' },
    health:      { score: f4_health,      weight: weights.health,      label: 'Corredor de Salud' },
    traffic:     { score: f5_traffic,     weight: weights.traffic,     label: 'Generadores de Tráfico' },
    commercial:  { score: f6_commercial,  weight: weights.commercial,  label: 'Densidad Comercial' },
    transport:   { score: f7_transport,   weight: weights.transport,   label: 'Accesibilidad' },
    residential: { score: f8_residential, weight: weights.residential, label: 'Densidad Residencial' },
    income:      { score: f9_income,      weight: weights.income,      label: 'Nivel de Ingreso' },
    saturation:  { score: f10_saturation, weight: weights.saturation,  label: 'Saturación' },
    nearest:     { score: f11_nearest,    weight: weights.nearest,     label: 'Distancia al competidor' },
  };

  const total = Math.round(Object.values(factors).reduce((sum, f) => sum + f.score * f.weight, 0));

  // Legacy compatible fields
  const comercial = Math.round(
    f2_compDensity * 0.3 + f4_health * 0.3 + f6_commercial * 0.2 + f5_traffic * 0.2
  );
  const compLabel = pharm1km === 0 ? 'Sin competencia' : pharm1km <= 2 ? 'Baja' : pharm1km <= 5 ? 'Media' : pharm1km <= 10 ? 'Alta' : 'Muy alta';

  return {
    territorial: f1_rezago,
    comercial,
    total,
    competencia: f2_compDensity,
    competenciaLabel: compLabel,
    salud: f4_health,
    comercios: f6_commercial,
    factors,
    // Extra data for UI
    nearestCompetitor: nearestPharm ? { name: nearestPharm.name, distance: nearestPharm.distance, chain: nearestPharm.chain } : null,
    pharmacyCount1km: pharm1km,
    chainCount: chains.length,
    healthFacilities: health1km,
    hospitals,
    trafficGenerators: { schools, churches, markets, gasolineras },
    transportStops: transport1km,
    residentialBuildings: resid1km,
    bankCount: banks,
    restaurantCount: restaurants,
    saturationIndex: saturation,
  };
}

/* ══════════════════════════════════════════
   SUGGESTED SCENARIO from total score
   ══════════════════════════════════════════ */
export function suggestScenario(totalScore) {
  if (totalScore >= 80) return { scenario: 'upside',       factor: 1.20, label: '🟢 Plaza Premium',   desc: 'Excelente ubicación — alta demanda, baja saturación' };
  if (totalScore >= 65) return { scenario: 'upside',       factor: 1.10, label: '🟢 Plaza Fuerte',    desc: 'Buena ubicación — demanda sólida, competencia manejable' };
  if (totalScore >= 50) return { scenario: 'base',         factor: 1.00, label: '🟡 Plaza Normal',    desc: 'Ubicación promedio — resultados según ejecución' };
  if (totalScore >= 35) return { scenario: 'conservative', factor: 0.85, label: '🟠 Plaza Débil',     desc: 'Ubicación desafiante — requiere estrategia agresiva' };
  return                       { scenario: 'conservative', factor: 0.70, label: '🔴 Plaza Riesgosa',  desc: 'Alto riesgo — considerar alternativas de ubicación' };
}

/* ══════════════════════════════════════════
   FULL LOCATION STUDY (enhanced)
   ══════════════════════════════════════════ */
export async function runLocationStudy(addressQuery) {
  const errors = [];
  let geocode = null;
  let multiRadius = null;
  let rezago = null;

  // Step 1: Geocode
  try {
    geocode = await geocodeAddress(addressQuery);
  } catch (e) {
    errors.push({ step: 'geocoding', error: e.message });
    return { errors, partial: true };
  }

  // Step 2: Multi-radius POI analysis
  let nearby = null;
  try {
    multiRadius = await queryMultiRadius(geocode.lat, geocode.lng);
    // Build legacy-compatible nearby object
    const c = multiRadius.classified;
    nearby = {
      farmacias: c.farmacias.filter(x => (x.distance||9999) <= 1000).length,
      salud: c.salud.filter(x => (x.distance||9999) <= 1000).length,
      comercios: c.comercios.filter(x => (x.distance||9999) <= 1000).length,
      detalles: {
        farmacias: c.farmacias.slice(0, 15),
        salud: c.salud.slice(0, 15),
        comercios: c.comercios.slice(0, 15),
      },
      source: multiRadius.source,
      note: multiRadius.note
    };
  } catch (e) {
    errors.push({ step: 'nearby', error: e.message });
    nearby = { farmacias: 0, salud: 0, comercios: 0, detalles: { farmacias: [], salud: [], comercios: [] }, source: 'Error', note: e.message, apiError: true };
    multiRadius = null;
  }

  // Step 3: Rezago social lookup
  try {
    rezago = lookupRezago(geocode.municipio, geocode.estado);
    if (!rezago) errors.push({ step: 'rezago', error: 'Municipio no encontrado en tabla CONEVAL' });
  } catch (e) {
    errors.push({ step: 'rezago', error: e.message });
  }

  // Step 4: Build study object
  const study = {
    address: addressQuery,
    displayName: geocode.displayName,
    coordinates: { lat: geocode.lat, lng: geocode.lng },
    geocodeSource: geocode.source,
    geocodeConfidence: geocode.confidence,
    importance: geocode.importance,
    municipio: geocode.municipio,
    estado: geocode.estado,
    colonia: geocode.colonia,
    cp: geocode.cp,
    rezago,
    nearby,
    // NEW enhanced data
    classified: multiRadius?.classified || null,
    radiusSummary: multiRadius?.radiusSummary || null,
    totalPOIs: multiRadius?.totalElements || 0,
    scores: null,
    suggestion: null,
    lastUpdated: new Date().toISOString(),
    version: 2,
    errors,
  };

  study.scores = calcLocationScores(study);
  study.suggestion = suggestScenario(study.scores.total);

  return study;
}
