/**
 * FarmaTuya — Multi-Model Financial Engine (v6.1)
 * Uses documented socialCharge per model (not hardcoded 30% rule).
 */
import { MODELS, SEASONALITY } from '../data/model-registry.js?v=bw3';

/* ── Ramp Interpolation ── */
function buildRamp(salesData, horizonMonths, factor=1) {
  const pts = Object.entries(salesData).filter(([k])=>k.startsWith('m')).map(([k,v])=>[parseInt(k.slice(1)),v*factor]).sort((a,b)=>a[0]-b[0]);
  const curve = [];
  for (let m=1; m<=horizonMonths; m++) {
    const exact = pts.find(([km])=>km===m);
    if (exact) { curve.push(exact[1]); continue; }
    let before=pts[0], after=pts[pts.length-1];
    for (let i=0;i<pts.length-1;i++) { if(pts[i][0]<=m&&pts[i+1][0]>=m) { before=pts[i]; after=pts[i+1]; break; } }
    if (m>pts[pts.length-1][0]) {
      const last2=pts.slice(-2); const span=last2[1][0]-last2[0][0];
      const g=Math.pow(last2[1][1]/last2[0][1],1/span);
      curve.push(pts[pts.length-1][1]*Math.pow(g,m-pts[pts.length-1][0]));
    } else {
      const t=(m-before[0])/(after[0]-before[0]);
      curve.push(before[1]*Math.pow(after[1]/before[1],t));
    }
  }
  return curve;
}

/* ── Fixed Costs ── */
export function calcFixedCosts(fc, month) {
  const social = fc.socialCharge != null ? fc.socialCharge : fc.payroll * 0.30;
  const sp = month===1 ? fc.servPap.m1 : month===2 ? fc.servPap.m2 : fc.servPap.m3;
  // Omissions treated as fixed_like (~1% of base CF)
  const om = fc.omissions ? (month===1 ? fc.omissions.m1 : month===2 ? fc.omissions.m2 : fc.omissions.m3) : 0;
  return fc.rent + fc.systems + fc.accounting + fc.payroll + social + sp + om;
}

export function calcFixedCostBreakdown(fc) {
  const social = fc.socialCharge != null ? fc.socialCharge : fc.payroll * 0.30;
  const om = fc.omissions ? fc.omissions.m3 : 0;
  return {
    renta:fc.rent, nomina:fc.payroll, cargaSocial:social,
    sistemas:fc.systems, contabilidad:fc.accounting, serviciosPap:fc.servPap.m3,
    omisiones:om
  };
}

/* ── Variable Cost Rate ── */
export function calcVarRate(vc, royaltyMode, month, preOpeningMonths=0, waiverFromOpening=false) {
  let r = vc.cogs + vc.comVenta + vc.merma + vc.pubDir + vc.bancario;
  // Omisiones y Errores: 1% of sales in documented Súper format (variable, not fixed)
  r += (vc.omisiones || 0);
  if (!royaltyMode || royaltyMode==='variable_2_5') r += vc.regalia;
  else if (royaltyMode==='condonacion_6m') {
    const startWaiverAt = waiverFromOpening ? preOpeningMonths : 0;
    if (month > startWaiverAt + 6) r += vc.regalia;
  }
  // pago_unico: no royalty added
  return r;
}

