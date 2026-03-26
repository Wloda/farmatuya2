/**
 * BW² — PDF Export Module
 * Generates a professional 5-page investment report PDF.
 * Uses jsPDF (global) + html2canvas (global) loaded via CDN.
 */
import { MODELS, SCENARIOS } from './data/model-registry.js?v=bw3';
import { runBranchProjection } from './engine/enterprise-engine.js?v=bw3';
import { generateChecklist, evaluateAlerts, calcStress, runSensitivity } from './engine/financial-model.js?v=bw3';

/* ── Helpers ── */
const fm = v => '$' + Math.round(v).toLocaleString('es-MX');
const fp = v => (v * 100).toFixed(1) + '%';
const fmo = v => v != null ? v + ' m' : '∞';

const COLORS = {
  dark: '#0f172a', accent: '#4d7cfe', green: '#34d399',
  red: '#f87171', yellow: '#fbbf24', text: '#334155',
  textLight: '#64748b', bg: '#f8fafc', line: '#e2e8f0'
};

/* ── Capture a canvas chart as image ── */
async function captureChart(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return null;
  // Ensure parent is visible temporarily
  const panel = el.closest('.branch-tab-panel');
  let wasHidden = false;
  if (panel && !panel.classList.contains('active')) {
    panel.style.display = 'block';
    panel.style.position = 'absolute';
    panel.style.left = '-9999px';
    wasHidden = true;
  }
  try {
    const canvas = await html2canvas(el, { backgroundColor: null, scale: 2 });
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('Chart capture failed:', canvasId, e);
    return null;
  } finally {
    if (wasHidden && panel) {
      panel.style.display = '';
      panel.style.position = '';
      panel.style.left = '';
    }
  }
}

/* ── Draw styled text helpers ── */
function drawTitle(doc, text, x, y) {
  doc.setFontSize(18); doc.setTextColor(COLORS.dark); doc.setFont('helvetica', 'bold');
  doc.text(text, x, y);
  return y + 10;
}
function drawSubtitle(doc, text, x, y) {
  doc.setFontSize(12); doc.setTextColor(COLORS.accent); doc.setFont('helvetica', 'bold');
  doc.text(text, x, y);
  return y + 7;
}
function drawLabel(doc, text, x, y) {
  doc.setFontSize(9); doc.setTextColor(COLORS.textLight); doc.setFont('helvetica', 'normal');
  doc.text(text, x, y);
}
function drawValue(doc, text, x, y, color) {
  doc.setFontSize(11); doc.setTextColor(color || COLORS.dark); doc.setFont('helvetica', 'bold');
  doc.text(String(text), x, y);
}

/* ── Draw a KPI row ── */
function drawKPI(doc, label, value, x, y, w, color) {
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, 14, 2, 2, 'F');
  drawLabel(doc, label, x + 3, y + 5);
  drawValue(doc, String(value), x + 3, y + 11, color);
  return y + 16;
}

/* ── Table drawing ── */
function drawTable(doc, headers, rows, x, startY, colWidths) {
  const rowH = 6; let y = startY;
  const totalW = colWidths.reduce((a, b) => a + b, 0);

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(x, y, totalW, rowH + 1, 'F');
  doc.setFontSize(7); doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold');
  let cx = x;
  headers.forEach((h, i) => {
    doc.text(h, cx + 1.5, y + 4.5);
    cx += colWidths[i];
  });
  y += rowH + 1;

  // Rows
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  rows.forEach((row, ri) => {
    if (y > 260) { doc.addPage(); y = 20; } // Page break
    if (ri % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(x, y, totalW, rowH, 'F'); }
    cx = x;
    row.forEach((cell, ci) => {
      const val = String(cell);
      const isNeg = val.startsWith('-$') || val.startsWith('-');
      doc.setTextColor(isNeg ? COLORS.red : COLORS.text);
      doc.text(val, cx + 1.5, y + 4);
      cx += colWidths[ci];
    });
    y += rowH;
  });
  return y;
}

/* ── Page footer ── */
function addFooter(doc, pageNum, totalPages) {
  doc.setFontSize(7); doc.setTextColor(COLORS.textLight); doc.setFont('helvetica', 'normal');
  doc.text(`BW² — Reporte de Inversión  |  Página ${pageNum} de ${totalPages}`, 105, 274, { align: 'center' });
  doc.setDrawColor(226, 232, 240);
  doc.line(20, 270, 195, 270);
}

