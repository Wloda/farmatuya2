/**
 * FarmaTuya — Location Engine v3 (Google + OSM Market Study)
 * ────────────────────────────────────────────────────────────
 * Primary: Google Places/Geocoding (when configured)
 * Fallback: Nominatim (geocoding) + Overpass (POIs multi-radio)
 * Census: INEGI DENUE + CONEVAL rezago social
 *
 * Multi-radius analysis: 500m, 1km, 2km
 * 15-factor scoring model
 * Chain detection for pharmacy competition
 * Traffic generators: schools, churches, markets, transport
 * Residential density estimation
 */
import { lookupRezago } from '../data/coneval-rezago.js';
import { googleGeocode, isGoogleMapsLoaded, getGoogleApiKey } from './google-places.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
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
   GEOCODING — Google Primary, Nominatim Fallback
   ══════════════════════════════════════════ */
export async function geocodeAddress(query, returnMultiple = false) {
  // Try Google first if API key is configured
  if (getGoogleApiKey() && isGoogleMapsLoaded()) {
    try {
      const result = await googleGeocode(query, returnMultiple);
      console.log('[LocationEngine] Geocoded via Google ✓');
      return result;
    } catch (e) {
      console.warn('[LocationEngine] Google geocode failed, falling back to Nominatim:', e.message);
    }
  }

  // Fallback: Nominatim
  return _nominatimGeocode(query, returnMultiple);
}

/**
 * Nominatim geocoding (fallback)
 */
async function _nominatimGeocode(query, returnMultiple = false) {
  // Smart query: if it looks like a specific POI (has name-like words), don't force ', México'
  const poiIndicators = /hospital|centro\s*comercial|plaza|mall|parque|aeropuerto|estadio|mercado|universidad|iglesia|catedral|museo|hotel|walmart|soriana|chedraui|costco|sam's|city\s*market|liverpool/i;
  const hasMexicoRef = /m[eé]xico|mx|cdmx|guadalajara|monterrey|puebla|tijuana|chihuahua|juárez|león|cancún|mérida|querétaro|oaxaca/i;
  const searchQuery = poiIndicators.test(query) || hasMexicoRef.test(query) ? query : query + ', México';

  const params = new URLSearchParams({
    q: searchQuery,
    format: 'json',
    addressdetails: '1',
    limit: returnMultiple ? '8' : '1',
    countrycodes: 'mx',
    'accept-language': 'es'
  });

  const resp = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { 'User-Agent': 'FarmaTuya-Dashboard/2.0' }
  });

  if (!resp.ok) throw new Error(`Geocoding error: ${resp.status}`);
  const data = await resp.json();
  if (!data.length) throw new Error('No se encontró la dirección');

  const parseResult = (r) => {
    const addr = r.address || {};
    return {
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      displayName: r.display_name,
      municipio: addr.municipality || addr.county || addr.city || addr.town || null,
      estado: addr.state || null,
      colonia: addr.suburb || addr.neighbourhood || null,
      cp: addr.postcode || null,
      source: 'Nominatim/OSM',
      confidence: r.importance > 0.5 ? 'alta' : r.importance > 0.3 ? 'media' : 'baja',
      importance: r.importance,
      type: r.type || null,
      category: r.class || null
    };
  };

  if (returnMultiple) return data.map(parseResult);
  return parseResult(data[0]);
}

/* ══════════════════════════════════════════
   MULTI-RADIUS POI QUERY via Overpass
   ══════════════════════════════════════════ */
