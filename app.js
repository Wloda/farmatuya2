/**
 * BW² — Multi-Empresa Multi-Proyecto Dashboard v8
 */
import { MODELS, SCENARIOS, LOCATIONS, BENCHMARKS } from './data/model-registry.js?v=bw4';
import { runProjection, runSensitivity, generateHeatmap, calcStress, generateChecklist, evaluateAlerts } from './engine/financial-model.js?v=bw4';
import { registerUser, loginUser, logoutUser, getCurrentUser, isAuthenticated, updateUserProfile, changePassword } from './auth.js';
import { runBranchProjection, runConsolidation } from './engine/enterprise-engine.js?v=bw4';
import { getWorkspace, getEmpresas, getEmpresaById, getActiveEmpresa, setActiveEmpresa, addEmpresa, updateEmpresaData, removeEmpresa, getProyectos, getProyectoById, getActiveProyecto, setActiveProyecto, addProyecto, updateProyecto, removeProyecto, getEmpresa, updateEmpresa, addBranch, updateBranch, updateBranchOverrides, dupBranch, archiveBranch, activateBranch, restoreBranch, removeBranch, getBranch, getActiveBranches, addPartner, updatePartner, removePartner, resetEmpresa, resetBranchToDefaults, buildDefaultOverrides, updateBranchLocation, onEmpresaChange } from './data/empresa-store.js?v=bw4';
import { runLocationStudy, calcCombinedMarketFactor } from './engine/location-engine.js?v=bw5';
import { generateBranchPDF } from './pdf-export.js?v=bw4';

/* ═══ GLOBALS & STATE ═══ */
const STORE_KEY = 'bw2_store';
let ws = {
  version: 3,
  empresas: [],
  activeEmpresaId: null
};

// State view: dashboard, bw2home, comparador, etc.
let state = { view: 'bw2home', activeBranchId: null, showInactive: false, activeTab: 'resultados' };

/* ═══ WIDGET LAYOUT MANAGER ═══ */
const WidgetManager = {
  isEditing: false,
  sortables: [],
  
  init() {
    this.hookButtons();
    this.loadLayout('branch-resultados');
    this.loadLayout('consolidated');
  },

  hookButtons() {
    document.querySelectorAll('.btn-edit-layout').forEach(btn => {
      btn.onclick = () => this.toggleEditMode(btn.dataset.target, true);
    });
    document.querySelectorAll('.btn-save-layout').forEach(btn => {
      btn.onclick = () => this.toggleEditMode(btn.dataset.target, false);
    });
    
    // Remove restore widget logic
  },

  getGrids(target) {
    if (target === 'branch-resultados') return ['branch-resultados-grid', 'branch-an-grid'];
    return ['consol-widget-grid'];
  },

  getAllWidgets(target) {
    const grids = this.getGrids(target);
    const selectors = grids.map(g => `#${g} > .widget`).join(', ');
    return Array.from(document.querySelectorAll(selectors));
  },

  toggleEditMode(target, active) {
    const grids = this.getGrids(target);
    const firstGrid = $(grids[0]);
    if (!firstGrid) return;

    this.isEditing = active;
    const tabEl = firstGrid.closest('.branch-tab-panel') || firstGrid.closest('section');
    const toolbar = $(`toolbar-${target}`);
    
    if (active) {
      tabEl.classList.add('dashboard-edit-mode');
      if(toolbar) toolbar.style.display = 'flex';
      
      // Inject overlays into widgets
      this.getAllWidgets(target).forEach(w => {
        if (!w.querySelector('.widget-edit-overlay')) {
          w.insertAdjacentHTML('beforeend', `
            <div class="widget-edit-overlay">
              <div style="display:flex;gap:0.5rem">
                <button class="widget-control-btn btn-shrink" title="Achicar">←</button>
                <button class="widget-control-btn btn-expand" title="Agrandar">→</button>
              </div>
            </div>
          `);
          
          const btnShrink = w.querySelector('.btn-shrink');
          const btnExpand = w.querySelector('.btn-expand');
          if (btnShrink) btnShrink.onclick = (e) => { e.stopPropagation(); this.resizeWidget(w, target, -1); };
          if (btnExpand) btnExpand.onclick = (e) => { e.stopPropagation(); this.resizeWidget(w, target, 1); };
        }
      });

      // Init Sortable natively for all grids under this target
      if (window.Sortable) {
        grids.forEach(gId => {
          const el = $(gId);
          if (el && !this.sortables[gId]) {
            this.sortables[gId] = new Sortable(el, {
              group: target,
              animation: 150,
              ghostClass: 'widget-ghost',
              dragClass: 'widget-drag',
              onEnd: () => this.saveLayout(target)
            });
          }
        });
      }
      // Nothing else needed here
      
    } else {
      tabEl.classList.remove('dashboard-edit-mode');
      if(toolbar) toolbar.style.display = 'none';
      this.saveLayout(target);
      
      const btn = document.querySelector(`.btn-save-layout[data-target="${target}"]`);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✅ Guardado';
        setTimeout(() => btn.textContent = orig, 1500);
      }
      
      // Trigger a resize on charts just in case sizes changed
      setTimeout(()=> window.dispatchEvent(new Event('resize')), 200);
    }
  },

  resizeWidget(widgetEl, target, direction) {
    const sizes = ['wg-3', 'wg-4', 'wg-6', 'wg-8', 'wg-12'];
    let current = sizes.find(s => widgetEl.classList.contains(s)) || 'wg-4';
    let currIdx = sizes.indexOf(current);
    if(currIdx === -1) currIdx = 1;
    
    let nextIdx = currIdx + direction;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= sizes.length) nextIdx = sizes.length - 1;
    
    if (nextIdx !== currIdx) {
      widgetEl.classList.remove(...sizes);
      widgetEl.classList.add(sizes[nextIdx]);
      this.saveLayout(target);
      const canvas = widgetEl.querySelector('canvas');
      if(canvas) setTimeout(()=> window.dispatchEvent(new Event('resize')), 100);
    }
  },

  saveLayout(target) {
    const widgets = this.getAllWidgets(target);
    const layout = widgets.map(w => {
      const sizes = ['wg-3', 'wg-4', 'wg-6', 'wg-8', 'wg-12'];
      return {
        id: w.dataset.widgetId,
        size: sizes.find(s => w.classList.contains(s)) || 'wg-4'
      };
    });
    const key = `bw2_layout_v2_${target}`;
    localStorage.setItem(key, JSON.stringify(layout));
  },

  loadLayout(target) {
    const saved = localStorage.getItem(`bw2_layout_v2_${target}`);
    if(!saved) return;
    try {
      const layout = JSON.parse(saved);
      const grids = this.getGrids(target);
      // Determine final grid host to append to (last configured parent or fallback to first grid)
      
      layout.forEach(conf => {
        if(!conf.id) return;
        const w = document.querySelector(`[data-widget-id="${conf.id}"]`);
        if(w) {
          // Keep it in its current parent grid if we aren't saving exact grid-parent state,
          // or properly append it sequentially back to its parent. Since we didn't save parentGridId,
          // we'll just append it to the grid it is currently in to re-order it, or first grid.
          const currentParent = w.parentElement;
          if (currentParent) currentParent.appendChild(w);
          
          const sizes = ['wg-3', 'wg-4', 'wg-6', 'wg-8', 'wg-12'];
          w.classList.remove(...sizes);
          w.classList.add(conf.size);
          w.style.display = '';
        }
      });
    } catch(e) { console.warn('Layout load error', e); }
  }
};

/* ═══ LOCALSTORAGE MIGRATION ═══ */
let charts = {};
let locMap = null;

function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000);
}

/* ── Listen for storage quota errors from empresa-store ── */
window.addEventListener('bw2:storage-error', (e) => {
  showToast(e.detail?.message || 'Error de almacenamiento', 'error');
});

/* ── Resize image file to max 256×256 base64 data URL ── */
function resizeImageToDataURL(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
        else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

Chart.defaults.color='#6B7280';
Chart.defaults.font.family="'Inter',-apple-system,sans-serif";
Chart.defaults.font.size=11;
Chart.defaults.font.weight=500;
Chart.defaults.plugins.legend.labels.boxWidth=12;
Chart.defaults.plugins.legend.labels.padding=16;
Chart.defaults.plugins.legend.labels.usePointStyle=true;
Chart.defaults.plugins.legend.labels.pointStyle='circle';
Chart.defaults.elements.bar.borderRadius=6;
Chart.defaults.elements.bar.borderSkipped=false;
Chart.defaults.elements.line.tension=0.35;
Chart.defaults.elements.line.borderWidth=2.5;
Chart.defaults.elements.point.radius=0;
Chart.defaults.elements.point.hoverRadius=5;
Chart.defaults.elements.point.hoverBorderWidth=2;
// Scale defaults — merge, don't replace
Object.assign(Chart.defaults.scale.grid, {color:'rgba(0,0,0,0.04)', drawBorder:false});
if(Chart.defaults.scale.border) Object.assign(Chart.defaults.scale.border, {display:false});
// Tooltip — merge into existing defaults (replacing entire object breaks Chart.js)
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor:'rgba(17,24,39,0.92)',
  cornerRadius:10,
  borderColor:'rgba(255,255,255,0.1)',
  borderWidth:1,
  boxPadding:4,
  caretSize:6,
  displayColors:true,
});
Chart.defaults.plugins.tooltip.titleFont = {size:12, weight:700};
Chart.defaults.plugins.tooltip.bodyFont = {size:11};
Chart.defaults.plugins.tooltip.padding = {x:12, y:8};
Chart.defaults.animation.duration = 800;
Chart.defaults.animation.easing = 'easeOutQuart';

const $=id=>document.getElementById(id);
const fmt={m:v=>'$'+Math.round(v).toLocaleString('es-MX'),mk:v=>'$'+(v/1000).toFixed(0)+'K',p:v=>(v*100).toFixed(1)+'%',pi:v=>Math.round(v*100)+'%',mo:v=>v?v+' m':'∞'};

/* ── Projection Cache (cleared each render cycle) ── */
const _projCache = new Map();
let _projCacheGen = 0;
function cachedProjection(branch, empresa) {
  const key = `${_projCacheGen}:${branch.id}:${branch.scenarioId||'base'}`;
  if (_projCache.has(key)) return _projCache.get(key);
  const r = runBranchProjection(branch, empresa);
  _projCache.set(key, r);
  return r;
}
function invalidateCache() { _projCacheGen++; _projCache.clear(); }

/* ── CSV Export Utility ── */
function exportCSV(filename, headers, rows) {
  const bom = '\uFEFF';
  const csv = bom + [headers.join(','), ...rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast(`📁 ${filename} exportado`, 'success');
}

/* ── KPI Tooltip Definitions ── */
const KPI_TIPS = {
  'EBITDA/mes': 'Ganancias antes de intereses, impuestos, depreciación y amortización. Mide la rentabilidad operativa mensual.',
  'Ganancia/mes': 'Es el EBITDA promedio mensual estabilizado de la sucursal o proyecto.',
  'Recuperación': 'Meses estimados para recuperar la inversión total. Menor es mejor. Óptimo: <24 meses.',
  'Score': 'Puntuación de viabilidad 0-100. Combina payback, ROI, EBITDA y riesgo. ≥ 80 = Excelente.',
  'Capital Total': 'Suma del capital de todos los proyectos en esta empresa.',
  'Comprometido': 'Capital ya asignado a inversiones en sucursales activas y planificadas.',
  'Capital Libre': 'Capital disponible para nuevas inversiones. Debe ser > 20% del total.',
  'ROI 12m': 'Retorno sobre inversión en los primeros 12 meses. Positivo = ganancia en año 1.',
  'ROI 36m': 'Retorno acumulado a 3 años. > 60% se considera bueno.',
  'VPN': 'Valor Presente Neto a WACC 12%. Positivo = proyecto crea valor.',
  'TIR': 'Tasa Interna de Retorno. > 12% supera el costo de capital.',
  'Renta Máx.': 'Renta máxima que el negocio soporta antes de perder viabilidad.',
  'Venta Mín.': 'Nivel mínimo de ventas para cubrir todos los costos (punto de equilibrio).',
  'Fragilidad': 'Porcentaje de escenarios de estrés donde el negocio no es viable. Menor es mejor.',
  'Impacto Mercado': 'Factor de ajuste basado en el estudio de ubicación (demografía, competencia, tráfico).',
};

/* ── Tab Memory ── */
const _tabMemory = {};
function rememberTab(viewKey, tabId) { _tabMemory[viewKey] = tabId; }
function recallTab(viewKey, fallback) { return _tabMemory[viewKey] || fallback; }

/* ── Chart Screenshot ── */
function screenshotChart(chartId) {
  const canvas = document.getElementById(chartId);
  if (!canvas) { showToast('Gráfico no encontrado', 'error'); return; }
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = `bw2_${chartId}_${Date.now()}.png`; a.click();
  showToast('📸 Captura guardada', 'success');
}

/* ── Clipboard Copy ── */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast('📋 Copiado', 'success')).catch(() => showToast('Error al copiar', 'error'));
}
function dc(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
function kc(l,v,d,s,tip){const t=tip||KPI_TIPS[l]||'';return `<div class="kpi-card" data-status="${s}"${t?` title="${esc(t)}"`:''} style="cursor:${t?'help':'default'}"><div class="kpi-label">${l}</div><div class="kpi-value" data-animate>${v}</div><div class="kpi-detail">${d}</div></div>`;}

/* ── Shared KPI aggregation helper (eliminates redundancy across Home/L2/Portfolio) ── */
function computeAggregate(branches, empresa) {
  let totalInv=0,ebitda=0,score=0,scored=0,payback=0;
  branches.forEach(b => {
    if (b.status === 'archived') return;
    try {
      const r = runBranchProjection(b, empresa);
      if (r) {
        totalInv += r.totalInvestment || 0;
        ebitda += r.avgMonthlyEBITDA || 0;
        if (r.paybackMonth > payback) payback = r.paybackMonth;
        if (r.viabilityScore) { score += r.viabilityScore; scored++; }
      }
    } catch(e) { /* skip failed projections */ }
  });
  return { totalInv, ebitda, avgScore: scored ? Math.round(score/scored) : 0, payback, scored, branchCount: branches.filter(b=>b.status!=='archived').length };
}

/* ── Global Escape key handler for modals ── */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Close command palette first
  const cp = document.querySelector('.cmd-palette-overlay');
  if (cp) { cp.remove(); return; }
  // Close dynamically-created modal overlays
  const overlay = document.querySelector('.bw2-modal-overlay');
  if (overlay) { overlay.remove(); return; }
  // Close static modals
  ['modal-add-branch', 'modal-confirm', 'modal-profile'].forEach(id => {
    const m = document.getElementById(id);
    if (m && m.style.display !== 'none' && m.style.display !== '') {
      m.style.display = 'none';
    }
  });
});

/* ── Score ring gauge SVG helper ── */
function scoreRing(score, size=48) {
  const r = (size/2) - 4;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score)) / 100;
  const offset = circ * (1 - pct);
  const color = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : 'var(--red)';
  return `<div class="score-ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}"><circle class="ring-bg" cx="${size/2}" cy="${size/2}" r="${r}" stroke-dasharray="${circ}" stroke-dashoffset="0"/><circle class="ring-fg" cx="${size/2}" cy="${size/2}" r="${r}" stroke="${color}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/></svg>
    <span class="ring-label">${score}</span>
  </div>`;
}

/* ── Sparkline SVG helper ── */
function sparklineSVG(values, w=120, h=28) {
  if (!values || values.length < 2) return '';
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  const area = pts.join(' ') + ` ${w},${h} 0,${h}`;
  const trend = values[values.length-1] >= values[0] ? 'var(--green)' : 'var(--red)';
  return `<div class="sparkline-container"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="spG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${trend}" stop-opacity="0.3"/><stop offset="100%" stop-color="${trend}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${area}" fill="url(#spG)"/>
    <polyline points="${line}" fill="none" stroke="${trend}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg></div>`;
}

/* ── Smart alerts generator ── */
function generateAlerts() {
  const alerts = [];
  const empresas = getEmpresas();
  empresas.forEach(emp => {
    (emp.proyectos||[]).forEach(proj => {
      // Capital warning
      const agg = computeAggregate(proj.branches||[], proj);
      const free = (proj.totalCapital||0) - agg.totalInv;
      if (proj.totalCapital > 0 && free / proj.totalCapital < 0.2) {
        alerts.push({ type: 'warn', icon: '⚠️', text: `${esc(emp.name)}: Capital libre < 20%` });
      }
      // Negative EBITDA branches
      (proj.branches||[]).forEach(b => {
        if (b.status === 'archived') return;
        try {
          const r = runBranchProjection(b, proj);
          if (r && r.avgMonthlyEBITDA < 0) {
            alerts.push({ type: 'danger', icon: '📉', text: `${esc(b.name)}: EBITDA negativo` });
          }
          if (r && r.paybackMonth && r.paybackMonth <= 18) {
            alerts.push({ type: 'success', icon: '🎯', text: `${esc(b.name)}: Payback < 18m — ¡Excelente!` });
          }
        } catch(e) {}
      });
    });
  });
  return alerts;
}

function renderAlertStrip(container) {
  const alerts = generateAlerts();
  if (!alerts.length) return;
  const strip = document.createElement('div');
  strip.className = 'alert-strip';
  strip.innerHTML = alerts.slice(0, 6).map(a =>
    `<span class="alert-chip ${a.type}">${a.icon} ${a.text}</span>`
  ).join('');
  container.prepend(strip);
}

/* ── Command Palette (⌘K quick navigation) ── */
function openCommandPalette() {
  if (document.querySelector('.cmd-palette-overlay')) return;
  const empresas = getEmpresas();
  // Build index of all navigable items
  const items = [];
  empresas.forEach(emp => {
    items.push({ icon: '🏢', label: emp.name, path: 'Empresa', action: () => { setActiveEmpresa(emp.id); state.view = 'empresa'; renderCurrentView(); }});
    (emp.proyectos||[]).forEach(proj => {
      items.push({ icon: '📁', label: proj.name || proj.projectName || 'Proyecto', path: emp.name, action: () => { setActiveEmpresa(emp.id); setActiveProyecto(proj.id); state.view = 'proyecto'; renderCurrentView(); }});
      (proj.branches||[]).forEach(b => {
        items.push({ icon: '📍', label: b.name, path: `${emp.name} › ${proj.name||'Proyecto'}`, action: () => { setActiveEmpresa(emp.id); setActiveProyecto(proj.id); state.view = 'branch'; state.activeBranchId = b.id; state.activeTab = 'resultados'; renderCurrentView(); }});
      });
    });
  });

  const overlay = document.createElement('div');
  overlay.className = 'cmd-palette-overlay';
  overlay.innerHTML = `
    <div class="cmd-palette">
      <input class="cmd-palette-input" placeholder="Buscar empresa, proyecto o sucursal…" autofocus>
      <div class="cmd-palette-results"></div>
      <div class="cmd-palette-hint"><span><kbd>↑↓</kbd> Navegar</span><span><kbd>↵</kbd> Abrir</span><span><kbd>Esc</kbd> Cerrar</span></div>
    </div>`;

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.cmd-palette-input');
  const results = overlay.querySelector('.cmd-palette-results');
  let activeIdx = 0;
  let filtered = items;

  function renderResults() {
    if (!filtered.length) {
      results.innerHTML = '<div class="cmd-palette-empty">🔍 Sin resultados</div>';
      return;
    }
    results.innerHTML = filtered.map((it, i) =>
      `<div class="cmd-palette-item${i===activeIdx?' active':''}" data-idx="${i}">
        <span class="cmd-icon">${it.icon}</span>
        <span class="cmd-label">${esc(it.label)}</span>
        <span class="cmd-path">${esc(it.path)}</span>
      </div>`
    ).join('');
    results.querySelectorAll('.cmd-palette-item').forEach(el => {
      el.addEventListener('click', () => { overlay.remove(); filtered[+el.dataset.idx].action(); });
      el.addEventListener('mouseenter', () => { activeIdx = +el.dataset.idx; renderResults(); });
    });
    // Scroll active into view
    const active = results.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function filterItems() {
    const q = input.value.toLowerCase().trim();
    filtered = q ? items.filter(it => it.label.toLowerCase().includes(q) || it.path.toLowerCase().includes(q)) : items;
    activeIdx = 0;
    renderResults();
  }

  input.addEventListener('input', filterItems);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx+1, filtered.length-1); renderResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx-1, 0); renderResults(); }
    else if (e.key === 'Enter' && filtered[activeIdx]) { overlay.remove(); filtered[activeIdx].action(); }
  });

  renderResults();
  input.focus();
}

// ⌘K / Ctrl+K shortcut
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
  }
});

let _suppressFullRender = false;
let _suppressTimer = null;
document.addEventListener('DOMContentLoaded',()=>{
  initNav(); 
  WidgetManager.init();
  renderCurrentView();
  onEmpresaChange(()=>{ if(!_suppressFullRender) renderCurrentView(); });
});

/* ═══ NAVIGATION ═══ */
function initNav(){
  // BW² Home button (always present in header)
  const homeBtn=$('btn-bw2-home');
  if(homeBtn) homeBtn.addEventListener('click',()=>{
    state.view='bw2home';
    state.activeBranchId=null;
    renderCurrentView();
  });
  // Nav is now built dynamically by updateNav() called from renderCurrentView()
}

function renderCurrentView() {
  const isBW2Home = state.view === 'bw2home';
  const mainNav=$('main-nav');
  const mainContent=$('main-content');
  const appFooter=$('app-footer');
  const colorLegend = document.querySelector('.color-legend');

  if(colorLegend) colorLegend.remove();

  const empresa=getEmpresa();

  // Hide all views
  ['view-bw2-home','view-empresa-dashboard','view-portfolio','view-branch','view-consolidated','view-comparador','view-empresa','view-glosario'].forEach(id=>{
    const el=$(id);if(el)el.style.display='none';
  });

  const headerLogo = document.querySelector('#app-header .header-logo');
  const headerBrand = document.querySelector('#app-header .header-brand');
  const hInfo=$('enterprise-header-info');

  const isEmpresaDash = state.view === 'empresa-dashboard';

  if(isBW2Home || (!empresa && !isEmpresaDash)) {
    $('view-bw2-home').style.display='block';
    renderBW2Home();
    if(hInfo) hInfo.innerHTML='';
    if(headerLogo) headerLogo.style.display = 'none';
    if(headerBrand) headerBrand.style.display = 'none';
    if(mainContent) mainContent.style.marginLeft = '';
    if(appFooter) appFooter.style.marginLeft = '';
  } else if(isEmpresaDash) {
    // Level 2: Empresa Dashboard
    $('view-empresa-dashboard').style.display='block';
    const emp = getActiveEmpresa();
    if(emp) {
      renderEmpresaDashboard(emp);
    }
    if(hInfo) hInfo.innerHTML=''; // breadcrumb already shows empresa name
    if(headerLogo) headerLogo.style.display = '';
    if(headerBrand) headerBrand.style.display = 'none';
    if(mainContent) mainContent.style.marginLeft = '';
    if(appFooter) appFooter.style.marginLeft = '';
  } else {
    if(headerLogo) headerLogo.style.display = '';
    if(headerBrand) headerBrand.style.display = '';
    updateEnterpriseHeader(empresa);
    // Restore sidebar spacing
    if(mainContent) mainContent.style.marginLeft = '';
    if(appFooter) appFooter.style.marginLeft = '';

    if(state.view==='portfolio') { $('view-portfolio').style.display='block'; renderPortfolioSummary(empresa); renderPortfolio(empresa); }
    else if(state.view==='branch'&&state.activeBranchId) {
      $('view-branch').style.display='block';
      // Ensure active tab is shown
      switchBranchTab(state.activeTab || 'resultados');
      renderBranchDetail(empresa);
    }
    else if(state.view==='consolidated') { $('view-consolidated').style.display='block'; renderConsolidated(empresa); }
    else if(state.view==='comparador') { $('view-comparador').style.display='block'; renderComparador(empresa); }
    else if(state.view==='empresa') { $('view-empresa').style.display='block'; renderEmpresaSettings(empresa); }
    else if(state.view==='glosario') { $('view-glosario').style.display='block'; renderGlosario(); }
    else { $('view-portfolio').style.display='block'; renderPortfolioSummary(empresa); renderPortfolio(empresa); }
  }

  // Update contextual sidebar and breadcrumb
  updateNav();
  updateBreadcrumb();
}

function updateEnterpriseHeader(empresa){
  const consol = runConsolidation(empresa);
  const emp = getActiveEmpresa();
  const empName = emp ? emp.name : 'Sin Empresa';
  const projName = empresa.name || 'Proyecto';
  const el=$('enterprise-header-info');
  const scoreColor = consol.avgScore >= 80 ? 'green' : consol.avgScore >= 60 ? 'yellow' : 'red';
  if(el) el.innerHTML=`<span class="ent-stat project-badge">📁 ${projName}</span>
    <span class="ent-stat">Capital: ${fmt.m(empresa.totalCapital)}</span>
    <span class="ent-stat">Comprometido: ${fmt.m(consol.capitalCommitted)}</span>
    <span class="ent-stat ${consol.capitalFree<0?'danger':''}">Libre: ${fmt.m(consol.capitalFree)}</span>
    <span class="ent-stat">Sucursales: ${consol.branchCountActive} activas</span>
    <span class="ent-stat"><span class="sem-dot ${scoreColor}"></span> Score: ${consol.avgScore}</span>`;
  // Update brand
  const brandName=$('header-brand-name');
  const brandSub=$('header-brand-subtitle');
  if(brandName) brandName.textContent=empName;
  if(brandSub) brandSub.textContent=projName;
  // Update header logo to empresa logo
  const headerLogo = document.querySelector('#app-header .header-logo');
  if(headerLogo) {
    if(emp && emp.logo) {
      headerLogo.src = emp.logo;
      headerLogo.alt = empName;
    } else {
      headerLogo.src = 'assets/nojom-bird.png';
      headerLogo.alt = 'Logo';
    }
  }
}

