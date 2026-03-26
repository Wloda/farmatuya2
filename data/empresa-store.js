/**
 * BW² — Multi-Empresa, Multi-Proyecto Store (v8)
 * Hierarchy: BW² Workspace → Empresas[] → Proyectos[] → Branches[]
 * Backward-compatible: getEmpresa() returns the active proyecto (same shape as before).
 * Persists to localStorage.
 */
import { MODELS } from './model-registry.js?v=bw3';

const STORAGE_KEY = 'bw2_workspace';
const LEGACY_KEY  = 'farmatuya_empresa';

/* ── Build full overrides from template ── */
export function buildDefaultOverrides(format) {
  const model = MODELS[format];
  if (!model) return {};
  const inv = model.totalInitialInvestment || { min: 1000000, max: 1000000, default: 1000000 };
  return {
    fixedCosts: {
      rent: model.fixedCosts.rent,
      systems: model.fixedCosts.systems,
      accounting: model.fixedCosts.accounting,
      payroll: model.fixedCosts.payroll,
      socialCharge: model.fixedCosts.socialCharge,
      servPap: { ...model.fixedCosts.servPap },
      omissions: model.fixedCosts.omissions ? { ...model.fixedCosts.omissions } : null
    },
    variableCosts: {
      cogs: model.variableCosts.cogs,
      comVenta: model.variableCosts.comVenta,
      merma: model.variableCosts.merma,
      pubDir: model.variableCosts.pubDir,
      regalia: model.variableCosts.regalia,
      bancario: model.variableCosts.bancario
    },
    sales: { ...model.sales },
    totalInitialInvestment: inv.default,
    totalInitialInvestmentMin: inv.min,
    totalInitialInvestmentMax: inv.max,
    scenarioFactor: 1,
    royaltyMode: model.royaltyPromo ? model.royaltyPromo.default : 'variable_2_5'
  };
}

/* ── ID generator ── */
function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

/* ── Branch Factory ── */
export function createBranch(format, name = '', colonia = '') {
  return {
    id: uid('br'),
    name: name || 'Nueva Sucursal',
    format,
    colonia,
    zona: '',
    ciudad: '',
    estimatedOpenDate: null,
    status: 'planned',
    scenarioId: 'base',
    overrides: buildDefaultOverrides(format),
    locationStudy: null,
    notes: ''
  };
}

/* ── Duplicate Branch ── */
export function duplicateBranch(branch) {
  return {
    ...JSON.parse(JSON.stringify(branch)),
    id: uid('br'),
    name: branch.name + ' (copia)',
    status: 'planned',
    colonia: '',
    coloniaFull: '',
    locationStudy: null
  };
}

/* ── Proyecto Factory ── */
function createProyecto(name = 'Nuevo Proyecto') {
  return {
    id: uid('proj'),
    name,
    isFranchise: true,
    logo: null,
    totalCapital: 2000000,
    corporateReserve: 200000,
    corporateExpenses: 0,
    partners: [
      { id: 'p1', name: 'Socio 1', capital: 1000000, equity: 0.50 },
      { id: 'p2', name: 'Socio 2', capital: 1000000, equity: 0.50 }
    ],
    branches: [
      createBranch('super', 'Sucursal 1', 'Col. Centro')
    ],
    createdAt: new Date().toISOString()
  };
}

/* ── Empresa Factory ── */
function createEmpresa(name = 'Mi Empresa') {
  return {
    id: uid('emp'),
    name,
    logo: null,
    createdAt: new Date().toISOString(),
    proyectos: [
      createProyecto('Proyecto 1')
    ]
  };
}

/* ── Default Workspace ── */
function createDefaultWorkspace() {
  const emp = createEmpresa('NOJOM');
  emp.proyectos[0].name = 'FarmaTuya';
  return {
    id: uid('bw2'),
    empresas: [emp],
    activeEmpresaId: emp.id,
    activeProyectoId: emp.proyectos[0].id
  };
}

/* ── Migration from legacy single-empresa ── */
function migrateFromLegacy(legacy) {
  const emp = {
    id: legacy.id || uid('emp'),
    name: legacy.name || 'Mi Empresa',
    logo: null,
    createdAt: new Date().toISOString(),
    proyectos: [{
      id: uid('proj'),
      name: legacy.projectName || 'FarmaTuya',
      isFranchise: true,
      totalCapital: legacy.totalCapital || 2000000,
      corporateReserve: legacy.corporateReserve || 200000,
      corporateExpenses: legacy.corporateExpenses || 0,
      partners: legacy.partners || [],
      branches: legacy.branches || [],
      createdAt: new Date().toISOString()
    }]
  };
  return {
    id: uid('bw2'),
    empresas: [emp],
    activeEmpresaId: emp.id,
    activeProyectoId: emp.proyectos[0].id
  };
}

/* ══════════ STORE ══════════ */
let _workspace = null;
let _listeners = [];
let _loading = false;

