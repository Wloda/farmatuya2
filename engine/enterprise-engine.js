/**
 * FarmaTuya — Enterprise Engine (v7)
 * Wraps the core financial-model.js for multi-branch projections.
 * Core engine is NOT modified — this is a pure wrapper.
 */
import { MODELS, SCENARIOS } from '../data/model-registry.js?v=bw37';
import { runProjection } from './financial-model.js?v=bw37';
import { calcCombinedMarketFactor } from './location-engine.js?v=bw37';

/* ── Single Branch Projection ── */
export function runBranchProjection(branch, empresa, activeEmpresa) {
  const sc = SCENARIOS[branch.scenarioId] || SCENARIOS.base;
  const model = MODELS[branch.format];
  if (!model) throw new Error('Unknown format: ' + branch.format);

  const overrides = { ...branch.overrides };

  // Apply scenario adjustments
  overrides.scenarioFactor = (sc.factor || 1) * (overrides.scenarioFactor || 1);
  if (sc.rentAdj && sc.rentAdj !== 1) {
    overrides.rent = (overrides.fixedCosts?.rent || model.fixedCosts.rent) * sc.rentAdj;
  }
  if (sc.mermaAdj) {
    const vc = { ...(overrides.variableCosts || model.variableCosts) };
    vc.merma = (vc.merma || model.variableCosts.merma) + sc.mermaAdj;
    overrides.variableCosts = vc;
  }

  // Apply market study adjustments (if study exists and is enabled)
  // Settings are on the actual empresa (activeEmpresa), not on the proyecto
  const settingsSource = activeEmpresa || empresa;
  const globalMarketEnabled = settingsSource?.settings?.applyMarketFactor !== false;
  if (globalMarketEnabled && branch.locationStudy?.scores?.factors && overrides.marketStudyEnabled !== false) {
    const toggles = overrides.marketStudyToggles || {};
    const { combinedFactor } = calcCombinedMarketFactor(branch.locationStudy.scores.factors, toggles);
    overrides.scenarioFactor *= combinedFactor;
  }

  // Partners come from empresa, not from branch
  overrides.partners = empresa?.partners || [];

  // Enforce 0 royalty if the project is not a franchise
  const proj = empresa?.proyectos?.find(p => p.id === branch.proyectoId);
  if (proj && proj.isFranchise === false) {
    overrides.variableCosts = { ...(overrides.variableCosts || model.variableCosts) };
    overrides.variableCosts.regalia = 0;
  }

  const result = runProjection(branch.format, overrides);
  result._overridesUsed = overrides;
  return result;
}

/* ── Enterprise Consolidation ── */
export function runConsolidation(empresa, activeEmpresa) {
  const activeBranches = empresa.branches.filter(b => b.status !== 'paused' && b.status !== 'archived');

  const branchResults = activeBranches.map(branch => ({
    branch,
    result: runBranchProjection(branch, empresa, activeEmpresa)
  }));

  // Totals
  const totalInvestment = branchResults.reduce((s, br) => s + br.result.totalInvestment, 0);
  const capitalCommitted = totalInvestment + empresa.corporateReserve;
  const capitalFree = empresa.totalCapital - capitalCommitted;

  // Monthly consolidation (60 months)
  const horizonMonths = 60;
  const corpExp = empresa.corporateExpenses || 0;
  const months = [];
  let cumCF = -totalInvestment;

  for (let m = 0; m < horizonMonths; m++) {
    const revenue = branchResults.reduce((s, br) => s + (br.result.months[m]?.revenue || 0), 0);
    const ebitda = branchResults.reduce((s, br) => s + (br.result.months[m]?.ebitda || 0), 0) - corpExp;
    const netIncome = branchResults.reduce((s, br) => s + (br.result.months[m]?.netIncome || 0), 0) - corpExp * 0.7;
    cumCF += netIncome;

    months.push({
      month: m + 1,
      revenue,
      ebitda,
      netIncome,
      cumulativeCashFlow: cumCF
    });
  }

  // Enterprise payback (rampa)
  let paybackMonth = null;
  for (let i = 0; i < months.length; i++) {
    if (months[i].cumulativeCashFlow >= 0) { paybackMonth = i + 1; break; }
  }

  // Stabilized monthly (last 6 months)
  const stab = months.slice(-6);
  const avgMonthlyNet = stab.reduce((s, m) => s + m.netIncome, 0) / stab.length;
  const avgMonthlyRev = stab.reduce((s, m) => s + m.revenue, 0) / stab.length;
  const avgMonthlyEBITDA = stab.reduce((s, m) => s + m.ebitda, 0) / stab.length;

  // Total 5Y
  const totalNet60 = months.reduce((s, m) => s + m.netIncome, 0);

  // Per-partner attribution
  const perPartner = empresa.partners.map(p => ({
    id: p.id,
    name: p.name,
    equity: p.equity,
    capital: p.capital,
    capitalCommitted: capitalCommitted * p.equity,
    monthlyReturn: avgMonthlyNet * p.equity,
    totalReturn60: totalNet60 * p.equity,
    roi60: p.capital > 0 ? (totalNet60 * p.equity / p.capital) * 100 : 0,
    paybackSimple: avgMonthlyNet * p.equity > 0 ? p.capital / (avgMonthlyNet * p.equity) : null
  }));

  // Portfolio score
  const avgScore = branchResults.length > 0
    ? branchResults.reduce((s, r) => s + r.result.viabilityScore, 0) / branchResults.length
    : 0;

  return {
    branchResults,
    totalInvestment,
    capitalCommitted,
    capitalFree,
    months,
    paybackMonth,
    avgMonthlyRevenue: avgMonthlyRev,
    avgMonthlyEBITDA,
    avgMonthlyNet,
    totalNet60,
    perPartner,
    branchCount: branchResults.length,
    branchCountActive: branchResults.filter(br => br.branch.status === 'active').length,
    branchCountPlanned: branchResults.filter(br => br.branch.status === 'planned').length,
    avgScore: Math.round(avgScore)
  };
}