/* ── Main Projection ── */
export function runProjection(modelId, overrides={}) {
  const model = MODELS[modelId];
  if (!model) throw new Error('Unknown model: '+modelId);

  const fc = { ...model.fixedCosts, ...(overrides.fixedCosts||{}) };
  const vc = { ...model.variableCosts, ...(overrides.variableCosts||{}) };
  
  // Market Factor check
  const applyMarketFactor = overrides.applyMarketFactor !== false; // Default true
  let scenarioFactor = overrides.scenarioFactor || 1.0;
  if (!applyMarketFactor) {
    scenarioFactor = overrides.baseScenarioFactor || 1.0;
  }

  const royaltyMode = overrides.royaltyMode || (model.royaltyPromo ? model.royaltyPromo.default : 'variable_2_5');
  const horizonMonths = overrides.horizonMonths || 60;
  const taxRate = overrides.taxRate ?? model.taxRate ?? 0.30;
  const discountRate = overrides.discountRate || 0.12;
  const preOpeningMonths = overrides.preOpenMonths || 0; // Renamed from preOpenMonths to preOpeningMonths for consistency with new param
  const waiverFromOpening = overrides.waiverFromOpening || false;

  // Investment — uses per-branch override (worst case default)
  let totalInv;
  if (overrides.totalInitialInvestment != null) {
    totalInv = overrides.totalInitialInvestment;
  } else if (model.totalInitialInvestment) {
    totalInv = model.totalInitialInvestment.default; // use default (worst case) to match UI
  } else {
    totalInv = model.summary.invRange[1]; // fallback to max
  }
  // Pago único adds upfront royalty
  if (royaltyMode === 'pago_unico' && model.royaltyPromo) {
    totalInv += model.royaltyPromo.upfront5Y || 125000;
  }

  // Partners (Safely map Spanish data contract to English engine contract)
  const rawPartners = overrides.partners || [
    {name:'Socio 1',capital:1500000,equity:0.50},
    {name:'Socio 2',capital:1500000,equity:0.50}
  ];
  const partners = rawPartners.map(p => ({
    name: p.nombre || p.name,
    capital: p.capitalAportado !== undefined ? p.capitalAportado : p.capital,
    equity: p.porcentajeAcciones !== undefined ? p.porcentajeAcciones : p.equity
  }));
  const totalCapital = partners.reduce((s,p)=>s+p.capital,0);

  // Ramp
  const ramp = buildRamp(model.sales, horizonMonths, scenarioFactor);
  const rentOverride = overrides.rent != null ? overrides.rent : fc.rent;
  const fcWithRent = { ...fc, rent: rentOverride };

  // Pre-opening months (capital deployed but store not yet open)
  const totalMonths = preOpeningMonths + horizonMonths;

  const months = [];
  let cumCF = -totalInv, pbMonth = null;
  let taxLossPool = 0;  // Accumulated losses carried forward (tax shield)

  // Pre-opening phase: rent + partial costs, zero revenue
  for (let p = 0; p < preOpeningMonths; p++) {
    const m = p + 1;
    // During pre-opening: rent, services (m1-level), but no payroll/operations yet
    const preOpenCost = rentOverride + (fcWithRent.servPap?.m1 || 0);
    const ebitda = -preOpenCost;
    taxLossPool += preOpenCost;
    const net = ebitda; // No taxes on losses
    cumCF += net;
    months.push({ month: m, revenue: 0, cogs: 0, grossProfit: 0, totalFixedCosts: preOpenCost, variableCosts: 0, variableCostsExCogs: 0, ebitda, ebitdaMargin: 0, taxes: 0, netIncome: net, cashFlow: net, cumulativeCashFlow: cumCF, seasonFactor: 1, preOpen: true });
  }

  // Extract Marketing & CAF Levers
  const mkt = overrides.marketing || {};
  const seoLocal = mkt.seoLocal || 0;
  const ads = mkt.ads || 0;
  const cofepris = mkt.cofepris || 0;
  const loyaltyActive = mkt.loyalty || false;
  
  const caf = overrides.caf || {};
  const maxConsultas = caf.consultas || 0;
  const conversionCAF = caf.conversion || 0.40;
  const ticketCAF = caf.ticket || 350;
  
  // Operating phase
  for (let i=0; i<horizonMonths; i++) {
    const m = preOpeningMonths + i + 1;
    const opMonth = i + 1; // operating month (for ramp/fixed cost calc)
    const season = SEASONALITY[i%12];
    
    // Base revenue + CAF revenue (ramped up)
    let baseRevenue = ramp[i] * season;
    let cafRevenue = maxConsultas * conversionCAF * ticketCAF * Math.min(1, ramp[i] / (ramp[horizonMonths-1] || 1)) * season;
    let revenue = baseRevenue + cafRevenue;
    
    // Loyalty Boost (+10% sales, but costs 2% of total sales)
    if (loyaltyActive) revenue *= 1.10;
    
    // Fixed Costs + Marketing/Compliance
    const cfTotal = calcFixedCosts(fcWithRent, opMonth) + seoLocal + ads + cofepris;
    
    const varRate = calcVarRate(vc, royaltyMode, opMonth);
    const cogs = revenue * vc.cogs;
    const grossProfit = revenue - cogs;
    
    // Variable costs + Loyalty expense
    let varCostsTotal = revenue * varRate;
    if (loyaltyActive) varCostsTotal += (revenue * 0.02);
    
    const varCostsExCogs = varCostsTotal - cogs;
    const ebitda = grossProfit - varCostsExCogs - cfTotal;
    
    // Tax loss carryforward: losses offset future taxable income
    let taxes = 0;
    if (ebitda > 0) {
      const taxableIncome = Math.max(0, ebitda - taxLossPool);
      const lossUsed = ebitda - taxableIncome;
      taxLossPool -= lossUsed;
      taxes = taxableIncome * taxRate;
    } else {
      taxLossPool += Math.abs(ebitda);
    }
    const net = ebitda - taxes;
    cumCF += net;
    if (pbMonth===null && cumCF>=0) pbMonth = m;
    months.push({ month:m, revenue, cogs, grossProfit, totalFixedCosts:cfTotal, variableCosts:varCostsTotal, variableCostsExCogs:varCostsExCogs, ebitda, ebitdaMargin:revenue>0?ebitda/revenue:0, taxes, netIncome:net, cashFlow:net, cumulativeCashFlow:cumCF, seasonFactor:season });
  }

  // Aggregates
  const sum=(arr,k)=>arr.reduce((s,m)=>s+m[k],0);
  const y1=months.slice(0,12), y2=months.slice(12,24), y3=months.slice(24,36), y4=months.slice(36,48), y5=months.slice(48,60);
  const stab = months.slice(-6);
  const avgEBITDA = stab.reduce((s,m)=>s+m.ebitda,0)/stab.length;
  const avgRev = stab.reduce((s,m)=>s+m.revenue,0)/stab.length;
  const totalFixed = calcFixedCosts(fcWithRent, 12);
  const varRateStab = calcVarRate(vc, royaltyMode, 12);
  const mc = 1 - varRateStab;
  const be = mc>0 ? totalFixed/mc : Infinity;
  const bePct = avgRev>0 ? be/avgRev : Infinity;
  const rentPct = avgRev>0 ? rentOverride/avgRev : 0;
  const reserve = totalFixed * 3;

  // NPV
  const mDisc = Math.pow(1+discountRate,1/12)-1;
  let npv = -totalInv;
  for (let i=0;i<months.length;i++) npv += months[i].cashFlow/Math.pow(1+mDisc,i+1);
  const irr = calcIRR([-totalInv,...months.map(m=>m.cashFlow)]);

  // ROI
  const tn=(arr)=>sum(arr,'netIncome');
  const roi12=totalInv>0?(tn(y1)/totalInv)*100:0;
  const roi24=totalInv>0?((tn(y1)+tn(y2))/totalInv)*100:0;
  const roi36=totalInv>0?((tn(y1)+tn(y2)+tn(y3))/totalInv)*100:0;

  // Payback simple
  const netStab = avgEBITDA*(1-taxRate);
  const pbSimple = netStab>0 ? totalInv/netStab : null;

  // Partners
  const perPartner = partners.map(p => {
    const mi = netStab*p.equity;
    let cum=0, ppb=null;
    for(let i=0;i<months.length;i++){cum+=months[i].netIncome*p.equity;if(ppb===null&&cum>=p.capital)ppb=i+1;}
    return {name:p.name,equity:p.equity,capital:p.capital,monthlyIncome:mi, roi36:p.capital>0?((tn(y1)+tn(y2)+tn(y3))*p.equity/p.capital)*100:0, paybackMonth:ppb, recommendedCash:reserve*p.equity};
  });

  // Score
  const score = calcScore({paybackMonth:pbMonth,npv,rentPctRevenue:rentPct,breakEvenPctCapacity:bePct,roi36,capitalRemaining:totalCapital-totalInv,recommendedReserve:reserve});

  return {
    modelId, totalInvestment:totalInv, totalPartnerCapital:totalCapital,
    capitalRemaining:totalCapital-totalInv, recommendedReserve:reserve,
    grossMargin:1-vc.cogs, varCostRate:varRateStab, mc,
    totalFixedMonthly:totalFixed, fixedCostBreakdown:calcFixedCostBreakdown(fcWithRent),
    breakEvenRevenue:be, breakEvenPctCapacity:bePct, costPerSqm:0,
    rentPctRevenue:rentPct,
    // Legacy single payback (rampa) — kept for backward compat
    paybackMonth:pbMonth, paybackSimple:pbSimple,
    // New: 4 separate payback metrics
    paybackMetrics: calcPaybackMetrics(model, totalInv, netStab, months),
    npv, irr, roi12, roi24, roi36,
    avgMonthlyEBITDA:avgEBITDA, avgMonthlyRevenue:avgRev,
    ebitdaMarginStabilized:avgRev>0?avgEBITDA/avgRev:0,
    perPartnerMonthly:perPartner, viabilityScore:score, months,
    annualSummary: {
      year1:{revenue:sum(y1,'revenue'),netIncome:tn(y1),cashFlow:sum(y1,'cashFlow')},
      year2:{revenue:sum(y2,'revenue'),netIncome:tn(y2),cashFlow:sum(y2,'cashFlow')},
      year3:{revenue:sum(y3,'revenue'),netIncome:tn(y3),cashFlow:sum(y3,'cashFlow')},
      year4:{revenue:sum(y4,'revenue'),netIncome:tn(y4),cashFlow:sum(y4,'cashFlow')},
      year5:{revenue:sum(y5,'revenue'),netIncome:tn(y5),cashFlow:sum(y5,'cashFlow')}
    }
  };
}

