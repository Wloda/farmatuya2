/**
 * Numerical validation of BW² financial engine
 * Runs projections and cross-checks against documented data
 */
import { MODELS, SCENARIOS, SEASONALITY } from './data/model-registry.js';
import { runProjection, calcPaybackMetrics, calcFixedCosts, calcVarRate, generateChecklist, evaluateAlerts, runSensitivity } from './engine/financial-model.js';

const fmt = v => '$' + Math.round(v).toLocaleString();
const pct = v => (v*100).toFixed(2) + '%';

console.log('═══════════════════════════════════════════════════');
console.log('  BW² FINANCIAL ENGINE — NUMERICAL VALIDATION');
console.log('═══════════════════════════════════════════════════\n');

for (const [modelId, model] of Object.entries(MODELS)) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  MODEL: ${model.label} (${modelId})`);
  console.log(`${'═'.repeat(60)}`);

  // Run base projection
  const r = runProjection(modelId, {});

  // ── 1. Fixed Cost Validation ──
  const cfM1 = calcFixedCosts(model.fixedCosts, 1);
  const cfM2 = calcFixedCosts(model.fixedCosts, 2);
  const cfM3 = calcFixedCosts(model.fixedCosts, 3);
  const docM1 = model.fixedCosts.totalDocumented?.m1;
  const docM2 = model.fixedCosts.totalDocumented?.m2;
  const docM3 = model.fixedCosts.totalDocumented?.m3;

  console.log('\n── Fixed Costs Reconciliation ──');
  console.log(`  M1: Engine=${fmt(cfM1)}, Doc=${docM1?fmt(docM1):'N/A'}, Δ=${docM1?fmt(cfM1-docM1):'N/A'}`);
  console.log(`  M2: Engine=${fmt(cfM2)}, Doc=${docM2?fmt(docM2):'N/A'}, Δ=${docM2?fmt(cfM2-docM2):'N/A'}`);
  console.log(`  M3: Engine=${fmt(cfM3)}, Doc=${docM3?fmt(docM3):'N/A'}, Δ=${docM3?fmt(cfM3-docM3):'N/A'}`);
  console.log(`  Summary CF: ${model.summary.fixedCosts ? fmt(model.summary.fixedCosts) : 'N/A'}`);
  if (model.summary.fixedCosts) {
    console.log(`  Engine M3 vs Summary: Δ${fmt(cfM3 - model.summary.fixedCosts)}`);
  }

  // ── 2. Variable Cost Rate ──
  const vcRate = calcVarRate(model.variableCosts, 'variable_2_5', 12);
  const mc = 1 - vcRate;
  console.log('\n── Variable Costs ──');
  console.log(`  COGS: ${pct(model.variableCosts.cogs)}`);
  console.log(`  Total VC Rate: ${pct(vcRate)} (doc: ${pct(model.variableCosts.cvTotal)})`);
  console.log(`  MC: ${pct(mc)} (doc: ${pct(model.variableCosts.mc)})`);
  console.log(`  VC Rate Δ: ${pct(vcRate - model.variableCosts.cvTotal)}`);

  // ── 3. Revenue Ramp ──
  console.log('\n── Revenue Ramp (first 12 months) ──');
  const months = r.months;
  for (let i = 0; i < Math.min(12, months.length); i++) {
    const m = months[i];
    const docKey = `m${i+1}`;
    const docRev = model.sales[docKey];
    const docNet = model.netProfitDoc?.[docKey];
    const revDelta = docRev ? `Δ${fmt(m.revenue - docRev)}` : '';
    const netDelta = docNet != null ? `ΔNet=${fmt(m.netIncome - docNet)}` : '';
    if (docRev || i < 8) {
      console.log(`  M${String(i+1).padStart(2)}: Rev=${fmt(m.revenue).padEnd(12)} ${docRev ? `Doc=${fmt(docRev).padEnd(12)} ${revDelta}` : ''}`);
      if (docNet != null) {
        console.log(`        Net=${fmt(m.netIncome).padEnd(12)} Doc=${fmt(docNet).padEnd(12)} ${netDelta}`);
      }
    }
  }

  // Check key milestones
  console.log('\n── Milestone Months ──');
  for (const mk of ['m12', 'm24', 'm36', 'm48', 'm60']) {
    const mi = parseInt(mk.slice(1)) - 1;
    if (mi < months.length) {
      const m = months[mi];
      const docRev = model.sales[mk];
      const docNet = model.netProfitDoc?.[mk];
      console.log(`  ${mk}: Rev=${fmt(m.revenue)}${docRev ? ` (doc=${fmt(docRev)}, Δ${fmt(m.revenue-docRev)})` : ''}`);
      if (docNet != null) {
        console.log(`       Net=${fmt(m.netIncome)} (doc=${fmt(docNet)}, Δ${fmt(m.netIncome-docNet)})`);
      }
    }
  }

  // ── 4. Aggregates ──
  console.log('\n── Key Metrics ──');
  console.log(`  Total Investment: ${fmt(r.totalInvestment)}`);
  console.log(`  Break-Even Revenue: ${fmt(r.breakEvenRevenue)} (${pct(r.breakEvenPctCapacity)} of capacity)`);
  console.log(`  Rent % Revenue: ${pct(r.rentPctRevenue)}`);
  console.log(`  Tax Rate: ${pct(model.taxRate)}`);
  console.log(`  Avg Monthly EBITDA (stab): ${fmt(r.avgMonthlyEBITDA)}`);
  console.log(`  Avg Monthly Revenue (stab): ${fmt(r.avgMonthlyRevenue)}`);
  console.log(`  EBITDA Margin (stab): ${pct(r.ebitdaMarginStabilized)}`);
  console.log(`  NPV: ${fmt(r.npv)}`);
  console.log(`  IRR: ${r.irr != null ? pct(r.irr) : 'N/A'}`);
  console.log(`  ROI 12m: ${r.roi12.toFixed(1)}%`);
  console.log(`  ROI 24m: ${r.roi24.toFixed(1)}%`);
  console.log(`  ROI 36m: ${r.roi36.toFixed(1)}%`);
  console.log(`  ROI Anual (roi36/3): ${(r.roi36/3).toFixed(1)}%`);
  console.log(`  ROI Anual (CAGR): ${((Math.pow(1+r.roi36/100, 1/3)-1)*100).toFixed(1)}%`);

  // ── 5. Payback Comparison ──
  console.log('\n── Payback Metrics ──');
  const pm = r.paybackMetrics;
  console.log(`  Documented Claim: ${pm.documentedClaim || 'N/A'} meses`);
  console.log(`  PB Simple: ${pm.simple.min?.toFixed(1) || '∞'} – ${pm.simple.max?.toFixed(1) || '∞'} meses`);
  console.log(`  PB Promedio 5Y: ${pm.avg5y.min?.toFixed(1) || '∞'} – ${pm.avg5y.max?.toFixed(1) || '∞'} meses`);
  console.log(`  PB Rampa: ${pm.rampa.month || '∞'} meses${pm.rampa.extrapolated ? ' (extrapolado)' : ''}`);
  console.log(`  BE Operativo: ${pm.beOperativo.month || '∞'} meses`);
  console.log(`  Legacy paybackMonth: ${r.paybackMonth || '∞'}`);
  console.log(`  PB Simple (motor, netStab): ${r.paybackSimple?.toFixed(1) || '∞'} meses`);
  console.log(`  Audit: ${pm.auditStatus} — ${pm.auditNote}`);

  // Compare payback simple from summary vs from engine
  const netStab = r.avgMonthlyEBITDA * (1 - model.taxRate);
  const pbFromEngine = netStab > 0 ? r.totalInvestment / netStab : null;
  console.log(`  PB from netStab: ${pbFromEngine?.toFixed(1) || '∞'} meses`);
  console.log(`  ⚠️ PB Simple uses summary.profitRange, NOT engine netStab`);

  // ── 6. Score ──
  console.log(`\n── Viability Score: ${r.viabilityScore}/100 ──`);

  // ── 7. Checklist ──
  const checklist = generateChecklist(r);
  console.log('\n── Checklist ──');
  checklist.forEach(c => {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.item}: ${c.detail}`);
  });

  // ── 8. Alerts ──
  const alerts = evaluateAlerts(r);
  if (alerts.length) {
    console.log('\n── Alerts ──');
    alerts.forEach(a => console.log(`  ${a.icon} [${a.severity}] ${a.label}: ${a.message}`));
  }

  // ── 9. Edge cases ──
  console.log('\n── Edge Case Tests ──');
  
  // Zero revenue scenario
  try {
    const r0 = runProjection(modelId, { scenarioFactor: 0 });
    console.log(`  Factor=0: EBITDA=${fmt(r0.avgMonthlyEBITDA)}, PB=${r0.paybackMonth||'∞'}, Score=${r0.viabilityScore}`);
  } catch(e) {
    console.log(`  Factor=0: ERROR: ${e.message}`);
  }

  // Extreme rent
  try {
    const rHigh = runProjection(modelId, { rent: 100000 });
    console.log(`  Rent=100K: EBITDA=${fmt(rHigh.avgMonthlyEBITDA)}, BE=${fmt(rHigh.breakEvenRevenue)}, Score=${rHigh.viabilityScore}`);
  } catch(e) {
    console.log(`  Rent=100K: ERROR: ${e.message}`);
  }

  // Negative margin scenario (COGS > 100%)
  try {
    const rNeg = runProjection(modelId, { variableCosts: {...model.variableCosts, cogs: 0.95} });
    console.log(`  COGS=95%: EBITDA=${fmt(rNeg.avgMonthlyEBITDA)}, BE=${fmt(rNeg.breakEvenRevenue)}, Score=${rNeg.viabilityScore}`);
  } catch(e) {
    console.log(`  COGS=95%: ERROR: ${e.message}`);
  }

  // ── 10. Scenario comparison ──
  console.log('\n── Scenario Spread ──');
  for (const [sid, sc] of Object.entries(SCENARIOS)) {
    const overrides = {};
    overrides.scenarioFactor = sc.factor;
    if (sc.rentAdj && sc.rentAdj !== 1) overrides.rent = model.fixedCosts.rent * sc.rentAdj;
    if (sc.mermaAdj) overrides.variableCosts = {...model.variableCosts, merma: model.variableCosts.merma + sc.mermaAdj};
    const rs = runProjection(modelId, overrides);
    console.log(`  ${sc.emoji} ${sc.label.padEnd(14)}: EBITDA=${fmt(rs.avgMonthlyEBITDA).padEnd(10)} PB=${String(rs.paybackMonth||'∞').padEnd(4)} NPV=${fmt(rs.npv).padEnd(14)} Score=${rs.viabilityScore}`);
  }

  // ── 11. Cumulative Cash Flow check ──
  console.log('\n── Cash Flow Trajectory ──');
  const cfChecks = [6, 12, 18, 24, 36, 48, 60];
  for (const m of cfChecks) {
    if (m <= months.length) {
      const mon = months[m-1];
      console.log(`  M${String(m).padStart(2)}: CumCF=${fmt(mon.cumulativeCashFlow).padEnd(14)} NetIncome=${fmt(mon.netIncome).padEnd(10)} Rev=${fmt(mon.revenue)}`);
    }
  }

  // ── 12. Sensitivity Analysis ──
  try {
    const sens = runSensitivity(modelId, {});
    console.log('\n── Sensitivity (±20%) ──');
    sens.forEach(s => {
      console.log(`  ${s.label.padEnd(16)}: EBITDA Δ ↑${fmt(s.ebitdaDeltaUp).padEnd(10)} ↓${fmt(s.ebitdaDeltaDown).padEnd(10)} Impact=${fmt(s.impact)}`);
    });
  } catch(e) {
    console.log(`  Sensitivity ERROR: ${e.message}`);
  }
}