/* ═══ UTILS ═══ */
function esc(str) {
  if(!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ═══ HOME — Uses same design language as Level 2 ═══ */
function renderBW2Home(){
  const container=$('bw2-home-container');if(!container)return;
  const empresas = getEmpresas();

  // Calculate globals
  let gCap=0,gComm=0,gBranches=0,gEBITDA=0,gScore=0,gScored=0;
  empresas.forEach(emp => {
    (emp.proyectos||[]).forEach(proj => {
      gCap += proj.totalCapital||0;
      (proj.branches||[]).forEach(b => {
        if(b.status==='archived') return;
        gBranches++;
        try {
          const r = runBranchProjection(b, proj);
          if(r){
            gComm += r.totalInvestment||0;
            gEBITDA += r.avgMonthlyEBITDA||0;
            if(r.viabilityScore){ gScore += r.viabilityScore; gScored++; }
          }
        } catch(e){}
      });
    });
  });
  const gFree = gCap - gComm;
  const gAvg = gScored ? Math.round(gScore/gScored) : 0;
  const sCol = gAvg>=80?'var(--green)':gAvg>=60?'var(--yellow)':'var(--red)';

  let h = '';

  // ── Summary (full-width grid, no floating title) ──
  h += `<div class="bw2-global-summary">
    <div class="global-summary-grid">
      <div class="global-summary-card"><span class="global-summary-label">Capital Total</span><span class="global-summary-value">${fmt.m(gCap)}</span></div>
      <div class="global-summary-card"><span class="global-summary-label">Comprometido</span><span class="global-summary-value" style="color:var(--yellow)">${fmt.m(gComm)}</span><span class="global-summary-sub">${gCap?((gComm/gCap)*100).toFixed(0):'0'}%</span></div>
      <div class="global-summary-card"><span class="global-summary-label">Capital Libre</span><span class="global-summary-value" style="color:${gFree>=0?'var(--green)':'var(--red)'}">${fmt.m(gFree)}</span></div>
      <div class="global-summary-card"><span class="global-summary-label">Sucursales</span><span class="global-summary-value">${gBranches}</span><span class="global-summary-sub">${empresas.length} empresa${empresas.length!==1?'s':''}</span></div>
      <div class="global-summary-card"><span class="global-summary-label">EBITDA/mes</span><span class="global-summary-value" style="color:${gEBITDA>=0?'var(--green)':'var(--red)'}">${fmt.m(gEBITDA)}</span></div>
      <div class="global-summary-card"><span class="global-summary-label">Score</span><span class="global-summary-value">${scoreRing(gAvg, 40)}</span></div>
    </div>
  </div>`;

  // ── View header ──
  h += `<div class="view-header" style="display:flex;justify-content:space-between;align-items:center">
    <div><h2>Mis Empresas</h2><p>Selecciona una empresa para ver sus proyectos</p></div>
    <button class="btn-primary" id="btn-create-empresa">+ Nueva Empresa</button>
  </div>`;

  if(!empresas.length){
    h += `<div class="empty-state">
      <div class="empty-state-icon">🏢</div>
      <div class="empty-state-title">Crea tu primera empresa</div>
      <div class="empty-state-desc">Organiza tus inversiones en franquicias por empresa, proyecto y sucursal. Analiza viabilidad financiera, estudio de mercado y más.</div>
      <button class="empty-state-cta" id="btn-empty-create">+ Crear Empresa</button>
    </div>`;
    container.innerHTML = h;
    $('btn-create-empresa').onclick = ()=>showBW2Modal('crear-empresa');
    $('btn-empty-create').onclick = ()=>showBW2Modal('crear-empresa');
    return;
  }

  // ── Empresa cards grid (same card style as Level 2 project cards) ──
  h += `<div class="empresa-proyectos-grid">`;
  empresas.forEach(emp => {
    const pCount = emp.proyectos.length;
    let bCount=0, ebitda=0, score=0, scored=0, payback=0;
    (emp.proyectos||[]).forEach(proj => {
      (proj.branches||[]).forEach(b => {
        if(b.status==='archived') return;
        bCount++;
        try {
          const r = runBranchProjection(b, proj);
          if(r){
            ebitda += r.avgMonthlyEBITDA||0;
            if(r.paybackMonth > payback) payback = r.paybackMonth;
            if(r.viabilityScore){ score += r.viabilityScore; scored++; }
          }
        } catch(e){}
      });
    });
    const aScore = scored ? Math.round(score/scored) : 0;
    const sc = aScore>=80?'var(--green)':aScore>=60?'var(--yellow)':'var(--red)';
    const logo = emp.logo
      ? `<img src="${emp.logo}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover">`
      : '<span style="font-size:1.25rem">🏢</span>';

    // Compute sparkline data (monthly EBITDA for last 12 months)
    let sparkData = [];
    (emp.proyectos||[]).forEach(proj => {
      (proj.branches||[]).forEach(b => {
        if (b.status === 'archived') return;
        try {
          const r = runBranchProjection(b, proj);
          if (r && r.months) {
            const last12 = r.months.slice(-12);
            last12.forEach((m,i) => { sparkData[i] = (sparkData[i]||0) + (m.ebitda||0); });
          }
        } catch(e) {}
      });
    });

    h += `<div class="emp-dash-proj-card" data-emp-id="${emp.id}">
      <div class="emp-dash-proj-header">
        <div style="display:flex;align-items:center;gap:0.5rem">
          ${logo}
          <div>
            <div class="emp-dash-proj-name">${esc(emp.name)}</div>
            <div class="emp-dash-proj-meta">${pCount} proyecto${pCount!==1?'s':''} · ${bCount} sucursal${bCount!==1?'es':''}</div>
          </div>
        </div>
        <div style="display:flex;gap:0.25rem">
          <button class="btn-icon btn-edit-empresa" data-emp-id="${emp.id}" title="Editar">✏️</button>
          <button class="btn-icon btn-delete-empresa" data-emp-id="${emp.id}" title="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="emp-dash-proj-kpis">
        <div class="emp-dash-kpi"><span class="emp-dash-kpi-label">EBITDA/mes</span><span class="emp-dash-kpi-value" style="color:${ebitda>=0?'var(--accent)':'var(--red)'}">${fmt.m(ebitda)}</span></div>
        <div class="emp-dash-kpi"><span class="emp-dash-kpi-label">Recuperación</span><span class="emp-dash-kpi-value">${payback?payback+' m':'—'}</span></div>
        <div class="emp-dash-kpi" style="display:flex;align-items:center;gap:0.4rem"><span class="emp-dash-kpi-label">Score</span>${scoreRing(aScore, 36)}</div>
      </div>
      ${sparkData.length >= 2 ? sparklineSVG(sparkData) : ''}
      <div class="emp-dash-proj-footer">
        <div class="emp-dash-proj-meta-foot">${pCount} proyecto${pCount!==1?'s':''} · ${bCount} sucursal${bCount!==1?'es':''}</div>
        <button class="btn-open-empresa btn-compact-open" data-emp-id="${emp.id}">Abrir →</button>
      </div>
    </div>`;
  });

  // Add "new empresa" card
  h += `<div class="emp-dash-proj-card emp-dash-add-card">
    <button class="btn-add-proyecto-dash" id="btn-create-empresa-card">+ Nueva Empresa</button>
  </div>`;
  h += `</div>`;

  container.innerHTML = h;
  bindBW2Events();
  renderAlertStrip(container);
  const cardBtn = $('btn-create-empresa-card');
  if(cardBtn) cardBtn.onclick = ()=>showBW2Modal('crear-empresa');
}

function bindBW2Events(){
  const createBtn = $('btn-create-empresa');
  if(createBtn) createBtn.onclick = ()=>showBW2Modal('crear-empresa');

  document.querySelectorAll('.btn-edit-empresa').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); showBW2Modal('editar-empresa', btn.dataset.empId); };
  });
  document.querySelectorAll('.btn-delete-empresa').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const emp = getEmpresaById(btn.dataset.empId);
      if(!emp) return;
      showConfirm(`🗑️ ¿Eliminar "${emp.name}"?`,`<p>Se eliminarán todos los proyectos y sucursales.</p>`,'🗑️ Eliminar',()=>{ removeEmpresa(btn.dataset.empId); renderBW2Home(); });
    };
  });
  document.querySelectorAll('.btn-open-empresa').forEach(btn=>{
    btn.onclick = ()=>{
      setActiveEmpresa(btn.dataset.empId);
      state.view = 'empresa-dashboard';
      state.activeBranchId = null;
      renderCurrentView();
    };
  });
}

function renderPortfolioSummary(empresa){
  const el=$('portfolio-summary'); if(!el) return;
  if(!empresa){ el.style.display='none'; return; }

  const consol = runConsolidation(empresa);
  el.style.display='';
  el.innerHTML=`
    <div class="global-summary-title">📁 ${esc(empresa.name)} — Resumen</div>
    <div class="global-summary-grid">
      <div class="global-summary-card">
        <span class="global-summary-label">Capital</span>
        <span class="global-summary-value">${fmt.m(empresa.totalCapital)}</span>
      </div>
      <div class="global-summary-card">
        <span class="global-summary-label">Comprometido</span>
        <span class="global-summary-value" style="color:var(--yellow)">${fmt.m(consol.capitalCommitted)}</span>
        <span class="global-summary-sub">${empresa.totalCapital?((consol.capitalCommitted/empresa.totalCapital)*100).toFixed(0):'0'}%</span>
      </div>
      <div class="global-summary-card">
        <span class="global-summary-label">Libre</span>
        <span class="global-summary-value" style="color:${consol.capitalFree>=0?'var(--green)':'var(--red)'}">${fmt.m(consol.capitalFree)}</span>
      </div>
      <div class="global-summary-card">
        <span class="global-summary-label">Ganancia/mes</span>
        <span class="global-summary-value" style="color:${consol.avgMonthlyEBITDA>=0?'var(--green)':'var(--red)'}">${fmt.m(consol.avgMonthlyEBITDA)}</span>
      </div>
      <div class="global-summary-card">
        <span class="global-summary-label">Sucursales</span>
        <span class="global-summary-value">${consol.branchCount}</span>
      </div>
      <div class="global-summary-card">
        <span class="global-summary-label">Score</span>
        <span class="global-summary-value">${scoreRing(consol.avgScore, 40)}</span>
      </div>
    </div>`;
}

/* ═══ EMPRESA DASHBOARD (Level 2) ═══ */
function renderEmpresaDashboard(empresa){
  const titleEl=$('empresa-dash-title');
  const summaryEl=$('empresa-dash-summary');
  const gridEl=$('empresa-dash-proyectos');
  if(!titleEl||!gridEl) return;

  titleEl.textContent = '🏢 ' + (empresa.name || 'Empresa');

  // Calculate empresa-wide KPIs across all projects
  let totalCap=0, totalComm=0, totalBranches=0, totalEBITDA=0, totalScore=0, scoredCount=0;
  (empresa.proyectos||[]).forEach(proj => {
    totalCap += proj.totalCapital||0;
    (proj.branches||[]).forEach(b => {
      if(b.status==='archived') return;
      totalBranches++;
      try {
        const r = runBranchProjection(b, proj);
        if(r) {
          totalComm += r.totalInvestment||0;
          totalEBITDA += r.avgMonthlyEBITDA||0;
          if(r.viabilityScore){ totalScore += r.viabilityScore; scoredCount++; }
        }
      } catch(e){}
    });
  });
  const avgScore = scoredCount ? Math.round(totalScore/scoredCount) : 0;
  const totalFree = totalCap - totalComm;

  if(summaryEl){
    summaryEl.innerHTML=`
      <div class="global-summary-title">🏢 ${esc(empresa.name)} — Resumen General</div>
      <div class="global-summary-grid">
        <div class="global-summary-card"><span class="global-summary-label">Capital Total</span><span class="global-summary-value">${fmt.m(totalCap)}</span></div>
        <div class="global-summary-card"><span class="global-summary-label">Comprometido</span><span class="global-summary-value" style="color:var(--yellow)">${fmt.m(totalComm)}</span><span class="global-summary-sub">${totalCap?((totalComm/totalCap)*100).toFixed(0):'0'}%</span></div>
        <div class="global-summary-card"><span class="global-summary-label">Capital Libre</span><span class="global-summary-value" style="color:${totalFree>=0?'var(--green)':'var(--red)'}">${fmt.m(totalFree)}</span></div>
        <div class="global-summary-card"><span class="global-summary-label">Sucursales</span><span class="global-summary-value">${totalBranches}</span><span class="global-summary-sub">${empresa.proyectos.length} proyecto${empresa.proyectos.length!==1?'s':''}</span></div>
        <div class="global-summary-card"><span class="global-summary-label">EBITDA/mes</span><span class="global-summary-value" style="color:${totalEBITDA>=0?'var(--green)':'var(--red)'}">${fmt.m(totalEBITDA)}</span></div>
        <div class="global-summary-card"><span class="global-summary-label">Score</span><span class="global-summary-value">${scoreRing(avgScore, 40)}</span></div>
      </div>`;
  }

  // Render project cards
  let html = '';
  (empresa.proyectos||[]).forEach(proj => {
    const activeBranches = (proj.branches||[]).filter(b=>b.status!=='archived');
    let projEBITDA=0, projScore=0, projScored=0, projPayback=0;
    activeBranches.forEach(b => {
      try {
        const r = runBranchProjection(b, proj);
        if(r) {
          projEBITDA += r.avgMonthlyEBITDA||0;
          if(r.paybackMonth > projPayback) projPayback = r.paybackMonth;
          if(r.viabilityScore){ projScore += r.viabilityScore; projScored++; }
        }
      } catch(e){}
    });
    const pScore = projScored ? Math.round(projScore/projScored) : 0;
    const scoreCol = pScore>=80?'var(--green)':pScore>=60?'var(--yellow)':'var(--red)';
    const projLogoHtml = proj.logo
      ? `<img src="${proj.logo}" alt="${esc(proj.name)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover">`
      : '<span style="font-size:1.25rem">📁</span>';

    html += `<div class="emp-dash-proj-card" data-emp-id="${empresa.id}" data-proj-id="${proj.id}">
      <div class="emp-dash-proj-header">
        <div style="display:flex;align-items:center;gap:0.5rem">
          ${projLogoHtml}
          <div>
            <div class="emp-dash-proj-name">${esc(proj.name)}</div>
            <div class="emp-dash-proj-meta">Capital: ${fmt.m(proj.totalCapital)} · ${activeBranches.length} sucursal${activeBranches.length!==1?'es':''}</div>
          </div>
        </div>
        <div style="display:flex;gap:0.25rem">
          <button class="btn-icon btn-edit-proyecto" data-emp-id="${empresa.id}" data-proj-id="${proj.id}" title="Editar">✏️</button>
          <button class="btn-icon btn-delete-proyecto" data-emp-id="${empresa.id}" data-proj-id="${proj.id}" title="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="emp-dash-proj-kpis">
        <div class="emp-dash-kpi"><span class="emp-dash-kpi-label">Ganancia/mes</span><span class="emp-dash-kpi-value" style="color:${projEBITDA>=0?'var(--accent)':'var(--red)'}">${fmt.m(projEBITDA)}</span></div>
        <div class="emp-dash-kpi"><span class="emp-dash-kpi-label">Recuperación</span><span class="emp-dash-kpi-value">${projPayback?projPayback+' m':'—'}</span></div>
        <div class="emp-dash-kpi" style="display:flex;align-items:center;gap:0.4rem"><span class="emp-dash-kpi-label">Score</span>${scoreRing(pScore, 36)}</div>
      </div>
      <button class="btn-open-proyecto-dash" data-emp-id="${empresa.id}" data-proj-id="${proj.id}">Abrir Proyecto →</button>
    </div>`;
  });

  // Add "new project" card
  html += `<div class="emp-dash-proj-card emp-dash-add-card">
    <button class="btn-add-proyecto-dash" data-emp-id="${empresa.id}">+ Nuevo Proyecto</button>
  </div>`;

  gridEl.innerHTML = html;

  // Wire events
  gridEl.querySelectorAll('.btn-open-proyecto-dash').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveProyecto(btn.dataset.empId, btn.dataset.projId);
      state.view = 'portfolio';
      state.activeBranchId = null;
      renderCurrentView();
    });
  });
  gridEl.querySelectorAll('.btn-add-proyecto-dash').forEach(btn => {
    btn.addEventListener('click', () => {
      showBW2Modal('crear-proyecto', btn.dataset.empId);
    });
  });
  gridEl.querySelectorAll('.btn-edit-proyecto').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showBW2Modal('editar-proyecto', btn.dataset.empId, btn.dataset.projId);
    });
  });
  gridEl.querySelectorAll('.btn-delete-proyecto').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const proj = getProyectoById(btn.dataset.empId, btn.dataset.projId);
      if(!proj) return;
      showConfirm(
        `🗑️ ¿Eliminar "${proj.name}"?`,
        `<p>Se eliminarán todas las sucursales de este proyecto.</p>`,
        '🗑️ Eliminar',
        ()=>{ removeProyecto(btn.dataset.empId, btn.dataset.projId); renderEmpresaDashboard(getActiveEmpresa()); }
      );
    });
  });
}