function calcIRR(cf,guess=0.1,maxIter=100,tol=1e-6){let r=guess;for(let i=0;i<maxIter;i++){let n=0,d=0;for(let t=0;t<cf.length;t++){n+=cf[t]/Math.pow(1+r,t);d-=t*cf[t]/Math.pow(1+r,t+1);}if(Math.abs(d)<1e-12)break;const nr=r-n/d;if(Math.abs(nr-r)<tol)return(isFinite(nr)&&Math.abs(nr)<=10)?nr:null;r=Math.max(-0.99,Math.min(10,nr));}return(isFinite(r)&&Math.abs(r)<=10)?r:null;}

function calcScore({paybackMonth:pb,npv,rentPctRevenue:rp,breakEvenPctCapacity:bp,roi36,capitalRemaining:cr,recommendedReserve:rr}){
  let s=0;
  if(pb&&pb<=18)s+=25;else if(pb&&pb<=24)s+=20;else if(pb&&pb<=36)s+=10;
  if(npv>0)s+=20;else if(npv>-100000)s+=5;
  if(rp<0.10)s+=15;else if(rp<0.15)s+=10;else if(rp<0.20)s+=5;
  if(bp<0.50)s+=15;else if(bp<0.70)s+=10;else if(bp<0.90)s+=5;
  if(roi36>60)s+=15;else if(roi36>30)s+=10;else if(roi36>0)s+=5;
  if(cr>=rr)s+=10;else if(cr>=rr*0.5)s+=5;
  return s;
}

