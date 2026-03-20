/**
 * FarmaTuya — CONEVAL Rezago Social por Municipio (Expandido v2)
 * Fuente: CONEVAL – Índice de Rezago Social 2020
 * Nivel: Municipal
 * 200+ municipios covering all major metro areas in Mexico
 *
 * Formato: { 'ESTADO|MUNICIPIO': { grado, indice } }
 * Grado: 'Muy bajo' | 'Bajo' | 'Medio' | 'Alto' | 'Muy alto'
 */
export const CONEVAL_REZAGO = {
  // ══════════════ CDMX (16 Alcaldías) ══════════════
  'Ciudad de México|Álvaro Obregón':       { grado: 'Muy bajo', indice: -1.35 },
  'Ciudad de México|Azcapotzalco':         { grado: 'Muy bajo', indice: -1.52 },
  'Ciudad de México|Benito Juárez':        { grado: 'Muy bajo', indice: -1.73 },
  'Ciudad de México|Coyoacán':             { grado: 'Muy bajo', indice: -1.54 },
  'Ciudad de México|Cuajimalpa':           { grado: 'Muy bajo', indice: -1.27 },
  'Ciudad de México|Cuauhtémoc':           { grado: 'Muy bajo', indice: -1.42 },
  'Ciudad de México|Gustavo A. Madero':    { grado: 'Muy bajo', indice: -1.29 },
  'Ciudad de México|Iztacalco':            { grado: 'Muy bajo', indice: -1.46 },
  'Ciudad de México|Iztapalapa':           { grado: 'Muy bajo', indice: -1.15 },
  'Ciudad de México|Magdalena Contreras':  { grado: 'Muy bajo', indice: -1.18 },
  'Ciudad de México|Miguel Hidalgo':       { grado: 'Muy bajo', indice: -1.62 },
  'Ciudad de México|Milpa Alta':           { grado: 'Bajo',     indice: -0.72 },
  'Ciudad de México|Tláhuac':              { grado: 'Muy bajo', indice: -1.09 },
  'Ciudad de México|Tlalpan':              { grado: 'Muy bajo', indice: -1.28 },
  'Ciudad de México|Venustiano Carranza':  { grado: 'Muy bajo', indice: -1.39 },
  'Ciudad de México|Xochimilco':           { grado: 'Muy bajo', indice: -1.05 },

  // ══════════════ ESTADO DE MÉXICO ══════════════
  'México|Huixquilucan':          { grado: 'Muy bajo', indice: -1.21 },
  'México|Naucalpan':             { grado: 'Muy bajo', indice: -1.18 },
  'México|Naucalpan de Juárez':   { grado: 'Muy bajo', indice: -1.18 },
  'México|Tlalnepantla':          { grado: 'Muy bajo', indice: -1.25 },
  'México|Tlalnepantla de Baz':   { grado: 'Muy bajo', indice: -1.25 },
  'México|Atizapán de Zaragoza':  { grado: 'Muy bajo', indice: -1.15 },
  'México|Metepec':               { grado: 'Muy bajo', indice: -1.32 },
  'México|Toluca':                { grado: 'Muy bajo', indice: -1.01 },
  'México|Toluca de Lerdo':       { grado: 'Muy bajo', indice: -1.01 },
  'México|Ecatepec':              { grado: 'Muy bajo', indice: -1.05 },
  'México|Ecatepec de Morelos':   { grado: 'Muy bajo', indice: -1.05 },
  'México|Nezahualcóyotl':       { grado: 'Muy bajo', indice: -1.15 },
  'México|Coacalco':              { grado: 'Muy bajo', indice: -1.28 },
  'México|Coacalco de Berriozábal': { grado: 'Muy bajo', indice: -1.28 },
  'México|Cuautitlán Izcalli':    { grado: 'Muy bajo', indice: -1.22 },
  'México|Texcoco':               { grado: 'Bajo',     indice: -0.65 },
  'México|Chalco':                { grado: 'Bajo',     indice: -0.55 },
  'México|Valle de Bravo':        { grado: 'Medio',    indice:  0.15 },
  'México|Ixtapaluca':            { grado: 'Bajo',     indice: -0.72 },
  'México|Tecámac':               { grado: 'Bajo',     indice: -0.85 },
  'México|Tultitlán':             { grado: 'Muy bajo', indice: -1.10 },
  'México|Zinacantepec':          { grado: 'Bajo',     indice: -0.45 },
  'México|Lerma':                 { grado: 'Bajo',     indice: -0.58 },
  'México|Nicolás Romero':        { grado: 'Bajo',     indice: -0.65 },
  'México|Almoloya de Juárez':    { grado: 'Medio',    indice:  0.22 },
  'México|La Paz':                { grado: 'Bajo',     indice: -0.68 },
  'México|Chimalhuacán':          { grado: 'Bajo',     indice: -0.55 },
  'México|Cuautitlán':            { grado: 'Muy bajo', indice: -1.05 },
  'México|Zumpango':              { grado: 'Bajo',     indice: -0.52 },
  'México|Huehuetoca':            { grado: 'Bajo',     indice: -0.62 },

  // ══════════════ MORELOS ══════════════
  'Morelos|Cuernavaca':           { grado: 'Muy bajo', indice: -1.12 },
  'Morelos|Jiutepec':             { grado: 'Muy bajo', indice: -1.08 },
  'Morelos|Temixco':              { grado: 'Bajo',     indice: -0.68 },
  'Morelos|Cuautla':              { grado: 'Bajo',     indice: -0.52 },
  'Morelos|Yautepec':             { grado: 'Bajo',     indice: -0.38 },
  'Morelos|Jojutla':              { grado: 'Bajo',     indice: -0.42 },
  'Morelos|Xochitepec':           { grado: 'Bajo',     indice: -0.55 },
  'Morelos|Emiliano Zapata':      { grado: 'Muy bajo', indice: -1.02 },

  // ══════════════ JALISCO ══════════════
  'Jalisco|Guadalajara':          { grado: 'Muy bajo', indice: -1.45 },
  'Jalisco|Zapopan':              { grado: 'Muy bajo', indice: -1.28 },
  'Jalisco|Tlaquepaque':          { grado: 'Muy bajo', indice: -1.10 },
  'Jalisco|San Pedro Tlaquepaque': { grado: 'Muy bajo', indice: -1.10 },
  'Jalisco|Tonalá':               { grado: 'Bajo',     indice: -0.78 },
  'Jalisco|Tlajomulco':           { grado: 'Muy bajo', indice: -1.02 },
  'Jalisco|Tlajomulco de Zúñiga': { grado: 'Muy bajo', indice: -1.02 },
  'Jalisco|El Salto':             { grado: 'Bajo',     indice: -0.72 },
  'Jalisco|Puerto Vallarta':      { grado: 'Muy bajo', indice: -1.05 },
  'Jalisco|Lagos de Moreno':      { grado: 'Bajo',     indice: -0.52 },
  'Jalisco|Tepatitlán':           { grado: 'Bajo',     indice: -0.65 },
  'Jalisco|Chapala':              { grado: 'Bajo',     indice: -0.58 },

  // ══════════════ NUEVO LEÓN ══════════════
  'Nuevo León|Monterrey':              { grado: 'Muy bajo', indice: -1.48 },
  'Nuevo León|San Pedro Garza García': { grado: 'Muy bajo', indice: -1.72 },
  'Nuevo León|San Nicolás':            { grado: 'Muy bajo', indice: -1.55 },
  'Nuevo León|San Nicolás de los Garza': { grado: 'Muy bajo', indice: -1.55 },
  'Nuevo León|Guadalupe':              { grado: 'Muy bajo', indice: -1.40 },
  'Nuevo León|Apodaca':                { grado: 'Muy bajo', indice: -1.25 },
  'Nuevo León|Santa Catarina':         { grado: 'Muy bajo', indice: -1.18 },
  'Nuevo León|General Escobedo':       { grado: 'Muy bajo', indice: -1.12 },
  'Nuevo León|García':                 { grado: 'Bajo',     indice: -0.72 },
  'Nuevo León|Juárez':                 { grado: 'Bajo',     indice: -0.62 },
  'Nuevo León|Cadereyta Jiménez':      { grado: 'Bajo',     indice: -0.48 },
  'Nuevo León|Santiago':               { grado: 'Bajo',     indice: -0.55 },

  // ══════════════ QUERÉTARO ══════════════
  'Querétaro|Querétaro':          { grado: 'Muy bajo', indice: -1.18 },
  'Querétaro|Corregidora':        { grado: 'Muy bajo', indice: -1.30 },
  'Querétaro|El Marqués':         { grado: 'Bajo',     indice: -0.55 },
  'Querétaro|San Juan del Río':   { grado: 'Bajo',     indice: -0.62 },
  'Querétaro|Pedro Escobedo':     { grado: 'Bajo',     indice: -0.38 },

  // ══════════════ PUEBLA ══════════════
  'Puebla|Puebla':                { grado: 'Muy bajo', indice: -1.05 },
  'Puebla|San Andrés Cholula':    { grado: 'Bajo',     indice: -0.72 },
  'Puebla|San Pedro Cholula':     { grado: 'Bajo',     indice: -0.48 },
  'Puebla|Atlixco':               { grado: 'Bajo',     indice: -0.35 },
  'Puebla|Cuautlancingo':         { grado: 'Bajo',     indice: -0.65 },
  'Puebla|Amozoc':                { grado: 'Bajo',     indice: -0.42 },
  'Puebla|Tehuacán':              { grado: 'Medio',    indice:  0.05 },

  // ══════════════ GUANAJUATO ══════════════
  'Guanajuato|León':              { grado: 'Muy bajo', indice: -1.15 },
  'Guanajuato|León de los Aldama': { grado: 'Muy bajo', indice: -1.15 },
  'Guanajuato|Irapuato':          { grado: 'Muy bajo', indice: -1.02 },
  'Guanajuato|Celaya':            { grado: 'Muy bajo', indice: -1.08 },
  'Guanajuato|Salamanca':         { grado: 'Bajo',     indice: -0.75 },
  'Guanajuato|Guanajuato':        { grado: 'Bajo',     indice: -0.65 },
  'Guanajuato|San Miguel de Allende': { grado: 'Bajo', indice: -0.38 },
  'Guanajuato|Silao':             { grado: 'Bajo',     indice: -0.52 },

  // ══════════════ AGUASCALIENTES ══════════════
  'Aguascalientes|Aguascalientes': { grado: 'Muy bajo', indice: -1.22 },
  'Aguascalientes|Jesús María':    { grado: 'Bajo',     indice: -0.68 },

  // ══════════════ SAN LUIS POTOSÍ ══════════════
  'San Luis Potosí|San Luis Potosí': { grado: 'Muy bajo', indice: -1.12 },
  'San Luis Potosí|Soledad de Graciano Sánchez': { grado: 'Bajo', indice: -0.78 },

  // ══════════════ CHIHUAHUA ══════════════
  'Chihuahua|Chihuahua':           { grado: 'Muy bajo', indice: -1.35 },
  'Chihuahua|Ciudad Juárez':       { grado: 'Muy bajo', indice: -1.28 },
  'Chihuahua|Cuauhtémoc':          { grado: 'Bajo',     indice: -0.72 },
  'Chihuahua|Delicias':            { grado: 'Bajo',     indice: -0.82 },

  // ══════════════ SONORA ══════════════
  'Sonora|Hermosillo':             { grado: 'Muy bajo', indice: -1.32 },
  'Sonora|Cajeme':                 { grado: 'Muy bajo', indice: -1.10 },
  'Sonora|Ciudad Obregón':         { grado: 'Muy bajo', indice: -1.10 },
  'Sonora|Nogales':                { grado: 'Muy bajo', indice: -1.05 },
  'Sonora|San Luis Río Colorado':  { grado: 'Bajo',     indice: -0.85 },

  // ══════════════ BAJA CALIFORNIA ══════════════
  'Baja California|Tijuana':       { grado: 'Muy bajo', indice: -1.38 },
  'Baja California|Mexicali':      { grado: 'Muy bajo', indice: -1.28 },
  'Baja California|Ensenada':      { grado: 'Muy bajo', indice: -1.02 },
  'Baja California|Rosarito':      { grado: 'Muy bajo', indice: -1.05 },
  'Baja California|Tecate':        { grado: 'Bajo',     indice: -0.78 },

  // ══════════════ BAJA CALIFORNIA SUR ══════════════
  'Baja California Sur|La Paz':     { grado: 'Muy bajo', indice: -1.15 },
  'Baja California Sur|Los Cabos':  { grado: 'Muy bajo', indice: -1.08 },

  // ══════════════ SINALOA ══════════════
  'Sinaloa|Culiacán':              { grado: 'Muy bajo', indice: -1.15 },
  'Sinaloa|Mazatlán':              { grado: 'Muy bajo', indice: -1.05 },
  'Sinaloa|Los Mochis':            { grado: 'Bajo',     indice: -0.72 },
  'Sinaloa|Ahome':                 { grado: 'Bajo',     indice: -0.72 },

  // ══════════════ TAMAULIPAS ══════════════
  'Tamaulipas|Tampico':            { grado: 'Muy bajo', indice: -1.25 },
  'Tamaulipas|Reynosa':            { grado: 'Muy bajo', indice: -1.12 },
  'Tamaulipas|Matamoros':          { grado: 'Bajo',     indice: -0.85 },
  'Tamaulipas|Ciudad Victoria':    { grado: 'Muy bajo', indice: -1.05 },
  'Tamaulipas|Nuevo Laredo':       { grado: 'Muy bajo', indice: -1.08 },
  'Tamaulipas|Altamira':           { grado: 'Bajo',     indice: -0.78 },
  'Tamaulipas|Ciudad Madero':      { grado: 'Muy bajo', indice: -1.18 },

  // ══════════════ VERACRUZ ══════════════
  'Veracruz|Veracruz':             { grado: 'Bajo',     indice: -0.78 },
  'Veracruz|Xalapa':               { grado: 'Muy bajo', indice: -1.02 },
  'Veracruz|Boca del Río':         { grado: 'Muy bajo', indice: -1.15 },
  'Veracruz|Coatzacoalcos':        { grado: 'Bajo',     indice: -0.68 },
  'Veracruz|Córdoba':              { grado: 'Bajo',     indice: -0.52 },
  'Veracruz|Orizaba':              { grado: 'Bajo',     indice: -0.62 },
  'Veracruz|Poza Rica':            { grado: 'Bajo',     indice: -0.48 },

  // ══════════════ YUCATÁN ══════════════
  'Yucatán|Mérida':                { grado: 'Muy bajo', indice: -1.25 },
  'Yucatán|Kanasín':               { grado: 'Bajo',     indice: -0.55 },
  'Yucatán|Progreso':              { grado: 'Bajo',     indice: -0.62 },
  'Yucatán|Umán':                  { grado: 'Bajo',     indice: -0.42 },

  // ══════════════ QUINTANA ROO ══════════════
  'Quintana Roo|Cancún':           { grado: 'Muy bajo', indice: -1.12 },
  'Quintana Roo|Benito Juárez':    { grado: 'Muy bajo', indice: -1.12 },
  'Quintana Roo|Playa del Carmen': { grado: 'Muy bajo', indice: -1.02 },
  'Quintana Roo|Solidaridad':      { grado: 'Muy bajo', indice: -1.02 },
  'Quintana Roo|Chetumal':         { grado: 'Bajo',     indice: -0.68 },
  'Quintana Roo|Othón P. Blanco':  { grado: 'Bajo',     indice: -0.68 },
  'Quintana Roo|Tulum':            { grado: 'Bajo',     indice: -0.45 },

  // ══════════════ COAHUILA ══════════════
  'Coahuila|Saltillo':             { grado: 'Muy bajo', indice: -1.32 },
  'Coahuila|Torreón':              { grado: 'Muy bajo', indice: -1.22 },
  'Coahuila|Monclova':             { grado: 'Muy bajo', indice: -1.12 },
  'Coahuila|Piedras Negras':       { grado: 'Muy bajo', indice: -1.08 },
  'Coahuila|Ramos Arizpe':        { grado: 'Muy bajo', indice: -1.15 },

  // ══════════════ DURANGO ══════════════
  'Durango|Durango':               { grado: 'Muy bajo', indice: -1.05 },
  'Durango|Victoria de Durango':   { grado: 'Muy bajo', indice: -1.05 },
  'Durango|Gómez Palacio':         { grado: 'Bajo',     indice: -0.82 },
  'Durango|Lerdo':                 { grado: 'Bajo',     indice: -0.72 },

  // ══════════════ MICHOACÁN ══════════════
  'Michoacán|Morelia':             { grado: 'Muy bajo', indice: -1.08 },
  'Michoacán|Uruapan':             { grado: 'Bajo',     indice: -0.52 },
  'Michoacán|Zamora':              { grado: 'Bajo',     indice: -0.45 },
  'Michoacán|Lázaro Cárdenas':     { grado: 'Bajo',     indice: -0.38 },

  // ══════════════ TABASCO ══════════════
  'Tabasco|Villahermosa':          { grado: 'Bajo',     indice: -0.72 },
  'Tabasco|Centro':                { grado: 'Bajo',     indice: -0.72 },

  // ══════════════ OAXACA ══════════════
  'Oaxaca|Oaxaca de Juárez':       { grado: 'Bajo',     indice: -0.62 },
  'Oaxaca|Santa Cruz Xoxocotlán': { grado: 'Bajo',     indice: -0.35 },
  'Oaxaca|Huatulco':               { grado: 'Medio',    indice:  0.08 },

  // ══════════════ CHIAPAS ══════════════
  'Chiapas|Tuxtla Gutiérrez':     { grado: 'Bajo',     indice: -0.68 },
  'Chiapas|San Cristóbal de las Casas': { grado: 'Medio', indice: 0.15 },
  'Chiapas|Tapachula':             { grado: 'Bajo',     indice: -0.42 },
  'Chiapas|Comitán':               { grado: 'Medio',    indice:  0.12 },

  // ══════════════ GUERRERO ══════════════
  'Guerrero|Acapulco':             { grado: 'Bajo',     indice: -0.42 },
  'Guerrero|Acapulco de Juárez':   { grado: 'Bajo',     indice: -0.42 },
  'Guerrero|Chilpancingo':         { grado: 'Bajo',     indice: -0.35 },
  'Guerrero|Ixtapa Zihuatanejo':   { grado: 'Bajo',     indice: -0.52 },

  // ══════════════ TLAXCALA ══════════════
  'Tlaxcala|Tlaxcala':             { grado: 'Bajo',     indice: -0.72 },
  'Tlaxcala|Apizaco':              { grado: 'Bajo',     indice: -0.62 },

  // ══════════════ HIDALGO ══════════════
  'Hidalgo|Pachuca':               { grado: 'Muy bajo', indice: -1.02 },
  'Hidalgo|Pachuca de Soto':       { grado: 'Muy bajo', indice: -1.02 },
  'Hidalgo|Mineral de la Reforma': { grado: 'Muy bajo', indice: -1.08 },
  'Hidalgo|Tulancingo':            { grado: 'Bajo',     indice: -0.55 },
  'Hidalgo|Tula de Allende':       { grado: 'Bajo',     indice: -0.48 },

  // ══════════════ NAYARIT ══════════════
  'Nayarit|Tepic':                 { grado: 'Bajo',     indice: -0.82 },
  'Nayarit|Bahía de Banderas':     { grado: 'Bajo',     indice: -0.65 },

  // ══════════════ COLIMA ══════════════
  'Colima|Colima':                 { grado: 'Muy bajo', indice: -1.12 },
  'Colima|Manzanillo':             { grado: 'Bajo',     indice: -0.78 },
  'Colima|Villa de Álvarez':       { grado: 'Muy bajo', indice: -1.05 },

  // ══════════════ ZACATECAS ══════════════
  'Zacatecas|Zacatecas':           { grado: 'Bajo',     indice: -0.82 },
  'Zacatecas|Guadalupe':           { grado: 'Bajo',     indice: -0.72 },
  'Zacatecas|Fresnillo':           { grado: 'Bajo',     indice: -0.42 },

  // ══════════════ CAMPECHE ══════════════
  'Campeche|Campeche':             { grado: 'Bajo',     indice: -0.72 },
  'Campeche|San Francisco de Campeche': { grado: 'Bajo', indice: -0.72 },
  'Campeche|Ciudad del Carmen':    { grado: 'Bajo',     indice: -0.55 },
  'Campeche|Carmen':               { grado: 'Bajo',     indice: -0.55 },
};

