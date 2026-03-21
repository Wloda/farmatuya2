/**
 * BW² — Multi-Empresa Multi-Proyecto Dashboard v8
 */
import { MODELS, SCENARIOS, LOCATIONS, BENCHMARKS } from './data/model-registry.js?v=bw3';
import { runProjection, runSensitivity, generateHeatmap, calcStress, generateChecklist, evaluateAlerts } from './engine/financial-model.js?v=bw3';
import { runBranchProjection, runConsolidation } from './engine/enterprise-engine.js?v=bw3';
import { getWorkspace, getEmpresas, getEmpresaById, getActiveEmpresa, setActiveEmpresa, addEmpresa, updateEmpresaData, removeEmpresa, getProyectos, getProyectoById, getActiveProyecto, setActiveProyecto, addProyecto, updateProyecto, removeProyecto, getEmpresa, updateEmpresa, addBranch, updateBranch, updateBranchOverrides, dupBranch, archiveBranch, activateBranch, restoreBranch, removeBranch, getBranch, getActiveBranches, addPartner, updatePartner, removePartner, resetEmpresa, resetBranchToDefaults, buildDefaultOverrides, updateBranchLocation, onEmpresaChange } from './data/empresa-store.js?v=bw3';
import { runLocationStudy } from './engine/location-engine.js?v=bw3';

let state = { view:'bw2home', activeBranchId:null, branchOverrides:{} };
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

Chart.defaults.color='#a1a9b8';Chart.defaults.font.family="'Inter',sans-serif";Chart.defaults.font.size=11;
Chart.defaults.plugins.legend.labels.boxWidth=12;Chart.defaults.elements.bar.borderRadius=3;
Chart.defaults.scale.grid={color:'rgba(255,255,255,0.04)'};

const $=id=>document.getElementById(id);
const fmt={m:v=>'$'+Math.round(v).toLocaleString('es-MX'),mk:v=>'$'+(v/1000).toFixed(0)+'K',p:v=>(v*100).toFixed(1)+'%',pi:v=>Math.round(v*100)+'%',mo:v=>v?v+' m':'∞'};
function dc(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
function kc(l,v,d,s,tip){return `<div class="kpi-card" data-status="${s}"${tip?' title="'+tip+'"':''}><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-detail">${d}</div></div>`;}

let _suppressFullRender = false;
let _suppressTimer = null;
document.addEventListener('DOMContentLoaded',()=>{
  initNav(); renderCurrentView();
  onEmpresaChange(()=>{ if(!_suppressFullRender) renderCurrentView(); });
});

/* ═══ NAVIGATION ═══ */
function initNav(){
  document.querySelectorAll('#main-nav .nav-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      state.view=btn.dataset.view;
      state.activeBranchId=null;
      document.querySelectorAll('#main-nav .nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const addBtn=$('btn-add-branch');
      if(addBtn) addBtn.style.display = state.view==='portfolio' ? '' : 'none';
      renderCurrentView();
    });
  });
  // Add branch button
  const addBtn=$('btn-add-branch');
  if(addBtn) addBtn.addEventListener('click',showAddBranchModal);
  // BW² Home button
  const homeBtn=$('btn-bw2-home');
  if(homeBtn) homeBtn.addEventListener('click',()=>{
    state.view='bw2home';
    state.activeBranchId=null;
    renderCurrentView();
  });
}

function renderCurrentView(){
  const isBW2Home = state.view === 'bw2home';
  const mainNav = $('main-nav');
  const colorLegend = document.querySelector('.color-legend');
  const appHeader = $('app-header');

  // Show/hide chrome based on whether we're on BW² Home or project views
  if(mainNav) mainNav.style.display = isBW2Home ? 'none' : '';
  if(colorLegend) colorLegend.remove();

  // Hide all views
  ['view-bw2-home','view-portfolio','view-branch','view-consolidated','view-comparador','view-empresa','view-glosario'].forEach(id=>{
    const el=$(id);if(el)el.style.display='none';
  });

  if(isBW2Home) {
    $('view-bw2-home').style.display='block';
    renderBW2Home();
    // Update header for BW² mode — hide empresa logo and brand
    const hInfo=$('enterprise-header-info');
    if(hInfo) hInfo.innerHTML='<span style="color:var(--text-3);font-size:0.85rem">Selecciona una empresa y proyecto</span>';
    const headerLogo = document.querySelector('#app-header .header-logo');
    const headerBrand = document.querySelector('#app-header .header-brand');
    if(headerLogo) headerLogo.style.display = 'none';
    if(headerBrand) headerBrand.style.display = 'none';
    return;
  }

  // Show header elements when inside a project
  const headerLogo = document.querySelector('#app-header .header-logo');
  const headerBrand = document.querySelector('#app-header .header-brand');
  if(headerLogo) headerLogo.style.display = '';
  if(headerBrand) headerBrand.style.display = '';

  const empresa=getEmpresa();
  if(!empresa) { state.view='bw2home'; renderCurrentView(); return; }

  updateEnterpriseHeader(empresa);
  const addBtn=$('btn-add-branch');
  if(addBtn) addBtn.style.display = state.view==='portfolio' ? '' : 'none';

  // Activate correct nav button
  document.querySelectorAll('#main-nav .nav-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.view===state.view);
  });

  if(state.view==='portfolio') { $('view-portfolio').style.display='block'; renderPortfolio(empresa); }
  else if(state.view==='branch'&&state.activeBranchId) { $('view-branch').style.display='block'; renderBranchDetail(empresa); }
  else if(state.view==='consolidated') { $('view-consolidated').style.display='block'; renderConsolidated(empresa); }
  else if(state.view==='comparador') { $('view-comparador').style.display='block'; renderComparador(empresa); }
  else if(state.view==='empresa') { $('view-empresa').style.display='block'; renderEmpresaSettings(empresa); }
  else if(state.view==='glosario') { $('view-glosario').style.display='block'; renderGlosario(); }
  else { $('view-portfolio').style.display='block'; renderPortfolio(empresa); }
}