/* ── Payback Metrics (4 distinct definitions) ── */
export function calcPaybackMetrics(model, totalInv, netStab, months) {
  const sm = model.summary;

  // A. Payback Simple: actual investment / stabilized monthly profit
  //    Uses the actual totalInv (user's slider choice), not the hardcoded summary range
  const profitRange = sm.profitRange || [0, 0];
  const pbSimpleMin = profitRange[1] > 0 ? totalInv / profitRange[1] : null; // best profit
  const pbSimpleMax = profitRange[0] > 0 ? totalInv / profitRange[0] : null; // worst profit

  // B. Payback Promedio 5Y: actual investment / (profit5Y / 60)
  const avgMonthly5Y = sm.profit5Y ? sm.profit5Y / 60 : null;
  const pbAvg5yMin = avgMonthly5Y > 0 ? totalInv / avgMonthly5Y : null;
  const pbAvg5yMax = avgMonthly5Y > 0 ? totalInv / avgMonthly5Y : null;

  // C. Payback con Rampa Real: first month where cumulative CF >= 0
  //    (engine already tracks this via cumulativeCashFlow in months[])
  let pbRampa = null;
  let extrapolated = false;
  for (let i = 0; i < months.length; i++) {
    if (months[i].cumulativeCashFlow >= 0) { pbRampa = i + 1; break; }
  }
  if (pbRampa === null && months.length > 0) {
    // Extrapolate: if last 6 months show positive net income
    const lastCF = months[months.length - 1].cumulativeCashFlow;
    const lastNet = months[months.length - 1].netIncome;
    if (lastNet > 0 && lastCF < 0) {
      pbRampa = months.length + Math.ceil(Math.abs(lastCF) / lastNet);
      extrapolated = true;
    }
  }

  // D. Break-Even Operativo: first month where monthly net income > 0
  //    and sustains for at least 3 consecutive months
  let beOperativo = null;
  for (let i = 0; i < months.length - 2; i++) {
    if (months[i].netIncome > 0 && months[i+1].netIncome > 0 && months[i+2].netIncome > 0) {
      beOperativo = i + 1;
      break;
    }
  }

  // Documented claim comparison
  const docClaim = sm.documentedClaimPayback || null;
  let auditStatus = 'PASS';
  let auditNote = '';
  if (docClaim) {
    const simpleAvg = (pbSimpleMin != null && pbSimpleMax != null) ? (pbSimpleMin + pbSimpleMax) / 2 : null;
    const avg5y = (pbAvg5yMin != null && pbAvg5yMax != null) ? (pbAvg5yMin + pbAvg5yMax) / 2 : null;
    // Check which definition the documented claim aligns with
    const deltaSimple = simpleAvg != null ? Math.abs(docClaim - simpleAvg) : 999;
    const deltaAvg5y = avg5y != null ? Math.abs(docClaim - avg5y) : 999;
    const deltaRampa = pbRampa != null ? Math.abs(docClaim - pbRampa) : 999;
    const minDelta = Math.min(deltaSimple, deltaAvg5y, deltaRampa);

    if (minDelta > 6) {
      auditStatus = 'REVIEW';
      auditNote = `Claim ${docClaim}m no coincide con simple (${simpleAvg?.toFixed(1)||'?'}m), promedio 5Y (${avg5y?.toFixed(1)||'?'}m), ni rampa (${pbRampa||'∞'}m). Δ mín. ${minDelta.toFixed(1)}m.`;
    } else if (minDelta > 3) {
      auditStatus = 'REVIEW';
      const closest = deltaSimple === minDelta ? 'simple' : deltaAvg5y === minDelta ? 'promedio 5Y' : 'rampa';
      auditNote = `Claim ${docClaim}m se acerca a payback ${closest} (Δ${minDelta.toFixed(1)}m) pero no es exacto.`;
    } else {
      const closest = deltaSimple === minDelta ? 'simple' : deltaAvg5y === minDelta ? 'promedio 5Y' : 'rampa';
      auditNote = `Claim ${docClaim}m coincide con payback ${closest} (Δ${minDelta.toFixed(1)}m).`;
    }
  }

  return {
    simple: { min: pbSimpleMin, max: pbSimpleMax, label: 'PB Simple' },
    avg5y:  { min: pbAvg5yMin, max: pbAvg5yMax, label: 'PB Promedio 5A' },
    rampa:  { month: pbRampa, extrapolated, label: 'PB Rampa Real' },
    beOperativo: { month: beOperativo, label: 'BE Operativo' },
    documentedClaim: docClaim,
    auditStatus,
    auditNote
  };
}