function showBW2Modal(type, empId, projId){
  // Remove existing dynamically-created modal (not static ones like profile)
  const old = document.querySelector('.bw2-modal-overlay:not([id])');
  if(old) old.remove();

  let title='', fields='', submitLabel='Guardar';
  let existingLogo = null;

  // Logo upload field HTML
  const logoField = (label, currentLogo) => {
    existingLogo = currentLogo;
    return `<div class="bw2-form-group">
      <label>${label}</label>
      <div class="bw2-logo-upload" id="bw2-logo-dropzone">
        <input type="file" id="bw2-input-logo" accept="image/jpeg,image/png,image/webp" style="display:none">
        <div class="bw2-logo-preview" id="bw2-logo-preview" ${currentLogo ? '' : 'style="display:none"'}>
          <img id="bw2-logo-preview-img" src="${currentLogo || ''}" alt="Logo">
          <button type="button" class="bw2-logo-remove" id="bw2-logo-remove" title="Quitar logo">✕</button>
        </div>
        <div class="bw2-logo-placeholder" id="bw2-logo-placeholder" ${currentLogo ? 'style="display:none"' : ''}>
          <span class="bw2-logo-icon">📷</span>
          <span>Arrastra una imagen o <strong>haz clic</strong></span>
          <small>JPG, PNG · Máx 2MB</small>
        </div>
      </div>
    </div>`;
  };

  if(type==='crear-empresa'){
    title='Nueva Empresa';
    fields=`<div class="bw2-form-group">
      <label>Nombre de la Empresa</label>
      <input type="text" id="bw2-input-name" class="input-text" placeholder="Ej: Mi Empresa S.A. de C.V." autofocus>
    </div>
    ${logoField('Logo de la Empresa', null)}`;
    submitLabel='Crear Empresa';
  } else if(type==='editar-empresa'){
    const emp = getEmpresaById(empId);
    title='Editar Empresa';
    fields=`<div class="bw2-form-group">
      <label>Nombre de la Empresa</label>
      <input type="text" id="bw2-input-name" class="input-text" value="${emp?.name||''}" autofocus>
    </div>
    ${logoField('Logo de la Empresa', emp?.logo || null)}`;
  } else if(type==='crear-proyecto'){
    title='Nuevo Proyecto';
    fields=`<div class="bw2-form-group">
      <label>Nombre del Proyecto</label>
      <input type="text" id="bw2-input-name" class="input-text" placeholder="Ej: FarmaTuya Zona Norte" autofocus>
    </div>
    <div class="bw2-form-group">
      <label>Capital Total ($)</label>
      <input type="number" id="bw2-input-capital" class="input-text" value="2000000" step="100000">
    </div>
    <div class="bw2-form-group">
      <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
        <input type="checkbox" id="bw2-input-franchise" checked>
        Es un proyecto de franquicia
      </label>
      <p style="font-size:0.75rem;color:var(--text-3);margin-top:0.25rem">Si marcas esto, el proyecto incluirá cálculos de regalías.</p>
    </div>
    ${logoField('Logo del Proyecto', null)}`;
    submitLabel='Crear Proyecto';
  } else if(type==='editar-proyecto'){
    const proj = getProyectoById(empId, projId);
    const isF = proj?.isFranchise !== false;
    title='Editar Proyecto';
    fields=`<div class="bw2-form-group">
      <label>Nombre del Proyecto</label>
      <input type="text" id="bw2-input-name" class="input-text" value="${proj?.name||''}" autofocus>
    </div>
    <div class="bw2-form-group">
      <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
        <input type="checkbox" id="bw2-input-franchise" ${isF ? 'checked' : ''}>
        Es un proyecto de franquicia
      </label>
    </div>
    ${logoField('Logo del Proyecto', proj?.logo || null)}`;
  }

  const overlay = document.createElement('div');
  overlay.className='bw2-modal-overlay';
  overlay.innerHTML=`<div class="bw2-modal">
    <div class="bw2-modal-header">
      <h3>${title}</h3>
      <button class="bw2-modal-close">✕</button>
    </div>
    <div class="bw2-modal-body">${fields}</div>
    <div class="bw2-modal-footer">
      <button class="btn-secondary bw2-modal-cancel">Cancelar</button>
      <button class="btn-primary bw2-modal-submit">${submitLabel}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  // ── Logo upload logic ──
  let pendingLogoDataURL = existingLogo || null;
  const fileInput = overlay.querySelector('#bw2-input-logo');
  const dropzone = overlay.querySelector('#bw2-logo-dropzone');
  const preview = overlay.querySelector('#bw2-logo-preview');
  const previewImg = overlay.querySelector('#bw2-logo-preview-img');
  const placeholder = overlay.querySelector('#bw2-logo-placeholder');
  const removeBtn = overlay.querySelector('#bw2-logo-remove');

  function showPreview(dataURL) {
    pendingLogoDataURL = dataURL;
    previewImg.src = dataURL;
    preview.style.display = 'flex';
    placeholder.style.display = 'none';
  }
  function clearPreview() {
    pendingLogoDataURL = null;
    previewImg.src = '';
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
  }

  if(dropzone) {
    // Click to upload
    dropzone.addEventListener('click', (e) => {
      if(e.target === fileInput) return; // prevent re-trigger
      if(e.target.closest('#bw2-logo-remove')) return;
      fileInput.click();
    });
    // File selected
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if(!file) return;
      if(file.size > 2 * 1024 * 1024) { showToast('Imagen muy grande (máx 2MB)', 'error'); return; }
      try {
        const dataURL = await resizeImageToDataURL(file, 256);
        showPreview(dataURL);
      } catch(e) { showToast('Error al procesar imagen', 'error'); }
    });
    // Drag & drop
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault(); dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if(!file || !file.type.startsWith('image/')) { showToast('Solo se aceptan imágenes', 'error'); return; }
      if(file.size > 2 * 1024 * 1024) { showToast('Imagen muy grande (máx 2MB)', 'error'); return; }
      try {
        const dataURL = await resizeImageToDataURL(file, 256);
        showPreview(dataURL);
      } catch(e) { showToast('Error al procesar imagen', 'error'); }
    });
    // Remove
    if(removeBtn) removeBtn.addEventListener('click', (e) => { e.stopPropagation(); clearPreview(); });
  }

  // Focus input
  setTimeout(()=>{const inp=$('bw2-input-name');if(inp)inp.focus();},100);

  // Close handlers
  overlay.querySelector('.bw2-modal-close').onclick=()=>overlay.remove();
  overlay.querySelector('.bw2-modal-cancel').onclick=()=>overlay.remove();
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});

  // Submit handler
  overlay.querySelector('.bw2-modal-submit').onclick=()=>{
    const nameVal = $('bw2-input-name')?.value.trim();
    if(!nameVal || nameVal.length < 1){showToast('El nombre es requerido','error');return;}
    if(nameVal.length > 100){showToast('El nombre es demasiado largo (máx 100 caracteres)','error');return;}

    if(type==='crear-empresa'){
      const newEmp = addEmpresa(nameVal);
      if(pendingLogoDataURL) updateEmpresaData(newEmp.id, {logo: pendingLogoDataURL});
      showToast(`Empresa "${nameVal}" creada`,'success');
    } else if(type==='editar-empresa'){
      updateEmpresaData(empId, {name:nameVal, logo: pendingLogoDataURL});
      showToast('Empresa actualizada','success');
    } else if(type==='crear-proyecto'){
      const cap = parseFloat($('bw2-input-capital')?.value)||2000000;
      const isFranchise = $('bw2-input-franchise') ? $('bw2-input-franchise').checked : true;
      const newProj = addProyecto(empId, nameVal);
      if(newProj){
        updateProyecto(empId, newProj.id, {totalCapital:cap, isFranchise, logo: pendingLogoDataURL});
        showToast(`Proyecto "${nameVal}" creado`,'success');
      }
    } else if(type==='editar-proyecto'){
      const isFranchise = $('bw2-input-franchise') ? $('bw2-input-franchise').checked : true;
      updateProyecto(empId, projId, {name:nameVal, isFranchise, logo: pendingLogoDataURL});
      showToast('Proyecto actualizado','success');
    }

    overlay.remove();
    renderBW2Home();
  };

  // Enter key submit
  overlay.addEventListener('keydown',e=>{if(e.key==='Enter')overlay.querySelector('.bw2-modal-submit').click();});
}

/* ═══ PORTFOLIO VIEW ═══ */
function renderPortfolio(empresa){
  const container=$('portfolio-grid');if(!container)return;
  const proj = empresa.proyectos?.find(p => p.id === state.activeProyectoId);
  const titleEl = $('portfolio-title');
  if (titleEl) titleEl.textContent = `Sucursales de ${proj ? proj.name : 'Proyecto'}`;
  const branchResults = empresa.branches.map(b=>{
    try { return {branch:b, result:runBranchProjection(b,empresa)}; }
    catch(e) { return {branch:b, result:null}; }
  });
  container.innerHTML = branchResults.map(({branch:b,result:r})=>{
    const score=r?r.viabilityScore:0;
    const color=score>=60?'var(--green)':score>=40?'var(--yellow)':'var(--red)';
    const label=score>=80?'EXCELENTE':score>=60?'VIABLE':score>=40?'FRÁGIL':'—';
    const emoji=MODELS[b.format]?.emoji||'📍';
    const statusMap = {
      active:   '<span class="branch-status active">✅ Activa</span>',
      planned:  '<span class="branch-status planned">📋 Planeada</span>',
      archived: '<span class="branch-status archived">📦 Archivada</span>',
      paused:   '<span class="branch-status archived">📦 Archivada</span>'
    };
    const statusBadge = statusMap[b.status] || statusMap.planned;
    const isArchived = b.status === 'archived' || b.status === 'paused';
    const isPlanned = b.status === 'planned';
    const isActive = b.status === 'active';

    // Build action buttons — using data attributes for event delegation (no inline onclick)
    let actionBtns = `<button class="btn-sm" data-action="open" data-bid="${b.id}">📊 Ver</button>`;
    actionBtns += `<button class="btn-sm" data-action="dup" data-bid="${b.id}">📋 Duplicar</button>`;

    if (isPlanned) {
      actionBtns += `<button class="btn-sm success" data-action="activate" data-bid="${b.id}">✅ Activar</button>`;
      actionBtns += `<button class="btn-sm warn" data-action="delete" data-bid="${b.id}">🗑 Eliminar</button>`;
    } else if (isActive) {
      actionBtns += `<button class="btn-sm warn" data-action="archive" data-bid="${b.id}">📦 Archivar</button>`;
    } else if (isArchived) {
      actionBtns += `<button class="btn-sm success" data-action="restore" data-bid="${b.id}">▶ Restaurar</button>`;
      actionBtns += `<button class="btn-sm danger" data-action="delete" data-bid="${b.id}">🗑 Eliminar</button>`;
    }

    return `<div class="branch-card ${isArchived?'archived':''}" data-branch="${b.id}">
      <div class="branch-card-header">
        <span class="branch-emoji">${emoji}</span>
        <div class="branch-info"><div class="branch-name">${b.name}</div><div class="branch-meta">${MODELS[b.format]?.label||b.format} · ${b.colonia||'Sin colonia'}</div></div>
        ${statusBadge}
      </div>
      ${r?`<div class="branch-kpis">
        <div class="branch-kpi"><span class="bk-label" title="Ganancia mensual antes de impuestos">Ganancia/mes</span><span class="bk-value" style="color:${r.avgMonthlyEBITDA>=0?'var(--green)':'var(--red)'}">${fmt.m(r.avgMonthlyEBITDA)}</span></div>
        <div class="branch-kpi"><span class="bk-label" title="Venta mínima mensual para cubrir todos los costos">Pto. Equilibrio</span><span class="bk-value">${fmt.m(r.breakEvenRevenue)}</span></div>
        <div class="branch-kpi"><span class="bk-label" title="Meses reales para recuperar la inversión (flujo acumulado desde apertura)">Recuperación</span><span class="bk-value" style="color:${r.paybackMonth&&r.paybackMonth<=36?'var(--green)':r.paybackMonth&&r.paybackMonth<=48?'var(--yellow)':'var(--red)'}">${r.paybackMonth?r.paybackMonth+' meses':'∞'}</span></div>
        <div class="branch-kpi" style="display:flex;align-items:center;gap:0.35rem"><span class="bk-label" title="Calificación de viabilidad: 0-100">Calif.</span>${scoreRing(score, 32)}</div>
      </div>`:'<div class="branch-kpis"><span style="color:var(--text-3)">Sin datos</span></div>'}
      <div class="branch-actions">${actionBtns}</div>
    </div>`;
  }).join('');

  // Event delegation for branch action buttons (replaces inline onclick)
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const bid = btn.dataset.bid;
    const action = btn.dataset.action;
    if (action === 'open') window._openBranch(bid);
    else if (action === 'dup') window._dupBranch(bid);
    else if (action === 'activate') window._activateBranch(bid);
    else if (action === 'delete') window._deleteBranch(bid);
    else if (action === 'archive') window._archiveBranch(bid);
    else if (action === 'restore') window._restoreBranch(bid);
  });
}

// Global action handlers
window._openBranch = (id)=>{ state.view='branch'; state.activeBranchId=id; state.activeTab='resultados'; state.branchOverrides={}; renderCurrentView(); };
window._activateBranch = (id)=>{ activateBranch(id); };
window._restoreBranch = (id)=>{ restoreBranch(id); };

/* ── Custom confirm modal (replaces native confirm) ── */
function showConfirm(title, bodyHtml, dangerLabel, onConfirm) {
  const modal = document.getElementById('modal-confirm');
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-body').innerHTML = bodyHtml;
  const okBtn = document.getElementById('modal-confirm-ok');
  okBtn.textContent = dangerLabel;
  modal.style.display = 'flex';
  // Clone to remove old listeners
  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);
  const cancelBtn = document.getElementById('modal-confirm-cancel');
  const newCancel = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  newOk.addEventListener('click', () => { modal.style.display = 'none'; onConfirm(); });
  newCancel.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; }, { once: true });
}

window._archiveBranch = (id)=>{
  const b = getBranch(id);
  if (!b) return;
  showConfirm(
    `📦 ¿Archivar "${b.name}"?`,
    `<p>Se excluirá del consolidado y métricas activas.</p><p style="color:var(--green)">Podrás restaurarla después.</p>`,
    '📦 Archivar',
    () => archiveBranch(id)
  );
};
window._deleteBranch = (id)=>{
  const b = getBranch(id);
  if (!b) return;
  showConfirm(
    `🗑 ¿Eliminar "${b.name}"?`,
    `<ul style="text-align:left;color:var(--text-2);line-height:1.8">
      <li>Se quitará del consolidado</li>
      <li>Se quitará del conteo total</li>
      <li>Su inversión se liberará del capital comprometido</li>
      <li>Su utilidad y flujo se quitarán del consolidado</li>
      <li>Se quitará de comparativos</li>
    </ul>
    <p style="color:var(--red);font-weight:700;margin-top:0.5rem">Esta acción NO se puede deshacer.</p>`,
    '🗑 Eliminar definitivamente',
    () => {
      removeBranch(id);
      if (state.activeBranchId === id) { state.view = 'portfolio'; state.activeBranchId = null; }
    }
  );
};

function selectNav(view) {
  // Legacy compatibility — calls updateNav instead
  updateNav();
}

/* ══════════════════════════════════════════
   CONTEXTUAL SIDEBAR NAVIGATION
   ══════════════════════════════════════════ */
function updateNav() {
  const nav = $('main-nav');
  if (!nav) return;

  const empresa = getEmpresa();
  const activeEmp = getActiveEmpresa();
  const isHome = state.view === 'bw2home';
  const isEmpresaDash = state.view === 'empresa-dashboard';
  const isBranch = state.view === 'branch' && state.activeBranchId;
  const branch = isBranch ? getBranch(state.activeBranchId) : null;

  nav.className = '';
  let html = '';

  if (isHome) {
    // Level 1: Home — minimal sidebar for consistency
    nav.style.display = 'flex';
    html += `<div class="nav-section">Panel de Control</div>`;
    html += `<button class="nav-btn active"><span class="nav-icon">🏢</span>Empresas</button>`;
    html += `<div class="nav-divider"></div>`;
    html += `<div class="nav-spacer"></div>`;
    html += `<button class="nav-btn" id="nav-open-profile"><span class="nav-icon">👤</span>Mi Perfil</button>`;
    nav.innerHTML = html;
    const profBtn = nav.querySelector('#nav-open-profile');
    if(profBtn) profBtn.addEventListener('click', () => {
      const profileBtn = $('btn-open-profile');
      if(profileBtn) profileBtn.click();
    });
    return;
  }

  nav.style.display = 'flex';

  if (isEmpresaDash) {
    // Level 2: Empresa Dashboard
    html += `<button class="nav-back" id="nav-back-home"><span class="nav-back-icon">🏠</span> Home</button>`;
    html += `<div class="nav-divider"></div>`;
    html += `<div class="nav-section">Empresa</div>`;
    html += `<button class="nav-btn active"><span class="nav-icon">📁</span>Proyectos</button>`;
    html += `<div class="nav-divider"></div>`;
    html += `<div class="nav-section">Configuración</div>`;
    html += `<button class="nav-btn" data-action="empresa-settings"><span class="nav-icon">⚙️</span>Sociedad y Socios</button>`;
    html += `<div class="nav-spacer"></div>`;
    html += `<button class="btn-add" id="btn-add-proyecto-nav">+ Nuevo Proyecto</button>`;
  } else if (isBranch && branch) {
    // Level 4: Inside a Branch
    html += `<button class="nav-back" id="nav-back-project"><span class="nav-back-icon">←</span> Proyecto</button>`;
    html += `<div class="nav-divider"></div>`;
    html += `<div class="nav-section">Sucursal</div>`;
    html += `<button class="nav-btn ${state.activeTab === 'resultados' ? 'active' : ''}" data-branch-tab="resultados"><span class="nav-icon">📊</span>Resultados</button>`;
    html += `<button class="nav-btn ${state.activeTab === 'config' ? 'active' : ''}" data-branch-tab="config"><span class="nav-icon">⚙️</span>Configuración</button>`;
    html += `<button class="nav-btn ${state.activeTab === 'socioeconomico' ? 'active' : ''}" data-branch-tab="socioeconomico"><span class="nav-icon">🌍</span>Estudio de Mercado</button>`;
    html += `<div class="nav-divider"></div>`;
    html += `<div class="nav-spacer"></div>`;
    html += `<button class="btn-add" id="nav-export-pdf" style="background:var(--surface);color:var(--text-2);box-shadow:var(--shadow-neu-sm)"><span class="nav-icon">📄</span> Exportar PDF</button>`;
  } else {
    // Level 3: Inside a Project
    html += `<button class="nav-back" id="nav-back-empresa"><span class="nav-back-icon">←</span> Empresa</button>`;
    html += `<div class="nav-divider"></div>`;
    html += `<div class="nav-section">Proyecto</div>`;
    html += `<button class="nav-btn ${state.view === 'portfolio' ? 'active' : ''}" data-view="portfolio"><span class="nav-icon">📁</span>Sucursales</button>`;
    html += `<button class="nav-btn ${state.view === 'consolidated' ? 'active' : ''}" data-view="consolidated"><span class="nav-icon">📊</span>Consolidado</button>`;
    html += `<button class="nav-btn ${state.view === 'comparador' ? 'active' : ''}" data-view="comparador"><span class="nav-icon">⚖️</span>Comparar</button>`;
    html += `<div class="nav-divider"></div>`;
    html += `<div class="nav-section">Configuración</div>`;
    html += `<button class="nav-btn ${state.view === 'empresa' ? 'active' : ''}" data-view="empresa"><span class="nav-icon">⚙️</span>Sociedad y Socios</button>`;
    html += `<div class="nav-spacer"></div>`;
    html += `<button class="btn-add" id="btn-add-branch">+ Nueva Sucursal</button>`;
  }

  nav.innerHTML = html;

  // Wire up events
  // Home button (available at empresa level)
  const homeBtn = nav.querySelector('#nav-back-home');
  if (homeBtn) homeBtn.addEventListener('click', () => {
    state.view = 'bw2home'; state.activeBranchId = null; renderCurrentView();
  });

  if (isEmpresaDash) {
    // Empresa-level buttons
    const settingsBtn = nav.querySelector('[data-action="empresa-settings"]');
    if (settingsBtn && activeEmp) {
      settingsBtn.addEventListener('click', () => {
        // Set the first project as active to access settings
        if(activeEmp.proyectos.length) {
          setActiveProyecto(activeEmp.id, activeEmp.proyectos[0].id);
        }
        state.view = 'empresa';
        renderCurrentView();
      });
    }
    const addProjBtn = nav.querySelector('#btn-add-proyecto-nav');
    if (addProjBtn && activeEmp) {
      addProjBtn.addEventListener('click', () => {
        showBW2Modal('crear-proyecto', activeEmp.id);
      });
    }
  } else if (isBranch) {
    // Back to project
    const backBtn = nav.querySelector('#nav-back-project');
    if (backBtn) backBtn.addEventListener('click', () => {
      state.view = 'portfolio'; state.activeBranchId = null; renderCurrentView();
    });
    // Branch tab buttons
    nav.querySelectorAll('[data-branch-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchBranchTab(btn.dataset.branchTab);
        updateNav();
      });
    });
    // PDF export
    const pdfBtn = nav.querySelector('#nav-export-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', () => {
      const mainPdfBtn = $('btn-export-pdf');
      if (mainPdfBtn) mainPdfBtn.click();
    });
  } else {
    // Back to empresa
    const backEmpBtn = nav.querySelector('#nav-back-empresa');
    if (backEmpBtn) backEmpBtn.addEventListener('click', () => {
      state.view = 'empresa-dashboard'; state.activeBranchId = null; renderCurrentView();
    });
    // Project-level nav buttons
    nav.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.view;
        state.activeBranchId = null;
        renderCurrentView();
      });
    });
    // Add branch
    const addBtn = nav.querySelector('#btn-add-branch');
    if (addBtn) addBtn.addEventListener('click', showAddBranchModal);
  }
}

/* ── Breadcrumb in header ── */
function updateBreadcrumb() {
  const bc = $('header-breadcrumb');
  if (!bc) return;

  const isHome = state.view === 'bw2home';
  const isEmpresaDash = state.view === 'empresa-dashboard';

  if (isHome) { bc.innerHTML = ''; return; }

  const emp = getActiveEmpresa();
  const proy = getActiveProyecto();
  const empresa = getEmpresa();
  const isBranch = state.view === 'branch' && state.activeBranchId;
  const branch = isBranch ? getBranch(state.activeBranchId) : null;

  let crumbs = [];

  // Empresa name (always first, clickable → empresa-dashboard)
  if (emp) {
    crumbs.push({ label: emp.name || 'Empresa', action: 'empresa-dashboard' });
  }

  if (isEmpresaDash) {
    // Level 2: Just show empresa name — no redundant "Proyectos"
  } else {
    // Proyecto name (clickable → portfolio)
    if (proy) {
      crumbs.push({ label: proy.name || 'Proyecto', action: 'portfolio' });
    }
    // Current view / branch
    if (isBranch && branch) {
      crumbs.push({ label: branch.name || 'Sucursal', action: null });
    } else {
      const viewLabels = {
        portfolio: 'Sucursales', consolidated: 'Consolidado',
        comparador: 'Comparar', empresa: 'Ajustes'
      };
      if (viewLabels[state.view]) {
        crumbs.push({ label: viewLabels[state.view], action: null });
      }
    }
  }

  bc.innerHTML = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    const sep = i > 0 ? '<span class="breadcrumb-sep">›</span>' : '';
    if (isLast) {
      return `${sep}<span class="breadcrumb-item current">${esc(c.label)}</span>`;
    }
    return `${sep}<button class="breadcrumb-item" data-bc-action="${c.action}">${esc(c.label)}</button>`;
  }).join('');

  // Wire breadcrumb clicks
  bc.querySelectorAll('[data-bc-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.bcAction;
      if (action === 'empresa-dashboard') {
        state.view = 'empresa-dashboard'; state.activeBranchId = null;
      } else if (action === 'portfolio') {
        state.view = 'portfolio'; state.activeBranchId = null;
      }
      renderCurrentView();
    });
  });
}

/* ── Switch branch tab from sidebar ── */
function switchBranchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.branch-tab-panel').forEach(p => p.classList.remove('active'));
  const targetPanel = $(`btab-${tabName}`);
  if (targetPanel) targetPanel.classList.add('active');
}

/* ─── GEOCODING AUTOCOMPLETE HELPER ─── */
function setupGeocodingAutocomplete(inputId, suggestionsId, statusId, onSelectCallback) {
  const ci = $(inputId); const sugBox = $(suggestionsId); const statusEl = $(statusId);
  let debounce = null;
  if (!ci) return;
  ci.addEventListener('input', () => {
    clearTimeout(debounce); const q = ci.value.trim();
    if (q.length < 3) { if(sugBox){sugBox.classList.remove('open');sugBox.innerHTML='';} if(statusEl)statusEl.innerHTML=''; return; }
    if (statusEl) statusEl.innerHTML = '<span class="searching">🔍 Buscando...</span>';
    debounce = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', México')}&format=json&limit=6&addressdetails=1&countrycodes=mx`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        const data = await res.json();
        if (!data.length) {
          if (sugBox) { sugBox.innerHTML = '<div class="colonia-suggestion"><span class="sug-main">Sin resultados</span></div>'; sugBox.classList.add('open'); }
          if (statusEl) statusEl.innerHTML = '<span class="no-results">Sin resultados</span>'; return;
        }
        if (sugBox) {
          sugBox.innerHTML = data.map((r, i) => {
            const name = r.address?.suburb || r.address?.neighbourhood || r.address?.city || r.display_name.split(',')[0];
            const detail = [r.address?.city || r.address?.town, r.address?.state].filter(Boolean).join(', ');
            return `<div class="colonia-suggestion" data-name="${esc(name)}" data-full="${esc(r.display_name)}" data-lat="${r.lat}" data-lon="${r.lon}">
              <div class="sug-main">${esc(name)}</div>
              <div class="sug-detail">${esc(detail || r.display_name)}</div>
            </div>`;
          }).join('');
          sugBox.classList.add('open');
          if (statusEl) statusEl.innerHTML = '<span class="searching">↓ Selecciona una ubicación</span>';
          sugBox.querySelectorAll('.colonia-suggestion').forEach(s => {
            s.addEventListener('click', () => {
              ci.value = s.dataset.name;
              if (sugBox) sugBox.classList.remove('open');
              if (statusEl) statusEl.innerHTML = `<span class="validated">✅ ${s.dataset.name}</span>`;
              if (onSelectCallback) onSelectCallback(s.dataset.name, s.dataset.full, s.dataset.lat, s.dataset.lon);
            });
          });
        }
      } catch (e) {
        if (statusEl) statusEl.innerHTML = '<span class="no-results">Error de conexión</span>';
      }
    }, 400);
  });
  document.addEventListener('click', (e) => { if (sugBox && !e.target.closest('.colonia-autocomplete')) sugBox.classList.remove('open'); });
}

/* ═══ ADD BRANCH MODAL ═══ */
function showAddBranchModal(){
  const modal=$('modal-add-branch');if(!modal)return;
  modal.style.display='flex';
  $('modal-add-format').value='express';
  $('modal-add-name').value='';
  $('modal-add-colonia').value='';
  const sugBox=$('modal-add-suggestions');
  const statusEl=$('modal-add-colonia-status');
  if(sugBox){sugBox.classList.remove('open');sugBox.innerHTML='';}
  if(statusEl) statusEl.innerHTML='';

  // Geocoding autocomplete for the modal colonia input
  setupGeocodingAutocomplete('modal-add-colonia', 'modal-add-suggestions', 'modal-add-colonia-status', (name, full) => {
    $('modal-add-colonia').dataset.full = full;
  });
}
window._closeModal=()=>{const m=$('modal-add-branch');if(m)m.style.display='none';};
window._confirmAddBranch=()=>{
  const format=$('modal-add-format').value;
  const name=$('modal-add-name').value||`Sucursal ${getEmpresa().branches.length+1}`;
  const colonia=$('modal-add-colonia').value;
  if(!colonia){
    showConfirm(
      '📍 Sin dirección',
      '<p>No ingresaste una dirección. ¿Deseas crear la sucursal sin ubicación?</p><p style="color:var(--text-3);font-size:0.8rem">Podrás agregarla después en la pestaña de Estudio de Mercado.</p>',
      '✅ Crear sin dirección',
      () => { addBranch(format, name, colonia); window._closeModal(); }
    );
    return;
  }
  addBranch(format,name,colonia);
  window._closeModal();
};

// Duplicate with toast reminder
window._dupBranch = (id)=>{
  const dup = dupBranch(id);
  if(dup) showToast('📋 Sucursal duplicada — recuerda asignarle una nueva dirección','info');
};