/* ════════════════════════════════════════════════════ */
/* ═══ MAIN EXPORT FUNCTION                       ═══ */
/* ════════════════════════════════════════════════════ */
export async function generateBranchPDF(branch, empresa) {
  if (!window.jspdf) throw new Error('jsPDF no cargó. Verifica tu conexión a internet.');
  const { jsPDF } = window.jspdf;
  const model = MODELS[branch.format];
  const scenario = SCENARIOS[branch.scenarioId] || SCENARIOS.base;
  const r = runBranchProjection(branch, empresa);
  const checklist = generateChecklist(r);
  const alerts = evaluateAlerts(r);
  const pm = r.paybackMetrics;
  const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

  const doc = new jsPDF('p', 'mm', 'letter');
  const PW = 215.9, PH = 279.4; // Letter size in mm
  const ML = 20, MR = 20; // Margins
  const CW = PW - ML - MR; // Content width

  // ══════════════ PAGE 1: COVER + EXECUTIVE SUMMARY ══════════════
  // Header bar
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, PW, 45, 'F');
  // Accent line
  doc.setFillColor(77, 124, 254);
  doc.rect(0, 45, PW, 2, 'F');

  // Logo text
  doc.setFontSize(28); doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold');
  doc.text('BW²', ML, 22);
  doc.setFontSize(10); doc.setTextColor('#94a3b8'); doc.setFont('helvetica', 'normal');
  doc.text('Dashboard de Inversión', ML, 30);
  doc.setFontSize(9); doc.setTextColor('#64748b');
  doc.text(dateStr, PW - MR, 30, { align: 'right' });

  // Title
  doc.setFontSize(22); doc.setTextColor(COLORS.dark); doc.setFont('helvetica', 'bold');
  doc.text('Reporte de Inversión', ML, 60);
  doc.setFontSize(16); doc.setTextColor(COLORS.accent);
  doc.text(branch.name, ML, 70);
  doc.setFontSize(10); doc.setTextColor(COLORS.textLight); doc.setFont('helvetica', 'normal');
  doc.text(`${model.emoji} ${model.label}  ·  ${scenario.emoji} ${scenario.label}`, ML, 78);

  // Score badge
  const scoreColor = r.viabilityScore >= 60 ? COLORS.green : r.viabilityScore >= 40 ? COLORS.yellow : COLORS.red;
  const scoreLabel = r.viabilityScore >= 80 ? 'EXCELENTE' : r.viabilityScore >= 60 ? 'VIABLE' : r.viabilityScore >= 40 ? 'FRÁGIL' : 'NO VIABLE';
  doc.setFillColor(...hexToRgb(scoreColor));
  doc.roundedRect(PW - MR - 45, 55, 45, 25, 4, 4, 'F');
  doc.setFontSize(22); doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold');
  doc.text(String(r.viabilityScore), PW - MR - 22.5, 68, { align: 'center' });
  doc.setFontSize(8);
  doc.text(scoreLabel, PW - MR - 22.5, 75, { align: 'center' });

  // KPI Summary Grid
  let y = 90;
  y = drawSubtitle(doc, 'Resumen Ejecutivo', ML, y);
  doc.setDrawColor(226, 232, 240);
  doc.line(ML, y, PW - MR, y); y += 5;

  const kpis = [
    ['Inversión Total', fm(r.totalInvestment)],
    ['Capital Socios', fm(r.totalPartnerCapital)],
    ['Capital Libre', fm(r.capitalRemaining)],
    ['Reserva Recom.', fm(r.recommendedReserve)],
    ['EBITDA / mes', fm(r.avgMonthlyEBITDA), r.avgMonthlyEBITDA > 0 ? COLORS.green : COLORS.red],
    ['Venta Prom. / mes', fm(r.avgMonthlyRevenue)],
    ['Margen EBITDA', fp(r.ebitdaMarginStabilized)],
    ['Margen Contrib.', fp(r.mc)],
    ['Pto. Equilibrio', fm(r.breakEvenRevenue)],
    ['BE % Capacidad', fp(r.breakEvenPctCapacity), r.breakEvenPctCapacity < 0.7 ? COLORS.green : COLORS.red],
    ['Recup. Simple', pm.simple.min != null ? `${pm.simple.min.toFixed(0)}–${pm.simple.max.toFixed(0)} m` : '∞'],
    ['Recup. Rampa', fmo(pm.rampa.month)],
    ['ROI 12m', fp(r.roi12 / 100), r.roi12 > 0 ? COLORS.green : COLORS.red],
    ['ROI 36m', fp(r.roi36 / 100), r.roi36 > 20 ? COLORS.green : COLORS.red],
    ['VPN', fm(r.npv), r.npv > 0 ? COLORS.green : COLORS.red],
    ['TIR', r.irr != null ? fp(r.irr) : 'N/A', r.irr && r.irr > 0.12 ? COLORS.green : COLORS.red],
  ];

  const colW = CW / 2;
  kpis.forEach((kpi, i) => {
    const col = i % 2;
    const kx = ML + col * colW;
    drawKPI(doc, kpi[0], kpi[1], kx, y, colW - 2, kpi[2]);
    if (col === 1) y += 16;
  });
  if (kpis.length % 2 !== 0) y += 16;

  // Partners summary
  y += 5;
  y = drawSubtitle(doc, 'Retorno por Socio', ML, y);
  const partHeaders = ['Socio', 'Capital', 'Participación', 'Ganancia/mes', 'ROI 3A', 'Payback'];
  const partRows = r.perPartnerMonthly.map(p => [
    p.name, fm(p.capital), fp(p.equity), fm(p.monthlyIncome),
    p.roi36.toFixed(1) + '%', p.paybackMonth ? p.paybackMonth + ' m' : '∞'
  ]);
  const partWidths = [30, 28, 25, 28, 20, 20];
  y = drawTable(doc, partHeaders, partRows, ML, y, partWidths);

  addFooter(doc, 1, 5);

  // ══════════════ PAGE 2: CHECKLIST + CASH FLOW ══════════════
  doc.addPage();
  y = 20;
  y = drawTitle(doc, 'Checklist Go/No-Go', ML, y);

  checklist.forEach(item => {
    const icon = item.pass ? '✓' : '✗';
    const color = item.pass ? COLORS.green : COLORS.red;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(ML, y, CW, 10, 2, 2, 'F');
    doc.setFontSize(12); doc.setTextColor(color); doc.setFont('helvetica', 'bold');
    doc.text(icon, ML + 3, y + 7);
    doc.setFontSize(9); doc.setTextColor(COLORS.dark); doc.setFont('helvetica', 'normal');
    doc.text(item.item, ML + 12, y + 5);
    doc.setFontSize(8); doc.setTextColor(COLORS.textLight);
    doc.text(item.detail, ML + 12, y + 9);
    y += 12;
  });

  // Cash Flow chart
  y += 5;
  y = drawSubtitle(doc, 'Flujo de Caja Acumulado (60 meses)', ML, y);
  const cfImg = await captureChart('chart-branch-cashflow');
  if (cfImg) {
    const imgH = 70;
    doc.addImage(cfImg, 'PNG', ML, y, CW, imgH);
    y += imgH + 5;
  }

  // Alerts
  if (alerts.length) {
    y = drawSubtitle(doc, 'Alertas', ML, y);
    alerts.forEach(a => {
      const aColor = a.severity === 'critical' ? COLORS.red : a.severity === 'warning' ? COLORS.yellow : COLORS.green;
      doc.setFontSize(9); doc.setTextColor(aColor); doc.setFont('helvetica', 'bold');
      doc.text(`${a.icon} ${a.label}`, ML + 3, y + 4);
      doc.setFontSize(8); doc.setTextColor(COLORS.text); doc.setFont('helvetica', 'normal');
      doc.text(a.message, ML + 40, y + 4);
      y += 7;
    });
  }

  addFooter(doc, 2, 5);

  // ══════════════ PAGE 3: ANNUAL P&L + COSTS ══════════════
  doc.addPage();
  y = 20;
  y = drawTitle(doc, 'Resultados Financieros', ML, y);

  // Annual table
  y = drawSubtitle(doc, 'Resumen Anual', ML, y);
  const as = r.annualSummary;
  const annHeaders = ['Año', 'Ingresos', 'Ut. Neta', 'Flujo de Caja'];
  const annRows = ['year1', 'year2', 'year3', 'year4', 'year5']
    .filter(k => as[k])
    .map((k, i) => ['Año ' + (i + 1), fm(as[k].revenue), fm(as[k].netIncome), fm(as[k].cashFlow)]);
  const annWidths = [25, 45, 45, 45];
  y = drawTable(doc, annHeaders, annRows, ML, y, annWidths);

  // Fixed costs chart
  y += 8;
  y = drawSubtitle(doc, 'Desglose de Costos Fijos', ML, y);
  const donutImg = await captureChart('chart-branch-donut');
  if (donutImg) {
    doc.addImage(donutImg, 'PNG', ML, y, CW / 2, 55);
  }
  // Variable costs chart
  const cvImg = await captureChart('chart-branch-cv');
  if (cvImg) {
    doc.addImage(cvImg, 'PNG', ML + CW / 2 + 5, y, CW / 2 - 5, 55);
  }
  y += 60;

  // Fixed cost breakdown as text
  y = drawSubtitle(doc, 'Estructura de Costos', ML, y);
  const bd = r.fixedCostBreakdown;
  const costItems = [
    ['Renta', fm(bd.renta)], ['Nómina', fm(bd.nomina)], ['Carga Social', fm(bd.cargaSocial)],
    ['Sistemas', fm(bd.sistemas)], ['Contabilidad', fm(bd.contabilidad)], ['Serv. Papel', fm(bd.serviciosPap)]
  ];
  if (bd.omisiones) costItems.push(['Omisiones', fm(bd.omisiones)]);
  costItems.push(['TOTAL CF/mes', fm(r.totalFixedMonthly)]);

  costItems.forEach((ci, i) => {
    const isBold = i === costItems.length - 1;
    doc.setFontSize(8);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setTextColor(COLORS.text);
    doc.text(ci[0], ML + 3, y + 4);
    doc.text(ci[1], ML + 50, y + 4);
    y += 5;
  });

  addFooter(doc, 3, 5);

  // ══════════════ PAGE 4: MONTHLY P&L ══════════════
  doc.addPage();
  y = 20;
  y = drawTitle(doc, 'P&L Mensual', ML, y);

  const pnlHeaders = ['Mes', 'Venta', 'COGS', 'Ut.Br.', 'CF', 'CV', 'EBITDA', 'Imp.', 'Ut.Net', 'Acum.'];
  const pnlWidths = [13, 20, 18, 18, 18, 18, 20, 15, 18, 20];
  const pnlRows = r.months.slice(0, 36).map(m => [
    (m.preOpen ? 'P' : 'M') + m.month,
    fm(m.revenue), fm(m.cogs), fm(m.grossProfit),
    fm(m.totalFixedCosts), fm(m.variableCosts), fm(m.ebitda),
    fm(m.taxes), fm(m.netIncome), fm(m.cumulativeCashFlow)
  ]);
  y = drawTable(doc, pnlHeaders, pnlRows, ML, y, pnlWidths);

  addFooter(doc, 4, 5);

  // ══════════════ PAGE 5: RISK ANALYSIS ══════════════
  doc.addPage();
  y = 20;
  y = drawTitle(doc, 'Análisis de Riesgo', ML, y);

  let stress;
  try { stress = calcStress(branch.format, branch.overrides || {}); }
  catch (e) { stress = { maxRent: 0, fragilityPct: 1, viableCells: 0, totalCells: 1 }; }

  const riskKPIs = [
    ['Renta Máxima Viable', fm(stress.maxRent), stress.maxRent > (r.fixedCostBreakdown?.renta || 0) * 1.2 ? COLORS.green : COLORS.red],
    ['Fragilidad', fp(stress.fragilityPct), stress.fragilityPct < 0.3 ? COLORS.green : COLORS.red],
    ['Escenarios Viables', `${stress.viableCells}/${stress.totalCells}`],
    ['Renta Actual', fm(r.fixedCostBreakdown?.renta || 0)],
    ['Renta % Venta', fp(r.rentPctRevenue), r.rentPctRevenue < 0.15 ? COLORS.green : COLORS.red],
    ['BE % Capacidad', fp(r.breakEvenPctCapacity), r.breakEvenPctCapacity < 0.7 ? COLORS.green : COLORS.red],
  ];

  riskKPIs.forEach((kpi, i) => {
    const col = i % 2;
    const kx = ML + col * colW;
    drawKPI(doc, kpi[0], kpi[1], kx, y, colW - 2, kpi[2]);
    if (col === 1) y += 16;
  });
  if (riskKPIs.length % 2 !== 0) y += 16;

  // Tornado chart
  y += 5;
  y = drawSubtitle(doc, 'Sensibilidad (±20%)', ML, y);
  const tornadoImg = await captureChart('chart-branch-tornado');
  if (tornadoImg) {
    doc.addImage(tornadoImg, 'PNG', ML, y, CW, 65);
    y += 70;
  }

  // Sensitivity table
  let sensitivity;
  try { sensitivity = runSensitivity(branch.format, branch.overrides || {}); }
  catch (e) { sensitivity = []; }

  if (sensitivity.length) {
    y = drawSubtitle(doc, 'Tabla de Sensibilidad', ML, y);
    const sensHeaders = ['Variable', 'Valor Base', 'EBITDA +20%', 'EBITDA −20%', 'Impacto'];
    const sensRows = sensitivity.map(s => [
      s.label,
      typeof s.baseValue === 'number' && s.baseValue < 1 ? fp(s.baseValue) : fm(s.baseValue),
      fm(s.ebitdaDeltaUp), fm(s.ebitdaDeltaDown), fm(s.impact)
    ]);
    const sensWidths = [30, 28, 30, 30, 28];
    y = drawTable(doc, sensHeaders, sensRows, ML, y, sensWidths);
  }

  addFooter(doc, 5, 5);

  // ══════════════ SAVE ══════════════
  const safeName = branch.name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').replace(/\s+/g, '_');
  doc.save(`${safeName}_Reporte_Inversion.pdf`);
  return true;
}

/* ── Util ── */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}