function updateEnterpriseHeader(empresa){
  const consol = runConsolidation(empresa);
  const emp = getActiveEmpresa();
  const empName = emp ? emp.name : 'Sin Empresa';
  const projName = empresa.name || 'Proyecto';
  const el=$('enterprise-header-info');
  if(el) el.innerHTML=`<span class="ent-name">🏢 ${empName}</span>
    <span class="ent-stat project-badge">📁 ${projName}</span>
    <span class="ent-stat">Capital: ${fmt.m(empresa.totalCapital)}</span>
    <span class="ent-stat">Comprometido: ${fmt.m(consol.capitalCommitted)}</span>
    <span class="ent-stat ${consol.capitalFree<0?'danger':''}">Libre: ${fmt.m(consol.capitalFree)}</span>
    <span class="ent-stat">Sucursales: ${consol.branchCount}</span>
    <span class="ent-stat">Score: ${consol.avgScore}</span>`;
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

/* ═══ BW² HOME VIEW ═══ */
function renderBW2Home(){
  const container=$('bw2-empresas-grid');if(!container)return;
  const empresas = getEmpresas();
  const ws = getWorkspace();

  if(!empresas.length){
    container.innerHTML='<div class="bw2-empty"><p>No hay empresas registradas.</p><p>Crea tu primera empresa para comenzar.</p></div>';
    bindBW2Events();
    return;
  }

  let html='';
  empresas.forEach(emp=>{
    const projCount = emp.proyectos.length;
    const isActive = emp.id===ws.activeEmpresaId;
    const empLogoHtml = emp.logo
      ? `<img src="${emp.logo}" alt="${emp.name}" class="bw2-card-logo">`
      : '<span class="bw2-card-logo-placeholder">🏢</span>';
    html+=`<div class="bw2-empresa-card ${isActive?'active':''}" data-emp-id="${emp.id}">
      <div class="bw2-empresa-header">
        <div class="bw2-empresa-info">
          <div class="bw2-empresa-name-row">${empLogoHtml}<h3 class="bw2-empresa-name">${emp.name}</h3></div>
          <span class="bw2-empresa-meta">${projCount} proyecto${projCount!==1?'s':''} · Creada ${new Date(emp.createdAt).toLocaleDateString('es-MX')}</span>
        </div>
        <div class="bw2-empresa-actions">
          <button class="btn-icon btn-edit-empresa" data-emp-id="${emp.id}" title="Editar empresa">✏️</button>
          <button class="btn-icon btn-delete-empresa" data-emp-id="${emp.id}" title="Eliminar empresa">🗑️</button>
        </div>
      </div>
      <div class="bw2-proyectos-grid">
        ${emp.proyectos.map(proj=>{
          const isProjActive = proj.id===ws.activeProyectoId && isActive;
          const branchCount = (proj.branches||[]).length;
          const projLogoHtml = proj.logo
            ? `<img src="${proj.logo}" alt="${proj.name}" class="bw2-proj-logo">`
            : '<span class="bw2-proj-logo-placeholder">📁</span>';
          return `<div class="bw2-proyecto-card ${isProjActive?'active':''}" data-emp-id="${emp.id}" data-proj-id="${proj.id}">
            <div class="bw2-proj-header">
              <div class="bw2-proj-name-row">${projLogoHtml}<span class="bw2-proj-name">${proj.name}</span></div>
              <div class="bw2-proj-actions">
                <button class="btn-icon btn-edit-proyecto" data-emp-id="${emp.id}" data-proj-id="${proj.id}" title="Editar proyecto">✏️</button>
                <button class="btn-icon btn-delete-proyecto" data-emp-id="${emp.id}" data-proj-id="${proj.id}" title="Eliminar proyecto">🗑️</button>
              </div>
            </div>
            <div class="bw2-proj-stats">
              <span>💰 Capital: ${fmt.m(proj.totalCapital)}</span>
              <span>🏪 ${branchCount} sucursal${branchCount!==1?'es':''}</span>
              <span>👥 ${(proj.partners||[]).length} socio${(proj.partners||[]).length!==1?'s':''}</span>
            </div>
            <button class="btn-open-proyecto" data-emp-id="${emp.id}" data-proj-id="${proj.id}">Abrir Proyecto →</button>
          </div>`;
        }).join('')}
        <div class="bw2-proyecto-card bw2-add-card" data-emp-id="${emp.id}">
          <button class="btn-add-proyecto" data-emp-id="${emp.id}">+ Nuevo Proyecto</button>
        </div>
      </div>
    </div>`;
  });

  container.innerHTML=html;
  bindBW2Events();
}

function bindBW2Events(){
  // Create empresa
  const createBtn = $('btn-create-empresa');
  if(createBtn) createBtn.onclick = ()=>showBW2Modal('crear-empresa');

  // Edit empresa
  document.querySelectorAll('.btn-edit-empresa').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      showBW2Modal('editar-empresa', btn.dataset.empId);
    };
  });

  // Delete empresa
  document.querySelectorAll('.btn-delete-empresa').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const emp = getEmpresaById(btn.dataset.empId);
      if(!emp) return;
      showConfirm(
        `🗑️ ¿Eliminar "${emp.name}"?`,
        `<p>Se eliminarán todos los proyectos y sucursales de esta empresa.</p>`,
        '🗑️ Eliminar',
        ()=>{ removeEmpresa(btn.dataset.empId); renderBW2Home(); }
      );
    };
  });

  // Add proyecto
  document.querySelectorAll('.btn-add-proyecto').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      showBW2Modal('crear-proyecto', btn.dataset.empId);
    };
  });

  // Edit proyecto
  document.querySelectorAll('.btn-edit-proyecto').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      showBW2Modal('editar-proyecto', btn.dataset.empId, btn.dataset.projId);
    };
  });

  // Delete proyecto
  document.querySelectorAll('.btn-delete-proyecto').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const proj = getProyectoById(btn.dataset.empId, btn.dataset.projId);
      if(!proj) return;
      showConfirm(
        `🗑️ ¿Eliminar "${proj.name}"?`,
        `<p>Se eliminarán todas las sucursales de este proyecto.</p>`,
        '🗑️ Eliminar',
        ()=>{ removeProyecto(btn.dataset.empId, btn.dataset.projId); renderBW2Home(); }
      );
    };
  });

  // Open proyecto
  document.querySelectorAll('.btn-open-proyecto').forEach(btn=>{
    btn.onclick = ()=>{
      setActiveProyecto(btn.dataset.empId, btn.dataset.projId);
      state.view='portfolio';
      state.activeBranchId=null;
      renderCurrentView();
    };
  });
}