/* ═══ MARKET INDICATOR UTILS ═══ */
function updateMarketIndicators(branch) {
  let hasStudy = !!branch.locationStudy;
  let isActive = true;
  if (branch.overrides && branch.overrides.marketStudyToggles && branch.overrides.marketStudyToggles.master === false) {
    isActive = false;
  }
  
  let label = '📍 Mercado: --';
  let color = 'var(--text-3)';
  let bg = 'var(--surface)';
  let title = '';
  
  if (hasStudy) {
    if (isActive && branch.locationStudy.scores?.factors) {
      const { combinedFactor } = calcCombinedMarketFactor(branch.locationStudy.scores.factors, branch.overrides?.marketStudyToggles);
      const pct = ((combinedFactor - 1)*100).toFixed(1);
      label = `📍 Impacto Mercado: ${pct > 0 ? '+'+pct : pct}%`;
      color = pct >= 0 ? '#10b981' : '#ef4444'; // green or red
      bg = pct >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
      title = 'El estudio de mercado está ajustando las proyecciones. Clic para ver detalles.';
    } else if (isActive) {
      label = '📍 Estudio sin scoring';
      title = 'El estudio de mercado no tiene datos de scoring. Re-ejecuta la evaluación.';
    } else {
      label = '📍 Mercado Ignorado';
      color = 'var(--text-2)';
      bg = 'var(--bg-hover)';
      title = 'El estudio de mercado está desactivado.';
    }
  } else {
    label = '📍 Sin Estudio de Mercado';
    title = 'No hay estudio de ubicación para esta sucursal.';
  }
  
  ['branch-market-indicator', 'config-market-indicator'].forEach(id => {
    const el = $(id);
    if (el) {
      el.style.display = 'inline-block';
      el.textContent = label;
      el.style.color = color;
      el.style.background = bg;
      el.title = title;
      if (hasStudy) {
         el.onclick = () => {
             const panel = $('market-study-panel');
             if (panel && state.view === 'portfolio' && $('btab-resultados').classList.contains('active')) {
                 panel.scrollIntoView({behavior:'smooth', block: 'center'});
             } else {
                window.switchBranchTab?.('resultados');
                setTimeout(() => $('market-study-panel')?.scrollIntoView({behavior:'smooth', block: 'center'}), 150);
             }
         };
         el.style.cursor = 'pointer';
       } else {
         el.onclick = () => {
           // Navigate to Estudio Socioeconómico tab
           document.querySelectorAll('.branch-tab-btn').forEach(b => b.classList.remove('active'));
           document.querySelectorAll('.branch-tab-panel').forEach(p => p.classList.remove('active'));
           const socioBtn = document.querySelector('[data-tab="socioeconomico"]');
           if (socioBtn) socioBtn.classList.add('active');
           const socioPanel = $('btab-socioeconomico');
           if (socioPanel) { socioPanel.classList.add('active'); socioPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
           // Focus the search input
           setTimeout(() => { const inp = $('loc-address-input'); if (inp) inp.focus(); }, 200);
         };
         el.style.cursor = 'pointer';
       }
    }
  });
}

function updateConsolMarketIndicator(empresa) {
  const proyectos = empresa.proyectos || [];
  let totalBranches = proyectos.reduce((acc, p) => acc + (p.branches || []).length, 0);
  if(totalBranches===0) return;
  
  let branchesWithStudy = 0;
  let branchesActive = 0;
  
  proyectos.forEach(p => (p.branches || []).forEach(b => {
     if(b.locationStudy) {
        branchesWithStudy++;
        if (!b.overrides?.marketStudyToggles || b.overrides.marketStudyToggles.master !== false) {
           branchesActive++;
        }
     }
  }));
  
  const el = $('consol-market-indicator');
  if(!el) return;
  
  if (branchesWithStudy === 0) {
    el.style.display = 'inline-block';
    el.textContent = '📍 Sin Estudios';
    el.style.color = 'var(--text-3)';
    el.style.background = 'var(--surface)';
  } else {
    el.style.display = 'inline-block';
    el.textContent = `📍 Mercado: ${branchesActive}/${branchesWithStudy} Activos`;
    el.style.color = branchesActive > 0 ? 'var(--accent)' : 'var(--text-2)';
    el.style.background = branchesActive > 0 ? 'var(--accent-light)' : 'var(--bg)';
    el.title = `${branchesActive} de ${branchesWithStudy} sucursales con estudio tienen el impacto activado en este consolidado.`;
  }
}

/* ═══ BRANCH DETAIL VIEW (preserves all existing visualizations) ═══ */
function renderBranchDetail(empresa){
  const branch=getBranch(state.activeBranchId);
  if(!branch){state.view='portfolio';renderCurrentView();return;}

  const overrides={...branch.overrides};
  const sc=SCENARIOS[branch.scenarioId]||SCENARIOS.base;
  if(sc.rentAdj&&sc.rentAdj!==1) overrides.rent=(overrides.fixedCosts?.rent||MODELS[branch.format].fixedCosts.rent)*sc.rentAdj;
  if(sc.mermaAdj){const vc={...(overrides.variableCosts||MODELS[branch.format].variableCosts)};vc.merma=(vc.merma||MODELS[branch.format].variableCosts.merma)+sc.mermaAdj;overrides.variableCosts=vc;}
  overrides.scenarioFactor=(sc.factor||1)*(overrides.scenarioFactor||1);
  overrides.royaltyMode=overrides.royaltyMode||(MODELS[branch.format].royaltyPromo?MODELS[branch.format].royaltyPromo.default:'variable_2_5');
  overrides.partners=empresa.partners;

  const r=runProjection(branch.format,overrides);
  const model=MODELS[branch.format];

  // Update branch header
  $('branch-detail-title').textContent=branch.name;
  $('branch-detail-subtitle').textContent=`${model.emoji} ${model.label} · ${sc.emoji} ${sc.label}`;

  // Colonia display (read-only)
  const coloniaDisp = $('colonia-display');
  if (coloniaDisp) {
    if (branch.colonia) {
      coloniaDisp.innerHTML = `<span class="colonia-set">✅ ${branch.colonia}</span>`;
    } else {
      coloniaDisp.innerHTML = `<button class="btn-add-location" id="btn-goto-map">📍 Agregar dirección</button>`;
    }
  }
  // Hidden input for backward compat
  const ci = $('branch-colonia-input');
  if (ci) ci.value = branch.colonia || '';
  // Scroll-to-map button
  const gotoMapBtn = $('btn-goto-map');
  if (gotoMapBtn) {
    gotoMapBtn.addEventListener('click', () => {
      // Activate Estudio Socioeconómico tab
      switchBranchTab('socioeconomico');
      updateNav();
      const socioPanel = $('btab-socioeconomico');
      if(socioPanel) { socioPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  }
  // Format selector
  document.querySelectorAll('#branch-format-selector .seg-btn').forEach(btn=>{btn.classList.toggle('active',btn.dataset.format===branch.format);});
  // Scenario selector
  document.querySelectorAll('#branch-scenario-selector-res .seg-btn').forEach(btn=>{btn.classList.toggle('active',btn.dataset.scenario===branch.scenarioId);});
  // Royalty
  const proj = empresa.proyectos?.find(p => p.id === branch.proyectoId);
  const isFranchise = proj?.isFranchise !== false;
  const rg=$('branch-royalty-group');
  if(rg) rg.style.display=(branch.format==='super' && isFranchise)?'block':'none';
  // Royalty active state
  const currentRoyalty = branch.overrides?.royaltyMode || 'variable_2_5';
  document.querySelectorAll('#branch-royalty-selector .seg-btn').forEach(btn=>{btn.classList.toggle('active',btn.dataset.royalty===currentRoyalty);});

  // ═══ RESULTS-LEVEL ROYALTY PANEL ═══
  const resRoyaltyPanel = $('res-royalty-panel');
  if (resRoyaltyPanel) {
    if (isFranchise && branch.format === 'super') {
      resRoyaltyPanel.style.display = '';
      const royaltyDescs = {
        variable_2_5: '💳 Pagas 2.5% de ingresos como regalía mensual.',
        condonacion_6m: '🎁 Los primeros 6 meses se condonan las regalías.',
        pago_unico: '💰 Pago único de $125,000 — sin regalías futuras.'
      };
      const descEl = $('res-royalty-desc');
      document.querySelectorAll('#res-royalty-selector .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.royalty === currentRoyalty);
        const clone = btn.cloneNode(true);
        btn.parentNode.replaceChild(clone, btn);
        clone.classList.toggle('active', clone.dataset.royalty === currentRoyalty);
        clone.addEventListener('click', () => {
          if (!state.activeBranchId) return;
          document.querySelectorAll('#res-royalty-selector .seg-btn').forEach(b => b.classList.remove('active'));
          clone.classList.add('active');
          updateBranchOverrides(state.activeBranchId, { royaltyMode: clone.dataset.royalty });
          if (descEl) descEl.textContent = royaltyDescs[clone.dataset.royalty] || '';
          renderBranchDetail(getEmpresa());
        });
      });
      if (descEl) descEl.textContent = royaltyDescs[currentRoyalty] || '';
    } else {
      resRoyaltyPanel.style.display = 'none';
    }
  }

  // Timeline selector active state
  const currentPreOpen = String(branch.overrides?.preOpenMonths || 0);
  document.querySelectorAll('#branch-timeline-selector .seg-btn').forEach(btn=>{btn.classList.toggle('active',btn.dataset.preopen===currentPreOpen);});

  updateBranchKPIBar(r);
  renderMarketStudyPanel(branch);
  renderBranchResumen(r);
  renderBranchPnL(r,model,overrides);
  renderBranchStress(r,model,overrides);
  updateBranchAuditBadges(model);
  renderBranchEditPanel(branch,model);
  renderBranchLocation(branch);
  renderBranchScenarios(branch, empresa);
  updateMarketIndicators(branch);
}

// Init branch config listeners
document.addEventListener('DOMContentLoaded',()=>{
  // Format selector
  document.querySelectorAll('#branch-format-selector .seg-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!state.activeBranchId)return;
      updateBranch(state.activeBranchId,{format:btn.dataset.format, overrides:buildDefaultOverrides(btn.dataset.format)});
    });
  });
  // Scenario selector
  document.querySelectorAll('#branch-scenario-selector-res .seg-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!state.activeBranchId)return;
      updateBranch(state.activeBranchId,{scenarioId:btn.dataset.scenario});
    });
  });
  // Timeline selector (Desde Apertura / Desde Capital)
  document.querySelectorAll('#branch-timeline-selector .seg-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!state.activeBranchId)return;
      const branch = getBranch(state.activeBranchId);
      if(!branch) return;
      const preOpen = parseInt(btn.dataset.preopen) || 0;
      const ov = { ...(branch.overrides || {}), preOpenMonths: preOpen };
      updateBranch(state.activeBranchId, { overrides: ov });
      renderBranchDetail(getEmpresa());
    });
  });
  // Colonia autocomplete — geocoding suggestions
  setupGeocodingAutocomplete('branch-colonia-input', 'colonia-suggestions', 'colonia-status', (name, full) => {
    if(state.activeBranchId){
      _suppressFullRender = true;
      updateBranchLocation(state.activeBranchId, null);
      updateBranch(state.activeBranchId,{colonia:name,coloniaFull:full});
      _suppressFullRender = false;
      // Sync to location study + auto-run
      const locInput=$('loc-address-input');
      if(locInput) locInput.value=name;
      const studyBtn=$('btn-run-location-study');
      if(studyBtn) studyBtn.click();
    }
  });
  // Royalty selector (Config tab)
  document.querySelectorAll('#branch-royalty-selector .seg-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!state.activeBranchId)return;
      updateBranchOverrides(state.activeBranchId,{royaltyMode:btn.dataset.royalty});
      renderBranchDetail(getEmpresa());
    });
  });

  // ═══ INLINE MARKET ADDRESS REFRESH ═══
  const marketRefreshBtn = $('market-inline-refresh');
  const marketAddrInput = $('market-inline-address');
  if (marketRefreshBtn && marketAddrInput) {
    // Populate with current address
    const currentBranch = getBranch(state.activeBranchId);
    if (currentBranch?.colonia) marketAddrInput.value = currentBranch.colonia;
    else if (currentBranch?.locationStudy?.address) marketAddrInput.value = currentBranch.locationStudy.address;

    const doRefresh = async () => {
      const query = marketAddrInput.value.trim();
      if (!query || !state.activeBranchId) return;
      marketRefreshBtn.disabled = true;
      marketRefreshBtn.textContent = '⏳';
      try {
        const study = await runLocationStudy(query);
        updateBranchLocation(state.activeBranchId, study);
        updateBranch(state.activeBranchId, { colonia: query });
        renderBranchDetail(getEmpresa());
      } catch (e) {
        console.error('[BW2] inline market refresh error', e);
      } finally {
        marketRefreshBtn.disabled = false;
        marketRefreshBtn.textContent = '🔄';
      }
    };
    marketRefreshBtn.addEventListener('click', doRefresh);
    marketAddrInput.addEventListener('keydown', e => { if (e.key === 'Enter') doRefresh(); });
  }

  // (Royalty panel init moved to renderBranchDetail where branch is available)
  // Advanced panel toggle
  // (branch-adv-toggle removed — now using edit-section toggles)
  // Back button (legacy — sidebar also has this)
  const bb=$('btn-back-portfolio');
  if(bb) bb.addEventListener('click',()=>{state.view='portfolio';state.activeBranchId=null;renderCurrentView();});
  // Branch tabs are now in the sidebar (handled by updateNav)
  const tb=$('branch-toggle-pnl');
  if(tb) tb.addEventListener('click',()=>{const t=$('branch-pnl-table-full');t.classList.toggle('collapsed');tb.textContent=t.classList.contains('collapsed')?'Expandir ▼':'Colapsar ▲';});
  // Results sub-section collapsible toggles
  document.querySelectorAll('.results-section-title[data-toggle-section]').forEach(title=>{
    title.addEventListener('click',()=>{
      const bodyId = title.getAttribute('data-toggle-section');
      const body = $(bodyId);
      if(!body) return;
      title.classList.toggle('collapsed');
      body.classList.toggle('collapsed');
    });
  });
  // PDF Export button
  const pdfBtn = $('btn-export-pdf');
  if(pdfBtn) pdfBtn.addEventListener('click', async ()=>{
    if(!state.activeBranchId){showToast('Selecciona una sucursal primero','warning');return;}
    const branch=getBranch(state.activeBranchId);
    const empresa=getEmpresa();
    if(!branch||!empresa){showToast('No se encontró la sucursal','warning');return;}
    pdfBtn.disabled=true;pdfBtn.textContent='⏳ Generando...';
    try{
      await generateBranchPDF(branch,empresa);
      showToast('📄 PDF generado exitosamente','success');
    }catch(e){
      console.error('PDF generation error:',e);
      showToast('Error al generar PDF: '+e.message,'warning');
    }finally{
      pdfBtn.disabled=false;pdfBtn.textContent='📄 Exportar PDF';
    }
  });
});
/* ═══ APPLE-STYLE WIDGET SYSTEM ═══ */
(function initAppleWidgetSystem(){
  /* ── Size Definitions (Apple naming) ── */
  const SIZES = [
    {name:'S', label:'Small',  cols:3,  icon:'▪️'},
    {name:'M', label:'Medium', cols:6,  icon:'◻️'},
    {name:'L', label:'Large',  cols:8,  icon:'⬜'},
    {name:'XL',label:'Full',   cols:12, icon:'📐'}
  ];
  const COL_MAP = {2:'S',3:'S',4:'S',6:'M',8:'L',12:'XL'};
  const ALL_COLS = [2,3,4,6,8,12];
  const ROW_SIZES = [1,2,3];

  function getColSpan(w){ for(const s of [...ALL_COLS].reverse()) if(w.classList.contains('wg-'+s)) return s; return 6; }
  function getRowSpan(w){ for(const s of [...ROW_SIZES].reverse()) if(w.classList.contains('wg-h'+s)) return s; return 1; }
  function setColSpan(w,s){ ALL_COLS.forEach(c=>w.classList.remove('wg-'+c)); w.classList.add('wg-'+s); }
  function setRowSpan(w,s){ ROW_SIZES.forEach(r=>w.classList.remove('wg-h'+r)); if(s>1) w.classList.add('wg-h'+s); }
  function getSizeName(cols){ return COL_MAP[cols]||'M'; }

  /* ── FLIP Animation for smooth reflow ── */
  function flipAnimate(grid){
    const widgets = Array.from(grid.querySelectorAll('.widget[data-widget-id]'));
    const firstPos = new Map();
    widgets.forEach(w=>{
      const r = w.getBoundingClientRect();
      firstPos.set(w,{x:r.left,y:r.top});
    });
    return function play(){
      requestAnimationFrame(()=>{
        widgets.forEach(w=>{
          const first = firstPos.get(w);
          if(!first) return;
          const last = w.getBoundingClientRect();
          const dx = first.x - last.left;
          const dy = first.y - last.top;
          if(Math.abs(dx)<2 && Math.abs(dy)<2) return;
          w.style.transform = `translate(${dx}px,${dy}px)`;
          w.style.transition = 'none';
          requestAnimationFrame(()=>{
            w.classList.add('widget-flipping');
            w.style.transform = '';
            w.style.transition = '';
            const cleanup = ()=>{ w.classList.remove('widget-flipping'); };
            w.addEventListener('transitionend',cleanup,{once:true});
            setTimeout(cleanup,500);
          });
        });
      });
    };
  }

  /* ── Context Menu (Apple-style right-click) ── */
  let ctxMenu = null;
  function removeCtxMenu(){ if(ctxMenu){ctxMenu.remove();ctxMenu=null;} }

  function showContextMenu(e, w, grid){
    e.preventDefault(); e.stopPropagation();
    removeCtxMenu();
    const curCols = getColSpan(w);
    const curSize = getSizeName(curCols);
    const isHidden = w.dataset.widgetHidden === 'true';

    const menu = document.createElement('div');
    menu.className = 'widget-ctx-menu';

    const title = w.querySelector('.widget-title,.kpi-card-label');
    const titleText = title ? title.textContent.trim() : 'Widget';

    let html = `<div style="padding:0.3rem 0.65rem 0.2rem;font-size:0.65rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em">${titleText}</div><div class="widget-ctx-sep"></div>`;

    SIZES.forEach(s=>{
      const active = s.name === curSize ? 'active' : '';
      html += `<div class="widget-ctx-item ${active}" data-action="resize" data-size="${s.cols}">
        <span class="ctx-icon">${s.icon}</span>${s.label}
        <span class="ctx-check">${s.name===curSize?'✓':''}</span></div>`;
    });
    html += `<div class="widget-ctx-sep"></div>`;
    html += `<div class="widget-ctx-item" data-action="${isHidden?'show':'hide'}">
      <span class="ctx-icon">${isHidden?'👁️':'🙈'}</span>${isHidden?'Mostrar Widget':'Ocultar Widget'}</div>`;
    html += `<div class="widget-ctx-sep"></div>`;
    html += `<div class="widget-ctx-item" data-action="reset">
      <span class="ctx-icon">↺</span>Restablecer</div>`;

    menu.innerHTML = html;
    document.body.appendChild(menu);

    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = e.clientX, y = e.clientY;
    if(x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
    if(y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
    menu.style.left = x + 'px';menu.style.top = y + 'px';
    ctxMenu = menu;

    menu.querySelectorAll('.widget-ctx-item').forEach(item=>{
      item.addEventListener('click',()=>{
        const action = item.dataset.action;
        const animate = flipAnimate(grid);
        if(action==='resize'){
          setColSpan(w, parseInt(item.dataset.size));
          updateSizeLabel(w);
          animate();
        } else if(action==='hide'){
          toggleHidden(w, true);
          animate();
        } else if(action==='show'){
          toggleHidden(w, false);
          animate();
        } else if(action==='reset'){
          setColSpan(w, parseInt(w.dataset.defaultSize||6));
          setRowSpan(w, 1);
          updateSizeLabel(w);
          animate();
        }
        removeCtxMenu();
        saveLayout(grid.id);
      });
    });
  }
  document.addEventListener('click', removeCtxMenu);

  /* ── Hide / Show Widgets ── */
  function toggleHidden(w, hide){
    if(hide){
      w.dataset.widgetHidden = 'true';
      const panel = w.closest('.branch-tab-panel,.dashboard-edit-mode');
      const isEditing = panel && panel.classList.contains('dashboard-edit-mode');
      if(isEditing){
        if(!w.querySelector('.widget-hidden-overlay')){
          const ov = document.createElement('div');
          ov.className='widget-hidden-overlay';
          ov.innerHTML='<span>👁️ Oculto</span>';
          w.appendChild(ov);
        }
      } else {
        w.style.display = 'none';
      }
    } else {
      delete w.dataset.widgetHidden;
      w.style.display = '';
      w.querySelector('.widget-hidden-overlay')?.remove();
    }
  }

  /* ── Size Label ── */
  function updateSizeLabel(w){
    const label = w.querySelector('.widget-size-label');
    if(label) label.textContent = getSizeName(getColSpan(w));
  }

  /* ── Edit Mode Controls ── */
  function addEditControls(grid){
    grid.querySelectorAll('.widget[data-widget-id]').forEach(w=>{
      if(w.querySelector('.widget-hide-btn')) return;
      if(!w.dataset.defaultSize) w.dataset.defaultSize = getColSpan(w);

      // Red × button (macOS close style)
      const hideBtn = document.createElement('button');
      hideBtn.className = 'widget-hide-btn';
      hideBtn.innerHTML = '×';
      hideBtn.title = 'Ocultar widget';
      hideBtn.addEventListener('click',e=>{
        e.stopPropagation();
        const animate = flipAnimate(grid);
        toggleHidden(w, true);
        animate();
        saveLayout(grid.id);
      });
      w.appendChild(hideBtn);

      // Size label badge
      const sizeLabel = document.createElement('span');
      sizeLabel.className = 'widget-size-label';
      sizeLabel.textContent = getSizeName(getColSpan(w));
      w.appendChild(sizeLabel);

      // Drag-and-drop
      w.setAttribute('draggable','true');
      w.addEventListener('dragstart',e=>{
        e.dataTransfer.setData('text/plain',w.dataset.widgetId);
        e.dataTransfer.effectAllowed = 'move';
        w.classList.add('widget-dragging');
        setTimeout(()=>w.style.opacity='0.4',0);
      });
      w.addEventListener('dragend',()=>{
        w.classList.remove('widget-dragging');
        w.style.opacity='';
      });
      w.addEventListener('dragover',e=>{
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        w.classList.add('widget-drag-over');
      });
      w.addEventListener('dragleave',()=>w.classList.remove('widget-drag-over'));
      w.addEventListener('drop',e=>{
        e.preventDefault();
        w.classList.remove('widget-drag-over');
        const srcId = e.dataTransfer.getData('text/plain');
        const src = grid.querySelector(`[data-widget-id="${srcId}"]`);
        if(src && src!==w){
          const animate = flipAnimate(grid);
          const rect = w.getBoundingClientRect();
          const midY = rect.top + rect.height/2;
          if(e.clientY < midY) grid.insertBefore(src, w);
          else grid.insertBefore(src, w.nextSibling);
          animate();
        }
      });
    });
  }

  function removeEditControls(grid){
    grid.querySelectorAll('.widget-hide-btn').forEach(b=>b.remove());
    grid.querySelectorAll('.widget-size-label').forEach(l=>l.remove());
    grid.querySelectorAll('.widget-edit-overlay').forEach(o=>o.remove());
    grid.querySelectorAll('.widget[draggable]').forEach(w=>{
      w.removeAttribute('draggable'); w.style.opacity='';
    });
  }

  /* ── Save / Restore Layout ── */
  function saveLayout(gridId){
    const grid = document.getElementById(gridId);
    if(!grid) return;
    const layout = [];
    grid.querySelectorAll('.widget[data-widget-id]').forEach((w,i)=>{
      layout.push({
        id: w.dataset.widgetId,
        col: getColSpan(w),
        row: getRowSpan(w),
        order: i,
        hidden: w.dataset.widgetHidden==='true'
      });
    });
    try{ localStorage.setItem('bw2_layout_'+gridId, JSON.stringify(layout)); }catch(e){}
  }

  function restoreLayout(gridId){
    const grid = document.getElementById(gridId);
    if(!grid) return;
    let layout;
    try{ layout = JSON.parse(localStorage.getItem('bw2_layout_'+gridId)); }catch(e){ return; }
    if(!layout||!Array.isArray(layout)) return;
    const widgets = Array.from(grid.querySelectorAll('.widget[data-widget-id]'));
    const map = Object.fromEntries(widgets.map(w=>[w.dataset.widgetId,w]));
    layout.forEach(item=>{
      const w = map[item.id];
      if(!w) return;
      setColSpan(w, item.col);
      setRowSpan(w, item.row);
      if(item.hidden) toggleHidden(w, true);
    });
    layout.sort((a,b)=>a.order-b.order).forEach(item=>{
      const w = map[item.id];
      if(w) grid.appendChild(w);
    });
  }

  /* ── Toggle Edit Mode ── */
  document.addEventListener('DOMContentLoaded',()=>{
    // Edit mode toggle
    document.addEventListener('click',e=>{
      const editBtn = e.target.closest('.btn-edit-layout');
      if(!editBtn) return;
      const targetId = editBtn.dataset.target;
      const gridId = targetId+'-grid';
      const grid = document.getElementById(gridId);
      const toolbar = document.getElementById('toolbar-'+targetId);
      if(!grid) return;

      const panel = grid.closest('.branch-tab-panel')||document.body;
      const isEditing = panel.classList.contains('dashboard-edit-mode');

      if(!isEditing){
        panel.classList.add('dashboard-edit-mode');
        if(toolbar) toolbar.style.display='flex';
        addEditControls(grid);
        // Show hidden widgets as blurred in edit mode
        grid.querySelectorAll('.widget[data-widget-hidden="true"]').forEach(w=>{
          w.style.display='';
          if(!w.querySelector('.widget-hidden-overlay')){
            const ov = document.createElement('div');
            ov.className='widget-hidden-overlay';
            ov.innerHTML='<span>👁️ Oculto — clic derecho para mostrar</span>';
            w.appendChild(ov);
          }
        });
        editBtn.innerHTML='<span style="font-size:0.8rem">💾</span> Guardar';
        editBtn.style.background='var(--accent)';editBtn.style.color='#fff';
      } else {
        panel.classList.remove('dashboard-edit-mode');
        if(toolbar) toolbar.style.display='none';
        removeEditControls(grid);
        grid.querySelectorAll('.widget[data-widget-hidden="true"]').forEach(w=>{
          w.style.display='none';
          w.querySelector('.widget-hidden-overlay')?.remove();
        });
        saveLayout(gridId);
        editBtn.innerHTML='<span style="font-size:0.8rem">✨</span> Editar Layout';
        editBtn.style.background='var(--surface)';editBtn.style.color='var(--text-2)';
        if(typeof showToast==='function') showToast('✅ Layout guardado','success');
      }
    });

    // Save button in toolbar
    document.addEventListener('click',e=>{
      const saveBtn = e.target.closest('.btn-save-layout');
      if(!saveBtn) return;
      const targetId = saveBtn.dataset.target;
      saveLayout(targetId+'-grid');
      const editBtn = document.querySelector(`.btn-edit-layout[data-target="${targetId}"]`);
      if(editBtn) editBtn.click();
    });

    // Context menu on any widget right-click (even outside edit mode)
    document.addEventListener('contextmenu',e=>{
      const widget = e.target.closest('.widget[data-widget-id]');
      if(!widget) return;
      const grid = widget.closest('.widget-grid');
      if(!grid) return;
      showContextMenu(e, widget, grid);
    });

    // Restore saved layouts
    ['branch-resultados-grid'].forEach(id=>restoreLayout(id));
  });
})();

})();