export async function queryMultiRadius(lat, lng) {
  // Single comprehensive Overpass query for ALL categories at 2km radius
  // We'll classify by distance afterwards into 500m / 1km / 2km bands
  const radius = 2000;
  const query = `
    [out:json][timeout:30];
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

      // Pet shops (vet corridor)
      node["shop"="pet"](around:${radius},${lat},${lng});
      way["shop"="pet"](around:${radius},${lat},${lng});

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

      // Dog parks (vet corridor)
      node["leisure"="dog_park"](around:${radius},${lat},${lng});
      way["leisure"="dog_park"](around:${radius},${lat},${lng});

      // Residential (density estimation)
      way["building"="apartments"](around:${radius},${lat},${lng});
      way["building"="residential"](around:${radius},${lat},${lng});
    );
    out center body;
  `;

  // P6: Query Overpass servers sequentially with timeout (fixes 429 and "All servers failed")
  let data = null;
  let lastError = null;
  const TIMEOUT_MS = 25000; // Extended timeout for heavy/dense city queries
  
  for (const url of OVERPASS_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      const resp = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!resp.ok) {
        if (resp.status === 429) {
          console.warn(`[LocationEngine] Overpass 429 Rate Limit en ${url}, intentando el siguiente...`);
          lastError = `Rate limit on ${url}`;
          continue;
        }
        throw new Error(`HTTP ${resp.status}`);
      }
      
      const json = await resp.json();
      if (json && json.elements) {
        data = json;
        console.log(`[LocationEngine] Overpass data obtained via ${url}`);
        break; // Success
      } else {
        throw new Error('No elements array in response');
      }
    } catch (e) {
      lastError = `Failed at ${url}: ${e.message}`;
      console.warn(`[LocationEngine] ${lastError}`);
      continue;
    }
  }

  if (!data) throw new Error(lastError || 'All Overpass servers failed');
  const elements = data.elements || [];

  // Classify all elements
  const classified = {
    farmacias: [], salud: [], escuelas: [], iglesias: [],
    mercados: [], comercios: [], bancos: [], restaurantes: [],
    transporte: [], gasolineras: [], residencial: [],
    veterinarias: [], petShops: [], dogParks: [], publicHealth: []
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
      const operator = el.tags?.operator || '';
      const isPublic = /imss|issste|ssa|secretar[ií]a.*salud|centro.*salud|dif\b/i.test(operator) || /imss|issste/i.test(name);
      const type = amenity === 'hospital' ? 'Hospital' : amenity === 'clinic' ? 'Clínica' : amenity === 'dentist' ? 'Dentista' : 'Consultorio';
      classified.salud.push({ ...item, type, operator, isPublic });
      if (isPublic) classified.publicHealth.push({ ...item, type, operator });
    } else if (amenity === 'veterinary') {
      classified.salud.push({ ...item, type: 'Veterinaria' });
      classified.veterinarias.push({ ...item, type: 'Veterinaria' });
    } else if (['school', 'university', 'college', 'kindergarten'].includes(amenity)) {
      classified.escuelas.push({ ...item, type: amenity === 'university' ? 'Universidad' : amenity === 'college' ? 'Preparatoria' : amenity === 'kindergarten' ? 'Kinder' : 'Escuela' });
    } else if (amenity === 'place_of_worship') {
      classified.iglesias.push(item);
    } else if (['supermarket', 'convenience', 'mall', 'department_store', 'wholesale'].includes(shop)) {
      classified.mercados.push({ ...item, type: shop === 'supermarket' ? 'Supermercado' : shop === 'mall' ? 'Centro Comercial' : shop === 'convenience' ? 'Tienda' : 'Mayoreo' });
    } else if (shop === 'pet') {
      classified.petShops.push({ ...item, type: 'Pet Shop' });
      classified.comercios.push({ ...item, type: 'pet' });
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
    } else if (el.tags?.leisure === 'dog_park') {
      classified.dogParks.push({ ...item, type: 'Parque canino' });
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
      veterinarias: inRadius(classified.veterinarias).length,
      petShops: inRadius(classified.petShops).length,
      dogParks: inRadius(classified.dogParks).length,
      publicHealth: inRadius(classified.publicHealth).length,
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
   15-FACTOR SCORING MODEL
   Enhanced with COFEPRIS, DENUE, Public Health, Vet Corridor
   ══════════════════════════════════════════ */
export function calcLocationScores(study, modelId) {
  const rs = study.radiusSummary || {};
  const r1 = rs['1km'] || {};
  const r500 = rs['500m'] || {};
  const r2 = rs['2km'] || {};
  const c = study.classified || {};
  const isCoolPet = modelId && modelId.startsWith('coolpet');

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
  const potentialCustomers = resid1km * 10 + schools * 200 + health1km * 50 + markets * 100;
  const saturation = potentialCustomers > 0 ? pharm1km / (potentialCustomers / 1000) : pharm1km;
  const f10_saturation = saturation <= 0.5 ? 90 : saturation <= 1 ? 75 : saturation <= 2 ? 55 : saturation <= 4 ? 35 : 15;

  // ── Factor 11: Distance to Nearest Competitor ──
  const nearestPharm = (c.farmacias || [])[0];
  const nearestDist = nearestPharm?.distance || 9999;
  const f11_nearest = nearestDist >= 800 ? 95 : nearestDist >= 500 ? 82 : nearestDist >= 300 ? 65 : nearestDist >= 150 ? 45 : nearestDist >= 50 ? 25 : 10;

  // ── Factor 12: COFEPRIS 200m Compliance ──
  // COFEPRIS requires minimum 200m between pharmacies
  const cofeprisPass = nearestDist > 200;
  const f12_cofepris = nearestDist >= 500 ? 95 : nearestDist >= 300 ? 80 : nearestDist > 200 ? 60 : nearestDist >= 100 ? 20 : 5;

  // ── Factor 13: DENUE Census Validation ──
  // Uses INEGI DENUE data if available from async enrichment
  const denueData = study.denueValidation;
  let f13_denue = 50; // neutral default if no DENUE data
  if (denueData) {
    const osmCount = pharm1km;
    const denueCount = denueData.pharmacyCount || 0;
    const delta = Math.abs(osmCount - denueCount);
    // High confidence if counts match closely
    if (delta <= 1) f13_denue = 85; // OSM matches INEGI = high trust
    else if (delta <= 3) f13_denue = 70;
    else if (osmCount < denueCount) f13_denue = 40; // OSM undercount = more competition unseen
    else f13_denue = 60; // OSM overcount = less serious
  }

  // ── Factor 14: Public Health Infrastructure (IMSS/ISSSTE/SSA) ──
  // Public health institutions generate high prescription volume
  const pubHealth1km = r1.publicHealth || 0;
  const pubHospitals = (c.publicHealth || []).filter(s => s.type === 'Hospital' && (s.distance||9999) <= 1000).length;
  const pubClinics = (c.publicHealth || []).filter(s => (s.distance||9999) <= 1000).length;
  const f14_publicHealth = pubHospitals >= 1 ? 95 : pubClinics >= 3 ? 85 : pubClinics >= 2 ? 72 : pubClinics >= 1 ? 55 : health1km >= 3 ? 40 : 20;

  // ── Factor 15: Veterinary Corridor (CoolPet models) ──
  // Weighted for pet-oriented businesses
  const vets1km = r1.veterinarias || 0;
  const pets1km = r1.petShops || 0;
  const dogs1km = r1.dogParks || 0;
  const vetScore = vets1km * 3 + pets1km * 2 + dogs1km * 2;
  const f15_vetCorridor = vetScore >= 12 ? 95 : vetScore >= 8 ? 82 : vetScore >= 5 ? 68 : vetScore >= 2 ? 48 : 20;

  // ── Factor 16: Digital Saturation (Omnichannel Competition) ──
  // Proxy: High commercial density + High income + Dense competition = High digital ad costs / saturation
  // Inverted: High saturation = lower score for new entrants in digital channels
  const digitalPressure = (f6_commercial + f9_income + (100 - f2_compDensity)) / 3;
  const f16_digitalComp = Math.max(10, Math.min(95, 100 - digitalPressure + 15));

  // ── Factor 17: Chronic Disease Affinity ──
  // Proxy: Proximity to public health (IMSS) + hospitals + residential density
  // High density of public health and residential = high chronic scripts recurrence
  const chronicProxy = (f14_publicHealth * 0.5) + (f8_residential * 0.5);
  const f17_chronicAffin = Math.max(15, Math.min(95, chronicProxy + 15));

  // ── Weighted Total (17 factors, sum = 1.00) ──
  const weights = isCoolPet ? {
    rezago: 0.06, compDensity: 0.08, compQuality: 0.06, health: 0.06,
    traffic: 0.08, commercial: 0.06, transport: 0.05, residential: 0.07,
    income: 0.04, saturation: 0.04, nearest: 0.04,
    cofepris: 0.05, denue: 0.03, publicHealth: 0.04, vetCorridor: 0.12,
    digitalComp: 0.08, chronicAffin: 0.04
  } : {
    // Pharmacy: COFEPRIS + public health weighted higher, chronic affinity high
    rezago: 0.07, compDensity: 0.10, compQuality: 0.07, health: 0.08,
    traffic: 0.08, commercial: 0.06, transport: 0.05, residential: 0.07,
    income: 0.04, saturation: 0.04, nearest: 0.04,
    cofepris: 0.08, denue: 0.03, publicHealth: 0.05, vetCorridor: 0.02,
    digitalComp: 0.06, chronicAffin: 0.06
  };

  const factors = {
    rezago:      { score: f1_rezago,      weight: weights.rezago,      label: 'Rezago Social',              emoji: '📊' },
    compDensity: { score: f2_compDensity, weight: weights.compDensity, label: 'Competencia (densidad)',      emoji: '💊' },
    compQuality: { score: f3_compQuality, weight: weights.compQuality, label: 'Competencia (cadenas)',       emoji: '🏷️' },
    health:      { score: f4_health,      weight: weights.health,      label: 'Corredor de Salud',          emoji: '🏥' },
    traffic:     { score: f5_traffic,     weight: weights.traffic,     label: 'Generadores de Tráfico',     emoji: '🚶' },
    commercial:  { score: f6_commercial,  weight: weights.commercial,  label: 'Densidad Comercial',         emoji: '🏪' },
    transport:   { score: f7_transport,   weight: weights.transport,   label: 'Accesibilidad',              emoji: '🚌' },
    residential: { score: f8_residential, weight: weights.residential, label: 'Densidad Residencial',       emoji: '🏠' },
    income:      { score: f9_income,      weight: weights.income,      label: 'Nivel de Ingreso',           emoji: '💰' },
    saturation:  { score: f10_saturation, weight: weights.saturation,  label: 'Saturación',                 emoji: '📈' },
    nearest:     { score: f11_nearest,    weight: weights.nearest,     label: 'Distancia al competidor',    emoji: '📍' },
    cofepris:    { score: f12_cofepris,   weight: weights.cofepris,    label: 'COFEPRIS (200m)',            emoji: '🏛️' },
    denue:       { score: f13_denue,      weight: weights.denue,       label: 'DENUE (censo INEGI)',        emoji: '📋' },
    publicHealth:{ score: f14_publicHealth,weight: weights.publicHealth,label: 'Salud Pública (IMSS/ISSSTE)',emoji: '⚕️' },
    vetCorridor: { score: f15_vetCorridor,weight: weights.vetCorridor, label: 'Corredor Veterinario',       emoji: '🐾' },
    digitalComp: { score: f16_digitalComp,weight: weights.digitalComp, label: 'Saturación Digital',         emoji: '📱' },
    chronicAffin:{ score: f17_chronicAffin,weight: weights.chronicAffin,label:'Afinidad Enf. Crónicas',     emoji: '❤️' },
  };

  const total = Math.round(Object.values(factors).reduce((sum, f) => sum + f.score * f.weight, 0));

  // Legacy compatible fields
  const comercial = Math.round(
    f2_compDensity * 0.3 + f4_health * 0.3 + f6_commercial * 0.2 + f5_traffic * 0.2
  );
  const compLabel = pharm1km === 0 ? 'Sin competencia' : pharm1km <= 2 ? 'Baja' : pharm1km <= 5 ? 'Media' : pharm1km <= 10 ? 'Alta' : 'Muy alta';

  // AI Insights backwards compatibility
  const confidence = denueData ? 90 : 75;
  const confidenceReasons = denueData 
    ? ['Censo INEGI DENUE validado', 'Análisis multi-radio OSM (2km)'] 
    : ['Análisis multi-radio OSM (2km)', 'Estimación basada en densidad'];
  const explicability = [
    { type: f1_rezago >= 50 ? 'success' : 'warning', text: 'Nivel Socioeconómico: ' + (study.rezago?.grado || 'Local') },
    { type: pharm1km <= 3 ? 'success' : 'danger', text: 'Saturación Comercial: ' + pharm1km + ' competidores en 1km' }
  ];

  return {
    territorial: f1_rezago,
    comercial,
    total,
    competencia: f2_compDensity,
    competenciaLabel: compLabel,
    salud: f4_health,
    comercios: f6_commercial,
    factors,
    confidence,
    confidenceReasons,
    explicability,
    cofeprisCompliant: cofeprisPass,
    cofeprisNearestDist: nearestDist < 9999 ? nearestDist : null,
    // Extra data for UI
    nearestCompetitor: nearestPharm ? { name: nearestPharm.name, distance: nearestPharm.distance, chain: nearestPharm.chain } : null,
    pharmacyCount1km: pharm1km,
    chainCount: chains.length,
    healthFacilities: health1km,
    hospitals,
    publicHealthCount: pubClinics,
    publicHealthHospitals: pubHospitals,
    trafficGenerators: { schools, churches, markets, gasolineras },
    transportStops: transport1km,
    residentialBuildings: resid1km,
    bankCount: banks,
    restaurantCount: restaurants,
    saturationIndex: saturation,
    vetCorridorData: { vets: vets1km, petShops: pets1km, dogParks: dogs1km },
    denueAvailable: !!denueData,
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
   DENUE CENSUS VALIDATION (INEGI)
   SCIAN 464111 = Farmacias sin minisuper
   Free API — no auth token required for basic search
   ══════════════════════════════════════════ */
async function queryDENUE(lat, lng, radiusMeters = 1000) {
  const DENUE_URL = 'https://www.inegi.org.mx/app/api/denue/v1/consulta/Buscar';
  const keyword = 'farmacia';
  const radius = Math.round(radiusMeters);

  try {
    const url = `${DENUE_URL}/${encodeURIComponent(keyword)}/${lat},${lng}/${radius}/0`;
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000) // 8s timeout
    });

    if (!resp.ok) return null;
    const data = await resp.json();

    // DENUE returns array of establishments
    const pharmacies = Array.isArray(data) ? data.filter(d =>
      /farmacia|botica|drug/i.test(d.Nombre || '') ||
      /4641/i.test(d.Codigo_Act || '')
    ) : [];

    return {
      pharmacyCount: pharmacies.length,
      totalEstablishments: Array.isArray(data) ? data.length : 0,
      pharmacies: pharmacies.slice(0, 15).map(d => ({
        name: d.Nombre || 'Sin nombre',
        activity: d.Nombre_Act || '',
        address: [d.Tipo_Vial, d.Nom_Vial, d.Numero_Ext].filter(Boolean).join(' '),
        employees: d.Per_Ocu || null
      })),
      source: 'INEGI DENUE',
    };
  } catch (e) {
    // DENUE is non-critical — fail silently
    return null;
  }
}