function showBW2Modal(type, empId, projId){
  // Remove existing modal
  const old = document.querySelector('.bw2-modal-overlay');
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
    ${logoField('Logo del Proyecto', null)}`;
    submitLabel='Crear Proyecto';
  } else if(type==='editar-proyecto'){
    const proj = getProyectoById(empId, projId);
    title='Editar Proyecto';
    fields=`<div class="bw2-form-group">
      <label>Nombre del Proyecto</label>
      <input type="text" id="bw2-input-name" class="input-text" value="${proj?.name||''}" autofocus>
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
    if(!nameVal){showToast('El nombre es requerido','error');return;}

    if(type==='crear-empresa'){
      const newEmp = addEmpresa(nameVal);
      if(pendingLogoDataURL) updateEmpresaData(newEmp.id, {logo: pendingLogoDataURL});
      showToast(`Empresa "${nameVal}" creada`,'success');
    } else if(type==='editar-empresa'){
      updateEmpresaData(empId, {name:nameVal, logo: pendingLogoDataURL});
      showToast('Empresa actualizada','success');
    } else if(type==='crear-proyecto'){
      const cap = parseFloat($('bw2-input-capital')?.value)||2000000;
      const newProj = addProyecto(empId, nameVal);
      if(newProj){
        updateProyecto(empId, newProj.id, {totalCapital:cap, logo: pendingLogoDataURL});
        showToast(`Proyecto "${nameVal}" creado`,'success');
      }
    } else if(type==='editar-proyecto'){
      updateProyecto(empId, projId, {name:nameVal, logo: pendingLogoDataURL});
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

    // Build action buttons based on status
    let actionBtns = `<button class="btn-sm" onclick="window._openBranch('${b.id}')">📊 Ver</button>`;
    actionBtns += `<button class="btn-sm" onclick="window._dupBranch('${b.id}')">📋 Duplicar</button>`;

    if (isPlanned) {
      actionBtns += `<button class="btn-sm success" onclick="window._activateBranch('${b.id}')">✅ Activar</button>`;
      actionBtns += `<button class="btn-sm warn" onclick="window._deleteBranch('${b.id}')">🗑 Eliminar</button>`;
    } else if (isActive) {
      actionBtns += `<button class="btn-sm warn" onclick="window._archiveBranch('${b.id}')">📦 Archivar</button>`;
    } else if (isArchived) {
      actionBtns += `<button class="btn-sm success" onclick="window._restoreBranch('${b.id}')">▶ Restaurar</button>`;
      actionBtns += `<button class="btn-sm danger" onclick="window._deleteBranch('${b.id}')">🗑 Eliminar</button>`;
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
        <div class="branch-kpi"><span class="bk-label" title="Meses para recuperar la inversión (inversión ÷ utilidad mensual estabilizada)">Recuperación</span><span class="bk-value" style="color:${r.paybackSimple&&r.paybackSimple<=36?'var(--green)':r.paybackSimple&&r.paybackSimple<=48?'var(--yellow)':'var(--red)'}">${r.paybackSimple?Math.round(r.paybackSimple)+' meses':'∞'}</span></div>
        <div class="branch-kpi"><span class="bk-label" title="Calificación de viabilidad: 0-100">Calificación</span><span class="bk-value" style="color:${color}">${score}/100</span></div>
      </div>`:'<div class="branch-kpis"><span style="color:var(--text-3)">Sin datos</span></div>'}
      <div class="branch-actions">${actionBtns}</div>
    </div>`;
  }).join('');
}