function updateBranchKPIBar(r){
  const be=r.breakEvenPctCapacity, net=r.perPartnerMonthly[0]?.monthlyIncome||0;
  const pm=r.paybackMetrics;
  
  const elEq = $('branch-kpi-equilibrio');
  const elProfit = $('branch-kpi-profit');
  const elPayback = $('branch-kpi-payback');

  // Animated counter helper
  function animateValue(el, end, prefix='', suffix='', duration=900) {
    if(!el) return;
    const start = 0;
    const startTime = performance.now();
    const isNeg = end < 0;
    const absEnd = Math.abs(end);
    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (absEnd - start) * eased);
      el.textContent = prefix + (isNeg?'-':'') + current.toLocaleString('es-MX') + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // 1) Break-Even KPI + mini progress bar
  if(elEq) {
    animateValue(elEq, Math.round(r.breakEvenRevenue), '$');
    elEq.style.color = be<0.5?'var(--green)':be<0.7?'var(--text-1)':'var(--red)';
  }
  const beBar = document.querySelector('#kpi-be-bar .kpi-mini-bar-fill');
  const bePct = $('kpi-be-pct');
  if(beBar) {
    const pct = Math.min(be * 100, 100);
    setTimeout(() => { beBar.style.width = pct + '%'; }, 50);
  }
  if(bePct) bePct.textContent = (be*100).toFixed(0) + '% cap.';

  // 2) Profit KPI + sparkline
  if(elProfit) {
    animateValue(elProfit, Math.round(r.avgMonthlyEBITDA), '$');
    elProfit.style.color = r.avgMonthlyEBITDA>0?'var(--green)':'var(--red)';
  }
  const sparkEl = $('kpi-profit-sparkline');
  if(sparkEl && r.months && r.months.length > 1) {
    const data = r.months.slice(-12).map(m => m.ebitda);
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const w = 100, h = 28, pad = 2;
    const pts = data.map((v,i) => {
      const x = pad + (i/(data.length-1))*(w-2*pad);
      const y = h-pad - ((v-min)/range)*(h-2*pad);
      return `${x},${y}`;
    });
    const col = r.avgMonthlyEBITDA > 0 ? '#34d399' : '#f87171';
    sparkEl.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="spkGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.3"/><stop offset="100%" stop-color="${col}" stop-opacity="0.02"/></linearGradient></defs>
      <polygon points="${pts[0].split(',')[0]},${h} ${pts.join(' ')} ${pts[pts.length-1].split(',')[0]},${h}" fill="url(#spkGrad)"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  // 3) Payback KPI + ring gauge
  const pbVal = pm.rampa.month;
  const pbColor = pbVal&&pbVal<=36?'#34d399':pbVal&&pbVal<=48?'#fbbf24':'#f87171';
  if(elPayback) {
    if(pbVal != null) {
      animateValue(elPayback, pbVal, '', ' m');
    } else {
      elPayback.textContent = '∞';
    }
    elPayback.style.color = pbColor;
  }
  const pbSub = $('kpi-payback-sub');
  if(pbSub) pbSub.textContent = pm.rampa.extrapolated ? 'estimado' : 'recuperación';

  const ringEl = $('kpi-payback-ring');
  if(ringEl) {
    const total = r.months.length || 60;
    const month = pbVal || total;
    const pct = Math.min(month / total, 1);
    const R = 16, cx = 20, cy = 20, sw = 3.5;
    const circ = 2 * Math.PI * R;
    const filled = circ * pct;
    ringEl.innerHTML = `<svg width="40" height="40" viewBox="0 0 40 40">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--surface-alt)" stroke-width="${sw}"/>
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${pbColor}" stroke-width="${sw}"
        stroke-dasharray="${filled} ${circ}" stroke-linecap="round"
        transform="rotate(-90,${cx},${cy})" style="transition:stroke-dasharray 0.8s ease"/>
      <text x="${cx}" y="${cy+1}" text-anchor="middle" dominant-baseline="central"
        font-size="9" font-weight="800" fill="${pbColor}">${pbVal||'∞'}</text>
    </svg>`;
  }

  // 4) ROI circular gauge — large, prominent
  const roiEl = $('kpi-roi-gauge');
  if(roiEl) {
    const roi = r.roi12 || 0;
    const roiClamped = Math.min(Math.max(roi, -50), 100);
    const pct = (roiClamped + 50) / 150;
    const R = 26, cx = 36, cy = 34, sw = 5;
    const circ = 2 * Math.PI * R;
    const arcLen = circ * 0.75;
    const filled = arcLen * pct;
    const color = roi > 20 ? '#34d399' : roi > 0 ? '#fbbf24' : '#f87171';
    const glow = roi > 20 ? 'rgba(52,211,153,0.3)' : roi > 0 ? 'rgba(251,191,36,0.3)' : 'rgba(248,113,113,0.3)';
    roiEl.innerHTML = `
      <svg width="72" height="66" viewBox="0 0 72 66" style="display:block;margin:0 auto">
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--surface-alt)" stroke-width="${sw}"
          stroke-dasharray="${arcLen} ${circ}" stroke-linecap="round"
          transform="rotate(135,${cx},${cy})"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${sw}"
          stroke-dasharray="${filled} ${circ}" stroke-linecap="round"
          transform="rotate(135,${cx},${cy})"
          style="transition:stroke-dasharray 0.8s ease"/>
      </svg>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-55%);text-align:center">
        <span class="kpi-gauge-value" style="color:${color}">${roi.toFixed(1)}%</span>
        <span class="kpi-gauge-label">12 meses</span>
      </div>`;
    roiEl.style.position = 'relative';
  }

  // 5) Market Factor KPI
  const factorEl = $('branch-kpi-factor');
  const factorBar = document.querySelector('#kpi-factor-bar .kpi-mini-bar-fill');
  const factorLabel = $('kpi-factor-label');
  if (factorEl) {
    const branch = getBranch(state.activeBranchId);
    const study = branch?.locationStudy;
    if (study && study.scores && study.scores.factors) {
      try {
        const { combinedFactor } = calcCombinedMarketFactor(study.scores.factors, branch.overrides?.marketStudyToggles);
        const f = combinedFactor;
        const delta = ((f - 1) * 100);
        const isPositive = delta >= 0;
        factorEl.textContent = f.toFixed(3) + 'x';
        factorEl.style.color = isPositive ? 'var(--green)' : 'var(--red)';
        if (factorBar) {
          const pct = Math.min(Math.abs(delta), 30) / 30 * 100;
          setTimeout(() => { factorBar.style.width = pct + '%'; }, 50);
          factorBar.style.background = isPositive ? 'var(--green)' : 'var(--red)';
        }
        if (factorLabel) factorLabel.textContent = (isPositive ? '+' : '') + delta.toFixed(1) + '% ajuste';
      } catch(e) {
        factorEl.textContent = '—';
        factorEl.style.color = 'var(--text-3)';
        if (factorLabel) factorLabel.textContent = 'Error';
      }
    } else {
      factorEl.textContent = '—';
      factorEl.style.color = 'var(--text-3)';
      if (factorLabel) factorLabel.textContent = 'Sin estudio';
      if (factorBar) factorBar.style.width = '0%';
    }
  }
}

function updateBranchAuditBadges(model){
  const el=$('branch-audit-badges');if(!el)return;
  const fc=model.fixedCosts;
  const cls=fc.auditStatus==='RECONCILED'?'reconciled':fc.auditStatus==='REVIEW'?'review':'conflict';
  let html=`<span class="audit-badge ${cls}">${fc.auditStatus}: CF</span>`;
  if(!model.franchise) html+=`<span class="audit-badge missing">CAPEX: SOURCE_MISSING</span>`;
  if(!model.royaltyPromo) html+=`<span class="audit-badge missing">Promo: SOURCE_MISSING</span>`;
  el.innerHTML=html;
}

function renderAlerts(alerts,id){
  const el=$(id);if(!el)return;
  if(!alerts.length){el.innerHTML='<div class="alert-item success"><div class="alert-icon-wrap success"><span>✅</span></div><div class="alert-content"><div class="alert-label">Sin alertas — proyecto saludable</div></div></div>';return;}
  el.innerHTML=alerts.map(a=>`<div class="alert-item ${a.severity}"><div class="alert-icon-wrap ${a.severity}"><span>${a.icon}</span></div><div class="alert-content"><div class="alert-label">${a.label}</div><div class="alert-message">${a.message}</div></div></div>`).join('');
}

/* ─── BRANCH RESUMEN ─── */
function renderBranchResumen(r){
  const cl=generateChecklist(r);
  const passed = cl.filter(c=>c.pass).length;
  const total = cl.length;
  const pctPass = Math.round((passed/total)*100);
  $('branch-checklist').innerHTML=`
    <div class="checklist-summary" style="grid-column:1/-1;display:flex;align-items:center;gap:0.75rem;padding-bottom:0.375rem;border-bottom:1px solid var(--border);margin-bottom:0.125rem">
      <div class="checklist-progress-ring" style="flex-shrink:0">
        <svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="var(--surface-alt)" stroke-width="3"/><circle cx="16" cy="16" r="13" fill="none" stroke="${passed===total?'var(--green)':'var(--yellow)'}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${2*Math.PI*13}" stroke-dashoffset="${2*Math.PI*13 - (pctPass/100)*2*Math.PI*13}" transform="rotate(-90,16,16)" style="transition:stroke-dashoffset 0.8s ease"/></svg>
      </div>
      <div><span style="font-weight:700;font-size:0.8125rem;color:var(--text-1)">${passed}/${total} criterios</span><span style="font-size:0.6875rem;color:var(--text-3);margin-left:0.5rem">${passed===total?'✨ Todos aprobados':'⚠️ '+(total-passed)+' pendiente'+(total-passed>1?'s':'')}</span></div>
    </div>
  `+cl.map(c=>`<div class="checklist-item ${c.pass?'pass':'fail'}"><span class="check-icon">${c.pass?'<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(22,163,74,0.12)"/><path d="M5.5 9.5L7.5 11.5L12.5 6.5" stroke="#16a34a" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>':'<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(220,38,38,0.1)"/><path d="M6.5 6.5L11.5 11.5M11.5 6.5L6.5 11.5" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/></svg>'}</span><span class="check-label">${c.item}</span><span class="check-detail">${c.detail}</span></div>`).join('');
  dc('branch-cashflow');const ctx=$('chart-branch-cashflow');if(!ctx)return;
  // Create gradient for the cumulative line
  const ctxCanvas = ctx.getContext('2d');
  const grad = ctxCanvas.createLinearGradient(0, 0, 0, ctx.parentElement.clientHeight || 300);
  grad.addColorStop(0, 'rgba(77,124,254,0.18)');
  grad.addColorStop(0.5, 'rgba(77,124,254,0.06)');
  grad.addColorStop(1, 'rgba(77,124,254,0.01)');
  charts['branch-cashflow']=new Chart(ctx,{type:'line',data:{labels:r.months.map(m=>'M'+m.month),datasets:[{label:'Acumulado',data:r.months.map(m=>m.cumulativeCashFlow),borderColor:'#4d7cfe',backgroundColor:grad,fill:true,pointRadius:0,borderWidth:2.5,pointHoverRadius:5,pointHoverBackgroundColor:'#4d7cfe',pointHoverBorderColor:'#fff',pointHoverBorderWidth:2},{label:'Mensual',data:r.months.map(m=>m.cashFlow),type:'bar',backgroundColor:r.months.map(m=>m.cashFlow>=0?'rgba(52,211,153,0.45)':'rgba(248,113,113,0.35)'),borderRadius:4,maxBarThickness:8}]},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt.m(c.parsed.y)}`}}},scales:{y:{ticks:{callback:v=>fmt.mk(v)}}}}});

  // Cost structure donut (main section)
  dc('branch-costs-main');const cDonut=$('chart-branch-costs-main');if(cDonut){
    const bd=r.fixedCostBreakdown;
    const colors=['#f87171','#4d7cfe','#818cf8','#8b5cf6','#34d399','#fbbf24'];
    const labels=['Renta','Nómina','C.Social','Sistemas','Contab.','Serv/Pap'];
    const data=[bd.renta,bd.nomina,bd.cargaSocial,bd.sistemas,bd.contabilidad,bd.serviciosPap];
    const total=data.reduce((a,b)=>a+b,0);
    charts['branch-costs-main']=new Chart(cDonut,{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.label}: ${fmt.m(c.parsed)} (${(c.parsed/total*100).toFixed(0)}%)`}}}}});
    // Render compact legend
    const legendEl=$('cost-donut-legend');
    if(legendEl) legendEl.innerHTML=labels.map((l,i)=>`<span class="donut-legend-item"><span class="donut-legend-dot" style="background:${colors[i]}"></span>${l}</span>`).join('');
  }

  renderAlerts(evaluateAlerts(r),'branch-alerts');
}

/* ─── MARKET STUDY VARIABLES PANEL ─── */
function renderMarketStudyPanel(branch) {
  const panel = $('market-study-panel');
  const body = $('market-study-body');
  const masterSwitch = $('market-master-switch');
  const factorBadge = $('market-combined-factor');
  if (!panel || !body) return;

  const study = branch.locationStudy;
  const radarPanel = $('market-radar-panel');
  if (!study?.scores?.factors) {
    panel.style.display = 'none';
    if(radarPanel) radarPanel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  if(radarPanel) radarPanel.style.display = 'block';

  // Render radar chart for market factors
  dc('market-radar-main');const radarCanvas=$('chart-market-radar-main');
  if(radarCanvas && study.scores.factors){
    const factors = study.scores.factors;
    const factorKeys = Object.keys(factors);
    const factorLabels = factorKeys.map(k => {
      const meta = {trafico:'Tráfico',traffic:'Tráfico',competencia:'Competencia',compDensity:'Densidad',compQuality:'Calidad',distComp:'Dist.Comp',salud:'Salud',health:'Salud',cofepris:'COFEPRIS',COFEPRIS:'COFEPRIS',bancos:'Bancos',restaurantes:'Rest.',residencial:'Resid.',residential:'Residencial',saturacion:'Saturación',saturation:'Saturación',rezago:'Rezago',Rezago:'Rezago',confianza:'Confianza',commercial:'Comercio',transport:'Transporte',nearest:'Cercanía',denue:'DENUE',publicHealth:'Salud Púb.',vetCorridor:'Corredor',income:'Ingreso'};
      return meta[k] || k;
    });
    const factorScores = factorKeys.map(k => factors[k]?.score || 0);
    charts['market-radar-main']=new Chart(radarCanvas,{type:'radar',data:{labels:factorLabels,datasets:[{label:'Score',data:factorScores,backgroundColor:'rgba(107,122,46,0.15)',borderColor:'rgba(107,122,46,0.7)',borderWidth:2,pointBackgroundColor:factorScores.map(s=>s>=75?'#34d399':s>=50?'#fbbf24':'#f87171'),pointRadius:3,pointHoverRadius:5}]},options:{responsive:true,maintainAspectRatio:false,scales:{r:{beginAtZero:true,max:100,ticks:{stepSize:25,font:{size:8},backdropColor:'transparent'},grid:{color:'rgba(0,0,0,0.06)'},pointLabels:{font:{size:8,weight:'600'},color:'var(--text-2)'}}},plugins:{legend:{display:false}}}});
  }

  const toggles = branch.overrides?.marketStudyToggles || {};
  const masterEnabled = branch.overrides?.marketStudyEnabled !== false;
  if (masterSwitch) masterSwitch.checked = masterEnabled;

  const { combinedFactor, activeImpacts, inactiveImpacts } = calcCombinedMarketFactor(
    study.scores.factors, masterEnabled ? toggles : Object.fromEntries(Object.keys(study.scores.factors).map(k => [k, false]))
  );

  // Combined factor badge
  const cfPct = ((combinedFactor - 1) * 100);
  const cfClass = cfPct >= 0 ? 'positive' : 'negative';
  if (factorBadge) factorBadge.innerHTML = masterEnabled
    ? `Factor: <strong class="${cfClass}">${combinedFactor.toFixed(3)}x</strong> <small>(${cfPct >= 0 ? '+' : ''}${cfPct.toFixed(1)}%)</small>`
    : '<small>Desactivado</small>';

  // Build variables table
  const allImpacts = [...activeImpacts, ...inactiveImpacts].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  body.innerHTML = `<table class="market-vars-table">
    <thead><tr><th></th><th>Variable</th><th class="num">Score</th><th class="num">Efecto</th><th>Activa</th></tr></thead>
    <tbody>${allImpacts.map(imp => {
      const enabled = toggles[imp.key] !== false;
      const pctStr = imp.pct >= 0 ? `+${imp.pct.toFixed(1)}%` : `${imp.pct.toFixed(1)}%`;
      const pctClass = imp.pct >= 0 ? 'positive' : 'negative';
      const scoreClass = imp.score >= 75 ? 'score-high' : imp.score >= 50 ? 'score-mid' : 'score-low';
      return `<tr class="${enabled && masterEnabled ? '' : 'mvar-disabled'}">
        <td class="mvar-emoji">${imp.emoji}</td>
        <td class="mvar-label">${imp.label}</td>
        <td class="num"><span class="mvar-score ${scoreClass}">${imp.score}</span></td>
        <td class="num"><span class="mvar-pct ${pctClass}">${pctStr}</span></td>
        <td><label class="mvar-toggle"><input type="checkbox" data-key="${imp.key}" ${enabled ? 'checked' : ''} ${masterEnabled ? '' : 'disabled'}><span class="mvar-slider"></span></label></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  // Bind toggle events
  body.querySelectorAll('input[data-key]').forEach(inp => {
    inp.onchange = () => {
      const key = inp.dataset.key;
      const newToggles = { ...(branch.overrides?.marketStudyToggles || {}), [key]: inp.checked };
      updateBranchOverrides(branch.id, { marketStudyToggles: newToggles });
      renderBranchDetail(getEmpresa());
    };
  });

  // Master switch
  if (masterSwitch) {
    masterSwitch.onchange = () => {
      updateBranchOverrides(branch.id, { marketStudyEnabled: masterSwitch.checked });
      renderBranchDetail(getEmpresa());
    };
  }
}

/* ─── BRANCH P&L ─── */
function renderBranchPnL(r,model,overrides){
  const finKpiEl = $('branch-fin-kpis');
  if(finKpiEl) {
    finKpiEl.innerHTML=[
      kc('ROI 12m',r.roi12.toFixed(1)+'%','Año 1',r.roi12>0?'success':'danger'),
      kc('ROI 36m',r.roi36.toFixed(1)+'%','3 años',r.roi36>60?'success':r.roi36>0?'warning':'danger'),
      kc('VPN',fmt.m(r.npv),'WACC 12%',r.npv>0?'success':'danger'),
      kc('TIR',r.irr!=null&&isFinite(r.irr)&&Math.abs(r.irr)<=10?(r.irr*100).toFixed(1)+'%':'N/A','Interna',r.irr&&r.irr>0.12?'success':'danger'),
    ].join('');
  }
  dc('branch-pnl-bars');const c1=$('chart-branch-pnl');if(c1){
    charts['branch-pnl-bars']=new Chart(c1,{type:'bar',data:{labels:r.months.map(m=>'M'+m.month),datasets:[{label:'Ingresos',data:r.months.map(m=>m.revenue),backgroundColor:'rgba(77,124,254,0.4)'},{label:'EBITDA',data:r.months.map(m=>m.ebitda),backgroundColor:r.months.map(m=>m.ebitda>=0?'rgba(52,211,153,0.4)':'rgba(248,113,113,0.35)')}]},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false},scales:{y:{ticks:{callback:v=>fmt.mk(v)}}}}});
  }
  dc('branch-fixed-donut');const c3=$('chart-branch-donut');if(c3){
    const bd=r.fixedCostBreakdown;const labels=['Renta','Nómina','C.Social','Sistemas','Contab.','Serv/Pap','Omisiones'];
    const data=[bd.renta,bd.nomina,bd.cargaSocial,bd.sistemas,bd.contabilidad,bd.serviciosPap,bd.omisiones||0].filter((_,i)=>i<6||(bd.omisiones&&bd.omisiones>0));
    const lbls=bd.omisiones&&bd.omisiones>0?labels:labels.slice(0,6);
    charts['branch-fixed-donut']=new Chart(c3,{type:'doughnut',data:{labels:lbls,datasets:[{data,backgroundColor:['#f87171','#4d7cfe','#818cf8','#8b5cf6','#34d399','#fbbf24','#fb923c'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{tooltip:{callbacks:{label:c=>`${c.label}: ${fmt.m(c.parsed)} (${fmt.pi(c.parsed/data.reduce((a,b)=>a+b,0))})`}}}}});
  }
  const vc=model.variableCosts;
  dc('branch-cv-bar');const c4=$('chart-branch-cv');if(c4){
    charts['branch-cv-bar']=new Chart(c4,{type:'bar',data:{labels:['COGS','ComVta','Merma','Pub','Regalía','Banc'],datasets:[{label:'% Venta',data:[vc.cogs*100,vc.comVenta*100,vc.merma*100,vc.pubDir*100,vc.regalia*100,vc.bancario*100],backgroundColor:['#f87171','#4d7cfe','#fbbf24','#d946ef','#818cf8','#6366f1']}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>v+'%'}}}}});
  }
  const as=r.annualSummary;const ys=['year1','year2','year3','year4','year5'].filter(y=>as[y]);
  $('branch-annual-table').innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem"><span style="font-size:0.7rem;font-weight:700;color:var(--text-2);text-transform:uppercase">Resumen Anual</span><button class="btn-sm" onclick="exportCSV('resumen_anual.csv',['Año','Ingresos','Ut.Neta','Flujo'],[${ys.map((y,i)=>`['Año ${i+1}',${as[y].revenue},${as[y].netIncome},${as[y].cashFlow}]`).join(',')}])">📥 CSV</button></div><table class="data-table"><thead><tr><th>Año</th><th class="num">Ingresos</th><th class="num">Ut.Neta</th><th class="num">Flujo</th></tr></thead><tbody>${ys.map((y,i)=>`<tr><td>Año ${i+1}</td><td class="num">${fmt.m(as[y].revenue)}</td><td class="num ${as[y].netIncome>=0?'positive':'negative'}">${fmt.m(as[y].netIncome)}</td><td class="num ${as[y].cashFlow>=0?'positive':'negative'}">${fmt.m(as[y].cashFlow)}</td></tr>`).join('')}</tbody></table>`;
  const cols=['Mes','Venta','COGS','Ut.Br','CF','CV','EBITDA','Imp','Ut.Net','Acum'];
  $('branch-pnl-table-full').innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem"><span style="font-size:0.7rem;font-weight:700;color:var(--text-2);text-transform:uppercase">Estado de Resultados (60 meses)</span><button class="btn-sm" onclick="window._exportPnL()">📥 CSV</button></div><table class="data-table"><thead><tr>${cols.map(c=>`<th class="${c!=='Mes'?'num':''}">${c}</th>`).join('')}</tr></thead><tbody>${r.months.map(m=>`<tr><td>M${m.month}</td><td class="num">${fmt.m(m.revenue)}</td><td class="num">${fmt.m(m.cogs)}</td><td class="num">${fmt.m(m.grossProfit)}</td><td class="num">${fmt.m(m.totalFixedCosts)}</td><td class="num">${fmt.m(m.variableCosts)}</td><td class="num ${m.ebitda>=0?'positive':'negative'}">${fmt.m(m.ebitda)}</td><td class="num">${fmt.m(m.taxes)}</td><td class="num ${m.netIncome>=0?'positive':'negative'}">${fmt.m(m.netIncome)}</td><td class="num ${m.cumulativeCashFlow>=0?'positive':'negative'}">${fmt.m(m.cumulativeCashFlow)}</td></tr>`).join('')}</tbody></table>`;
}

/* ── P&L CSV Export ── */
window._exportPnL = function() {
  const branch = getBranch(state.activeBranchId);
  if (!branch) return;
  const empresa = getActiveEmpresa ? getActiveEmpresa() : getEmpresa();
  const overrides = {...branch.overrides};
  const r = runProjection(branch.format, overrides);
  if (!r || !r.months) { showToast('Sin datos para exportar', 'error'); return; }
  const headers = ['Mes','Venta','COGS','Ut.Bruta','Costos Fijos','Costos Variables','EBITDA','Impuestos','Ut.Neta','Flujo Acumulado'];
  const rows = r.months.map(m => [
    m.month, Math.round(m.revenue), Math.round(m.cogs), Math.round(m.grossProfit),
    Math.round(m.totalFixedCosts), Math.round(m.variableCosts), Math.round(m.ebitda),
    Math.round(m.taxes), Math.round(m.netIncome), Math.round(m.cumulativeCashFlow)
  ]);
  exportCSV(`pnl_${branch.name.replace(/\s+/g,'_')}_60m.csv`, headers, rows);
};

/* ── Comparison CSV Export ── */
window._exportComparison = function() {
  const empresa = getActiveEmpresa ? getActiveEmpresa() : getEmpresa();
  if (!empresa) return;
  const branches = (empresa.branches || empresa.proyectos?.flatMap(p => p.branches || []) || []).filter(b => b.status !== 'archived');
  const headers = ['Sucursal','Formato','EBITDA/mes','Inversión','Payback','Score','ROI 12m','VPN'];
  const rows = branches.map(b => {
    try {
      const r = runBranchProjection(b, empresa);
      return [b.name, b.format, Math.round(r?.avgMonthlyEBITDA||0), Math.round(r?.totalInvestment||0),
              r?.paybackMonth||'∞', r?.viabilityScore||0, (r?.roi12||0).toFixed(1)+'%', Math.round(r?.npv||0)];
    } catch(e) { return [b.name, b.format, 0, 0, '∞', 0, '0%', 0]; }
  });
  exportCSV(`comparativa_${empresa.name?.replace(/\s+/g,'_')||'empresa'}.csv`, headers, rows);
};

