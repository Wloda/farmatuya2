const lat = 19.39497;
const lng = -99.28205;
const radius = 2000;
const query = `
  [out:json][timeout:30];
  (
    node["amenity"="pharmacy"](around:${radius},${lat},${lng});
    way["amenity"="pharmacy"](around:${radius},${lat},${lng});
  );
  out center body;
`;

const urls = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

async function go() {
  for (const url of urls) {
    console.log("Fetching", url);
    const resp = await fetch(url, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    console.log("Status:", resp.status);
    if (resp.ok) {
      const data = await resp.json();
      console.log("Elements:", data.elements?.length);
      console.log("Data snippet:", JSON.stringify(data).slice(0, 200));
      return;
    }
  }
}
go();