// Global action handlers
window._openBranch = (id)=>{ state.view='branch'; state.activeBranchId=id; state.branchOverrides={}; renderCurrentView(); selectNav('branch'); };
window._dupBranch = (id)=>{ dupBranch(id); };
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

function selectNav(view){ document.querySelectorAll('#main-nav .nav-btn').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);}); }

/* ═══ ADD BRANCH MODAL ═══ */
function showAddBranchModal(){
  const modal=$('modal-add-branch');if(!modal)return;
  modal.style.display='flex';
  $('modal-add-format').value='express';
  $('modal-add-name').value='';
  $('modal-add-colonia').value='';
}
window._closeModal=()=>{const m=$('modal-add-branch');if(m)m.style.display='none';};
window._confirmAddBranch=()=>{
  const format=$('modal-add-format').value;
  const name=$('modal-add-name').value||`Sucursal ${getEmpresa().branches.length+1}`;
  const colonia=$('modal-add-colonia').value;
  addBranch(format,name,colonia);
  window._closeModal();
};

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
      // Activate Ubicación tab
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.detail-panel').forEach(p => p.style.display = 'none');
      const ubicTab = document.querySelector('[data-panel="branch-location"]');
      if (ubicTab) { ubicTab.classList.add('active'); }
      const ubicPanel = $('branch-location');
      if (ubicPanel) { ubicPanel.style.display = 'block'; ubicPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  }
  // Format selector
  document.querySelectorAll('#branch-format-selector .seg-btn').forEach(btn=>{btn.classList.toggle('active',btn.dataset.format===branch.format);});
  // Scenario selector
  document.querySelectorAll('#branch-scenario-selector .seg-btn').forEach(btn=>{btn.classList.toggle('active',btn.dataset.scenario===branch.scenarioId);});
  // Royalty
  const rg=$('branch-royalty-group');
  if(rg) rg.style.display=branch.format==='super'?'block':'none';
  // Royalty active state
  const currentRoyalty = branch.overrides?.royaltyMode || 'variable_2_5';
  document.querySelectorAll('#branch-royalty-selector .seg-btn').forEach(btn=>{btn.classList.toggle('active',btn.dataset.royalty===currentRoyalty);});
  // Timeline selector active state
  const currentPreOpen = String(branch.overrides?.preOpenMonths || 0);
  document.querySelectorAll('#branch-timeline-selector .seg-btn').forEach(btn=>{btn.classList.toggle('active',btn.dataset.preopen===currentPreOpen);});

  updateBranchKPIBar(r);
  renderBranchResumen(r);
  renderBranchPnL(r,model,overrides);
  renderBranchStress(r,model,overrides);
  updateBranchAuditBadges(model);
  renderBranchEditPanel(branch,model);
  renderBranchLocation(branch);
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
  document.querySelectorAll('#branch-scenario-selector .seg-btn').forEach(btn=>{
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
    });
  });
  // Colonia autocomplete — geocoding suggestions
  const ci=$('branch-colonia-input');
  const sugBox=$('colonia-suggestions');
  const colStatus=$('colonia-status');
  let coloniaDebounce=null;
  if(ci){
    ci.addEventListener('input',()=>{
      clearTimeout(coloniaDebounce);
      const q=ci.value.trim();
      if(q.length<3){sugBox.classList.remove('open');sugBox.innerHTML='';if(colStatus)colStatus.innerHTML='';return;}
      if(colStatus)colStatus.innerHTML='<span class="searching">🔍 Buscando colonias...</span>';
      coloniaDebounce=setTimeout(async()=>{
        try{
          const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q+', México')}&format=json&limit=6&addressdetails=1&countrycodes=mx`;
          const res=await fetch(url,{headers:{'Accept-Language':'es'}});
          const data=await res.json();
          if(!data.length){
            sugBox.innerHTML='<div class="colonia-suggestion"><span class="sug-main">Sin resultados</span><div class="sug-detail">Intenta con otro nombre de colonia o ciudad</div></div>';
            sugBox.classList.add('open');
            if(colStatus)colStatus.innerHTML='<span class="no-results">No se encontraron resultados</span>';
            return;
          }
          sugBox.innerHTML=data.map((r,i)=>{
            const name=r.address?.suburb||r.address?.neighbourhood||r.address?.city||r.display_name.split(',')[0];
            const detail=[r.address?.city||r.address?.town,r.address?.state].filter(Boolean).join(', ');
            return `<div class="colonia-suggestion" data-idx="${i}" data-name="${name}" data-full="${r.display_name}" data-lat="${r.lat}" data-lon="${r.lon}">
              <div class="sug-main">${name}</div>
              <div class="sug-detail">${detail||r.display_name}</div>
            </div>`;
          }).join('');
          sugBox.classList.add('open');
          if(colStatus)colStatus.innerHTML='<span class="searching">↓ Selecciona una ubicación</span>';
          // Click handlers for suggestions
          sugBox.querySelectorAll('.colonia-suggestion').forEach(s=>{
            s.addEventListener('click',()=>{
              const name=s.dataset.name;
              const full=s.dataset.full;
              ci.value=name;
              sugBox.classList.remove('open');
              if(colStatus)colStatus.innerHTML=`<span class="validated">✅ ${name}</span>`;
              if(state.activeBranchId){
                updateBranch(state.activeBranchId,{colonia:name,coloniaFull:full});
                // Sync to location study + auto-run
                const locInput=$('loc-address-input');
                if(locInput) locInput.value=name;
                const studyBtn=$('btn-run-location-study');
                if(studyBtn) studyBtn.click();
              }
            });
          });
        }catch(e){
          if(colStatus)colStatus.innerHTML='<span class="no-results">Error de conexión</span>';
        }
      },400);
    });
    // Close suggestions on outside click
    document.addEventListener('click',(e)=>{if(!e.target.closest('.colonia-autocomplete'))sugBox.classList.remove('open');});
  }
  // Royalty selector
  document.querySelectorAll('#branch-royalty-selector .seg-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!state.activeBranchId)return;
      updateBranchOverrides(state.activeBranchId,{royaltyMode:btn.dataset.royalty});
    });
  });
  // Advanced panel toggle
  // (branch-adv-toggle removed — now using edit-section toggles)
  // Back button
  const bb=$('btn-back-portfolio');
  if(bb) bb.addEventListener('click',()=>{state.view='portfolio';state.activeBranchId=null;renderCurrentView();selectNav('portfolio');});
  // Branch tabs
  document.querySelectorAll('.branch-tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.branch-tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.branch-tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');$(`btab-${btn.dataset.tab}`).classList.add('active');
    });
  });
  const tb=$('branch-toggle-pnl');
  if(tb) tb.addEventListener('click',()=>{const t=$('branch-pnl-table-full');t.classList.toggle('collapsed');tb.textContent=t.classList.contains('collapsed')?'Expandir ▼':'Colapsar ▲';});
});

function updateBranchKPIBar(r){
  const be=r.breakEvenPctCapacity, net=r.perPartnerMonthly[0]?.monthlyIncome||0;
  const cf=r.months[Math.min(35,r.months.length-1)]?.cumulativeCashFlow||0;
  const pm=r.paybackMetrics;
  const fmtRange=(min,max)=>min!=null&&max!=null?`${min.toFixed(0)}–${max.toFixed(0)} m`:'∞';
  const fmtMo2=(m,ext)=>m!=null?(m+(ext?' (est.)':''))+' m':'∞';
  const pbSimpleMid=pm.simple.min!=null?(pm.simple.min+pm.simple.max)/2:null;
  const pbAvgMid=pm.avg5y.min!=null?(pm.avg5y.min+pm.avg5y.max)/2:null;
  const chips=[
    {l:'Pto. Equilibrio',v:fmt.m(r.breakEvenRevenue),d:fmt.pi(be)+' cap.',s:be<0.5?'success':be<0.7?'warning':'danger',t:'Venta mínima mensual para cubrir costos'},
    {l:'Ganancia/mes',v:fmt.m(r.avgMonthlyEBITDA),d:'Margen '+fmt.p(r.mc),s:r.avgMonthlyEBITDA>0?'success':'danger',t:'Ganancia mensual antes de impuestos'},
    {l:'Recup. Simple',v:fmtRange(pm.simple.min,pm.simple.max),d:'Inversión / Utilidad',s:pbSimpleMid&&pbSimpleMid<=24?'success':pbSimpleMid&&pbSimpleMid<=36?'warning':'danger',t:'Meses para recuperar la inversión (sin rampa)'},
    {l:'Recuperación',v:fmtMo2(pm.rampa.month,pm.rampa.extrapolated),d:'Flujo acum. real',s:pm.rampa.month&&pm.rampa.month<=36?'success':pm.rampa.month&&pm.rampa.month<=48?'warning':'danger',t:'Meses reales para recuperar la inversión'},
    {l:'Operativo +',v:pm.beOperativo.month?pm.beOperativo.month+' m':'∞',d:'Utilidad > 0 sost.',s:pm.beOperativo.month&&pm.beOperativo.month<=12?'success':pm.beOperativo.month&&pm.beOperativo.month<=18?'warning':'danger',t:'Mes en que la sucursal empieza a ganar'},
    {l:'Calificación',v:r.viabilityScore+'/100',d:r.viabilityScore>=60?'VIABLE':'FRÁGIL',s:r.viabilityScore>=60?'success':r.viabilityScore>=40?'warning':'danger',t:'Calificación general de viabilidad'},
  ];
  $('branch-kpi-strip').innerHTML=chips.map(k=>`<div class="kpi-chip" data-status="${k.s}"><div class="kpi-chip-label" title="${k.t}">${k.l}</div><div class="kpi-chip-value">${k.v}</div><div class="kpi-chip-detail">${k.d}</div></div>`).join('');
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
  if(!alerts.length){el.innerHTML='<div class="alert-item success"><span class="alert-icon">✅</span><div class="alert-content"><div class="alert-label">Sin alertas</div></div></div>';return;}
  el.innerHTML=alerts.map(a=>`<div class="alert-item ${a.severity}"><span class="alert-icon">${a.icon}</span><div class="alert-content"><div class="alert-label">${a.label}</div><div class="alert-message">${a.message}</div></div></div>`).join('');
}

/* ─── BRANCH RESUMEN ─── */
function renderBranchResumen(r){
  const color=r.viabilityScore>=60?'#34d399':r.viabilityScore>=40?'#fbbf24':'#f87171';
  const label=r.viabilityScore>=80?'EXCELENTE':r.viabilityScore>=60?'VIABLE':r.viabilityScore>=40?'FRÁGIL':'NO VIABLE';
  $('branch-gauge').innerHTML=`<div class="viability-gauge"><div class="gauge-score" style="color:${color}">${r.viabilityScore}</div><div class="gauge-label" style="color:${color}">${label}</div><div class="gauge-bar"><div class="gauge-fill" style="width:${r.viabilityScore}%;background:${color}"></div></div></div>`;
  const cl=generateChecklist(r);
  $('branch-checklist').innerHTML=cl.map(c=>`<div class="checklist-item"><span class="check-icon">${c.pass?'✅':'❌'}</span><span class="check-label">${c.item}</span><span class="check-detail">${c.detail}</span></div>`).join('');
  dc('branch-cashflow');const ctx=$('chart-branch-cashflow');if(!ctx)return;
  charts['branch-cashflow']=new Chart(ctx,{type:'line',data:{labels:r.months.map(m=>'M'+m.month),datasets:[{label:'Acumulado',data:r.months.map(m=>m.cumulativeCashFlow),borderColor:'#4d7cfe',backgroundColor:'rgba(77,124,254,0.1)',fill:true,tension:0.3,pointRadius:0,borderWidth:2.5},{label:'Mensual',data:r.months.map(m=>m.cashFlow),type:'bar',backgroundColor:r.months.map(m=>m.cashFlow>=0?'rgba(52,211,153,0.35)':'rgba(248,113,113,0.3)'),borderRadius:2}]},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt.m(c.parsed.y)}`}}},scales:{y:{ticks:{callback:v=>fmt.mk(v)}}}}});
  renderAlerts(evaluateAlerts(r),'branch-alerts');
}

