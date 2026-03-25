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
export function createBranch(format, name = '', colonia = '', proyectoId = null) {
  return {
    id: uid('br'),
    name: name || 'Nueva Sucursal',
    format, // Deprecated in favor of formatId, kept for backward comp
    formatId: format, 
    modeloId: `FT-${format.toUpperCase()}`,
    modeloVersion: 'v8.0',
    auditStatus: 'placeholder',
    colonia,
    zona: '',
    ciudad: '',
    estimatedOpenDate: null,
    status: 'planned',
    scenarioId: 'base',
    overrides: buildDefaultOverrides(format),
    locationStudy: null,
    notes: '',
    proyectoId: proyectoId
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
function createProyecto(name = 'Nuevo Proyecto', brandId = 'farmatuya') {
  return {
    id: uid('proj'),
    name,
    brandId,
    isFranchise: true,
    logo: null,
    totalCapital: 2000000,
    corporateReserve: 200000,
    corporateExpenses: 0,
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
    capitalInicial: 2000000,
    socios: [
      { id: 'p1', name: 'Socio 1', capitalAportado: 1000000, porcentajeAcciones: 0.50 },
      { id: 'p2', name: 'Socio 2', capitalAportado: 1000000, porcentajeAcciones: 0.50 }
    ],
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
    user: { id: uid('usr'), name: 'Usuario Nuevo', preferences: { theme: 'light', defaultCurrency: 'MXN' } },
    empresas: [emp],
    activeEmpresaId: emp.id,
    activeProyectoId: emp.proyectos[0].id,
    activeSucursalId: null
  };
}

/* ── Migration from legacy single-empresa ── */
function migrateFromLegacy(legacy) {
  // Legacy partners migrate to Empresa socios
  const mappedSocios = (legacy.partners || []).map(p => ({
    id: p.id,
    nombre: p.name,
    capitalAportado: p.capital || 0,
    porcentajeAcciones: p.equity || 0
  }));
  if (mappedSocios.length === 0) {
     mappedSocios.push({ id: 'p1', nombre: 'Benjamin', capitalAportado: legacy.totalCapital || 2000000, porcentajeAcciones: 1.0 });
  }

  // Ensure branches have the new schema fields
  const safeBranches = (legacy.branches || []).map(b => {
     if (!b.formatId) b.formatId = b.format || 'super';
     if (!b.modeloId) b.modeloId = `FT-${(b.format || 'super').toUpperCase()}`;
     if (!b.modeloVersion) b.modeloVersion = 'v8.0';
     if (!b.auditStatus) b.auditStatus = 'reconciled';
     return b;
  });

  const emp = {
    id: legacy.id || uid('emp'),
    nombre: legacy.name || 'Mi Empresa', // Using 'nombre' for Empresa matching new schema
    logo: null,
    capitalInicial: legacy.totalCapital || 2000000,
    socios: mappedSocios,
    createdAt: new Date().toISOString(),
    proyectos: [{
      id: uid('proj'),
      nombre: legacy.projectName || 'FarmaTuya', // Changed to nombre
      brandId: 'farmatuya',
      isFranchise: true,
      totalCapital: legacy.totalCapital || 2000000,
      corporateReserve: legacy.corporateReserve || 200000,
      corporateExpenses: legacy.corporateExpenses || 0,
      branches: safeBranches,
      createdAt: new Date().toISOString()
    }]
  };
  return {
    id: uid('bw2'),
    user: { id: uid('usr'), name: 'Benjamin', preferences: { theme: 'light', defaultCurrency: 'MXN' } },
    empresas: [emp],
    activeEmpresaId: emp.id,
    activeProyectoId: emp.proyectos[0].id,
    activeSucursalId: safeBranches.length > 0 ? safeBranches[0].id : null
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

export function addEmpresa(nombre) {
  const ws = _load();
  const emp = createEmpresa(nombre);
  ws.empresas.push(emp);
  _save();
  return emp;
}

export function updateEmpresaData(empresaId, updates) {
  const emp = getEmpresaById(empresaId);
  if (emp) {
    if (updates.nombre !== undefined) emp.nombre = updates.nombre;
    if (updates.logo !== undefined) emp.logo = updates.logo;
    _save();
  }
}

export function removeEmpresa(empresaId) {
  const ws = _load();
  ws.empresas = ws.empresas.filter(e => e.id !== empresaId);
  if (ws.activeEmpresaId === empresaId) {
    ws.activeEmpresaId = ws.empresas[0]?.id || null;
    ws.activeProyectoId = ws.empresas[0]?.proyectos?.[0]?.id || null;
    ws.activeSucursalId = null;
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

export function addProyecto(empresaId, nombre) {
  const emp = getEmpresaById(empresaId);
  if (!emp) return null;
  const proj = createProyecto(nombre);
  emp.proyectos.push(proj);
  _save();
  return proj;
}

export function updateProyecto(empresaId, proyectoId, updates) {
  const proj = getProyectoById(empresaId, proyectoId);
  if (proj) {
    if (updates.nombre !== undefined) proj.nombre = updates.nombre;
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
    ws.activeSucursalId = null;
  }
  _save();
}

/* ══════════ BACKWARD-COMPATIBLE API ══════════ */
/* getEmpresa() returns the active proyecto — same shape as old empresa */
export function getEmpresa() {
  const proj = getActiveProyecto();
  const emp = getActiveEmpresa();
  if (!proj || !emp) return null;
  // Inject parent's socios as partners to prevent UI from crashing until Phase 2 is finished
  return { ...proj, partners: emp.socios || [] };
}

export function updateEmpresa(updates) {
  const proj = getActiveProyecto();
  if (proj) {
    Object.assign(proj, updates);
    _save();
  }
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

/* ── Partners (ahora en Empresa activa) ── */
export function addPartner(nombre, capitalAportado, porcentajeAcciones) {
  const emp = getActiveEmpresa();
  if (!emp) return;
  if (!emp.socios) emp.socios = [];
  emp.socios.push({
    id: uid('p'),
    nombre, capitalAportado, porcentajeAcciones
  });
  _save();
}

export function updatePartner(partnerId, updates) {
  const emp = getActiveEmpresa();
  if (!emp || !emp.socios) return;
  const p = emp.socios.find(s => s.id === partnerId);
  if (p) { Object.assign(p, updates); _save(); }
}

export function removePartner(partnerId) {
  const emp = getActiveEmpresa();
  if (!emp || !emp.socios) return;
  emp.socios = emp.socios.filter(s => s.id !== partnerId);
  _save();
}

/* ── Branch CRUD (on active proyecto) ── */
export function addBranch(format, name, colonia) {
  const proj = getActiveProyecto();
  if (!proj) return null;
  const b = createBranch(format, name, colonia, proj.id);
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
  const ws = _load();
  if (ws.activeSucursalId === branchId) {
    ws.activeSucursalId = null;
  }
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