/* ══════════════════════════════════════════
   FULL LOCATION STUDY (enhanced v3)
   ══════════════════════════════════════════ */
export async function runLocationStudy(addressQuery, preGeocodedObject) {
  const errors = [];
  let geocode = null;
  let multiRadius = null;
  let rezago = null;

  // Step 1: Geocode
  try {
    if (preGeocodedObject && preGeocodedObject.lat && preGeocodedObject.lng) {
      geocode = preGeocodedObject;
    } else {
      geocode = await geocodeAddress(addressQuery);
    }
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

  // Step 4: DENUE enrichment (non-blocking)
  let denueValidation = null;
  try {
    denueValidation = await queryDENUE(geocode.lat, geocode.lng);
  } catch (e) {
    errors.push({ step: 'denue', error: e.message });
  }

  // Step 5: Build study object
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
    // Enhanced data
    classified: multiRadius?.classified || null,
    radiusSummary: multiRadius?.radiusSummary || null,
    totalPOIs: multiRadius?.totalElements || 0,
    denueValidation,
    scores: null,
    suggestion: null,
    lastUpdated: new Date().toISOString(),
    version: 3,
    errors,
  };

  study.scores = calcLocationScores(study);
  study.suggestion = suggestScenario(study.scores.total);

  return study;
}