/* ─── BRANCH STRESS ─── */
function renderBranchStress(r,model,overrides){
  let stress;try{stress=calcStress(state.activeBranchId?getBranch(state.activeBranchId).format:'express',overrides);}catch(e){stress={maxRent:0,fragilityPct:1,viableCells:0,totalCells:1};}
  const stressEl = $('branch-stress-kpis');
  if(stressEl) {
    stressEl.innerHTML=[
      kc('Renta Máx.',fmt.m(stress.maxRent),`Actual: ${fmt.m(overrides.rent||model.fixedCosts.rent)}`,stress.maxRent>(overrides.rent||model.fixedCosts.rent)*1.2?'success':'warning'),
      kc('Venta Mín.',fmt.m(r.breakEvenRevenue),fmt.pi(r.breakEvenPctCapacity)+' cap.',r.breakEvenPctCapacity<0.7?'success':'danger'),
      kc('Fragilidad',fmt.pi(stress.fragilityPct),`${stress.viableCells}/${stress.totalCells}`,stress.fragilityPct<0.3?'success':stress.fragilityPct<0.5?'warning':'danger'),
    ].join('');
  }
  let sensitivity;try{sensitivity=runSensitivity(getBranch(state.activeBranchId).format,overrides);}catch(e){sensitivity=[];}
  dc('branch-tornado');const ctx=$('chart-branch-tornado');if(ctx&&sensitivity.length){
    charts['branch-tornado']=new Chart(ctx,{type:'bar',data:{labels:sensitivity.map(s=>s.label),datasets:[{label:'+20%',data:sensitivity.map(s=>s.ebitdaDeltaUp),backgroundColor:sensitivity.map(s=>s.ebitdaDeltaUp>=0?'rgba(52,211,153,0.6)':'rgba(248,113,113,0.5)'),borderRadius:3},{label:'−20%',data:sensitivity.map(s=>s.ebitdaDeltaDown),backgroundColor:sensitivity.map(s=>s.ebitdaDeltaDown>=0?'rgba(52,211,153,0.4)':'rgba(248,113,113,0.35)'),borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt.m(c.parsed.x)}`}}},scales:{x:{ticks:{callback:v=>fmt.mk(v)}}}}});
  }
}

/* ─── BRANCH SCENARIOS COMPARISON ─── */
function renderBranchScenarios(branch, empresa) {
  const el = $('scenarios-comparison-table');
  if (!el) return;
  const scenarioIds = ['conservative', 'base', 'upside'];
  const results = scenarioIds.map(sid => {
    const clone = { ...branch, scenarioId: sid };
    return { sid, sc: SCENARIOS[sid], result: runBranchProjection(clone, empresa) };
  });

  const metrics = [
    { l: 'Inversión Total', f: r => fmt.m(r.totalInvestment) },
    { l: 'EBITDA / mes', f: r => fmt.m(r.avgMonthlyEBITDA), color: r => r.avgMonthlyEBITDA > 0 ? 'positive' : 'negative' },
    { l: 'Venta Prom. / mes', f: r => fmt.m(r.avgMonthlyRevenue) },
    { l: 'Margen EBITDA', f: r => fmt.p(r.ebitdaMarginStabilized) },
    { l: 'Pto. Equilibrio', f: r => fmt.m(r.breakEvenRevenue) },
    { l: 'BE % Capacidad', f: r => fmt.p(r.breakEvenPctCapacity), color: r => r.breakEvenPctCapacity < 0.7 ? 'positive' : 'negative' },
    { l: 'Recup. Simple', f: r => r.paybackMetrics.simple.min != null ? `${r.paybackMetrics.simple.min.toFixed(0)}–${r.paybackMetrics.simple.max.toFixed(0)} m` : '∞' },
    { l: 'Recup. Rampa', f: r => r.paybackMetrics.rampa.month ? r.paybackMetrics.rampa.month + ' m' : '∞' },
    { l: 'BE Operativo', f: r => r.paybackMetrics.beOperativo.month ? r.paybackMetrics.beOperativo.month + ' m' : '∞' },
    { l: 'ROI 12m', f: r => r.roi12.toFixed(1) + '%', color: r => r.roi12 > 0 ? 'positive' : 'negative' },
    { l: 'ROI 36m', f: r => r.roi36.toFixed(1) + '%', color: r => r.roi36 > 20 ? 'positive' : 'negative' },
    { l: 'VPN', f: r => fmt.m(r.npv), color: r => r.npv > 0 ? 'positive' : 'negative' },
    { l: 'TIR', f: r => r.irr != null && isFinite(r.irr) && Math.abs(r.irr) <= 10 ? (r.irr * 100).toFixed(1) + '%' : 'N/A', color: r => r.irr && r.irr > 0.12 ? 'positive' : 'negative' },
    { l: 'Calificación', f: r => r.viabilityScore + '/100' },
    { l: 'Ganancia 5 Años', f: r => fmt.m(r.annualSummary.year1.netIncome + r.annualSummary.year2.netIncome + r.annualSummary.year3.netIncome + (r.annualSummary.year4?.netIncome||0) + (r.annualSummary.year5?.netIncome||0)) },
  ];

  const activeSid = branch.scenarioId || 'base';
  el.innerHTML = `<table class="data-table scenarios-table">
    <thead><tr>
      <th>Métrica</th>
      ${results.map(({sid, sc}) => `<th class="num scenario-col ${sid === activeSid ? 'active' : ''}" data-sid="${sid}">${sc.emoji} ${sc.label}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${metrics.map(m => `<tr>
        <td class="metric-label">${m.l}</td>
        ${results.map(({sid, result}) => {
          const cls = m.color ? m.color(result) : '';
          return `<td class="num ${cls} ${sid === activeSid ? 'active-col' : ''}">${m.f(result)}</td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table>`;

  // Make scenario headers clickable
  el.querySelectorAll('.scenario-col').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      if (!state.activeBranchId) return;
      updateBranch(state.activeBranchId, { scenarioId: th.dataset.sid });
    });
  });

  // Overlay chart
  dc('scenarios-cf');
  const ctx = $('chart-scenarios-cf');
  if (!ctx) return;
  const colors = { conservative: '#f87171', base: '#fbbf24', upside: '#34d399' };
  charts['scenarios-cf'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: results[0].result.months.map(m => 'M' + m.month),
      datasets: results.map(({ sid, sc, result }) => ({
        label: sc.label,
        data: result.months.map(m => m.cumulativeCashFlow),
        borderColor: colors[sid],
        backgroundColor: 'transparent',
        borderWidth: sid === activeSid ? 3 : 1.5,
        borderDash: sid === activeSid ? [] : [5, 3],
        pointRadius: 0,
        tension: 0.3
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt.m(c.parsed.y)}` } },
        annotation: { annotations: { zeroline: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderDash: [4, 4] } } }
      },
      scales: { y: { ticks: { callback: v => fmt.mk(v) } } }
    }
  });
}

/* ─── BRANCH EDIT PANEL ─── */
function renderBranchEditPanel(branch, model) {
  const ov = branch.overrides || {};
  const fc = ov.fixedCosts || {};
  const vc = ov.variableCosts || {};
  const defFC = model.fixedCosts;
  const defVC = model.variableCosts;

  // ── Investment ──
  const invEl = $('edit-inv');
  if (invEl) {
    const invMin = ov.totalInitialInvestmentMin ?? model.totalInitialInvestment?.min ?? 0;
    const invMax = ov.totalInitialInvestmentMax ?? model.totalInitialInvestment?.max ?? 0;
    const invCurrent = ov.totalInitialInvestment ?? model.totalInitialInvestment?.default ?? invMax;
    const isWorstCase = invCurrent === invMax;
    const isMin = invCurrent === invMin;
    const pct = invMax > invMin ? ((invCurrent - invMin) / (invMax - invMin)) * 100 : 100;
    const statusLabel = isWorstCase ? 'Peor escenario' : isMin ? 'Escenario mínimo' : 'Personalizado';
    const statusClass = isWorstCase ? 'inv-status-worst' : isMin ? 'inv-status-min' : 'inv-status-custom';
    invEl.innerHTML = `
      <div class="inv-block">
        <div class="inv-grid">
          <div class="inv-col-left">
            <label class="inv-main-label">Inversión Total <span class="field-hint" data-tip="Monto total requerido para abrir esta sucursal (equipo, adecuación, inventario)">(?) </span></label>
            <div class="inv-input-row">
              <span class="inv-currency">$</span>
              <input type="number" class="inv-main-input input-text" data-key="totalInitialInvestment" value="${parseFloat(invCurrent.toFixed(2))}" step="1" min="${invMin}" max="${invMax * 2}">
            </div>
            <div class="inv-range-bar-wrap">
              <input type="range" class="inv-slider" id="inv-range-slider" min="${invMin}" max="${invMax}" step="1" value="${invCurrent}">
              <div class="inv-range-labels">
                <span>Mín ${fmt.m(invMin)}</span>
                <span>Máx ${fmt.m(invMax)}</span>
              </div>
            </div>
          </div>
          <div class="inv-col-right">
            <span class="inv-status ${statusClass}">${statusLabel}</span>
            <div class="inv-ventas-field">
              <label class="inv-main-label">Ajuste de Ventas <span class="field-hint" data-tip="Sube o baja este % para simular que vendes más o menos de lo proyectado">(?) </span></label>
              <div class="edit-input-wrap">
                <input type="number" class="input-text" data-key="scenarioFactor" value="${(ov.scenarioFactor ?? 1) * 100}" step="5" min="50" max="200">
                <span class="edit-unit">%</span>
              </div>
              <div class="edit-default">${Math.abs(((ov.scenarioFactor ?? 1) * 100) - 100) < 1 ? '= default (100%)' : '✏️ Editado (orig: 100%)'}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── Fixed Costs ──
  const fcEl = $('edit-fc');
  if (fcEl) {
    const nomina = fc.payroll ?? defFC.payroll;
    const cargaSocial = fc.socialCharge ?? defFC.socialCharge ?? (nomina * 0.30);
    fcEl.innerHTML = [
      editField('Renta', 'fc.rent', fc.rent ?? defFC.rent, defFC.rent, 1000, '$', undefined, undefined, 'Costo mensual del local comercial (sin IVA)'),
      editField('Nómina', 'fc.payroll', nomina, defFC.payroll, 1000, '$', undefined, undefined, 'Sueldo bruto total del personal (incluye farmacéutico, cajero, repartidor)'),
      readonlyField('Carga Social', cargaSocial, '$', '= Nómina × 30%', 'IMSS, Infonavit, ISN y prestaciones del personal'),
      editField('Sistemas', 'fc.systems', fc.systems ?? defFC.systems, defFC.systems, 100, '$', undefined, undefined, 'Software POS, inventarios, sistema de facturación y licencias'),
      editField('Contabilidad', 'fc.accounting', fc.accounting ?? defFC.accounting, defFC.accounting, 100, '$', undefined, undefined, 'Honorarios del contador externo o servicio contable'),
      editField('Serv/Papelería (M3+)', 'fc.servPapM3', fc.servPap?.m3 ?? defFC.servPap.m3, defFC.servPap.m3, 500, '$', undefined, undefined, 'Luz, agua, limpieza, papelería y servicios generales a partir del mes 3'),
    ].join('');
  }

  // ── Variable Costs ──
  const vcEl = $('edit-vc');
  if (vcEl) {
    const empresa = getEmpresa();
    const proj = empresa?.proyectos?.find(p => p.id === branch.proyectoId);
    const isFranchise = proj?.isFranchise !== false;

    let fields = [
      editField('COGS (Inventario)', 'vc.cogs', (vc.cogs ?? defVC.cogs) * 100, defVC.cogs * 100, 0.5, '%', 40, 80, 'Costo de la mercancía vendida como % de las ventas. ≈59% para farmacia'),
      editField('Comisión Venta', 'vc.comVenta', (vc.comVenta ?? defVC.comVenta) * 100, defVC.comVenta * 100, 0.1, '%', 0, 10, 'Comisión pagada al equipo de ventas sobre ingresos'),
      editField('Merma', 'vc.merma', (vc.merma ?? defVC.merma) * 100, defVC.merma * 100, 0.1, '%', 0, 5, 'Pérdida por caducidad, robo o daño del inventario'),
      editField('Publicidad', 'vc.pubDir', (vc.pubDir ?? defVC.pubDir) * 100, defVC.pubDir * 100, 0.5, '%', 0, 10, 'Marketing digital, volanteo, señalización y promociones')
    ];
    if (isFranchise) {
      fields.push(editField('Regalía', 'vc.regalia', (vc.regalia ?? defVC.regalia) * 100, defVC.regalia * 100, 0.1, '%', 0, 10, 'Pago mensual a la franquicia por uso de marca (% sobre ventas)'));
    }
    fields.push(editField('Bancario', 'vc.bancario', (vc.bancario ?? defVC.bancario) * 100, defVC.bancario * 100, 0.1, '%', 0, 5, 'Comisión por pagos con tarjeta (terminal bancaria)'));
    
    vcEl.innerHTML = fields.join('');
  }

  // ── Sales ──
  const salesEl = $('edit-sales');
  if (salesEl) {
    const sales = ov.sales || model.sales;
    salesEl.innerHTML = [
      editField('Venta M1', 'sales.m1', sales.m1 ?? model.sales.m1, model.sales.m1, 5000, '$', undefined, undefined, 'Ventas proyectadas para el primer mes de operación'),
      editField('Venta M6', 'sales.m6', sales.m6 ?? (model.sales.m6 || model.sales.m5 || 0), model.sales.m6 || model.sales.m5 || 0, 5000, '$', undefined, undefined, 'Ventas proyectadas al mes 6 (fase de crecimiento)'),
      editField('Venta M12', 'sales.m12', sales.m12 ?? model.sales.m12, model.sales.m12, 10000, '$', undefined, undefined, 'Ventas proyectadas al mes 12 (primer aniversario)'),
      editField('Venta M24', 'sales.m24', sales.m24 ?? model.sales.m24, model.sales.m24, 10000, '$', undefined, undefined, 'Ventas al mes 24 (madurez operativa esperada)'),
    ].join('');
  }

  // ── Bind inputs (debounced for real-time recalculation) ──
  let _editTimer = null;
  document.querySelectorAll('#branch-edit-panel input[data-key]').forEach(inp => {
    inp.addEventListener('input', e => {
      const key = e.target.dataset.key;
      const val = parseFloat(e.target.value);
      if (isNaN(val)) return;
      // Save immediately (suppress full re-render to keep focus)
      _suppressFullRender = true;
      clearTimeout(_suppressTimer);
      applyEditField(branch.id, key, val);
      // Debounced partial re-render (all KPIs + tabs + header, but NOT the edit panel itself)
      clearTimeout(_editTimer);
      _editTimer = setTimeout(() => {
        const freshBranch = getBranch(branch.id);
        if (!freshBranch) return;
        const empresa = getEmpresa();
        const r = runBranchProjection(freshBranch, empresa);
        const m = MODELS[freshBranch.format];
        const ov = freshBranch.overrides || {};
        // Update KPI strip + Resumen (gauge, checklist, cashflow chart)
        updateBranchKPIBar(r);
        renderBranchResumen(r);
        // Update P&L tab (ROI, NPV, TIR, charts)
        renderBranchPnL(r, m, ov);
        // Update Stress tab (max rent, fragility, tornado)
        renderBranchStress(r, m, ov);
        // Update enterprise header (Comprometido, Libre, Score)
        updateEnterpriseHeader(empresa);
        // Sync the slider ↔ number input if one changed
        const invSlider = $('inv-range-slider');
        const invNumInput = document.querySelector('[data-key="totalInitialInvestment"]');
        if (key === 'totalInitialInvestment' && invSlider && invNumInput) {
          // If number input changed, sync slider (clamped to slider range)
          const sliderMin = parseFloat(invSlider.min);
          const sliderMax = parseFloat(invSlider.max);
          invSlider.value = Math.max(sliderMin, Math.min(val, sliderMax));
          // Update status label in real-time
          const statusEl = document.querySelector('.inv-status');
          if (statusEl) {
            const isMax = Math.abs(val - sliderMax) < 2;
            const isMin = Math.abs(val - sliderMin) < 2;
            statusEl.textContent = isMax ? 'Peor escenario' : isMin ? 'Escenario mínimo' : 'Personalizado';
            statusEl.className = 'inv-status ' + (isMax ? 'inv-status-worst' : isMin ? 'inv-status-min' : 'inv-status-custom');
          }
        }
      }, 300);
      // Allow full re-render after extended inactivity (rebuilds edit panel)
      _suppressTimer = setTimeout(() => {
        _suppressFullRender = false;
        renderCurrentView();
      }, 2000);
    });
  });

  // ── Section toggles ──
  document.querySelectorAll('#branch-edit-panel .edit-section-title[data-toggle]').forEach(h4 => {
    h4.addEventListener('click', () => {
      const grid = $(h4.dataset.toggle);
      if (grid) grid.classList.toggle('collapsed');
      h4.classList.toggle('collapsed');
    });
  });

  // ── Reset button ──
  const resetBtn = $('btn-reset-branch-defaults');
  if (resetBtn) {
    resetBtn.onclick = () => {
      showConfirm(
        '🔄 ¿Resetear a defaults?',
        '<p>Se restaurarán todos los supuestos al valor original del formato <strong>' + model.label + '</strong>.</p>',
        '🔄 Resetear',
        () => { resetBranchToDefaults(branch.id); }
      );
    };
  }

  // ── Investment buttons ──
  const btnWorst = $('btn-inv-worst');
  if (btnWorst) {
    btnWorst.onclick = () => {
      const inv = model.totalInitialInvestment;
      if (inv) { updateBranchOverrides(branch.id, { totalInitialInvestment: inv.max }); }
    };
  }
  const btnMin = $('btn-inv-min');
  if (btnMin) {
    btnMin.onclick = () => {
      const inv = model.totalInitialInvestment;
      if (inv) { updateBranchOverrides(branch.id, { totalInitialInvestment: inv.min }); }
    };
  }

  // ── Investment range slider sync ──
  const invSlider = $('inv-range-slider');
  const invNumInput = document.querySelector('[data-key="totalInitialInvestment"]');
  if (invSlider && invNumInput) {
    invSlider.addEventListener('input', () => {
      const val = parseFloat(invSlider.value);
      invNumInput.value = val;
      // Update status label in real-time
      const sliderMin = parseFloat(invSlider.min);
      const sliderMax = parseFloat(invSlider.max);
      const statusEl = document.querySelector('.inv-status');
      if (statusEl) {
        const isMax = Math.abs(val - sliderMax) < 2;
        const isMin = Math.abs(val - sliderMin) < 2;
        statusEl.textContent = isMax ? 'Peor escenario' : isMin ? 'Escenario mínimo' : 'Personalizado';
        statusEl.className = 'inv-status ' + (isMax ? 'inv-status-worst' : isMin ? 'inv-status-min' : 'inv-status-custom');
      }
      invNumInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function editField(label, key, value, defaultVal, step, unit, min, max, hint) {
  const isDefault = Math.abs(value - defaultVal) < 1;
  const defStr = unit === '$' ? fmt.m(defaultVal) : defaultVal.toFixed(1) + '%';
  const hintHtml = hint ? ` <span class="field-hint" data-tip="${hint}">(?)</span>` : '';
  return `<div class="edit-field ${isDefault ? '' : 'modified'}">
    <label>${label}${hintHtml}</label>
    <div class="edit-input-wrap">
      <input type="number" class="input-text" data-key="${key}" value="${parseFloat(value.toFixed(2))}" step="${step}" ${min != null ? 'min="'+min+'"' : ''} ${max != null ? 'max="'+max+'"' : ''}>
      <span class="edit-unit">${unit}</span>
    </div>
    <div class="edit-default">${isDefault ? '= default' : '✏️ Editado (orig: ' + defStr + ')'}</div>
  </div>`;
}

function readonlyField(label, value, unit, formula, hint) {
  const display = unit === '$' ? fmt.m(value) : value.toFixed(1) + '%';
  const hintHtml = hint ? ` <span class="field-hint" data-tip="${hint}">(?)</span>` : '';
  return `<div class="edit-field readonly">
    <label>${label}${hintHtml}</label>
    <div class="edit-input-wrap">
      <input type="text" class="input-text" value="${display}" disabled readonly style="min-width:auto">
    </div>
    <div class="edit-default">${formula}</div>
  </div>`;
}

function applyEditField(branchId, key, val) {
  const branch = getBranch(branchId);
  if (!branch) return;
  const ov = { ...branch.overrides };

  if (key === 'totalInitialInvestment') {
    ov.totalInitialInvestment = val;
  } else if (key === 'scenarioFactor') {
    ov.scenarioFactor = val / 100;
  } else if (key.startsWith('fc.')) {
    const fcKey = key.split('.')[1];
    ov.fixedCosts = { ...(ov.fixedCosts || {}), [fcKey]: val };
    // Handle servPap specially
    if (fcKey === 'servPapM3') {
      const sp = ov.fixedCosts.servPap || { m1: 0, m2: 0, m3: 0 };
      ov.fixedCosts.servPap = { ...sp, m3: val, m2: val * 0.75, m1: val * 0.5 };
      delete ov.fixedCosts.servPapM3;
    }
  } else if (key.startsWith('vc.')) {
    const vcKey = key.split('.')[1];
    ov.variableCosts = { ...(ov.variableCosts || {}), [vcKey]: val / 100 };
  } else if (key.startsWith('sales.')) {
    const salesKey = key.split('.')[1];
    ov.sales = { ...(ov.sales || {}), [salesKey]: val };
  }

  updateBranchOverrides(branchId, ov);
}

/* ─── BRANCH LOCATION ─── */
function renderBranchLocation(branch) {
  const study = branch.locationStudy;
  const addrInput = $('loc-address-input');
  const resultsEl = $('loc-results');
  const emptyEl = $('loc-empty-state');
  const statusEl = $('loc-status');

  // Pre-fill address: branch.colonia (user's latest choice) takes precedence over old study address
  if (addrInput) addrInput.value = branch.colonia || study?.address || '';
  if (statusEl) statusEl.innerHTML = '';

  // Setup Geocoding Autocomplete
  setupGeocodingAutocomplete('loc-address-input', 'loc-address-suggestions', 'loc-address-status', (name, full) => {
    // Suppress re-render while we update colonia + run study
    _suppressFullRender = true;
    // Clear stale study since location changed
    updateBranchLocation(branch.id, null);
    updateBranch(branch.id, { colonia: name, coloniaFull: full });
    // Restore input value (in case re-render slipped through)
    if (addrInput) addrInput.value = name;
    _suppressFullRender = false;
    const btn = $('btn-run-location-study');
    if (btn) btn.click();
  });

  // Button handler
  const btn = $('btn-run-location-study');
  if (btn) {
    btn.onclick = async () => {
      const query = addrInput.value.trim();
      if (!query) { statusEl.innerHTML = '<span class="loc-error">Ingresa una colonia o dirección</span>'; return; }
      // Sync colonia with whatever user typed
      _suppressFullRender = true;
      updateBranch(branch.id, { colonia: query });
      _suppressFullRender = false;
      btn.disabled = true;
      btn.textContent = '⏳ ...';
      if (emptyEl) emptyEl.style.display = 'none'; // hide while loading
      statusEl.innerHTML = '<span class="loc-loading">Geocodificando → Buscando establecimientos → Calculando scores...</span>';
      try {
        const result = await runLocationStudy(query);
        updateBranchLocation(branch.id, result);
        renderLocationResults(result);
        // Update market indicators and panels without full re-render
        const freshBranch = getBranch(branch.id);
        if (freshBranch) {
          renderMarketStudyPanel(freshBranch);
          updateMarketIndicators(freshBranch);
        }
        if (result.errors && result.errors.length) {
          statusEl.innerHTML = '<span class="loc-warning">⚠️ Estudio parcial: ' + result.errors.map(e => e.error).join('; ') + '</span>';
        } else {
          statusEl.innerHTML = '<span class="loc-success">✅ Estudio completo — ' + new Date(result.lastUpdated).toLocaleString('es-MX') + '</span>';
        }
      } catch (e) {
        statusEl.innerHTML = '<span class="loc-error">❌ Error: ' + e.message + '</span>';
        if (emptyEl && (!study || !study.coordinates)) emptyEl.style.display = 'block';
      }
      btn.disabled = false;
      btn.textContent = '📍 Evaluar';
    };
  }

  // Toggle detail
  const togBtn = $('loc-toggle-detail');
  if (togBtn) { togBtn.onclick = () => { const t = $('loc-nearby-detail'); t.classList.toggle('collapsed'); togBtn.textContent = t.classList.contains('collapsed') ? 'Expandir ▼' : 'Colapsar ▲'; }; }

  // Render saved study
  if (study && study.coordinates) {
    if (emptyEl) emptyEl.style.display = 'none';
    renderLocationResults(study);
    if (statusEl) statusEl.innerHTML = '<span class="loc-success">📍 Último estudio: ' + new Date(study.lastUpdated).toLocaleString('es-MX') + '</span>';
  } else if (addrInput && addrInput.value.trim().length >= 3 && btn) {
    // Auto-run: branch has a colonia but no saved study — trigger automatically
    setTimeout(() => { if (btn && !btn.disabled) btn.click(); }, 300);
  } else {
    if (emptyEl) emptyEl.style.display = 'block';
    if (resultsEl) resultsEl.style.display = 'none';
  }
}

function renderLocationResults(study) {
  const resultsEl = $('loc-results');
  if (!resultsEl) return;
  resultsEl.style.display = 'block';

  const s = study.scores || { territorial: 0, comercial: 0, total: 0 };
  const sug = study.suggestion || { label: '—', factor: 1, desc: '' };
  const sc = v => v >= 75 ? 'success' : v >= 50 ? 'warning' : 'danger';
  const apiOk = !study.nearby?.apiError;
  const rs = study.radiusSummary || {};
  const c = study.classified || {};

  // ── EXECUTIVE SUMMARY ──
  const execEl = $('loc-executive-summary');
  if (execEl) {
    const totalClass = s.total >= 75 ? 'loc-verdict-excellent' : s.total >= 50 ? 'loc-verdict-good' : s.total >= 35 ? 'loc-verdict-weak' : 'loc-verdict-risk';
    const nearComp = s.nearestCompetitor;
    execEl.innerHTML = `
      <div class="loc-verdict ${totalClass}">
        <div class="loc-verdict-score">${s.total}</div>
        <div class="loc-verdict-text">
          <div class="loc-verdict-label">${sug.label}</div>
          <div class="loc-verdict-desc">${sug.desc || ''}</div>
        </div>
        <div class="loc-verdict-factor">Factor: <strong>${sug.factor}x</strong></div>
      </div>
      <div class="loc-verdict-pills">
        <span class="loc-pill loc-pill-${sc(s.territorial)}">Territorial: ${s.territorial}</span>
        <span class="loc-pill loc-pill-${sc(s.comercial || 0)}">Comercial: ${s.comercial ?? '—'}</span>
        <span class="loc-pill">${s.pharmacyCount1km ?? 0} farmacias (1km)</span>
        <span class="loc-pill">${s.healthFacilities ?? 0} salud</span>
        ${nearComp ? `<span class="loc-pill">Competidor más cercano: ${nearComp.name} a ${nearComp.distance}m</span>` : ''}
      </div>
    `;
  }

  // ── SCORE CARDS (top-level KPIs) ──
  $('loc-score-cards').innerHTML = [
    kc('Score Total', s.total, sug.label, sc(s.total)),
    kc('Territorial', s.territorial, study.rezago?.grado || 'Sin dato', sc(s.territorial)),
    kc('Comercial', apiOk ? (s.comercial ?? '—') : '—', apiOk ? `${s.pharmacyCount1km ?? 0} farmacias` : 'Sin dato', apiOk ? sc(s.comercial || 0) : 'warning'),
    kc('Competencia', apiOk ? (s.pharmacyCount1km ?? 0) : '—', apiOk ? s.competenciaLabel : 'Sin dato', apiOk ? (s.pharmacyCount1km <= 5 ? 'success' : 'danger') : 'warning'),
    kc('Salud', apiOk ? (s.healthFacilities ?? 0) : '—', apiOk ? `${s.hospitals ?? 0} hospitales` : 'Sin dato', apiOk ? sc(s.salud || 0) : 'warning'),
    kc('Tráfico', apiOk ? (s.trafficGenerators ? Object.values(s.trafficGenerators).reduce((a,b)=>a+b,0) : 0) : '—', apiOk ? 'generadores' : 'Sin dato', apiOk ? sc(s.factors?.traffic?.score || 0) : 'warning'),
  ].join('');

  // ── RADAR CHART (15 factors) ──
  if (s.factors) {
    const radarCanvas = $('loc-radar-chart');
    if (radarCanvas) {
      if (window._locRadarChart) { window._locRadarChart.destroy(); window._locRadarChart = null; }
      const labels = Object.values(s.factors).map(f => f.label);
      const scores = Object.values(s.factors).map(f => f.score);
      const weights = Object.values(s.factors).map(f => Math.round(f.weight * 100));
      window._locRadarChart = new Chart(radarCanvas, {
        type: 'radar',
        data: {
          labels,
          datasets: [{
            label: 'Score',
            data: scores,
            backgroundColor: 'rgba(37,99,235,0.15)',
            borderColor: '#2563eb',
            borderWidth: 2,
            pointBackgroundColor: scores.map(v => v >= 75 ? '#16a34a' : v >= 50 ? '#ca8a04' : '#dc2626'),
            pointRadius: 5,
          }, {
            label: 'Peso (%)',
            data: weights,
            backgroundColor: 'rgba(100,116,139,0.05)',
            borderColor: '#94a3b8',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
          scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 25, font: { size: 10 } }, pointLabels: { font: { size: 10 } } } }
        }
      });
    }
  }

  // ── MULTI-RADIUS DASHBOARD ──
  const mrEl = $('loc-multiradius');
  if (mrEl && rs['500m']) {
    const radii = ['500m', '1km', '2km'];
    const cats = [
      { key: 'farmacias',    emoji: '💊', label: 'Farmacias' },
      { key: 'salud',        emoji: '🏥', label: 'Salud' },
      { key: 'escuelas',     emoji: '🎓', label: 'Escuelas' },
      { key: 'iglesias',     emoji: '⛪', label: 'Iglesias' },
      { key: 'mercados',     emoji: '🛒', label: 'Mercados' },
      { key: 'comercios',    emoji: '🏪', label: 'Comercios' },
      { key: 'bancos',       emoji: '🏦', label: 'Bancos/ATMs' },
      { key: 'restaurantes', emoji: '🍽️', label: 'Restaurantes' },
      { key: 'transporte',   emoji: '🚌', label: 'Transporte' },
      { key: 'gasolineras',  emoji: '⛽', label: 'Gasolineras' },
      { key: 'residencial',  emoji: '🏠', label: 'Residencial' },
    ];
    mrEl.innerHTML = `
      <table class="data-table loc-multiradius-table">
        <thead><tr><th>Categoría</th>${radii.map(r => `<th class="num">${r}</th>`).join('')}</tr></thead>
        <tbody>
          ${cats.map(cat => `<tr>
            <td>${cat.emoji} ${cat.label}</td>
            ${radii.map(r => `<td class="num"><strong>${rs[r]?.[cat.key] ?? 0}</strong></td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    `;
  }

  // ── COMPETITION MATRIX ──
  const compEl = $('loc-competition');
  if (compEl && c.farmacias?.length) {
    const threatClass = t => t === 'alta' ? 'loc-threat-high' : t === 'baja' ? 'loc-threat-low' : 'loc-threat-mid';
    compEl.innerHTML = `
      <table class="data-table loc-competition-table">
        <thead><tr><th>Farmacia</th><th>Cadena</th><th class="num">Dist.</th><th>Amenaza</th></tr></thead>
        <tbody>
          ${c.farmacias.slice(0, 15).map(f => `<tr>
            <td>${f.name}</td>
            <td>${f.chain}</td>
            <td class="num">${f.distance ? f.distance + 'm' : '—'}</td>
            <td><span class="loc-threat-badge ${threatClass(f.threat)}">${f.threat}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${c.farmacias.length === 0 ? '<p class="loc-empty">No se encontraron farmacias en radio de 2km</p>' : ''}
    `;
  } else if (compEl) {
    compEl.innerHTML = '<p class="loc-empty">Sin datos de competencia</p>';
  }

  // ── TRAFFIC GENERATORS ──
  const trafEl = $('loc-traffic-generators');
  if (trafEl) {
    const sections = [
      { data: c.escuelas || [], emoji: '🎓', label: 'Escuelas' },
      { data: c.iglesias || [], emoji: '⛪', label: 'Iglesias' },
      { data: c.mercados || [], emoji: '🛒', label: 'Mercados/Super' },
      { data: c.transporte || [], emoji: '🚌', label: 'Transporte Público' },
      { data: c.gasolineras || [], emoji: '⛽', label: 'Gasolineras' },
    ];
    trafEl.innerHTML = sections.map(sec => `
      <div class="loc-traffic-section">
        <div class="loc-traffic-header">${sec.emoji} ${sec.label} <span class="loc-traffic-count">${sec.data.length}</span></div>
        <div class="loc-traffic-list">
          ${sec.data.slice(0, 5).map(p => `<div class="loc-traffic-item">${p.name} <span class="loc-dist">${p.distance ? p.distance + 'm' : ''}</span></div>`).join('')}
          ${sec.data.length > 5 ? `<div class="loc-traffic-more">+${sec.data.length - 5} más</div>` : ''}
          ${sec.data.length === 0 ? '<div class="loc-traffic-empty">Ninguno en 2km</div>' : ''}
        </div>
      </div>
    `).join('');
  }

  // ── MAP (enhanced with radius rings + color markers) ──
  if (study.coordinates) {
    if (locMap) { locMap.remove(); locMap = null; }
    try {
      locMap = L.map('loc-map').setView([study.coordinates.lat, study.coordinates.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM', maxZoom: 18
      }).addTo(locMap);

      // Main marker
      L.marker([study.coordinates.lat, study.coordinates.lng]).addTo(locMap)
        .bindPopup(`<b>${study.colonia || study.address}</b><br>${study.municipio || ''}<br>Score: ${s.total}/100`).openPopup();

      // Radius rings
      [500, 1000, 2000].forEach((r, i) => {
        L.circle([study.coordinates.lat, study.coordinates.lng], {
          radius: r, color: ['#2563eb', '#3b82f6', '#93c5fd'][i],
          fillOpacity: [0.04, 0.02, 0.01][i], weight: 1.5, dashArray: r > 500 ? '6 4' : null
        }).addTo(locMap);
      });

      // Color-coded markers
      const markerGroups = [
        { data: c.farmacias || [], color: '#dc2626', emoji: '💊', prefix: 'Farmacia' },
        { data: c.salud || [],     color: '#16a34a', emoji: '🏥', prefix: 'Salud' },
        { data: c.escuelas || [],  color: '#7c3aed', emoji: '🎓', prefix: 'Escuela' },
        { data: c.mercados || [],  color: '#ea580c', emoji: '🛒', prefix: 'Mercado' },
        { data: c.transporte || [],color: '#0284c7', emoji: '🚌', prefix: 'Transporte' },
        { data: c.bancos || [],    color: '#ca8a04', emoji: '🏦', prefix: 'Banco' },
      ];
      markerGroups.forEach(({ data, color, emoji, prefix }) => {
        data.forEach(p => {
          if (p.lat) L.circleMarker([p.lat, p.lng], {
            radius: prefix === 'Farmacia' ? 7 : 5, color, fillColor: color, fillOpacity: 0.7, weight: 1
          }).addTo(locMap).bindPopup(`${emoji} <b>${p.name}</b><br>${p.type || prefix}${p.chain ? ' · ' + p.chain : ''}${p.distance ? '<br>' + p.distance + 'm' : ''}`);
        });
      });

      setTimeout(() => { if(locMap) locMap.invalidateSize(); }, 100);
      setTimeout(() => { if(locMap) locMap.invalidateSize(); }, 400);
      setTimeout(() => { if(locMap) locMap.invalidateSize(); }, 1000);
    } catch (e) { console.error('Map error:', e); }
  }

  // ── DEMOGRAPHIC INDICATORS ──
  const indEl = $('loc-indicators');
  if (indEl) {
    const rez = study.rezago;
    indEl.innerHTML = `
      <div class="loc-indicator"><span class="loc-ind-label">📍 Dirección</span><span class="loc-ind-value">${study.displayName || study.address}</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">🏛️ Municipio</span><span class="loc-ind-value">${study.municipio || '—'}, ${study.estado || ''}</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">📊 Rezago Social</span><span class="loc-ind-value">${rez ? rez.grado + ' (idx: ' + rez.indice + ')' : 'Sin dato'}</span><span class="loc-ind-source">${rez ? rez.fuente + ' · ' + rez.nivel : ''}</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">🏦 Bancos/ATMs (1km)</span><span class="loc-ind-value">${s.bankCount ?? '—'}</span><span class="loc-ind-source">Proxy de nivel de ingreso</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">🍽️ Restaurantes (1km)</span><span class="loc-ind-value">${s.restaurantCount ?? '—'}</span><span class="loc-ind-source">Proxy densidad económica</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">🏠 Edif. Residenciales (1km)</span><span class="loc-ind-value">${s.residentialBuildings ?? '—'}</span><span class="loc-ind-source">Proxy densidad poblacional</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">📊 Índice de Saturación</span><span class="loc-ind-value">${s.saturationIndex != null ? s.saturationIndex.toFixed(2) : '—'}</span><span class="loc-ind-source">Farmacias / demanda potencial</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">🎯 Confianza geocode</span><span class="loc-ind-value">${study.geocodeConfidence || '—'}</span><span class="loc-ind-source">${study.geocodeSource || ''}</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">📐 Coordenadas</span><span class="loc-ind-value">${study.coordinates ? study.coordinates.lat.toFixed(5) + ', ' + study.coordinates.lng.toFixed(5) : '—'}</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">🔢 POIs Totales</span><span class="loc-ind-value">${study.totalPOIs || '—'}</span><span class="loc-ind-source">Elementos analizados en 2km</span></div>
      <div class="loc-indicator"><span class="loc-ind-label">💡 Escenario sugerido</span><span class="loc-ind-value">${sug.label} (factor ${sug.factor}x)</span><span class="loc-ind-source">⚡ Score ponderado de 15 factores</span></div>
    `;
  }

  // ── NEARBY DETAIL TABLE (legacy) ──
  const detEl = $('loc-nearby-detail');
  if (detEl) {
    const allPOIs = [
      ...(c.farmacias || []).map(p => ({ ...p, tipo: '💊 ' + (p.chain || 'Farmacia') })),
      ...(c.salud || []).map(p => ({ ...p, tipo: '🏥 ' + (p.type || 'Salud') })),
      ...(c.escuelas || []).map(p => ({ ...p, tipo: '🎓 ' + (p.type || 'Escuela') })),
      ...(c.mercados || []).map(p => ({ ...p, tipo: '🛒 ' + (p.type || 'Mercado') })),
      ...(c.bancos || []).map(p => ({ ...p, tipo: '🏦 ' + (p.type || 'Banco') })),
      ...(c.restaurantes || []).slice(0, 10).map(p => ({ ...p, tipo: '🍽️ ' + (p.type || 'Restaurante') })),
      ...(c.transporte || []).slice(0, 10).map(p => ({ ...p, tipo: '🚌 ' + (p.type || 'Transporte') })),
    ].sort((a, b) => (a.distance || 9999) - (b.distance || 9999));

    detEl.innerHTML = `<table class="data-table"><thead><tr><th>Tipo</th><th>Nombre</th><th class="num">Dist.</th><th>Radio</th></tr></thead><tbody>
      ${allPOIs.slice(0, 40).map(r => `<tr><td>${r.tipo}</td><td>${r.name}</td><td class="num">${r.distance ? r.distance + 'm' : '—'}</td><td>${r.band || '—'}</td></tr>`).join('')}
    </tbody></table>
    <p class="loc-note">${allPOIs.length} establecimientos encontrados en radio de 2km</p>`;
  }

  // ── SOURCES ──
  const srcEl = $('loc-sources');
  if (srcEl) {
    srcEl.innerHTML = `
      <div class="loc-sources-grid">
        <div class="loc-source-item"><span class="loc-src-badge dato">📍</span> Geocodificación: <strong>${study.geocodeSource || '—'}</strong></div>
        <div class="loc-source-item"><span class="loc-src-badge dato">🏪</span> POIs: <strong>${study.nearby?.source || '—'}</strong> (${study.totalPOIs || 0} elementos)</div>
        <div class="loc-source-item"><span class="loc-src-badge oficial">${study.rezago ? '📊' : '⚠️'}</span> Rezago social: <strong>${study.rezago?.fuente || 'No disponible'}</strong> <em>(${study.rezago?.nivel || '—'})</em></div>
        <div class="loc-source-item"><span class="loc-src-badge derivado">⚡</span> Scoring: <strong>15 factores ponderados v3</strong> — COFEPRIS, DENUE, Salud Pública, Corredor Vet</div>
      </div>
      ${study.nearby?.note ? '<p class="loc-note">⚠️ ' + study.nearby.note + '</p>' : ''}
      ${study.errors?.length ? '<p class="loc-note">⚠️ Errores parciales: ' + study.errors.map(e => e.step + ': ' + e.error).join(', ') + '</p>' : ''}
      <p class="loc-note">📅 Estudio v${study.version || 1} — ${new Date(study.lastUpdated).toLocaleString('es-MX')}</p>
    `;
  }
}

/* ═══ CONSOLIDATED VIEW ═══ */
function renderConsolidated(empresa){
  updateConsolMarketIndicator(empresa);
  const consol=runConsolidation(empresa);
  const ivaOn = $('toggle-iva')?.checked;
  const f = ivaOn ? 1.16 : 1; // IVA factor
  const fm = v => fmt.m(v * f); // format money with IVA
  const fmk = v => fmt.mk(v * f);

  // IVA label update
  const ivaLabel = $('iva-label');
  if(ivaLabel) ivaLabel.textContent = ivaOn ? 'Con IVA (×1.16)' : 'Sin IVA';

  // Wire toggle (only once)
  const tog = $('toggle-iva');
  if(tog && !tog._wired){
    tog._wired = true;
    tog.addEventListener('change', () => renderConsolidated(getEmpresa()));
  }

  // Enterprise KPIs
  const invEl = $('consol-kpi-inv');
  const freeEl = $('consol-kpi-free');
  const profitEl = $('consol-kpi-profit');
  const scoreEl = $('consol-kpi-score');

  if(invEl) {
    invEl.textContent = fm(consol.totalInvestment);
  }
  if(freeEl) {
    freeEl.textContent = fm(consol.capitalFree);
    freeEl.style.color = consol.capitalFree>0?'var(--green)':'var(--red)';
  }
  if(profitEl) {
    profitEl.textContent = fm(consol.avgMonthlyEBITDA);
    profitEl.style.color = consol.avgMonthlyEBITDA>0?'var(--green)':'var(--red)';
  }
  if(scoreEl) {
    scoreEl.textContent = consol.avgScore+'/100';
    scoreEl.style.color = consol.avgScore>=60?'var(--green)':consol.avgScore>=40?'var(--text-1)':'var(--red)';
  }

  // Consolidated cashflow chart
  dc('consol-cashflow');const ctx=$('chart-consol-cashflow');if(ctx){
    charts['consol-cashflow']=new Chart(ctx,{type:'line',data:{labels:consol.months.map(m=>'M'+m.month),datasets:[{label:'Acumulado Empresa',data:consol.months.map(m=>m.cumulativeCashFlow*f),borderColor:'#4d7cfe',backgroundColor:'rgba(77,124,254,0.1)',fill:true,tension:0.3,pointRadius:0,borderWidth:2.5},{label:'Mensual',data:consol.months.map(m=>m.netIncome*f),type:'bar',backgroundColor:consol.months.map(m=>m.netIncome>=0?'rgba(52,211,153,0.35)':'rgba(248,113,113,0.3)'),borderRadius:2}]},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt.m(c.parsed.y)}`}}},scales:{y:{ticks:{callback:v=>fmk(v/f)}}}}});
  }

  // Partner cards
  $('consol-partners').innerHTML=`<div class="partner-grid">${consol.perPartner.map(pp=>`<div class="partner-card"><div class="partner-name">👤 ${pp.name}</div>${[['Capital',fm(pp.capital)],['Participación',fmt.pi(pp.equity)],['Comprometido',fm(pp.capitalCommitted)],['Ret./mes',`<span style="color:${pp.monthlyReturn>=0?'var(--green)':'var(--red)'}">${fm(pp.monthlyReturn)}</span>`],['Ret. 5A',fm(pp.totalReturn60)],['ROI 5A',pp.roi60.toFixed(1)+'%']].map(([l,v])=>`<div class="partner-stat"><span class="partner-stat-label">${l}</span><span class="partner-stat-value">${v}</span></div>`).join('')}</div>`).join('')}</div>`;

  // Branch breakdown table
  $('consol-branch-table').innerHTML=`<table class="data-table"><thead><tr><th>Sucursal</th><th>Formato</th><th>Colonia</th><th class="num">Inversión</th><th class="num">EBITDA</th><th class="num">PB Simple</th><th class="num">Score</th><th>Ubicación</th><th>Acciones</th></tr></thead><tbody>${consol.branchResults.map(({branch:b,result:r})=>{
    const ls = b.locationStudy;
    const locScore = ls?.scores?.total;
    const locLabel = ls ? (locScore != null ? locScore + '/100' : 'Sin dato') : 'Sin estudio';
    const locColor = locScore >= 60 ? 'var(--green)' : locScore >= 40 ? 'var(--yellow)' : locScore != null ? 'var(--red)' : 'var(--text-3)';
    return `<tr><td>${b.name}</td><td>${MODELS[b.format]?.emoji||''} ${MODELS[b.format]?.label||b.format}</td><td>${b.colonia||'—'}</td><td class="num">${fm(r.totalInvestment)}</td><td class="num ${r.avgMonthlyEBITDA>=0?'positive':'negative'}">${fm(r.avgMonthlyEBITDA)}</td><td class="num">${r.paybackSimple?Math.round(r.paybackSimple)+'m':'∞'}</td><td class="num">${r.viabilityScore}</td><td style="color:${locColor}">${locLabel}</td><td><button class="btn-sm primary consol-study-btn" data-bid="${b.id}" title="Actualizar estudio de ubicación">📍 Estudio</button> <button class="btn-sm consol-view-btn" data-bid="${b.id}" title="Ver detalle">👁</button></td></tr>`;
  }).join('')}</tbody></table>`;

  // Wire consolidado action buttons — prompt for address
  document.querySelectorAll('.consol-study-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bid = btn.dataset.bid;
      const branch = getBranch(bid);
      if (!branch) return;
      const defaultAddr = branch.locationStudy?.address || branch.colonia || '';
      const query = prompt(`📍 Dirección para estudio de mercado\nSucursal: ${branch.name}\n\nIngresa la dirección completa:`, defaultAddr);
      if (!query || !query.trim()) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        const study = await runLocationStudy(query.trim());
        updateBranchLocation(bid, study);
        // Also update branch colonia from geocoded data
        if (study.colonia) updateBranch(bid, { colonia: study.colonia });
        showToast(`✅ Estudio actualizado: ${branch.name} — Score: ${study.scores?.total ?? '?'}/100`,'success');
        renderConsolidated(getEmpresa());
      } catch(e) {
        showToast(`❌ Error: ${e.message}`,'error');
        btn.disabled = false; btn.textContent = '📍 Estudio';
      }
    });
  });
  document.querySelectorAll('.consol-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.view = 'branch';
      state.activeBranchId = btn.dataset.bid;
      state.activeTab = 'resultados';
      renderCurrentView();
    });
  });
}

/* ═══ COMPARADOR VIEW ═══ */
function renderComparador(empresa){
  const activeBranches=empresa.branches.filter(b=>b.status!=='paused');
  const results=activeBranches.map(b=>({branch:b,result:runBranchProjection(b,empresa)}));
  const metrics=[
    {l:'EBITDA',f:r=>fmt.m(r.avgMonthlyEBITDA)},
    {l:'Break-Even',f:r=>fmt.m(r.breakEvenRevenue)},
    {l:'PB Simple',f:r=>{const pm=r.paybackMetrics;return pm.simple.min!=null?`${pm.simple.min.toFixed(0)}–${pm.simple.max.toFixed(0)}m`:'∞';}},
    {l:'PB Rampa',f:r=>r.paybackMetrics?.rampa?.month?r.paybackMetrics.rampa.month+'m':'∞'},
    {l:'BE Operativo',f:r=>r.paybackMetrics?.beOperativo?.month?r.paybackMetrics.beOperativo.month+'m':'∞'},
    {l:'ROI 36m',f:r=>r.roi36.toFixed(1)+'%'},
    {l:'VPN',f:r=>fmt.m(r.npv)},
    {l:'Score',f:r=>r.viabilityScore},
  ];
  $('comparador-table').innerHTML=`<table class="data-table"><thead><tr><th>Métrica</th>${results.map(({branch:b})=>`<th class="num">${MODELS[b.format]?.emoji||''} ${b.name}</th>`).join('')}</tr></thead><tbody>${metrics.map(m=>`<tr><td>${m.l}</td>${results.map(({result:r})=>`<td class="num">${m.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  // Side-by-side cashflow
  dc('comparador-cf');const ctx=$('chart-comparador-cf');if(ctx&&results.length){
    const colors=['#4d7cfe','#34d399','#f87171','#fbbf24','#818cf8'];
    charts['comparador-cf']=new Chart(ctx,{type:'line',data:{labels:results[0].result.months.map(m=>'M'+m.month),datasets:results.map(({branch:b,result:r},i)=>({label:b.name,data:r.months.map(m=>m.cumulativeCashFlow),borderColor:colors[i%colors.length],fill:false,tension:0.3,pointRadius:0,borderWidth:2}))},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt.m(c.parsed.y)}`}}},scales:{y:{ticks:{callback:v=>fmt.mk(v)}}}}});
  }
}

