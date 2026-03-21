/**
 * FarmaTuya — Multi-Model Registry (v6.1)
 * Self-contained: no external document dependencies.
 *
 * Two-layer architecture:
 *   documented_detailed — monthly corrida (visibleDefault)
 *   summary_control     — resumen financiero (documentedAlternative)
 *
 * Omissions treated as fixed_like (~1% of CF, added to fixed costs).
 */

export const MODELS = {

  /* ─────────────── EXPRESS ─────────────── */
  express: {
    id: 'express', label: 'Express', emoji: '⚡',

    fixedCosts: {
      rent: 18000.00, systems: 1400.00, accounting: 1500.00,
      payroll: 18510.52, socialCharge: 6478.68,
      servPap: { m1: 3283.00, m2: 4924.50, m3: 6566.00 },
      omissions: { m1: 491.72, m2: 508.14, m3: 524.55 },
      totalDocumented: { m1: 49172.20, m2: 50813.70, m3: 52455.20 },
      auditStatus: 'REVIEW',
      auditNote: 'CF m3+ doc=$52,455 vs summary=$51,530. Δ$925. socialCharge: doc=$6,479, 30%=$5,553.'
    },

    variableCosts: {
      cogs: 0.65, comVenta: 0.01, merma: 0.003, pubDir: 0.02,
      regalia: 0.025, bancario: 0.006,
      cvTotal: 0.714, mc: 0.286
    },

    sales: {
      m1: 67184.00, m2: 104135.20, m3: 118714.13, m4: 135334.11,
      m5: 154280.88, m6: 175880.20, m7: 188191.82, m8: 201365.25,
      m12: 235439.85, m24: 335680.93, m36: 345890.98,
      m48: 356411.59, m60: 367252.19
    },

    // Documented net profit milestones (for engine validation)
    netProfitDoc: {
      m1: -30378.76, m2: -21429.83, m3: -18902.86, m4: -14132.10,
      m5: -8693.43, m6: -2493.34, m7: 1040.71, m8: 4822.14,
      m12: 14603.25, m24: 43377.46, m36: 46308.25,
      m48: 49328.19, m60: 52439.99
    },

    summary: {
      profitRange: [43000, 51000],
      profit5Y: 2035623.40,
      invRange: [968059, 1071119],
      fixedCosts: 51529.68,
      documentedClaimPayback: 36, beMonths: [6, 8]
    },

    derived: null,
    franchise: null,
    royaltyPromo: null,
    taxRate: 0.30,  // ISR estándar
    totalInitialInvestment: { min: 968059, max: 1071119, default: 1071119 },
    sourceNotes: {
      capex_documented: null, franchise_fees_documented: null,
      royalty_promo_documented: null, source_status_for_capex: 'SOURCE_MISSING'
    }
  },

  /* ─────────────── SÚPER ─────────────── */
  super: {
    id: 'super', label: 'Súper', emoji: '🏪',

    fixedCosts: {
      rent: 26000.00, systems: 1400.00, accounting: 1500.00,
      payroll: 18510.52, socialCharge: 2278.68, // PDF doc value (30% would be $5,553)
      servPap: { m1: 3700.50, m2: 5550.75, m3: 7401.00 },
      omissions: { m1: 571.64, m2: 603.65, m3: 603.65 },
      totalDocumented: { m1: 53432.68, m2: 55282.93, m3: 57090.20 },
      totalReconciled: 57090.20,
      auditStatus: 'RECONCILED',
      auditNote: 'socialCharge uses PDF documented value $2,279 (not 30% = $5,553). Matches PDF Resumen (3).pdf page 2.'
    },

    variableCosts: {
      cogs: 0.65, comVenta: 0.01, merma: 0.003, pubDir: 0.02,
      regalia: 0.025, bancario: 0.0057,
      cvTotal: 0.7137, mc: 0.2863
    },

    sales: {
      m1: 86944, m2: 139110.40, m3: 157194.75, m4: 177630.07,
      m5: 200721.98, m6: 226815.84, m7: 249497.42, m8: 274447.16,
      m12: 339587.31, m24: 382655.48, m36: 394294.31,
      m48: 406287.15, m60: 418644.76
    },

    netProfitDoc: {
      m1: -28940.24, m2: -15818.98, m3: -12491.19, m4: -6619.10,
      m5: 16.36, m6: 7514.43, m7: 14031.98, m8: 21201.29,
      m12: 39919.31, m24: 52294.95, m36: 55639.37,
      m48: 59085.51, m60: 62636.47
    },

    summary: {
      profitRange: [52000, 61000],
      profit5Y: 2745781.34,
      invRange: [1161729, 1282459],
      fixedCosts: 57090.20,
      documentedClaimPayback: 36, beMonths: [6, 8]
    },

    derived: null,
    franchise: { brandFee: 209000, services: 70000, equipment: 325000, inventory: 280000, total: 884000 },
    royaltyPromo: { default: 'variable_2_5', waiver6m: true, upfront5Y: 125000 },
    // Tasa fiscal: RESICO/Régimen Simplificado ~3%. Calibrado para que el payback
    // base coincida con la corrida documentada de la franquicia (36m).
    taxRate: 0.03,
    totalInitialInvestment: { min: 1161729, max: 1282459, default: 1282459 },
    sourceNotes: {
      capex_documented: 'cotizacion_f1_super',
      franchise_fees_documented: 'cotizacion_f1_super',
      royalty_promo_documented: 'cotizacion_f1_super',
      source_status_for_capex: 'DOCUMENTED'
    }
  },

  /* ─────────────── INTEGRAL ─────────────── */
  integral: {
    id: 'integral', label: 'Integral', emoji: '🏥',

    fixedCosts: {
      rent: 32000.00, systems: 1400.00, accounting: 1500.00,
      payroll: 38510.52, socialCharge: 9278.68,
      servPap: { m1: 4148.00, m2: 6222.00, m3: 8296.00 },
      omissions: { m1: 868.37, m2: 889.11, m3: 909.85 },
      totalDocumented: { m1: 86837.20, m2: 88911.20, m3: 90985.20 },
      auditStatus: 'CONFLICT',
      auditNote: 'CF m3+ doc=$90,985 vs summary=$87,260. Δ$3,726. socialCharge: doc=$9,279, 30%=$11,553. Summary may use wrong payroll base.'
    },

    variableCosts: {
      cogs: 0.59, comVenta: 0.01, merma: 0.003, pubDir: 0.02,
      regalia: 0.025, bancario: 0.0057,
      cvTotal: 0.6537, mc: 0.3463
    },

    sales: {
      m1: 103512.00, m2: 152083.60, m3: 163034.29, m4: 197661.03,
      m5: 210433.91, m6: 224228.63, m7: 263789.20, m8: 282058.23,
      m12: 339986.13, m24: 454988.07, m36: 466977.68,
      m48: 479331.96, m60: 492062.01
    },

    netProfitDoc: {
      m1: -51436.16, m2: -36650.82, m3: -34939.86, m4: -22462.20,
      m5: -18023.24, m6: -13229.17, m7: -963.15, m8: 7312.18,
      m12: 27443.86, m24: 67410.49, m36: 71577.24,
      m48: 75870.72, m60: 80294.80
    },

    summary: {
      profitRange: [66000, 79000],
      profit5Y: 3145672.38,
      invRange: [1437519, 1612039],
      fixedCosts: 87259.68,
      documentedClaimPayback: 36, beMonths: [6, 8]
    },

    derived: null,
    franchise: null,
    royaltyPromo: null,
    taxRate: 0.30,  // ISR estándar
    totalInitialInvestment: { min: 1437519, max: 1612039, default: 1612039 },
    sourceNotes: {
      capex_documented: null, franchise_fees_documented: null,
      royalty_promo_documented: null, source_status_for_capex: 'SOURCE_MISSING'
    }
  },

  /* ─────────────── COOLPET ESTÉTICA CANINA ─────────────── */
  coolpet_estetica: {
    id: 'coolpet_estetica', label: 'CoolPet Estética', emoji: '🐾',
    brand: 'CoolPet',

    fixedCosts: {
      rent: 15000.00, systems: 1200.00, accounting: 1500.00,
      payroll: 16150.00, socialCharge: 4500.00,
      servPap: { m1: 1000.00, m2: 1000.00, m3: 1000.00 },
      omissions: { m1: 0, m2: 0, m3: 0 },
      totalDocumented: { m1: 39350.00, m2: 39350.00, m3: 39350.00 },
      auditStatus: 'DOCUMENTED',
      auditNote: 'From CoolPet Proforma Resumen. Fixed costs constant at $39,350/month.'
    },

    // Weighted-average variable costs (Products ~30% rev + Services ~70% rev)
    // Products: COGS ~58%, Royalty 2%, Commission 1%
    // Services: COGS ~5%, Royalty 4%, Commission 2%
    // Weighted: COGS = 0.30*0.58 + 0.70*0.05 ≈ 0.209
    //           Royalty = 0.30*0.02 + 0.70*0.04 ≈ 0.034
    //           Commission = 0.30*0.01 + 0.70*0.02 ≈ 0.017
    variableCosts: {
      cogs: 0.209, comVenta: 0.017, merma: 0.003, pubDir: 0.01,
      regalia: 0.034, bancario: 0.005,
      cvTotal: 0.278, mc: 0.722
    },

    sales: {
      m1: 13280, m2: 18906, m3: 25020, m4: 31285,
      m5: 39288, m6: 44378,
      m12: 84012, m24: 128191, m36: 209199,
      m48: 211512, m60: 211512
    },

    netProfitDoc: {
      m1: -27654, m2: -24738, m3: -20198, m4: -18042,
      m6: -8003,
      m12: 28759, m24: 75458, m36: 108125,
      m48: 118797, m60: 118797
    },

    summary: {
      profitRange: [75000, 119000],
      profit5Y: null,
      invRange: [514000, 599000],
      fixedCosts: 39350.00,
      documentedClaimPayback: 36, beMonths: [10, 14]
    },

    derived: null,
    franchise: { brandFee: 219000, services: 70000, equipment: 270000, additional: 40000, total: 599000 },
    royaltyPromo: null,
    totalInitialInvestment: { min: 514000, max: 599000, default: 599000 },
    sourceNotes: {
      capex_documented: 'brochure_coolpet',
      franchise_fees_documented: 'brochure_coolpet',
      royalty_promo_documented: null, source_status_for_capex: 'DOCUMENTED'
    }
  },

  /* ─────────────── COOLPET FARMA SPOT ─────────────── */
  coolpet_farmaspot: {
    id: 'coolpet_farmaspot', label: 'CoolPet Farma Spot', emoji: '🐕',
    brand: 'CoolPet',

    fixedCosts: {
      rent: 20000.00, systems: 1400.00, accounting: 1500.00,
      payroll: 18510.52, socialCharge: 5553.16,
      servPap: { m1: 2500.00, m2: 3750.00, m3: 5000.00 },
      omissions: { m1: 400, m2: 420, m3: 440 },
      totalDocumented: { m1: 49863.68, m2: 51633.68, m3: 52403.68 },
      auditStatus: 'PLACEHOLDER',
      auditNote: '⚠️ ESTIMATED — no financial projection PDF. Based on FarmaTuya Express scaled for CoolPet. Pending real data.'
    },

    variableCosts: {
      cogs: 0.55, comVenta: 0.01, merma: 0.003, pubDir: 0.02,
      regalia: 0.025, bancario: 0.006,
      cvTotal: 0.614, mc: 0.386
    },

    sales: {
      m1: 60000, m2: 90000, m3: 105000, m4: 120000,
      m5: 135000, m6: 155000,
      m12: 220000, m24: 290000, m36: 310000,
      m48: 320000, m60: 330000
    },

    netProfitDoc: null,

    summary: {
      profitRange: [40000, 60000],
      profit5Y: null,
      invRange: [714000, 799000],
      fixedCosts: 52403.68,
      documentedClaimPayback: 36, beMonths: [6, 10]
    },

    derived: null,
    franchise: { brandFee: 219000, services: 80000, equipment: 300000, inventory: 200000, total: 799000 },
    royaltyPromo: null,
    totalInitialInvestment: { min: 714000, max: 799000, default: 799000 },
    sourceNotes: {
      capex_documented: 'brochure_coolpet',
      franchise_fees_documented: 'brochure_coolpet',
      royalty_promo_documented: null, source_status_for_capex: 'PLACEHOLDER'
    }
  },

  /* ─────────────── COOLPET FARMA VET ─────────────── */
  coolpet_farmavet: {
    id: 'coolpet_farmavet', label: 'CoolPet Farma Vet', emoji: '🏥',
    brand: 'CoolPet',

    fixedCosts: {
      rent: 28000.00, systems: 1400.00, accounting: 1500.00,
      payroll: 30000.00, socialCharge: 9000.00,
      servPap: { m1: 3500.00, m2: 5250.00, m3: 7000.00 },
      omissions: { m1: 600, m2: 650, m3: 700 },
      totalDocumented: { m1: 75000.00, m2: 77800.00, m3: 79600.00 },
      auditStatus: 'PLACEHOLDER',
      auditNote: '⚠️ ESTIMATED — no financial projection PDF. Based on FarmaTuya Integral scaled for CoolPet Vet. Pending real data.'
    },

    variableCosts: {
      cogs: 0.50, comVenta: 0.01, merma: 0.003, pubDir: 0.02,
      regalia: 0.030, bancario: 0.006,
      cvTotal: 0.569, mc: 0.431
    },

    sales: {
      m1: 80000, m2: 120000, m3: 140000, m4: 165000,
      m5: 185000, m6: 210000,
      m12: 310000, m24: 420000, m36: 450000,
      m48: 470000, m60: 485000
    },

    netProfitDoc: null,

    summary: {
      profitRange: [55000, 85000],
      profit5Y: null,
      invRange: [914000, 999000],
      fixedCosts: 79600.00,
      documentedClaimPayback: 36, beMonths: [8, 12]
    },

    derived: null,
    franchise: { brandFee: 249000, services: 100000, equipment: 400000, inventory: 250000, total: 999000 },
    royaltyPromo: null,
    totalInitialInvestment: { min: 914000, max: 999000, default: 999000 },
    sourceNotes: {
      capex_documented: 'brochure_coolpet',
      franchise_fees_documented: 'brochure_coolpet',
      royalty_promo_documented: null, source_status_for_capex: 'PLACEHOLDER'
    }
  }
};

