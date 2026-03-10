// ==========================================
// 1. APPWRITE INITIALIZATION
// ==========================================
const { Client, Account, Databases, ID, Query } = Appwrite;
const client = new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('69abc18f00304e23f121');             
const account = new Account(client);
const databases = new Databases(client);
const DB_ID = '69abd4a8000d0b820e8b'; 

// ==========================================
// 2. STATE & GLOBALS
// ==========================================
let isAdmin = false; 
let db = { lists: [], cats: [], orgs: [] }; 
let editingId = null; 
let searchTimer = null; 
let copyClickState = {}; 
let pendingConflicts = []; 
let draggedRow = null;
let metaDragId = null; 
let metaDragType = null; 

// ==========================================
// 3. STARTUP & CLOUD FETCHING
// ==========================================
async function initApp() {
    initTheme(); initBulkRows(20); 
    try { await account.get(); isAdmin = true; updateUIForAdmin(); } catch (e) { isAdmin = false; }
    await fetchCloudData();
    client.subscribe([`databases.${DB_ID}.collections.organizations.documents`, `databases.${DB_ID}.collections.lists.documents`, `databases.${DB_ID}.collections.categories.documents`], response => fetchCloudData());
    document.getElementById('bulk-tbody').addEventListener('paste', handleGridPaste);
    document.addEventListener('keydown', (e) => { if(e.key === "Escape") document.querySelectorAll('.modal').forEach(m => closeModal(m.id)); });
}

async function fetchCloudData() {
    try {
        document.getElementById('stats-count').innerText = "Syncing...";
        const [listsRes, catsRes, orgsRes] = await Promise.all([ databases.listDocuments(DB_ID, 'lists', [Query.limit(100)]), databases.listDocuments(DB_ID, 'categories', [Query.limit(100)]), databases.listDocuments(DB_ID, 'organizations', [Query.limit(2000)]) ]);
        
        db.lists = listsRes.documents.map(d => ({ id: d.$id, name: d.name, order: d.order || 0 }));
        db.cats = catsRes.documents.map(d => ({ id: d.$id, name: d.name, order: d.order || 0 }));
        db.orgs = orgsRes.documents.map(d => ({ id: d.$id, name: d.name, listIds: d.listIds || [], catIds: d.catIds || [], tags: JSON.parse(d.tags || '{}'), orderData: JSON.parse(d.starredIn || '{}'), createdAt: new Date(d.$createdAt).getTime() }));

        initDropdowns(); renderTable();
        if (document.getElementById('meta-modal') && !document.getElementById('meta-modal').classList.contains('hidden')) renderMetaList();
    } catch(e) {}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp); else initApp();

// ==========================================
// 4. AUTHENTICATION
// ==========================================
async function login() { try { await account.createEmailPasswordSession(document.getElementById('login-email').value, document.getElementById('login-pass').value); isAdmin = true; updateUIForAdmin(); closeModal('login-modal'); } catch (e) { showToast("Login failed", "error"); } }
function updateUIForAdmin() { document.getElementById('admin-panel').classList.remove('hidden'); document.getElementById('login-trigger').classList.add('hidden'); document.getElementById('add-btn').classList.remove('hidden'); document.querySelectorAll('.admin-only').forEach(el=>el.classList.remove('hidden')); renderTable(); }
async function logout(){ try { await account.deleteSession('current'); } catch(e){} location.reload(); }

// ==========================================
// 5. MASTER DATA SCRUBBERS
// ==========================================
function ensureHandle(val) { if (!val) return ''; let str = val.toString().trim(); if (str === '-' || str === '@-' || str === '@' || str.toLowerCase() === 'na' || str.toLowerCase() === 'none') return ''; let clean = str.replace(/^@+/, '').trim(); if (clean.length === 0 || clean === '-') return ''; return '@' + clean; }
function ensureLink(val) { if (!val) return ''; let str = val.toString().trim(); if (str === '-' || str.toLowerCase() === 'na' || str.toLowerCase() === 'none') return ''; return str; }

