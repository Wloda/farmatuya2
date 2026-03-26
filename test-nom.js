async function go() {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&q=Hospital+Angeles+Lomas,+M%C3%A9xico';
  const resp = await fetch(url, { headers: { 'User-Agent': 'Test' } });
  const data = await resp.json();
  console.log(JSON.stringify(data, null, 2));
}
go();