// ── CROSS-MODEL CONSISTENCY CHECKS ──
console.log('\n\n' + '═'.repeat(60));
console.log('  CROSS-MODEL CONSISTENCY CHECKS');
console.log('═'.repeat(60));

const allResults = {};
for (const [id, m] of Object.entries(MODELS)) {
  allResults[id] = runProjection(id, {});
}

console.log('\n── Margin Comparison ──');
for (const [id, r] of Object.entries(allResults)) {
  const m = MODELS[id];
  console.log(`  ${m.label.padEnd(20)}: GM=${pct(r.grossMargin).padEnd(8)} MC=${pct(r.mc).padEnd(8)} EBITDA%=${pct(r.ebitdaMarginStabilized).padEnd(8)} Tax=${pct(m.taxRate)}`);
}

console.log('\n── Investment Efficiency ──');
for (const [id, r] of Object.entries(allResults)) {
  const m = MODELS[id];
  const monthlyROI = r.avgMonthlyEBITDA / r.totalInvestment * 100;
  console.log(`  ${m.label.padEnd(20)}: Inv=${fmt(r.totalInvestment).padEnd(14)} EBITDA/Inv=${monthlyROI.toFixed(2)}%/mo  NPV/Inv=${(r.npv/r.totalInvestment*100).toFixed(1)}%`);
}