// ==========================================
// 6. DEEP CONFLICT DETECTION ENGINE
// ==========================================
function detectConflict(newOrgObj, skipId, arrayToCheck = db.orgs) {
    const parseTags = (t) => { if (!t) return {}; if (typeof t === 'object') return t; try { return JSON.parse(t); } catch(e) { return {}; } };
    const nt = parseTags(newOrgObj.tags);
    for (let org of arrayToCheck) {
        if (skipId && (org.id === skipId || org.$id === skipId)) continue;
        const ot = parseTags(org.tags); let matchedFields = []; 
        const isConflict = (a, b) => {
            if (!a || !b) return false;
            let strA = a.toString().toLowerCase(); let strB = b.toString().toLowerCase();
            const cleanStr = (s) => s.replace(/^(https?:\/\/)?(www\.)?/,'').replace(/[@\/\-\s]/g, '').trim();
            strA = cleanStr(strA); strB = cleanStr(strB);
            if (strA.length < 2 || strB.length < 2) return false;
            const ignore = ['na', 'none', 'null', 'nil', 'blank', 'visitsite', 'visit', 'http', 'https', 'undefined'];
            if (ignore.includes(strA) || ignore.includes(strB)) return false;
            return strA === strB;
        };
        if (isConflict(nt.twitter, ot.twitter)) matchedFields.push('Twitter');
        if (isConflict(nt.instagram, ot.instagram)) matchedFields.push('Instagram');
        if (isConflict(nt.linkedin?.link, ot.linkedin?.link) || isConflict(nt.linkedin?.val, ot.linkedin?.val)) matchedFields.push('LinkedIn');
        if (isConflict(nt.facebook?.link, ot.facebook?.link) || isConflict(nt.facebook?.val, ot.facebook?.val)) matchedFields.push('Facebook');
        if (matchedFields.length > 0) return { org: org, matchedOn: matchedFields };
    } return null; 
}

function processConflictQueue() {
    if (pendingConflicts.length === 0) { closeModal('conflict-modal'); fetchCloudData(); return; }
    const current = pendingConflicts[0]; const matchText = current.matchedOn.join(", "); 
    document.getElementById('conflict-details').innerHTML = `<div style="margin-bottom:8px;"><strong>Attempting to save:</strong> <span style="color:var(--primary-color)">${current.newObj.name}</span></div><div style="margin-bottom:8px;"><strong>Matches Existing Org:</strong> <span style="color:var(--danger-color)">${current.existingOrg.name}</span> <br><small style="color:#666;">(Admin ID: ${current.existingOrg.id || current.existingOrg.$id})</small></div><div style="padding-top:8px; border-top:1px solid var(--border-color);"><strong><i class="fa-solid fa-link"></i> Conflict Found In:</strong> <span style="color:var(--danger-color); font-weight:bold;">${matchText}</span></div>`;
    openModal('conflict-modal');
}

async function resolveConflict(action) {
    const current = pendingConflicts.shift(); 
    const existingId = current.existingOrg.id || current.existingOrg.$id;
    const existingListIds = current.existingOrg.listIds || [];
    const newListIds = current.newObj.listIds || [];
    const combinedLists = [...new Set([...existingListIds, ...newListIds])];
    showToast("Resolving...");
    try {
        if (current.isEdit && current.editOldId) { try { await databases.deleteDocument(DB_ID, 'organizations', current.editOldId); } catch(e){} }
        if (action === 'overwrite') { await databases.updateDocument(DB_ID, 'organizations', existingId, { name: current.newObj.name, listIds: combinedLists, catIds: current.newObj.catIds, tags: typeof current.newObj.tags === 'string' ? current.newObj.tags : JSON.stringify(current.newObj.tags) });
        } else if (action === 'delete') { await databases.updateDocument(DB_ID, 'organizations', existingId, { listIds: combinedLists }); }
    } catch (e) { showToast("Error resolving conflict", "error"); }
    processConflictQueue(); 
}