/* ─── BRANCH P&L ─── */
function renderBranchPnL(r,model,overrides){
  $('branch-fin-kpis').innerHTML=[
    kc('ROI 12m',r.roi12.toFixed(1)+'%','Año 1',r.roi12>0?'success':'danger'),
    kc('ROI 36m',r.roi36.toFixed(1)+'%','3 años',r.roi36>60?'success':r.roi36>0?'warning':'danger'),
    kc('VPN',fmt.m(r.npv),'WACC 12%',r.npv>0?'success':'danger'),
    kc('TIR',r.irr!=null?(r.irr*100).toFixed(1)+'%':'N/A','Interna',r.irr&&r.irr>0.12?'success':'danger'),
  ].join('');
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
  $('branch-annual-table').innerHTML=`<table class="data-table"><thead><tr><th>Año</th><th class="num">Ingresos</th><th class="num">Ut.Neta</th><th class="num">Flujo</th></tr></thead><tbody>${ys.map((y,i)=>`<tr><td>Año ${i+1}</td><td class="num">${fmt.m(as[y].revenue)}</td><td class="num ${as[y].netIncome>=0?'positive':'negative'}">${fmt.m(as[y].netIncome)}</td><td class="num ${as[y].cashFlow>=0?'positive':'negative'}">${fmt.m(as[y].cashFlow)}</td></tr>`).join('')}</tbody></table>`;
  const cols=['Mes','Venta','COGS','Ut.Br','CF','CV','EBITDA','Imp','Ut.Net','Acum'];
  $('branch-pnl-table-full').innerHTML=`<table class="data-table"><thead><tr>${cols.map(c=>`<th class="${c!=='Mes'?'num':''}">${c}</th>`).join('')}</tr></thead><tbody>${r.months.map(m=>`<tr><td>M${m.month}</td><td class="num">${fmt.m(m.revenue)}</td><td class="num">${fmt.m(m.cogs)}</td><td class="num">${fmt.m(m.grossProfit)}</td><td class="num">${fmt.m(m.totalFixedCosts)}</td><td class="num">${fmt.m(m.variableCosts)}</td><td class="num ${m.ebitda>=0?'positive':'negative'}">${fmt.m(m.ebitda)}</td><td class="num">${fmt.m(m.taxes)}</td><td class="num ${m.netIncome>=0?'positive':'negative'}">${fmt.m(m.netIncome)}</td><td class="num ${m.cumulativeCashFlow>=0?'positive':'negative'}">${fmt.m(m.cumulativeCashFlow)}</td></tr>`).join('')}</tbody></table>`;
}