// ── SEASONALITY VALIDATION ──
console.log('\n── Seasonality Sum Check ──');
const seasonSum = SEASONALITY.reduce((s,v) => s+v, 0);
console.log(`  Sum of 12 months: ${seasonSum.toFixed(4)} (should be ~12.00)`);
console.log(`  Average: ${(seasonSum/12).toFixed(4)} (should be ~1.00)`);

// ── TAX LOSS POOL VERIFICATION ──
console.log('\n── Tax Loss Carryforward Verification (Súper model) ──');
const rSuper = allResults['super'];
if (rSuper) {
  let pool = 0, totalTax = 0;
  rSuper.months.forEach((m, i) => {
    if (m.ebitda > 0) {
      const taxable = Math.max(0, m.ebitda - pool);
      const used = m.ebitda - taxable;
      pool -= used;
      totalTax += taxable * 0.03;
    } else {
      pool += Math.abs(m.ebitda);
    }
    if (i < 12 || (i+1) % 12 === 0) {
      // only log year-ends and first year
    }
  });
  console.log(`  Total tax paid (60m): ${fmt(totalTax)}`);
  console.log(`  Effective tax rate: ${pct(totalTax / rSuper.months.reduce((s,m)=>s+Math.max(0,m.ebitda),0))}`);
  console.log(`  Final loss pool: ${fmt(pool)}`);
}

console.log('\n\n✅ Validation complete.\n');