// ==========================================
// 7. CRUD OPERATIONS
// ==========================================
async function saveOrg(){ 
    const n = document.getElementById('edit-name').value.trim(); if(!n) return showToast("Name required", "error");
    const l = Array.from(document.querySelectorAll('#check-lists input:checked')).map(c=>c.value); if(!l.includes('master'))l.push('master'); 
    const c = Array.from(document.querySelectorAll('#check-cats input:checked')).map(x=>x.value); 
    const tags = { twitter: ensureHandle(document.getElementById('tag-twitter').value), instagram: ensureHandle(document.getElementById('tag-instagram').value), linkedin:{val:ensureHandle(document.getElementById('tag-linkedin-val').value), link:ensureLink(document.getElementById('tag-linkedin-link').value)}, facebook:{val:ensureHandle(document.getElementById('tag-facebook-val').value), link:ensureLink(document.getElementById('tag-facebook-link').value)}, website:{val:ensureLink(document.getElementById('tag-website-link').value) ? "Visit Site" : "", link:ensureLink(document.getElementById('tag-website-link').value)} }; 
    const oldOrderData = editingId ? db.orgs.find(o=>o.id === editingId).orderData : {};
    const dataObj = { name: n, listIds: l, catIds: c, tags: JSON.stringify(tags), starredIn: JSON.stringify(oldOrderData) };

    const conflictData = detectConflict(dataObj, editingId, db.orgs);
    if (conflictData) { pendingConflicts = [{ newObj: dataObj, existingOrg: conflictData.org, matchedOn: conflictData.matchedOn, isEdit: !!editingId, editOldId: editingId }]; closeModal('org-modal'); processConflictQueue(); return; }
    try { if(editingId) await databases.updateDocument(DB_ID, 'organizations', editingId, dataObj); else await databases.createDocument(DB_ID, 'organizations', ID.unique(), dataObj); closeModal('org-modal'); } catch (e) { showToast("Error saving", "error"); }
}

async function analyzeBulkUpload() {
    const rows = document.querySelectorAll('.bulk-row'); const targetList = document.getElementById('bulk-list').value; const targetListIds = ['master']; if(targetList && targetList !== 'master') targetListIds.push(targetList);
    pendingConflicts = []; let cleanOrgs = []; let baseUploadTime = Date.now();
    for(let i=0; i<rows.length; i++) {
        const inputs = rows[i].querySelectorAll('input'); const name = inputs[0].value.trim(); if(!name) continue;
        const tags = { twitter: ensureHandle(inputs[1].value), linkedin: { val: ensureHandle(inputs[2].value), link: ensureLink(inputs[3].value) }, facebook: { val: ensureHandle(inputs[4].value), link: ensureLink(inputs[5].value) }, instagram: ensureHandle(inputs[6].value), website: { val: ensureLink(inputs[7].value) ? "Visit Site" : "", link: ensureLink(inputs[7].value) } };
        let initialOrder = {}; targetListIds.forEach(l => initialOrder[l] = baseUploadTime + i);
        const dataObj = { name: name, listIds: [...targetListIds], catIds: [], tags: JSON.stringify(tags), starredIn: JSON.stringify(initialOrder) };
        let conflictData = detectConflict(dataObj, null, db.orgs); if (!conflictData) conflictData = detectConflict(dataObj, null, cleanOrgs);
        if (conflictData) { pendingConflicts.push({ newObj: dataObj, existingOrg: conflictData.org, matchedOn: conflictData.matchedOn, isEdit: false }); } else { dataObj.id = "temp_" + i; cleanOrgs.push(dataObj); }
    }
    closeModal('bulk-modal'); if (cleanOrgs.length > 0) showToast(`Uploading ${cleanOrgs.length} clean records... please wait.`);
    for(let org of cleanOrgs) { try { delete org.id; const created = await databases.createDocument(DB_ID, 'organizations', ID.unique(), org); db.orgs.push({ id: created.$id, name: created.name, listIds: created.listIds, tags: JSON.parse(created.tags), orderData: JSON.parse(created.starredIn) }); } catch(e) {} }
    if (pendingConflicts.length > 0) processConflictQueue(); else { showToast("Bulk import complete!"); fetchCloudData(); }
}