/* ── Sensitivity ── */
export function runSensitivity(modelId, overrides) {
  const base = runProjection(modelId, overrides);
  const baseE = base.avgMonthlyEBITDA;
  const vars = [
    {key:'rent',label:'Renta',get:o=>o.rent||MODELS[modelId].fixedCosts.rent,set:(o,v)=>({...o,rent:v})},
    {key:'cogs',label:'COGS %',get:o=>(o.variableCosts||{}).cogs||MODELS[modelId].variableCosts.cogs,set:(o,v)=>({...o,variableCosts:{...(o.variableCosts||MODELS[modelId].variableCosts),cogs:v}})},
    {key:'factor',label:'Factor Ventas',get:o=>o.scenarioFactor||1,set:(o,v)=>({...o,scenarioFactor:v})},
    {key:'payroll',label:'Nómina',get:o=>(o.fixedCosts||{}).payroll||MODELS[modelId].fixedCosts.payroll,set:(o,v)=>({...o,fixedCosts:{...(o.fixedCosts||MODELS[modelId].fixedCosts),payroll:v}})},
    {key:'merma',label:'Merma',get:o=>(o.variableCosts||{}).merma||MODELS[modelId].variableCosts.merma,set:(o,v)=>({...o,variableCosts:{...(o.variableCosts||MODELS[modelId].variableCosts),merma:v}})},
  ];
  return vars.map(v=>{
    const bv=v.get(overrides);
    const up=runProjection(modelId,v.set({...overrides},bv*1.2));
    const dn=runProjection(modelId,v.set({...overrides},bv*0.8));
    return {key:v.key,label:v.label,baseValue:bv,ebitdaDeltaUp:up.avgMonthlyEBITDA-baseE,ebitdaDeltaDown:dn.avgMonthlyEBITDA-baseE,impact:Math.abs(up.avgMonthlyEBITDA-dn.avgMonthlyEBITDA)};
  }).sort((a,b)=>b.impact-a.impact);
}