/* ═══ EMPRESA SETTINGS VIEW ═══ */
function renderEmpresaSettings(empresa){
  const consol = runConsolidation(empresa);

  // ── KPI strip at top ──
  const kpiEl = $('empresa-kpis');
  if (kpiEl) {
    const capStatus = consol.capitalFree >= 0 ? 'good' : 'bad';
    kpiEl.innerHTML = [
      kc('Capital Total', fmt.m(empresa.totalCapital), `${empresa.partners.length} socios`, 'neutral'),
      kc('Comprometido', fmt.m(consol.capitalCommitted), fmt.pi(consol.capitalCommitted / empresa.totalCapital) + ' del total', 'neutral'),
      kc('Libre', fmt.m(consol.capitalFree), capStatus === 'good' ? 'Disponible' : '⚠️ Excedido', capStatus),
      kc('Ganancia/mes', fmt.m(consol.avgMonthlyNet), `en ${consol.branchCount} suc.`, consol.avgMonthlyNet >= 0 ? 'good' : 'bad'),
      kc('Recuperación Emp.', consol.paybackMonth ? consol.paybackMonth + ' meses' : '∞', 'Todas las sucursales', consol.paybackMonth && consol.paybackMonth <= 36 ? 'good' : 'warn'),
      kc('Calificación', consol.avgScore + '/100', 'Promedio portafolio', consol.avgScore >= 70 ? 'good' : consol.avgScore >= 50 ? 'warn' : 'bad')
    ].join('');
  }

  // ── Form fields ──
  $('emp-name').value = empresa.name || '';
  
  const logoPreview = $('emp-logo-preview');
  if (logoPreview) logoPreview.src = empresa.logo || 'assets/nojom-bird.png';
  const projNameEl = $('emp-project-name');
  if (projNameEl) projNameEl.value = empresa.projectName || 'FarmaTuya';
  $('emp-capital').value = empresa.totalCapital || 0;
  $('emp-reserve').value = empresa.corporateReserve || 0;
  const corpExpEl = $('emp-corp-expenses');
  if (corpExpEl) corpExpEl.value = empresa.corporateExpenses || 0;

  // ── Partners table with calculated metrics ──
  renderPartnersTable(empresa.partners, consol);
}