async function deleteOrg(){ if(editingId && confirm('Delete permanently?')){ try { await databases.deleteDocument(DB_ID, 'organizations', editingId); closeModal('org-modal'); } catch(e) { showToast("Delete failed", "error"); } } }
async function addMeta(t, i){ const n = document.getElementById(i).value; if(!n) return; try { await databases.createDocument(DB_ID, t, ID.unique(), { name: n, order: Date.now() }); document.getElementById(i).value=''; } catch(e) {} }
async function removeMeta(t, id){ if(!confirm("Delete this list/category?")) return; try { await databases.deleteDocument(DB_ID, t, id); } catch(e) {} }

// ==========================================
// 8. ORGANIZATION DRAG AND DROP
// ==========================================
function handleDragStart(e) { if (!isAdmin || document.getElementById('search-bar').value.trim() !== '') return e.preventDefault(); draggedRow = e.target.closest('tr'); draggedRow.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', draggedRow.dataset.id); }
function handleDragOver(e) { if (!isAdmin || !draggedRow) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const tbody = document.getElementById('table-body'); const afterElement = getDragAfterElement(tbody, e.clientY); if (afterElement == null) { tbody.appendChild(draggedRow); } else { tbody.insertBefore(draggedRow, afterElement); } }
function handleDragEnd(e) { if (!isAdmin || !draggedRow) return; draggedRow.classList.remove('dragging'); updateOrderAfterDrop(draggedRow); draggedRow = null; }
function getDragAfterElement(container, y) { const draggableElements = [...container.querySelectorAll('tr.draggable-row:not(.dragging)')]; return draggableElements.reduce((closest, child) => { const box = child.getBoundingClientRect(); const offset = y - box.top - box.height / 2; if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; } }, { offset: Number.NEGATIVE_INFINITY }).element; }
function getOrgOrderVal(org, listId) { if (org.orderData && org.orderData[listId] !== undefined) return Number(org.orderData[listId]); return org.createdAt || 0; }

async function updateOrderAfterDrop(row) {
    const listId = document.getElementById('filter-list').value; const orgId = row.dataset.id; const prevRow = row.previousElementSibling; const nextRow = row.nextElementSibling;
    const prevOrg = prevRow ? db.orgs.find(o => o.id === prevRow.dataset.id) : null; const nextOrg = nextRow ? db.orgs.find(o => o.id === nextRow.dataset.id) : null;
    let prevOrder = prevOrg ? getOrgOrderVal(prevOrg, listId) : null; let nextOrder = nextOrg ? getOrgOrderVal(nextOrg, listId) : null;
    let newOrder; if (prevOrder === null && nextOrder === null) newOrder = Date.now(); else if (prevOrder === null) newOrder = nextOrder - 10000; else if (nextOrder === null) newOrder = prevOrder + 10000; else newOrder = (prevOrder + nextOrder) / 2;
    const org = db.orgs.find(o => o.id === orgId); if (!org.orderData) org.orderData = {}; org.orderData[listId] = newOrder;
    try { await databases.updateDocument(DB_ID, 'organizations', orgId, { starredIn: JSON.stringify(org.orderData) }); } catch(e) {}
}