/* ── Heatmap ── */
export function generateHeatmap(modelId, overrides, revFactors, rentVals) {
  return revFactors.flatMap(rf => rentVals.map(rv => {
    const r = runProjection(modelId, {...overrides, scenarioFactor:(rf/100), rent:rv*1000});
    return {ticket:rf,traffic:rv,ebitda:r.avgMonthlyEBITDA,payback:r.paybackMonth,viable:r.avgMonthlyEBITDA>0,npv:r.npv};
  }));
}

/* ── Stress ── */
export function calcStress(modelId, overrides) {
  let rL=0,rH=200000;
  for(let i=0;i<20;i++){const mid=(rL+rH)/2;const r=runProjection(modelId,{...overrides,rent:mid});if(r.breakEvenPctCapacity<0.90)rL=mid;else rH=mid;}
  const maxRent=Math.round((rL+rH)/2);
  const rf=[60,70,80,90,100,110,120,130],rv=[20,30,40,50,60,70,80];
  const hd=generateHeatmap(modelId,overrides,rf,rv);
  const viable=hd.filter(d=>d.viable).length;
  return {maxRent,fragilityPct:1-(viable/hd.length),viableCells:viable,totalCells:hd.length};
}

/* ── Checklist ── */
export function generateChecklist(r) {
  const pm = r.paybackMetrics;
  const pbSimpleMid = pm.simple.min!=null ? (pm.simple.min+pm.simple.max)/2 : null;
  return [
    {item:'Capital ≥ Inv.+reserva',pass:r.capitalRemaining>=r.recommendedReserve,detail:`$${Math.round(r.capitalRemaining).toLocaleString()} vs $${Math.round(r.recommendedReserve).toLocaleString()}`},
    {item:'VPN positivo',pass:r.npv>0,detail:`$${Math.round(r.npv).toLocaleString()}`},
    {item:'PB Simple ≤ 24m',pass:pbSimpleMid!=null&&pbSimpleMid<=24,detail:`${pbSimpleMid!=null?pbSimpleMid.toFixed(0):'∞'}m (${pm.simple.min?.toFixed(0)||'?'}–${pm.simple.max?.toFixed(0)||'?'})`},
    {item:'PB Rampa ≤ 48m',pass:pm.rampa.month!=null&&pm.rampa.month<=48,detail:`${pm.rampa.month||'∞'}m`},
    {item:'ROI anual > 20%',pass:r.roi36/3>20,detail:`${(r.roi36/3).toFixed(1)}%`},
    {item:'Renta < 15% venta',pass:r.rentPctRevenue<0.15,detail:`${(r.rentPctRevenue*100).toFixed(1)}%`},
    {item:'BE < 70% cap.',pass:r.breakEvenPctCapacity<0.70,detail:`${Math.round(r.breakEvenPctCapacity*100)}%`},
    {item:'BE Oper. ≤ 12m',pass:pm.beOperativo.month!=null&&pm.beOperativo.month<=12,detail:`${pm.beOperativo.month||'∞'} m`},
  ];
}