/* ══════════════════════════════════════════
   FINANCIAL IMPACT MAPPER
   Converts 15-factor scores → financial adjustments
   ══════════════════════════════════════════ */

/**
 * Each factor score (0–100) → a sales multiplier.
 * Score 50 = neutral (1.00x), higher = bonus, lower = penalty.
 * The range defines max penalty / max bonus per factor.
 */
const FACTOR_IMPACT_RANGES = {
  rezago:      { min: -0.06, max: 0.04, label: 'Rezago Social',          emoji: '📊' },
  compDensity: { min: -0.10, max: 0.06, label: 'Competencia (densidad)', emoji: '💊' },
  compQuality: { min: -0.06, max: 0.04, label: 'Competencia (cadenas)',  emoji: '🏷️' },
  health:      { min: -0.04, max: 0.06, label: 'Corredor de Salud',     emoji: '🏥' },
  traffic:     { min: -0.05, max: 0.06, label: 'Generadores de Tráfico', emoji: '🚶' },
  commercial:  { min: -0.03, max: 0.04, label: 'Densidad Comercial',    emoji: '🏪' },
  transport:   { min: -0.04, max: 0.04, label: 'Accesibilidad',         emoji: '🚌' },
  residential: { min: -0.05, max: 0.05, label: 'Densidad Residencial',  emoji: '🏠' },
  income:      { min: -0.03, max: 0.04, label: 'Nivel de Ingreso',      emoji: '💰' },
  saturation:  { min: -0.08, max: 0.04, label: 'Saturación',            emoji: '📈' },
  nearest:     { min: -0.04, max: 0.04, label: 'Distancia Competidor',  emoji: '📍' },
  cofepris:    { min: -0.12, max: 0.03, label: 'COFEPRIS (200m)',       emoji: '🏛️' },
  denue:       { min: -0.04, max: 0.02, label: 'DENUE (censo INEGI)',   emoji: '📋' },
  publicHealth:{ min: -0.02, max: 0.06, label: 'Salud Pública',         emoji: '⚕️' },
  vetCorridor: { min: -0.02, max: 0.05, label: 'Corredor Veterinario',  emoji: '🐾' },
  digitalComp: { min: -0.05, max: 0.05, label: 'Saturación Digital',    emoji: '📱' },
  chronicAffin:{ min: -0.02, max: 0.08, label: 'Afinidad Crónica',      emoji: '❤️' },
};