/* ─── BRANCH STRESS ─── */
function renderBranchStress(r,model,overrides){
  let stress;try{stress=calcStress(state.activeBranchId?getBranch(state.activeBranchId).format:'express',overrides);}catch(e){stress={maxRent:0,fragilityPct:1,viableCells:0,totalCells:1};}
  $('branch-stress-kpis').innerHTML=[
    kc('Renta Máx.',fmt.m(stress.maxRent),`Actual: ${fmt.m(overrides.rent||model.fixedCosts.rent)}`,stress.maxRent>(overrides.rent||model.fixedCosts.rent)*1.2?'success':'warning'),
    kc('Venta Mín.',fmt.m(r.breakEvenRevenue),fmt.pi(r.breakEvenPctCapacity)+' cap.',r.breakEvenPctCapacity<0.7?'success':'danger'),
    kc('Fragilidad',fmt.pi(stress.fragilityPct),`${stress.viableCells}/${stress.totalCells}`,stress.fragilityPct<0.3?'success':stress.fragilityPct<0.5?'warning':'danger'),
  ].join('');
  let sensitivity;try{sensitivity=runSensitivity(getBranch(state.activeBranchId).format,overrides);}catch(e){sensitivity=[];}
  dc('branch-tornado');const ctx=$('chart-branch-tornado');if(ctx&&sensitivity.length){
    charts['branch-tornado']=new Chart(ctx,{type:'bar',data:{labels:sensitivity.map(s=>s.label),datasets:[{label:'+20%',data:sensitivity.map(s=>s.ebitdaDeltaUp),backgroundColor:sensitivity.map(s=>s.ebitdaDeltaUp>=0?'rgba(52,211,153,0.6)':'rgba(248,113,113,0.5)'),borderRadius:3},{label:'−20%',data:sensitivity.map(s=>s.ebitdaDeltaDown),backgroundColor:sensitivity.map(s=>s.ebitdaDeltaDown>=0?'rgba(52,211,153,0.4)':'rgba(248,113,113,0.35)'),borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt.m(c.parsed.x)}`}}},scales:{x:{ticks:{callback:v=>fmt.mk(v)}}}}});
  }
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
              <input type="range" class="inv-slider" id="inv-range-slider" min="${invMin}" max="${invMax}" step="1000" value="${invCurrent}">
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
    vcEl.innerHTML = [
      editField('COGS (Inventario)', 'vc.cogs', (vc.cogs ?? defVC.cogs) * 100, defVC.cogs * 100, 0.5, '%', 40, 80, 'Costo de la mercancía vendida como % de las ventas. ≈59% para farmacia'),
      editField('Comisión Venta', 'vc.comVenta', (vc.comVenta ?? defVC.comVenta) * 100, defVC.comVenta * 100, 0.1, '%', 0, 10, 'Comisión pagada al equipo de ventas sobre ingresos'),
      editField('Merma', 'vc.merma', (vc.merma ?? defVC.merma) * 100, defVC.merma * 100, 0.1, '%', 0, 5, 'Pérdida por caducidad, robo o daño del inventario'),
      editField('Publicidad', 'vc.pubDir', (vc.pubDir ?? defVC.pubDir) * 100, defVC.pubDir * 100, 0.5, '%', 0, 10, 'Marketing digital, volanteo, señalización y promociones'),
      editField('Regalía', 'vc.regalia', (vc.regalia ?? defVC.regalia) * 100, defVC.regalia * 100, 0.1, '%', 0, 10, 'Pago mensual a la franquicia por uso de marca (% sobre ventas)'),
      editField('Bancario', 'vc.bancario', (vc.bancario ?? defVC.bancario) * 100, defVC.bancario * 100, 0.1, '%', 0, 5, 'Comisión por pagos con tarjeta (terminal bancaria)'),
    ].join('');
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
          // If number input changed, sync slider (clamped to slider max)
          const sliderMax = parseFloat(invSlider.max);
          invSlider.value = Math.min(val, sliderMax);
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
  const statusEl = $('loc-status');

  // Pre-fill address
  if (addrInput) addrInput.value = study?.address || branch.colonia || '';
  if (statusEl) statusEl.innerHTML = '';

  // Button handler
  const btn = $('btn-run-location-study');
  if (btn) {
    btn.onclick = async () => {
      const query = addrInput.value.trim();
      if (!query) { statusEl.innerHTML = '<span class="loc-error">Ingresa una colonia o dirección</span>'; return; }
      btn.disabled = true;
      btn.textContent = '⏳ Consultando...';
      statusEl.innerHTML = '<span class="loc-loading">Geocodificando → Buscando establecimientos → Calculando scores...</span>';
      try {
        const result = await runLocationStudy(query);
        updateBranchLocation(branch.id, result);
        renderLocationResults(result);
        if (result.errors.length) {
          statusEl.innerHTML = '<span class="loc-warning">⚠️ Estudio parcial: ' + result.errors.map(e => e.error).join('; ') + '</span>';
        } else {
          statusEl.innerHTML = '<span class="loc-success">✅ Estudio completo — ' + new Date(result.lastUpdated).toLocaleString('es-MX') + '</span>';
        }
      } catch (e) {
        statusEl.innerHTML = '<span class="loc-error">❌ Error: ' + e.message + '</span>';
      }
      btn.disabled = false;
      btn.textContent = '🔍 Actualizar estudio';
    };
  }

  // Toggle detail
  const togBtn = $('loc-toggle-detail');
  if (togBtn) { togBtn.onclick = () => { const t = $('loc-nearby-detail'); t.classList.toggle('collapsed'); togBtn.textContent = t.classList.contains('collapsed') ? 'Expandir ▼' : 'Colapsar ▲'; }; }

  // Render saved study
  if (study && study.coordinates) {
    renderLocationResults(study);
    if (statusEl) statusEl.innerHTML = '<span class="loc-success">📍 Último estudio: ' + new Date(study.lastUpdated).toLocaleString('es-MX') + '</span>';
  } else {
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

  // ── RADAR CHART (11 factors) ──
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
      <div class="loc-indicator"><span class="loc-ind-label">💡 Escenario sugerido</span><span class="loc-ind-value">${sug.label} (factor ${sug.factor}x)</span><span class="loc-ind-source">⚡ Score ponderado de 11 factores</span></div>
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
        <div class="loc-source-item"><span class="loc-src-badge derivado">⚡</span> Scoring: <strong>11 factores ponderados v2</strong> — modelo propio, no dato oficial</div>
      </div>
      ${study.nearby?.note ? '<p class="loc-note">⚠️ ' + study.nearby.note + '</p>' : ''}
      ${study.errors?.length ? '<p class="loc-note">⚠️ Errores parciales: ' + study.errors.map(e => e.step + ': ' + e.error).join(', ') + '</p>' : ''}
      <p class="loc-note">📅 Estudio v${study.version || 1} — ${new Date(study.lastUpdated).toLocaleString('es-MX')}</p>
    `;
  }
}

/* ═══ CONSOLIDATED VIEW ═══ */
function renderConsolidated(empresa){
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
  $('consol-kpis').innerHTML=[
    kc('Inversión Total',fm(consol.totalInvestment),`${consol.branchCount} sucursales`,'warning'),
    kc('Capital Libre',fm(consol.capitalFree),fmt.pi(consol.capitalFree/empresa.totalCapital)+' del total',consol.capitalFree>0?'success':'danger'),
    kc('Ganancia Consolidada',fm(consol.avgMonthlyEBITDA),'Mensual estabilizado',consol.avgMonthlyEBITDA>0?'success':'danger'),
    kc('Recuperación Empresa',consol.paybackMonth?consol.paybackMonth+' meses':'∞','Flujo acumulado',consol.paybackMonth&&consol.paybackMonth<=36?'success':consol.paybackMonth&&consol.paybackMonth<=48?'warning':'danger'),
    kc('Calificación Promedio',consol.avgScore+'/100','Portafolio',consol.avgScore>=60?'success':consol.avgScore>=40?'warning':'danger'),
    kc('Ganancia Neta 5 Años',fm(consol.totalNet60),'Acumulado 60 meses',consol.totalNet60>0?'success':'danger'),
  ].join('');

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
      state.view = 'branch-detail';
      state.activeBranchId = btn.dataset.bid;
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
      kc('Ganancia/mes', fmt.m(consol.avgMonthlyNet), `${consol.branchCount} suc. activas`, consol.avgMonthlyNet >= 0 ? 'good' : 'bad'),
      kc('Recuperación Emp.', consol.paybackMonth ? consol.paybackMonth + ' meses' : '∞', 'Todas las sucursales', consol.paybackMonth && consol.paybackMonth <= 36 ? 'good' : 'warn'),
      kc('Calificación', consol.avgScore + '/100', 'Promedio portafolio', consol.avgScore >= 70 ? 'good' : consol.avgScore >= 50 ? 'warn' : 'bad')
    ].join('');
  }

  // ── Form fields ──
  $('emp-name').value = empresa.name || '';
  const projEl = $('emp-project-name');
  if (projEl) projEl.value = empresa.projectName || 'FarmaTuya';
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
      <td><button class="btn-sm warn" onclick="window._removePartner('${p.id}')">🗑</button></td>
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
      if (field === 'capital') val = parseFloat(val) || 0;
      else if (field === 'equity') val = (parseFloat(val) || 0) / 100;
      updatePartner(pid, { [field]: val });
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
    updateEmpresa({
      name:$('emp-name').value,
      projectName:$('emp-project-name')?.value || 'FarmaTuya',
      totalCapital:parseFloat($('emp-capital').value)||0,
      corporateReserve:parseFloat($('emp-reserve').value)||0,
      corporateExpenses:parseFloat($('emp-corp-expenses')?.value)||0
    });
    saveBtn.textContent='✅ Guardado';
    setTimeout(()=>saveBtn.textContent='💾 Guardar Cambios',1500);
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