/* ── Alerts ── */
export function evaluateAlerts(r) {
  const alerts = [];
  if((r.paybackMonth===null||r.paybackMonth>48)||r.npv<0) alerts.push({severity:'critical',icon:'⛔',label:'Modelo Inviable',message:`Payback: ${r.paybackMonth||'∞'}m, VPN: $${Math.round(r.npv).toLocaleString()}`});
  if(r.capitalRemaining<0) alerts.push({severity:'critical',icon:'💰',label:'Capital Insuficiente',message:`Falta $${Math.round(Math.abs(r.capitalRemaining)).toLocaleString()}`});
  if(r.capitalRemaining>=0&&r.capitalRemaining<r.recommendedReserve) alerts.push({severity:'warning',icon:'⚠️',label:'Reserva Baja',message:`$${Math.round(r.capitalRemaining).toLocaleString()} < reserva $${Math.round(r.recommendedReserve).toLocaleString()}`});
  if(r.rentPctRevenue>0.15) alerts.push({severity:'warning',icon:'⚠️',label:'Renta Alta',message:`${(r.rentPctRevenue*100).toFixed(1)}% de venta`});
  if(r.breakEvenPctCapacity>0.70) alerts.push({severity:'warning',icon:'⚠️',label:'BE Exigente',message:`${Math.round(r.breakEvenPctCapacity*100)}% capacidad`});
  if(r.months.length>=18&&r.months[17].cumulativeCashFlow<0) alerts.push({severity:'warning',icon:'📉',label:'Flujo Negativo M18',message:`$${Math.round(r.months[17].cumulativeCashFlow).toLocaleString()}`});
  if(r.paybackMonth&&r.paybackMonth<=24&&r.roi36>20) alerts.push({severity:'success',icon:'✅',label:'Proyecto Viable',message:`PB ${r.paybackMonth}m, ROI ${r.roi36.toFixed(1)}%`});
  return alerts;
}
