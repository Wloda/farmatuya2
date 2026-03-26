const lat = 19.39497;
const lng = -99.28205;
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

async function go() {
  const url = 'https://lz4.overpass-api.de/api/interpreter';
  const resp = await fetch(url, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  console.log("Status:", resp.status);
  const text = await resp.text();
  console.log("Response text:", text.slice(0, 500));
}
go();