function _load() {
  if (_workspace) return _workspace;

  _loading = true;

  // Try new format first
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    _workspace = JSON.parse(saved);
  } else {
    // Try legacy format and migrate
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      _workspace = migrateFromLegacy(JSON.parse(legacy));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_workspace));
      // Clean up legacy key
      localStorage.removeItem(LEGACY_KEY);
    } else {
      _workspace = createDefaultWorkspace();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_workspace));
    }
  }

  // ── Migration: ensure all branches have proper overrides ──
  let dirty = false;
  _workspace.empresas.forEach(emp => {
    emp.proyectos.forEach(proj => {
      (proj.branches || []).forEach(b => {
        const model = MODELS[b.format];
        if (!model) return;
        const ov = b.overrides || {};
        const modelDefault = model.totalInitialInvestment?.default;
        const needsMigration = !ov.fixedCosts
          || ov.totalInitialInvestment == null
          || (modelDefault && ov.totalInitialInvestmentMax !== model.totalInitialInvestment.max);
        if (needsMigration) {
          b.overrides = buildDefaultOverrides(b.format);
          dirty = true;
        }
      });
    });
  });
  if (dirty) localStorage.setItem(STORAGE_KEY, JSON.stringify(_workspace));

  _loading = false;
  return _workspace;
}

function _save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_workspace));
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      console.error('[BW2] localStorage quota exceeded — data NOT saved');
      // Dispatch a custom event so the UI can show a toast
      window.dispatchEvent(new CustomEvent('bw2:storage-error', { detail: { message: 'Almacenamiento lleno. Elimina datos o exporta antes de continuar.' } }));
    } else {
      console.error('[BW2] localStorage save error:', e);
    }
  }
  _listeners.forEach(fn => fn(_workspace));
}

export function onEmpresaChange(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(f => f !== fn); };
}

/* ══════════ WORKSPACE ══════════ */
export function getWorkspace() {
  return _load();
}

/* ══════════ EMPRESA CRUD ══════════ */
export function getEmpresas() {
  return _load().empresas;
}

export function getEmpresaById(empresaId) {
  return _load().empresas.find(e => e.id === empresaId) || null;
}

export function getActiveEmpresa() {
  const ws = _load();
  return ws.empresas.find(e => e.id === ws.activeEmpresaId) || ws.empresas[0] || null;
}

export function setActiveEmpresa(empresaId) {
  const ws = _load();
  const emp = ws.empresas.find(e => e.id === empresaId);
  if (emp) {
    ws.activeEmpresaId = empresaId;
    // Also set active proyecto to first of this empresa
    ws.activeProyectoId = emp.proyectos[0]?.id || null;
    _save();
  }
}

export function addEmpresa(name) {
  const ws = _load();
  const emp = createEmpresa(name);
  ws.empresas.push(emp);
  _save();
  return emp;
}

export function updateEmpresaData(empresaId, updates) {
  const emp = getEmpresaById(empresaId);
  if (emp) {
    if (updates.name !== undefined) emp.name = updates.name;
    if (updates.logo !== undefined) emp.logo = updates.logo;
    _save();
  }
}

export function removeEmpresa(empresaId) {
  const ws = _load();
  ws.empresas = ws.empresas.filter(e => e.id !== empresaId);
  if (ws.activeEmpresaId === empresaId) {
    ws.activeEmpresaId = ws.empresas[0]?.id || null;
    ws.activeProyectoId = ws.empresas[0]?.proyectos[0]?.id || null;
  }
  _save();
}

/* ══════════ PROYECTO CRUD ══════════ */
export function getProyectos(empresaId) {
  const emp = getEmpresaById(empresaId);
  return emp ? emp.proyectos : [];
}

export function getProyectoById(empresaId, proyectoId) {
  const emp = getEmpresaById(empresaId);
  if (!emp) return null;
  return emp.proyectos.find(p => p.id === proyectoId) || null;
}

export function getActiveProyecto() {
  const ws = _load();
  const emp = ws.empresas.find(e => e.id === ws.activeEmpresaId);
  if (!emp) return null;
  return emp.proyectos.find(p => p.id === ws.activeProyectoId) || emp.proyectos[0] || null;
}

export function setActiveProyecto(empresaId, proyectoId) {
  const ws = _load();
  ws.activeEmpresaId = empresaId;
  ws.activeProyectoId = proyectoId;
  _save();
}

export function addProyecto(empresaId, name) {
  const emp = getEmpresaById(empresaId);
  if (!emp) return null;
  const proj = createProyecto(name);
  emp.proyectos.push(proj);
  _save();
  return proj;
}

export function updateProyecto(empresaId, proyectoId, updates) {
  const proj = getProyectoById(empresaId, proyectoId);
  if (proj) {
    if (updates.name !== undefined) proj.name = updates.name;
    if (updates.isFranchise !== undefined) proj.isFranchise = updates.isFranchise;
    if (updates.logo !== undefined) proj.logo = updates.logo;
    if (updates.totalCapital !== undefined) proj.totalCapital = updates.totalCapital;
    if (updates.corporateReserve !== undefined) proj.corporateReserve = updates.corporateReserve;
    if (updates.corporateExpenses !== undefined) proj.corporateExpenses = updates.corporateExpenses;
    _save();
  }
}