function renderPartnersTable(partners, consol){
  const container = $('partners-table-container');
  if (!container) return;
  const alertEl = $('equity-alert');

  if (!partners.length) {
    container.innerHTML = '<p style="color:var(--text-3)">Sin socios registrados</p>';
    if (alertEl) alertEl.innerHTML = '';
    return;
  }

  const totalEquity = partners.reduce((s, p) => s + p.equity, 0);
  const equityOk = Math.abs(totalEquity - 1) < 0.001;

  // Show equity alert
  if (alertEl) {
    alertEl.innerHTML = equityOk
      ? '<span style="color:var(--green);font-size:0.7rem">✅ 100%</span>'
      : `<span style="color:var(--red);font-size:0.7rem">⚠️ ${Math.round(totalEquity * 100)}% (debe ser 100%)</span>`;
  }

  // Build per-partner data from consolidation
  const ppMap = {};
  if (consol && consol.perPartner) consol.perPartner.forEach(pp => ppMap[pp.id] = pp);

  container.innerHTML = `<div class="socios-table-wrap"><table class="data-table socios-table"><thead><tr>
    <th>Nombre</th><th class="num">Capital</th><th class="num">%</th>
    <th class="num" title="Capital invertido en sucursales activas">Comprometido</th><th class="num" title="Lo que gana cada socio al mes">Ganancia/mes</th><th class="num" title="Retorno en 5 años por cada peso invertido">Retorno 5A</th><th class="num" title="Meses para recuperar la inversión">Recuperación</th><th></th>
  </tr></thead><tbody>${partners.map(p => {
    const pp = ppMap[p.id] || {};
    const retColor = (pp.monthlyReturn || 0) >= 0 ? 'var(--green)' : 'var(--red)';
    const pb = pp.paybackSimple;
    const pbStr = pb != null ? Math.round(pb) + ' meses' : '∞';
    const pbColor = pb != null && pb <= 36 ? 'var(--green)' : pb != null && pb <= 48 ? 'var(--yellow)' : 'var(--red)';
    return `<tr>
      <td><input class="input-text inline" value="${p.name}" data-pid="${p.id}" data-field="name"></td>
      <td class="num"><input class="input-text inline num" type="number" value="${p.capital}" data-pid="${p.id}" data-field="capital" step="100000"></td>
      <td class="num"><input class="input-text inline num" type="number" value="${Math.round(p.equity*100)}" data-pid="${p.id}" data-field="equity" min="0" max="100" step="1">%</td>
      <td class="num calc">${fmt.m(pp.capitalCommitted || 0)}</td>
      <td class="num calc" style="color:${retColor}">${fmt.m(pp.monthlyReturn || 0)}</td>
      <td class="num calc">${pp.roi60 != null ? pp.roi60.toFixed(1) + '%' : '—'}</td>
      <td class="num calc" style="color:${pbColor}">${pbStr}</td>
      <td><button class="btn-sm warn btn-remove-partner" data-pid="${p.id}">🗑</button></td>
    </tr>`;
  }).join('')}</tbody>
  <tfoot><tr>
    <td><strong>Total</strong></td>
    <td class="num"><strong>${fmt.m(partners.reduce((s,p)=>s+p.capital, 0))}</strong></td>
    <td class="num ${equityOk ? '' : 'negative'}"><strong>${Math.round(totalEquity*100)}%</strong></td>
    <td class="num calc"><strong>${fmt.m(consol?.capitalCommitted || 0)}</strong></td>
    <td class="num calc"><strong>${fmt.m(consol?.avgMonthlyNet || 0)}</strong></td>
    <td colspan="3"></td>
  </tr></tfoot></table></div>`;

  container.querySelectorAll('input[data-pid]').forEach(inp => {
    inp.addEventListener('change', e => {
      const pid = e.target.dataset.pid, field = e.target.dataset.field;
      let val = e.target.value;
      if (field === 'capital') { val = Math.max(0, parseFloat(val) || 0); }
      else if (field === 'equity') { val = Math.max(0, Math.min(100, parseFloat(val) || 0)) / 100; }
      else if (field === 'name') { val = val.trim().slice(0, 100); if (!val) return; }
      updatePartner(pid, { [field]: val });
    });
  });
  // Event delegation for partner remove buttons
  container.querySelectorAll('.btn-remove-partner').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.pid;
      showConfirm(
        '🗑 ¿Eliminar este socio?',
        '<p>Se eliminará del sistema y se recalcularán las métricas de todos los demás socios.</p>',
        '🗑 Eliminar socio',
        () => removePartner(pid)
      );
    });
  });
}

window._removePartner = (id) => {
  showConfirm(
    '🗑 ¿Eliminar este socio?',
    '<p>Se eliminará del sistema y se recalcularán las métricas de todos los demás socios.</p>',
    '🗑 Eliminar socio',
    () => removePartner(id)
  );
};

// Module scripts run after DOM is parsed — no need for DOMContentLoaded
{
  const saveBtn=$('btn-save-empresa');
  if(saveBtn) saveBtn.addEventListener('click',()=>{
    const fileInp = $('emp-logo-upload');
    const commit = (logoStr) => {
      const data = {
        name:$('emp-name').value,
        projectName:$('emp-project-name')?.value || 'FarmaTuya',
        totalCapital:parseFloat($('emp-capital').value)||0,
        corporateReserve:parseFloat($('emp-reserve').value)||0,
        corporateExpenses:parseFloat($('emp-corp-expenses')?.value)||0
      };
      if (logoStr !== undefined) data.logo = logoStr;
      
      updateEmpresa(data);
      saveBtn.textContent='✅ Guardado';
      setTimeout(()=>saveBtn.textContent='Guardar Cambios',1500);
    };

    if (fileInp && fileInp.files && fileInp.files[0]) {
      const fr = new FileReader();
      fr.onload = (e) => commit(e.target.result);
      fr.readAsDataURL(fileInp.files[0]);
    } else {
      commit(undefined);
    }
  });
  
  // Live preview when file is selected
  const fileInp = $('emp-logo-upload');
  if(fileInp) fileInp.addEventListener('change', (e) => {
    if(e.target.files && e.target.files[0]) {
      const fr = new FileReader();
      fr.onload = (ev) => {
         const preview = $('emp-logo-preview');
         if (preview) preview.src = ev.target.result;
      };
      fr.readAsDataURL(e.target.files[0]);
    }
  });
  const addPBtn=$('btn-add-partner');
  if(addPBtn) addPBtn.addEventListener('click',()=>{
    const name=$('add-partner-name').value||'Nuevo Socio';
    const capital=parseFloat($('add-partner-capital').value)||0;
    const equity=(parseFloat($('add-partner-equity').value)||0)/100;
    addPartner(name,capital,equity);
    $('add-partner-name').value='';$('add-partner-capital').value='';$('add-partner-equity').value='';
  });
  const resetBtn=$('btn-reset-empresa');
  if(resetBtn){
    let confirmPending=false;
    resetBtn.addEventListener('click',()=>{
      if(!confirmPending){
        confirmPending=true;
        resetBtn.textContent='⚠️ Confirmar Reinicio';
        resetBtn.style.background='#dc2626';
        resetBtn.style.color='#fff';
        setTimeout(()=>{
          if(confirmPending){
            confirmPending=false;
            resetBtn.textContent='Reiniciar Todo';
            resetBtn.style.background='';
            resetBtn.style.color='';
          }
        },3000);
      } else {
        resetEmpresa();
        location.reload();
      }
    });
  }
}

/* ═══ GLOSARIO / DICTIONARY ═══ */
const GLOSSARY = [
  {cat:'💰 Rentabilidad',term:'EBITDA',def:'Ganancia mensual antes de impuestos, depreciación y amortización. Es lo que la sucursal genera de utilidad operativa pura.',where:'Cards del portafolio, KPI strip'},
  {cat:'💰 Rentabilidad',term:'Margen de Contribución (MC)',def:'Porcentaje de cada peso de venta que queda después de cubrir costos variables. Mientras más alto, mejor.',where:'KPI strip del branch'},
  {cat:'💰 Rentabilidad',term:'Utilidad Neta',def:'Lo que realmente queda después de costos fijos, variables e impuestos. Es el dinero que se puede repartir o reinvertir.',where:'P&L mensual'},
  {cat:'💰 Rentabilidad',term:'ROI (Return on Investment)',def:'Porcentaje de retorno sobre la inversión total. ROI 12m es a 1 año, ROI 36m es a 3 años.',where:'Tab P&L'},
  {cat:'📊 Inversión',term:'Payback Simple',def:'¿Cuántos meses tarda en recuperarse la inversión, asumiendo utilidad constante? Se divide inversión total entre utilidad mensual estabilizada.',where:'KPI strip'},
  {cat:'📊 Inversión',term:'Payback Rampa',def:'¿Cuántos meses tarda en recuperarse la inversión usando el flujo real mes a mes (que empieza bajo y sube)? Es más realista que el simple.',where:'KPI strip, cards'},
  {cat:'📊 Inversión',term:'Payback Promedio 5A',def:'Usa la utilidad promedio de 5 años para calcular el retorno. Útil cuando la utilidad varía mucho.',where:'Comparador'},
  {cat:'📊 Inversión',term:'Break-Even Operativo (BE Op.)',def:'Mes en el que la sucursal empieza a dar utilidad positiva de forma sostenida. Antes de ese mes, opera a pérdida.',where:'KPI strip'},
  {cat:'📊 Inversión',term:'VPN (Valor Presente Neto)',def:'Cuánto vale hoy todo el flujo futuro de 5 años, descontado al 12%. Si es positivo, la inversión genera valor real.',where:'Tab P&L'},
  {cat:'📊 Inversión',term:'TIR (Tasa Interna de Retorno)',def:'La tasa de rendimiento anual que genera la inversión. Si supera el costo de oportunidad (~12%), conviene invertir.',where:'Tab P&L'},
  {cat:'🏪 Operación',term:'Break-Even Revenue',def:'Nivel de ventas mínimo para cubrir todos los costos. Si vendes menos que esto, pierdes dinero.',where:'KPI strip'},
  {cat:'🏪 Operación',term:'COGS (Costo de Mercancía)',def:'Lo que cuesta comprar los productos que vendes. En farmacia típicamente es 62-65% de la venta.',where:'Tab P&L, donut de costos variables'},
  {cat:'🏪 Operación',term:'Merma',def:'Productos que se pierden (caducos, rotos, robados). Se mide como porcentaje de ventas, típicamente 1-2%.',where:'Sliders avanzados'},
  {cat:'🏪 Operación',term:'Comisión sobre Venta',def:'Porcentaje de ventas destinado a pagar comisiones al personal de mostrador.',where:'Costos variables'},
  {cat:'🏪 Operación',term:'Regalía',def:'Porcentaje que se paga a la franquicia por usar la marca. Solo aplica al modelo Súper (2.5%).',where:'Config de branch'},
  {cat:'🏢 Estructura',term:'Capital Total',def:'Todo el dinero disponible de la sociedad para invertir en sucursales.',where:'Header y Empresa'},
  {cat:'🏢 Estructura',term:'Capital Comprometido',def:'La suma de las inversiones de todas las sucursales activas y planeadas.',where:'Header'},
  {cat:'🏢 Estructura',term:'Capital Libre',def:'Capital Total menos el Comprometido. Si es negativo (rojo), la empresa necesita más fondos.',where:'Header'},
  {cat:'🏢 Estructura',term:'Reserva Corporativa',def:'Dinero apartado para imprevistos o gastos corporativos que no se asigna a sucursales.',where:'Empresa settings'},
  {cat:'🏢 Estructura',term:'Participación (%)',def:'El porcentaje de la empresa que le corresponde a cada socio. Determina reparto de utilidades.',where:'Consolidado, Empresa'},
  {cat:'🔬 Riesgo',term:'Score de Viabilidad',def:'Calificación de 0-100 que resume qué tan viable es la sucursal. 60+ es VIABLE, 40-59 es FRÁGIL, <40 NO VIABLE.',where:'Cards, gauge'},
  {cat:'🔬 Riesgo',term:'Fragilidad',def:'Porcentaje de escenarios donde la sucursal da negativo. Mientras más bajo, más robusta es la inversión.',where:'Tab Stress'},
  {cat:'🔬 Riesgo',term:'Renta Máxima',def:'La renta más alta que la sucursal puede pagar y seguir siendo rentable.',where:'Tab Stress'},
  {cat:'🔬 Riesgo',term:'Tornado (±20%)',def:'Gráfica que muestra cómo cambia la utilidad si cada variable sube o baja 20%. Identifica qué factores impactan más.',where:'Tab Stress'},
];

function renderGlosario(filter=''){
  const grid=$('glosario-grid');if(!grid)return;
  const q=filter.toLowerCase();
  const filtered=q?GLOSSARY.filter(g=>g.term.toLowerCase().includes(q)||g.def.toLowerCase().includes(q)||g.cat.toLowerCase().includes(q)):GLOSSARY;
  // Group by category
  const grouped={};
  filtered.forEach(g=>{if(!grouped[g.cat])grouped[g.cat]=[];grouped[g.cat].push(g);});
  grid.innerHTML=Object.entries(grouped).map(([cat,terms])=>`
    <div class="glosario-category">
      <h3 class="glosario-cat-title">${cat}</h3>
      <div class="glosario-terms">${terms.map(t=>`
        <div class="glosario-term">
          <div class="glosario-term-name">${t.term}</div>
          <div class="glosario-term-def">${t.def}</div>
          <div class="glosario-term-where">📍 ${t.where}</div>
        </div>`).join('')}
      </div>
    </div>`).join('')||'<p style="color:var(--text-3);text-align:center;padding:2rem">No se encontraron conceptos.</p>';
}

document.addEventListener('DOMContentLoaded',()=>{
  const si=$('glosario-search');
  if(si) si.addEventListener('input',e=>renderGlosario(e.target.value));
});

/* ═══ PROFILE POPUP MODULE ═══ */
const PROFILE_KEY = 'bw2_user_profile';

function getProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; }
  catch(e) { return {}; }
}

function saveProfile(data) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
}

function getInitials(first, last) {
  const f = (first || '').trim();
  const l = (last || '').trim();
  if (!f && !l) return '';
  return ((f[0] || '') + (l[0] || '')).toUpperCase();
}

function updateHeaderAvatar() {
  const profile = getProfile();
  const initialsEl = $('profile-avatar-initials');
  const imgEl = $('profile-avatar-img');
  if (!initialsEl || !imgEl) return;

  if (profile.photo) {
    imgEl.src = profile.photo;
    imgEl.style.display = 'block';
    initialsEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none';
    initialsEl.style.display = '';
    const initials = getInitials(profile.firstName, profile.lastName);
    if (initials) {
      initialsEl.textContent = initials;
      initialsEl.classList.add('has-name');
    } else {
      initialsEl.textContent = '👤';
      initialsEl.classList.remove('has-name');
    }
  }
}

function openProfilePopup() {
  const modal = $('modal-profile');
  if (!modal) return;

  const profile = getProfile();

  // Populate fields
  const nombreInput = $('profile-nombre');
  const apellidoInput = $('profile-apellido');
  const emailInput = $('profile-email');
  if (nombreInput) nombreInput.value = profile.firstName || '';
  if (apellidoInput) apellidoInput.value = profile.lastName || '';
  
  // Populate email from auth user
  const authUser = getCurrentUser();
  if (emailInput && authUser) emailInput.value = authUser.email || '';
  
  // Reset password change section
  const pwdSection = $('profile-pwd-section');
  if (pwdSection) pwdSection.removeAttribute('open');
  const curPwd = $('profile-current-pwd');
  const newPwd = $('profile-new-pwd');
  const pwdMsg = $('pwd-change-msg');
  if (curPwd) curPwd.value = '';
  if (newPwd) newPwd.value = '';
  if (pwdMsg) pwdMsg.style.display = 'none';

  // Photo state
  const placeholder = $('profile-photo-placeholder');
  const preview = $('profile-photo-preview');
  const previewImg = $('profile-photo-img');
  let pendingPhoto = profile.photo || null;

  if (pendingPhoto) {
    previewImg.src = pendingPhoto;
    preview.style.display = 'flex';
    placeholder.style.display = 'none';
  } else {
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
  }

  // Show modal
  modal.style.display = '';

  // ── Photo upload handlers (set up once, then clean up) ──
  const dropzone = $('profile-photo-dropzone');
  const fileInput = $('profile-photo-input');
  const removeBtn = $('btn-remove-profile-photo');

  function showPhotoPreview(dataURL) {
    pendingPhoto = dataURL;
    previewImg.src = dataURL;
    preview.style.display = 'flex';
    placeholder.style.display = 'none';
  }
  function clearPhotoPreview() {
    pendingPhoto = null;
    previewImg.src = '';
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) { showToast('Solo se aceptan imágenes', 'error'); return; }
    if (file.size > 2 * 1024 * 1024) { showToast('Imagen muy grande (máx 2MB)', 'error'); return; }
    try {
      const dataURL = await resizeImageToDataURL(file, 256);
      showPhotoPreview(dataURL);
    } catch(e) { showToast('Error al procesar imagen', 'error'); }
  }

  const onDropzoneClick = (e) => {
    if (e.target === fileInput) return;
    if (e.target.closest('#btn-remove-profile-photo')) return;
    fileInput.click();
  };
  const onFileChange = () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); };
  const onDragOver = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
  const onDragLeave = () => { dropzone.classList.remove('dragover'); };
  const onDrop = (e) => {
    e.preventDefault(); dropzone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  };
  const onRemove = (e) => { e.stopPropagation(); clearPhotoPreview(); };

  dropzone.addEventListener('click', onDropzoneClick);
  fileInput.addEventListener('change', onFileChange);
  dropzone.addEventListener('dragover', onDragOver);
  dropzone.addEventListener('dragleave', onDragLeave);
  dropzone.addEventListener('drop', onDrop);
  if (removeBtn) removeBtn.addEventListener('click', onRemove);

  // ── Close/Save handlers ──
  function closeModal() {
    modal.style.display = 'none';
    // Clean up event listeners
    dropzone.removeEventListener('click', onDropzoneClick);
    fileInput.removeEventListener('change', onFileChange);
    dropzone.removeEventListener('dragover', onDragOver);
    dropzone.removeEventListener('dragleave', onDragLeave);
    dropzone.removeEventListener('drop', onDrop);
    if (removeBtn) removeBtn.removeEventListener('click', onRemove);
    fileInput.value = '';
  }

  $('btn-close-profile').onclick = closeModal;
  $('btn-cancel-profile').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };

  $('btn-save-profile').onclick = () => {
    const firstName = (nombreInput?.value || '').trim();
    const lastName = (apellidoInput?.value || '').trim();
    saveProfile({ firstName, lastName, photo: pendingPhoto });
    // Sync to auth user
    updateUserProfile({ firstName, lastName, photo: pendingPhoto });
    updateHeaderAvatar();
    closeModal();
    showToast('Perfil guardado', 'success');
  };

  // Focus first field
  setTimeout(() => { if (nombreInput) nombreInput.focus(); }, 150);
}

document.addEventListener('DOMContentLoaded', () => {
  /* ── Auth Gate ── */
  const authScreen = $('auth-screen');
  const appHeader = $('app-header');
  const mainNav = $('main-nav');
  const appContent = document.querySelector('.app-content') || $('view-bw2-home')?.parentElement;
  const appFooter = $('app-footer');

  function showApp() {
    if (authScreen) authScreen.style.display = 'none';
    if (appHeader) appHeader.style.display = '';
    if (mainNav) mainNav.style.display = '';
    if (appContent) appContent.style.display = '';
    if (appFooter) appFooter.style.display = '';
    updateHeaderAvatar();
    // Sync auth user → old profile format
    const user = getCurrentUser();
    if (user) {
      saveProfile({ firstName: user.firstName, lastName: user.lastName, photo: user.photo });
    }
  }

  function showAuth() {
    if (authScreen) authScreen.style.display = '';
    if (appHeader) appHeader.style.display = 'none';
    if (mainNav) mainNav.style.display = 'none';
    if (appContent) appContent.style.display = 'none';
    if (appFooter) appFooter.style.display = 'none';
  }

  if (isAuthenticated()) {
    showApp();
  } else {
    showAuth();
  }

  /* ── Login/Register Toggle ── */
  const loginView = $('auth-login-view');
  const registerView = $('auth-register-view');
  const gotoReg = $('goto-register');
  const gotoLog = $('goto-login');

  if (gotoReg) gotoReg.addEventListener('click', e => {
    e.preventDefault();
    loginView.style.display = 'none';
    registerView.style.display = '';
    registerView.style.animation = 'authViewIn 0.35s ease';
    $('reg-firstName')?.focus();
  });
  if (gotoLog) gotoLog.addEventListener('click', e => {
    e.preventDefault();
    registerView.style.display = 'none';
    loginView.style.display = '';
    loginView.style.animation = 'authViewIn 0.35s ease';
    $('login-email')?.focus();
  });

  /* ── Toggle Password Visibility ── */
  document.querySelectorAll('.auth-toggle-pwd').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.target);
      if (!target) return;
      const isPwd = target.type === 'password';
      target.type = isPwd ? 'text' : 'password';
      btn.textContent = isPwd ? '🙈' : '👁';
    });
  });

  /* ── Password Strength Indicator ── */
  const regPwd = $('reg-password');
  const pwdFill = $('pwd-strength-fill');
  const pwdLabel = $('pwd-strength-label');
  if (regPwd && pwdFill && pwdLabel) {
    regPwd.addEventListener('input', () => {
      const v = regPwd.value;
      let score = 0;
      if (v.length >= 6) score++;
      if (v.length >= 10) score++;
      if (/[A-Z]/.test(v)) score++;
      if (/[0-9]/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;
      const levels = [
        { w: '0%', bg: 'transparent', label: '' },
        { w: '20%', bg: '#f87171', label: 'Muy débil' },
        { w: '40%', bg: '#fbbf24', label: 'Débil' },
        { w: '60%', bg: '#fbbf24', label: 'Aceptable' },
        { w: '80%', bg: '#34d399', label: 'Fuerte' },
        { w: '100%', bg: '#16a34a', label: 'Excelente' }
      ];
      const l = levels[Math.min(score, 5)];
      pwdFill.style.width = l.w;
      pwdFill.style.background = l.bg;
      pwdLabel.textContent = l.label;
      pwdLabel.style.color = l.bg;
    });
  }

  /* ── Login Form ── */
  const loginForm = $('auth-login-form');
  if (loginForm) loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = $('login-error');
    const btn = $('btn-login');
    const btnText = btn.querySelector('.auth-btn-text');
    const btnLoader = btn.querySelector('.auth-btn-loader');
    errorEl.style.display = 'none';
    btn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = '';

    const email = $('login-email').value;
    const password = $('login-password').value;

    const result = await loginUser(email, password);
    btn.disabled = false;
    btnText.style.display = '';
    btnLoader.style.display = 'none';

    if (result.success) {
      showApp();
      if (typeof renderCurrentView === 'function') renderCurrentView();
    } else {
      errorEl.textContent = result.error;
      errorEl.style.display = '';
      errorEl.style.animation = 'none';
      errorEl.offsetHeight; // trigger reflow
      errorEl.style.animation = 'authShake 0.4s ease';
    }
  });

  /* ── Register Form ── */
  const regForm = $('auth-register-form');
  if (regForm) regForm.addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = $('register-error');
    const btn = $('btn-register');
    const btnText = btn.querySelector('.auth-btn-text');
    const btnLoader = btn.querySelector('.auth-btn-loader');
    errorEl.style.display = 'none';
    btn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = '';

    const firstName = $('reg-firstName').value;
    const lastName = $('reg-lastName').value;
    const email = $('reg-email').value;
    const password = $('reg-password').value;
    const password2 = $('reg-password2').value;

    if (password !== password2) {
      errorEl.textContent = 'Las contraseñas no coinciden';
      errorEl.style.display = '';
      btn.disabled = false;
      btnText.style.display = '';
      btnLoader.style.display = 'none';
      return;
    }

    const result = await registerUser(email, password, firstName, lastName);
    btn.disabled = false;
    btnText.style.display = '';
    btnLoader.style.display = 'none';

    if (result.success) {
      showApp();
      if (typeof renderCurrentView === 'function') renderCurrentView();
      if (typeof showToast === 'function') showToast('¡Cuenta creada exitosamente!', 'success');
    } else {
      errorEl.textContent = result.error;
      errorEl.style.display = '';
      errorEl.style.animation = 'none';
      errorEl.offsetHeight;
      errorEl.style.animation = 'authShake 0.4s ease';
    }
  });

  /* ── Profile Popup ── */
  updateHeaderAvatar();
  const openBtn = $('btn-open-profile');
  if (openBtn) openBtn.addEventListener('click', openProfilePopup);

  /* ── Profile: Password Change ── */
  const changePwdBtn = $('btn-change-pwd');
  if (changePwdBtn) changePwdBtn.addEventListener('click', async () => {
    const currentPwd = $('profile-current-pwd')?.value;
    const newPwd = $('profile-new-pwd')?.value;
    const msgEl = $('pwd-change-msg');
    if (!currentPwd || !newPwd) {
      if (msgEl) { msgEl.textContent = 'Completa ambos campos'; msgEl.style.color = '#dc2626'; msgEl.style.display = ''; }
      return;
    }
    const result = await changePassword(currentPwd, newPwd);
    if (msgEl) {
      msgEl.textContent = result.success ? '✅ Contraseña actualizada' : result.error;
      msgEl.style.color = result.success ? 'var(--green)' : '#dc2626';
      msgEl.style.display = '';
    }
    if (result.success) {
      $('profile-current-pwd').value = '';
      $('profile-new-pwd').value = '';
    }
  });

  /* ── Profile: Logout ── */
  const logoutBtn = $('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    logoutUser();
    const modal = $('modal-profile');
    if (modal) modal.style.display = 'none';
    showAuth();
    // Reset login form
    if (loginForm) loginForm.reset();
    if (loginView && registerView) {
      registerView.style.display = 'none';
      loginView.style.display = '';
    }
    $('login-error') && ($('login-error').style.display = 'none');
  });
});