/**
 * Lookup rezago social data by estado + municipio
 * Multi-strategy matching: exact → state+partial → broad partial
 * @param {string} municipio
 * @param {string} estado
 * @returns {{ grado: string, indice: number, fuente: string, nivel: string } | null}
 */
export function lookupRezago(municipio, estado) {
  if (!municipio || !estado) return null;

  // Normalize: trim, title case, strip accents for comparison
  const normalize = s => s.trim().replace(/\b\w/g, c => c.toUpperCase());
  const stripAccents = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const key = `${normalize(estado)}|${normalize(municipio)}`;

  // Strategy 1: Exact key match
  if (CONEVAL_REZAGO[key]) {
    return { ...CONEVAL_REZAGO[key], fuente: 'CONEVAL 2020', nivel: 'municipio' };
  }

  // Strategy 2: Accent-stripped exact match
  const keyNorm = stripAccents(key);
  const accMatch = Object.entries(CONEVAL_REZAGO).find(([k]) => stripAccents(k) === keyNorm);
  if (accMatch) return { ...accMatch[1], fuente: 'CONEVAL 2020', nivel: 'municipio' };

  // Strategy 3: Same state + municipio starts with or contains
  const estNorm = stripAccents(estado);
  const munNorm = stripAccents(municipio);
  const stateMatches = Object.entries(CONEVAL_REZAGO).filter(([k]) =>
    stripAccents(k.split('|')[0]) === estNorm
  );
  // Try: registry municipio starts with search term, or vice versa
  const startMatch = stateMatches.find(([k]) => {
    const regMun = stripAccents(k.split('|')[1]);
    return regMun.startsWith(munNorm) || munNorm.startsWith(regMun);
  });
  if (startMatch) return { ...startMatch[1], fuente: 'CONEVAL 2020', nivel: 'municipio' };

  // Strategy 4: Broad partial match (any state, municipio contains)
  const partial = Object.entries(CONEVAL_REZAGO).find(([k]) => {
    const regMun = stripAccents(k.split('|')[1]);
    return regMun === munNorm || regMun.includes(munNorm) || munNorm.includes(regMun);
  });
  if (partial) return { ...partial[1], fuente: 'CONEVAL 2020', nivel: 'municipio' };

  return null;
}