export function removeProyecto(empresaId, proyectoId) {
  const emp = getEmpresaById(empresaId);
  if (!emp) return;
  emp.proyectos = emp.proyectos.filter(p => p.id !== proyectoId);
  const ws = _load();
  if (ws.activeProyectoId === proyectoId) {
    ws.activeProyectoId = emp.proyectos[0]?.id || null;
  }
  _save();
}

/* ══════════ BACKWARD-COMPATIBLE API ══════════ */
/* getEmpresa() returns the active proyecto — same shape as old empresa */
export function getEmpresa() {
  return getActiveProyecto();
}

export function updateEmpresa(updates) {
  const emp = getActiveEmpresa();
  const proj = getActiveProyecto();
  
  if (emp) {
    if (updates.name !== undefined) emp.name = updates.name;
    if (updates.logo !== undefined) emp.logo = updates.logo;
    if (updates.settings !== undefined) emp.settings = updates.settings;
  }
  
  if (proj) {
    if (updates.projectName !== undefined) proj.name = updates.projectName;
    if (updates.totalCapital !== undefined) proj.totalCapital = updates.totalCapital;
    if (updates.corporateReserve !== undefined) proj.corporateReserve = updates.corporateReserve;
    if (updates.corporateExpenses !== undefined) proj.corporateExpenses = updates.corporateExpenses;
    if (updates.overrides !== undefined) proj.overrides = updates.overrides;
  }
  
  _save();
}

export function resetEmpresa() {
  const ws = _load();
  const emp = getActiveEmpresa();
  if (!emp) return;
  const defaultProj = createProyecto('FarmaTuya');
  emp.proyectos = [defaultProj];
  ws.activeProyectoId = defaultProj.id;
  _save();
}

/* ── Partners (on active proyecto) ── */
export function addPartner(name, capital, equity) {
  const proj = getActiveProyecto();
  if (!proj) return;
  proj.partners.push({
    id: uid('p'),
    name, capital, equity
  });
  _save();
}

export function updatePartner(partnerId, updates) {
  const proj = getActiveProyecto();
  if (!proj) return;
  const p = proj.partners.find(p => p.id === partnerId);
  if (p) { Object.assign(p, updates); _save(); }
}

export function removePartner(partnerId) {
  const proj = getActiveProyecto();
  if (!proj) return;
  proj.partners = proj.partners.filter(p => p.id !== partnerId);
  _save();
}

/* ── Branch CRUD (on active proyecto) ── */
export function addBranch(format, name, colonia) {
  const proj = getActiveProyecto();
  if (!proj) return null;
  const b = createBranch(format, name, colonia);
  proj.branches.push(b);
  _save();
  return b;
}

export function updateBranch(branchId, updates) {
  const proj = getActiveProyecto();
  if (!proj) return;
  const b = proj.branches.find(b => b.id === branchId);
  if (b) { Object.assign(b, updates); _save(); }
}

export function updateBranchOverrides(branchId, overrides) {
  const proj = getActiveProyecto();
  if (!proj) return;
  const b = proj.branches.find(b => b.id === branchId);
  if (b) { b.overrides = { ...b.overrides, ...overrides }; _save(); }
}

export function dupBranch(branchId) {
  const proj = getActiveProyecto();
  if (!proj) return null;
  const b = proj.branches.find(b => b.id === branchId);
  if (!b) return null;
  const dup = duplicateBranch(b);
  proj.branches.push(dup);
  _save();
  return dup;
}

export function archiveBranch(branchId) {
  const proj = getActiveProyecto();
  if (!proj) return;
  const b = proj.branches.find(b => b.id === branchId);
  if (b) { b.status = 'archived'; _save(); }
}

export function activateBranch(branchId) {
  const proj = getActiveProyecto();
  if (!proj) return;
  const b = proj.branches.find(b => b.id === branchId);
  if (b) { b.status = 'active'; _save(); }
}

export function restoreBranch(branchId) {
  const proj = getActiveProyecto();
  if (!proj) return;
  const b = proj.branches.find(b => b.id === branchId);
  if (b) { b.status = 'planned'; _save(); }
}

export function removeBranch(branchId) {
  const proj = getActiveProyecto();
  if (!proj) return;
  proj.branches = proj.branches.filter(b => b.id !== branchId);
  _save();
}

export function getBranch(branchId) {
  const proj = getActiveProyecto();
  if (!proj) return null;
  return proj.branches.find(b => b.id === branchId) || null;
}

export function getActiveBranches() {
  const proj = getActiveProyecto();
  if (!proj) return [];
  return proj.branches.filter(b => b.status !== 'paused' && b.status !== 'archived');
}

/* ── Update branch location study ── */
export function updateBranchLocation(branchId, study) {
  const proj = getActiveProyecto();
  if (!proj) return;
  const b = proj.branches.find(b => b.id === branchId);
  if (b) { b.locationStudy = study; _save(); }
}

/* ── Reset branch to format defaults ── */
export function resetBranchToDefaults(branchId) {
  const proj = getActiveProyecto();
  if (!proj) return;
  const b = proj.branches.find(b => b.id === branchId);
  if (b) { b.overrides = buildDefaultOverrides(b.format); _save(); }
}