/**
 * Returns per-factor financial impact details.
 * @param {object} factors - from calcLocationScores().factors
 * @returns {object[]} Array of { key, label, emoji, score, multiplier, pct, enabled }
 */
export function calcFinancialImpact(factors) {
  if (!factors) return [];
  return Object.entries(FACTOR_IMPACT_RANGES).map(([key, range]) => {
    const factor = factors[key];
    if (!factor) return null;
    const score = factor.score;
    // Linear interpolation: score 0 → min, score 100 → max
    const pct = range.min + (score / 100) * (range.max - range.min);
    return {
      key,
      label: range.label,
      emoji: range.emoji,
      score,
      weight: factor.weight,
      multiplier: 1 + pct,
      pct: pct * 100,  // e.g. +3.5 or -2.1
    };
  }).filter(Boolean);
}

/**
 * Compute combined scenarioFactor adjustment from market study.
 * @param {object} factors - from calcLocationScores().factors
 * @param {object} toggles - { rezago: true, compDensity: false, ... }
 * @returns {{ combinedFactor: number, activeImpacts: object[], inactiveImpacts: object[] }}
 */
export function calcCombinedMarketFactor(factors, toggles = {}) {
  const impacts = calcFinancialImpact(factors);
  if (!impacts.length) return { combinedFactor: 1, activeImpacts: [], inactiveImpacts: [] };

  const activeImpacts = [];
  const inactiveImpacts = [];
  let combinedFactor = 1;

  for (const imp of impacts) {
    // Default: all enabled unless explicitly toggled off
    const enabled = toggles[imp.key] !== false;
    if (enabled) {
      combinedFactor *= imp.multiplier;
      activeImpacts.push({ ...imp, enabled: true });
    } else {
      inactiveImpacts.push({ ...imp, enabled: false });
    }
  }

  return { combinedFactor, activeImpacts, inactiveImpacts };
}