// ==========================================
// 9. UI & RENDERING LOGIC
// ==========================================
function initTheme() { const savedTheme = localStorage.getItem('amtz_theme') || 'light'; if (savedTheme === 'dark') { document.body.classList.add('dark-theme'); document.getElementById('theme-toggle').innerHTML = '<i class="fa-solid fa-sun"></i>'; } }
function toggleTheme() { const isDark = document.body.classList.toggle('dark-theme'); localStorage.setItem('amtz_theme', isDark ? 'dark' : 'light'); document.getElementById('theme-toggle').innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>'; }
function sortMeta(data) { return data.sort((a,b) => { if (a.id === 'master') return -1; if (b.id === 'master') return 1; if (a.order !== b.order) return a.order - b.order; return a.name.localeCompare(b.name); }); }
function sortTableData(data, currentListId) { return data.sort((a, b) => { let orderA = getOrgOrderVal(a, currentListId); let orderB = getOrgOrderVal(b, currentListId); if (orderA !== orderB) return orderA - orderB; return a.name.localeCompare(b.name); }); }
function showToast(msg, type = "success") { const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = `<i class="fa-solid fa-${type === 'success' ? 'check-circle' : 'circle-exclamation'}"></i> ${msg}`; container.appendChild(toast); setTimeout(() => toast.remove(), 3000); }
function debouncedRender() { clearTimeout(searchTimer); searchTimer = setTimeout(renderTable, 300); }

function initDropdowns() {
    const populate = (id, data, ph) => { const el = document.getElementById(id); if(!el) return; const curr = el.value; el.innerHTML = ph ? `<option value="all">${ph}</option>` : ''; sortMeta([...data]).forEach(i => el.innerHTML += `<option value="${i.id}">${i.name}</option>`); if(curr) el.value = curr; };
    populate('filter-list', db.lists, 'All Lists'); populate('filter-cat', db.cats, 'All Categories'); populate('bulk-list', db.lists, null); 
}

function renderTable() {
    copyClickState = {}; const listId = document.getElementById('filter-list').value; const catId = document.getElementById('filter-cat').value; const rawSearch = document.getElementById('search-bar').value.toLowerCase(); const searchGroups = rawSearch.split(',').map(s => s.trim()).filter(s => s !== ''); const tbody = document.getElementById('table-body'); const empty = document.getElementById('empty-state');
    const canDrag = isAdmin && rawSearch === '';
    let results = db.orgs.filter(org => { if (listId!=='all' && !org.listIds.includes(listId)) return false; if (catId!=='all' && !org.catIds.includes(catId)) return false; if (searchGroups.length > 0) { let txt = org.name.toLowerCase(); Object.values(org.tags).forEach(t => { if(typeof t === 'string') txt += " " + t.toLowerCase(); else if(t && t.val) txt += " " + t.val.toLowerCase() + " " + (t.link||"").toLowerCase(); }); return searchGroups.some(group => group.split(' ').filter(t => t).every(term => txt.includes(term))); } return true; });
    results = sortTableData(results, listId);
    if(document.getElementById('stats-count')) { document.getElementById('stats-count').innerText = `${results.length} Organizations`; }
    if (results.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    
    tbody.innerHTML = results.map(org => {
        return `<tr class="${canDrag ? 'draggable-row' : ''}" data-id="${org.id}" draggable="${canDrag ? 'true' : 'false'}" ondragstart="handleDragStart(event)" ondragover="handleDragOver(event)" ondragend="handleDragEnd(event)">
            <td class="col-drag ${isAdmin?'':'hidden'} admin-only"><i class="fa-solid fa-grip-vertical drag-handle" title="Drag to reorder"></i></td>
            <td class="col-admin ${isAdmin?'':'hidden'} admin-only"><code style="font-size:0.75rem; color:#888;">${org.id}</code></td>
            <td class="col-fixed-name"><span>${org.name}</span></td>
            <td>${renderLink(org.tags.twitter, 'twitter')}</td><td>${renderLink(org.tags.linkedin, 'linkedin')}</td>
            <td>${renderLink(org.tags.facebook, 'facebook')}</td><td>${renderLink(org.tags.instagram, 'instagram')}</td>
            <td>${renderLink(org.tags.website, 'website')}</td>
            <td class="col-action ${isAdmin?'':'hidden'} admin-only"><button class="btn-primary-action btn-sm" onclick="editOrg('${org.id}')">Edit</button></td>
        </tr>`;
    }).join('');
}

function renderLink(d, t) {
    if(!d) return '<span class="empty-cell">&minus;</span>'; const text = (typeof d === 'string') ? d : d.val;
    if(!text || text === '@' || text === '-' || text === '@-' || text.trim() === '') return '<span class="empty-cell">&minus;</span>';
    let url = (typeof d === 'string') ? (t === 'twitter' ? `https://x.com/${text.replace('@','')}` : `https://instagram.com/${text.replace('@','')}`) : (d.link || '#');
    const icon = t === 'website' ? 'fa-solid fa-globe' : (t === 'twitter' ? 'fa-brands fa-x-twitter' : `fa-brands fa-${t}`);
    return `<a href="${url}" target="_blank" class="tag-link" title="${text}"><i class="${icon}"></i> <span class="tag-truncate">${text.substring(0, 12)}${text.length>12?'...':''}</span></a>`;
}

function copyColumn(t) {
    const listId = document.getElementById('filter-list').value, catId = document.getElementById('filter-cat').value; const rawSearch = document.getElementById('search-bar').value.toLowerCase(); const searchGroups = rawSearch.split(',').map(s => s.trim()).filter(s => s !== '');
    let visibleOrgs = db.orgs.filter(org => { if (listId !== 'all' && !org.listIds.includes(listId)) return false; if (catId !== 'all' && !org.catIds.includes(catId)) return false; if (searchGroups.length > 0) { let txt = org.name.toLowerCase(); Object.values(org.tags).forEach(t => { if(typeof t === 'string') txt += " " + t.toLowerCase(); else if(t && t.val) txt += " " + t.val.toLowerCase(); }); return searchGroups.some(group => group.split(' ').filter(t=>t).every(term => txt.includes(term))); } return true; });
    visibleOrgs = sortTableData(visibleOrgs, listId);
    const allTags = visibleOrgs.map(o => (typeof o.tags[t] === 'string') ? o.tags[t] : (o.tags[t]?.val || "")).filter(k => { if (!k) return false; let clean = k.toString().trim(); return clean !== '' && clean !== '@' && clean !== '-' && clean !== '@-'; });
    if (allTags.length === 0) return showToast("No tags found", "error");
    if (!copyClickState[t]) copyClickState[t] = 'first'; let tagsToCopy = allTags, msg = "";
    if (allTags.length > 10 && copyClickState[t] === 'first') { tagsToCopy = allTags.slice(0, 10); copyClickState[t] = 'second'; msg = "Copied top 10 tags! Click again for ALL."; } else { tagsToCopy = allTags; copyClickState[t] = 'first'; msg = `Copied all ${allTags.length} tags.`; }
    navigator.clipboard.writeText(tagsToCopy.join('\n')); showToast(msg);
}

// ==========================================
// 10. CSV EXPORT INTEGRATION
// ==========================================
function exportToCSV() {
    const listId = document.getElementById('filter-list').value;
    const catId = document.getElementById('filter-cat').value;
    const rawSearch = document.getElementById('search-bar').value.toLowerCase();
    const searchGroups = rawSearch.split(',').map(s => s.trim()).filter(s => s !== '');
    
    // Filter to match exactly what is on screen
    let visibleOrgs = db.orgs.filter(org => {
        if (listId !== 'all' && !org.listIds.includes(listId)) return false;
        if (catId !== 'all' && !org.catIds.includes(catId)) return false;
        if (searchGroups.length > 0) {
            let txt = org.name.toLowerCase();
            Object.values(org.tags).forEach(t => { 
                if(typeof t === 'string') txt += " " + t.toLowerCase(); 
                else if(t && t.val) txt += " " + t.val.toLowerCase() + " " + (t.link||"").toLowerCase(); 
            });
            return searchGroups.some(group => group.split(' ').filter(t => t).every(term => txt.includes(term)));
        }
        return true;
    });
    
    visibleOrgs = sortTableData(visibleOrgs, listId);
    
    if (visibleOrgs.length === 0) return showToast("No data to export", "error");
    
    let csvContent = "data:text/csv;charset=utf-8,Organization,Twitter,LinkedIn,Facebook,Instagram,Website\n";
    
    visibleOrgs.forEach(org => {
        const t = org.tags;
        const tw = t.twitter && t.twitter !== '@' && t.twitter !== '-' ? t.twitter : '';
        const in_ = t.instagram && t.instagram !== '@' && t.instagram !== '-' ? t.instagram : '';
        const li = t.linkedin?.link && t.linkedin.link !== '-' ? t.linkedin.link : (t.linkedin?.val || '');
        const fb = t.facebook?.link && t.facebook.link !== '-' ? t.facebook.link : (t.facebook?.val || '');
        const web = t.website?.link && t.website.link !== '-' ? t.website.link : '';

        // Safely wrap fields in quotes to prevent commas from breaking columns
        const row = [
            `"${org.name.replace(/"/g, '""')}"`,
            `"${tw.replace(/"/g, '""')}"`,
            `"${li.replace(/"/g, '""')}"`,
            `"${fb.replace(/"/g, '""')}"`,
            `"${in_.replace(/"/g, '""')}"`,
            `"${web.replace(/"/g, '""')}"`
        ];
        csvContent += row.join(",") + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "AMTZ_Tags_Export.csv");
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link);
}

function resetFilters() { document.getElementById('filter-list').value = 'all'; document.getElementById('filter-cat').value = 'all'; document.getElementById('search-bar').value = ''; renderTable(); }
function openOrgModal(){editingId=null; document.getElementById('edit-name').value=''; ['twitter','instagram'].forEach(k=>document.getElementById(`tag-${k}`).value=''); ['linkedin','facebook','website'].forEach(k=>{document.getElementById(`tag-${k}-val`).value='';document.getElementById(`tag-${k}-link`).value=''}); renderCheckboxes(['master'],[]); openModal('org-modal');}
function editOrg(id){editingId=id; const o=db.orgs.find(i=>i.id===id); document.getElementById('edit-name').value=o.name; document.getElementById('tag-twitter').value=o.tags.twitter||''; document.getElementById('tag-instagram').value=o.tags.instagram||''; ['linkedin','facebook','website'].forEach(k=>{const t=o.tags[k]||{}; document.getElementById(`tag-${k}-val`).value=t.val||''; document.getElementById(`tag-${k}-link`).value=t.link||''}); renderCheckboxes(o.listIds,o.catIds); openModal('org-modal');}
function renderCheckboxes(sl, sc){ const b=(d,s,id)=>document.getElementById(id).innerHTML=sortMeta([...d]).map(i=>`<label style="display:block; margin-bottom:5px;" class="check-item ${i.id==='master'?'disabled':''}"><input type="checkbox" value="${i.id}" ${s.includes(i.id)||i.id==='master'?'checked':''} ${i.id==='master'?'disabled':''}> ${i.name}</label>`).join(''); b(db.lists,sl,'check-lists'); b(db.cats,sc,'check-cats'); }

// ==========================================
// 11. LISTS AND CATEGORIES DRAG AND DROP
// ==========================================
function renderMetaList(){ 
    const render = (data, el, t) => { 
        document.getElementById(el).innerHTML = sortMeta([...data]).filter(x => x.id !== 'master').map(item => `
        <li draggable="true" ondragstart="metaDragStart(event, '${item.id}', '${t}')" ondragover="event.preventDefault()" ondrop="metaDrop(event, '${item.id}', '${t}')" ondragend="this.classList.remove('dragging')"
            style="display:flex; justify-content:space-between; margin-bottom:10px; padding:5px; border-bottom:1px solid var(--border-color); cursor:grab;">
            <span style="font-weight:600;"><i class="fa-solid fa-grip-vertical" style="color:#aaa; margin-right:8px;"></i> ${item.name}</span>
            <button class="btn-danger" style="padding: 2px 6px; font-size: 0.8rem;" onclick="removeMeta('${t}','${item.id}')"><i class="fa-solid fa-trash"></i></button>
        </li>`).join(''); 
    }; 
    render(db.lists, 'list-manager-ul', 'lists'); render(db.cats, 'cat-manager-ul', 'categories'); 
}
function metaDragStart(e, id, type) { metaDragId = id; metaDragType = type; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => e.target.classList.add('dragging'), 0); }
async function metaDrop(e, targetId, type) {
    e.preventDefault(); if(!metaDragId || metaDragId === targetId || metaDragType !== type) return;
    let arr = type === 'lists' ? db.lists : db.cats; let sorted = sortMeta([...arr]);
    const targetIndex = sorted.findIndex(x => x.id === targetId); const prev = targetIndex > 0 ? sorted[targetIndex - 1] : null; const next = sorted[targetIndex];
    let prevOrder = prev ? (prev.order || 0) : null; let nextOrder = next.order || 0;
    let newOrder = prevOrder === null ? nextOrder - 10000 : (prevOrder + nextOrder) / 2;
    arr.find(x => x.id === metaDragId).order = newOrder;
    renderMetaList(); initDropdowns(); renderTable();
    try { await databases.updateDocument(DB_ID, type, metaDragId, { order: newOrder }); } catch(err){}
}

function openModal(id){ document.getElementById(id).classList.remove('hidden'); if(id==='meta-modal') renderMetaList(); if(id==='bulk-modal') { initBulkRows(20); document.getElementById('bulk-list').value = 'master'; } }
function closeModal(id){document.getElementById(id).classList.add('hidden');}
function initBulkRows(count) { document.getElementById('bulk-tbody').innerHTML = ''; addBulkRows(count); }
function addBulkRows(count) { const tbody = document.getElementById('bulk-tbody'); for(let i=0; i<count; i++) { tbody.innerHTML += `<tr class="bulk-row"><td><input type="text" class="input-cell" placeholder="Name"></td><td><input type="text" class="input-cell" placeholder="@handle"></td><td><input type="text" class="input-cell" placeholder="@handle"></td><td><input type="text" class="input-cell" placeholder="Full Link"></td><td><input type="text" class="input-cell" placeholder="@handle"></td><td><input type="text" class="input-cell" placeholder="Full Link"></td><td><input type="text" class="input-cell" placeholder="@handle"></td><td><input type="text" class="input-cell" placeholder="Full Link"></td></tr>`; } }
function handleGridPaste(e) { e.preventDefault(); const cb = (e.clipboardData || window.clipboardData).getData('text'); const rows = cb.split(/\r\n|\n|\r/).filter(r => r.length > 0); let tgt = e.target; if (tgt.tagName !== 'INPUT') return; let tr = tgt.closest('tr'); let srIdx = Array.from(tr.parentElement.children).indexOf(tr); let scIdx = Array.from(tr.children).indexOf(tgt.parentElement); const tb = document.getElementById('bulk-tbody'); rows.forEach((rData, rIdx) => { const cells = rData.split('\t'); if (srIdx + rIdx >= tb.children.length) addBulkRows(1); const tRow = tb.children[srIdx + rIdx]; cells.forEach((cData, cIdx) => { const tcIdx = scIdx + cIdx; if (tcIdx < tRow.children.length) { const inp = tRow.children[tcIdx].querySelector('input'); if (inp) { let cd = cData.trim(); if(cd.startsWith('"') && cd.endsWith('"')) cd = cd.substring(1, cd.length - 1); inp.value = cd; } } }); }); }
function resetBulkGrid() { if(confirm("Discard grid data?")) initBulkRows(20); }