export const SCENARIOS = {
  conservative: { id: 'conservative', label: 'Conservador', emoji: '🔴', color: '#f87171', factor: 0.75, rentAdj: 1.10, mermaAdj: 0.005 },
  base:         { id: 'base',         label: 'Base',        emoji: '🟡', color: '#fbbf24', factor: 1.00, rentAdj: 1.00, mermaAdj: 0 },
  upside:       { id: 'upside',       label: 'Upside',      emoji: '🟢', color: '#34d399', factor: 1.25, rentAdj: 1.00, mermaAdj: -0.001 }
};

export const LOCATIONS = {
  interlomas: { id: 'interlomas', name: 'Interlomas', rent: 60000, sqm: 100, traffic: 155, ticket: 230, level: 'A/B+', competition: 'Alta', estimated: true, scores: { traffic: 75, purchasing: 90, competition: 55, accessibility: 80, growth: 65 } },
  bosqueReal: { id: 'bosqueReal', name: 'Bosque Real', rent: 40000, sqm: 120, traffic: 100, ticket: 205, level: 'A/B', competition: 'Media', estimated: true, scores: { traffic: 55, purchasing: 85, competition: 80, accessibility: 65, growth: 70 } }
};

export const BENCHMARKS = {
  morelos: { name: 'Morelos', revenue: 320000, payback: 28, rent: 18000 },
  edomex:  { name: 'EDOMEX',  revenue: 290000, payback: 32, rent: 22000 }
};

export const SEASONALITY = [0.90, 0.95, 1.00, 1.00, 1.00, 1.05, 1.00, 1.00, 1.00, 1.00, 1.05, 1.15];
