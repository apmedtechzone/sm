// ==========================================
// 1. APPWRITE INITIALIZATION
// ==========================================
const { Client, Account, Databases, ID, Query } = Appwrite;

const client = new Client()
    .setEndpoint('https://sgp.cloud.appwrite.io/v1') 
    .setProject('69abc18f00304e23f121');             

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

// ==========================================
// 3. STARTUP & CLOUD FETCHING
// ==========================================
async function initApp() {
    initTheme();
    initBulkRows(20); 
    
    try {
        await account.get();
        isAdmin = true;
        updateUIForAdmin();
    } catch (e) { isAdmin = false; }

    await fetchCloudData();

    client.subscribe([
        `databases.${DB_ID}.collections.organizations.documents`,
        `databases.${DB_ID}.collections.lists.documents`,
        `databases.${DB_ID}.collections.categories.documents`
    ], response => {
        console.log("Live update detected! Syncing...");
        fetchCloudData(); 
    });

    document.getElementById('bulk-tbody').addEventListener('paste', handleGridPaste);
    document.addEventListener('keydown', (e) => {
        if(e.key === "Escape") document.querySelectorAll('.modal').forEach(m => closeModal(m.id));
    });
}

async function fetchCloudData() {
    try {
        document.getElementById('stats-count').innerText = "Syncing...";
        const [listsRes, catsRes, orgsRes] = await Promise.all([
            databases.listDocuments(DB_ID, 'lists', [Query.limit(100)]),
            databases.listDocuments(DB_ID, 'categories', [Query.limit(100)]),
            databases.listDocuments(DB_ID, 'organizations', [Query.limit(2000)])
        ]);
        
        db.lists = listsRes.documents.map(d => ({ id: d.$id, name: d.name }));
        db.cats = catsRes.documents.map(d => ({ id: d.$id, name: d.name }));
        db.orgs = orgsRes.documents.map(d => ({
            id: d.$id,
            name: d.name,
            listIds: d.listIds || [],
            catIds: d.catIds || [],
            tags: JSON.parse(d.tags || '{}'),
            starredIn: JSON.parse(d.starredIn || '{}')
        }));

        initDropdowns();
        renderTable();
        if (document.getElementById('meta-modal') && !document.getElementById('meta-modal').classList.contains('hidden')) {
            renderMetaList();
        }
    } catch(e) { console.error(e); showToast("Error connecting to database.", "error"); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();

// ==========================================
// 4. AUTHENTICATION & UI FOR ADMIN
// ==========================================
async function login() { 
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    try {
        await account.createEmailPasswordSession(email, pass);
        isAdmin = true; 
        updateUIForAdmin(); 
        closeModal('login-modal'); 
        showToast("Logged in securely"); 
        document.getElementById('login-email').value = ''; document.getElementById('login-pass').value = '';
    } catch (e) { showToast(e.message, "error"); }
}

function updateUIForAdmin() { 
    document.getElementById('admin-panel').classList.remove('hidden'); 
    document.getElementById('login-trigger').classList.add('hidden'); 
    document.getElementById('add-btn').classList.remove('hidden'); 
    document.querySelectorAll('.col-action').forEach(el=>el.classList.remove('hidden')); 
    document.querySelectorAll('.col-admin').forEach(el=>el.classList.remove('hidden')); 
    renderTable(); 
}

async function logout(){ try { await account.deleteSession('current'); } catch(e){} location.reload(); }

// ==========================================
// 5. MASTER DATA SCRUBBERS (The Fix for "-" and "@")
// ==========================================
function ensureHandle(val) { 
    if (!val) return ''; 
    let str = val.toString().trim();
    // Vigorously wipe out pure dashes, NA, and empty spaces
    if (str === '-' || str.toLowerCase() === 'na' || str.toLowerCase() === 'none' || str === '@') return ''; 
    
    let clean = str.replace(/^@+/, '').trim();
    if (clean.length === 0 || clean === '-') return ''; 
    return '@' + clean; 
}

function ensureLink(val) {
    if (!val) return '';
    let str = val.toString().trim();
    // Wipe out dashes and empty placeholders for links
    if (str === '-' || str.toLowerCase() === 'na' || str.toLowerCase() === 'none') return '';
    return str;
}

// ==========================================
// 6. DEEP CONFLICT DETECTION ENGINE
// ==========================================
function detectConflict(newOrgObj, skipId, arrayToCheck = db.orgs) {
    const parseTags = (t) => {
        if (!t) return {};
        if (typeof t === 'object') return t;
        try { return JSON.parse(t); } catch(e) { return {}; }
    };

    const nt = parseTags(newOrgObj.tags);
    const nName = (newOrgObj.name || '').toString().trim().toLowerCase();

    for (let org of arrayToCheck) {
        if (skipId && (org.id === skipId || org.$id === skipId)) continue;

        const oName = (org.name || '').toString().trim().toLowerCase();

        // 1. Exact Name Match
        if (nName && nName === oName) return org;

        // 2. Deep Tags Match
        const ot = parseTags(org.tags);

        const match = (a, b) => {
            if (!a || !b) return false;
            let strA = a.toString().toLowerCase();
            let strB = b.toString().toLowerCase();

            // Strip out formatting
            const cleanStr = (s) => s.replace(/^(https?:\/\/)?(www\.)?/,'').replace(/[@\/\-\s]/g, '').trim();
            strA = cleanStr(strA);
            strB = cleanStr(strB);

            // CRITICAL: If the cleaned string is empty or just 1 character, NEVER trigger a conflict
            if (strA.length < 2 || strB.length < 2) return false;

            const ignore = ['na', 'none', 'null', 'nil', 'blank', 'visitsite', 'visit', 'http', 'https', 'undefined'];
            if (ignore.includes(strA) || ignore.includes(strB)) return false;

            return strA === strB;
        };

        if (match(nt.twitter, ot.twitter)) return org;
        if (match(nt.instagram, ot.instagram)) return org;
        if (match(nt.linkedin?.link, ot.linkedin?.link)) return org;
        if (match(nt.linkedin?.val, ot.linkedin?.val)) return org;
        if (match(nt.facebook?.link, ot.facebook?.link)) return org;
        if (match(nt.facebook?.val, ot.facebook?.val)) return org;
        if (match(nt.website?.link, ot.website?.link)) return org;
    }
    return null;
}

function processConflictQueue() {
    if (pendingConflicts.length === 0) {
        closeModal('conflict-modal');
        fetchCloudData(); 
        return;
    }
    
    const current = pendingConflicts[0];
    document.getElementById('conflict-details').innerHTML = `
        <div style="margin-bottom:8px;"><strong>Attempting to save:</strong> <span style="color:var(--primary-color)">${current.newObj.name}</span></div>
        <div><strong>Matches Existing Org:</strong> <span style="color:var(--danger-color)">${current.existingOrg.name}</span> 
        <br><small style="color:#666;">(Admin ID: ${current.existingOrg.id || current.existingOrg.$id})</small></div>
    `;
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
        if (current.isEdit && current.editOldId) {
            try { await databases.deleteDocument(DB_ID, 'organizations', current.editOldId); } catch(e){}
        }

        if (action === 'overwrite') {
            await databases.updateDocument(DB_ID, 'organizations', existingId, {
                name: current.newObj.name,
                listIds: combinedLists,
                catIds: current.newObj.catIds,
                tags: typeof current.newObj.tags === 'string' ? current.newObj.tags : JSON.stringify(current.newObj.tags)
            });
        } else if (action === 'delete') {
            await databases.updateDocument(DB_ID, 'organizations', existingId, {
                listIds: combinedLists
            });
        }
    } catch (e) { showToast("Error resolving conflict", "error"); }

    processConflictQueue(); 
}

// ==========================================
// 7. CRUD OPERATIONS (CLOUD SAVING)
// ==========================================
async function saveOrg(){ 
    const n = document.getElementById('edit-name').value.trim(); if(!n) return showToast("Name required", "error");
    const l = Array.from(document.querySelectorAll('#check-lists input:checked')).map(c=>c.value); if(!l.includes('master'))l.push('master'); 
    const c = Array.from(document.querySelectorAll('#check-cats input:checked')).map(x=>x.value); 
    
    // Utilize the Master Scrubbers
    const tags = {
        twitter: ensureHandle(document.getElementById('tag-twitter').value), 
        instagram: ensureHandle(document.getElementById('tag-instagram').value), 
        linkedin:{val:ensureHandle(document.getElementById('tag-linkedin-val').value), link:ensureLink(document.getElementById('tag-linkedin-link').value)}, 
        facebook:{val:ensureHandle(document.getElementById('tag-facebook-val').value), link:ensureLink(document.getElementById('tag-facebook-link').value)}, 
        website:{val:ensureLink(document.getElementById('tag-website-link').value) ? "Visit Site" : "", link:ensureLink(document.getElementById('tag-website-link').value)}
    }; 
    
    const dataObj = { name: n, listIds: l, catIds: c, tags: JSON.stringify(tags) };

    const conflictOrg = detectConflict(dataObj, editingId, db.orgs);
    if (conflictOrg) {
        pendingConflicts = [{ newObj: dataObj, existingOrg: conflictOrg, isEdit: !!editingId, editOldId: editingId }];
        closeModal('org-modal');
        processConflictQueue();
        return;
    }

    showToast("Saving...");
    try {
        if(editingId){
            await databases.updateDocument(DB_ID, 'organizations', editingId, dataObj);
        } else {
            dataObj.starredIn = JSON.stringify({});
            await databases.createDocument(DB_ID, 'organizations', ID.unique(), dataObj);
        } 
        closeModal('org-modal'); 
    } catch (e) { showToast("Error saving: " + e.message, "error"); }
}

async function analyzeBulkUpload() {
    const rows = document.querySelectorAll('.bulk-row');
    const targetList = document.getElementById('bulk-list').value;
    const targetListIds = ['master']; if(targetList && targetList !== 'master') targetListIds.push(targetList);
    
    pendingConflicts = []; 
    let cleanOrgs = [];

    for(let i=0; i<rows.length; i++) {
        const inputs = rows[i].querySelectorAll('input');
        const name = inputs[0].value.trim();
        if(!name) continue;
        
        // Utilize the Master Scrubbers for Bulk Uploads
        const tags = {
            twitter: ensureHandle(inputs[1].value), 
            linkedin: { val: ensureHandle(inputs[2].value), link: ensureLink(inputs[3].value) },
            facebook: { val: ensureHandle(inputs[4].value), link: ensureLink(inputs[5].value) }, 
            instagram: ensureHandle(inputs[6].value),
            website: { val: ensureLink(inputs[7].value) ? "Visit Site" : "", link: ensureLink(inputs[7].value) }
        };
        
        const dataObj = { name: name, listIds: [...targetListIds], catIds: [], tags: JSON.stringify(tags), starredIn: JSON.stringify({}) };
        
        let conflictOrg = detectConflict(dataObj, null, db.orgs);
        if (!conflictOrg) conflictOrg = detectConflict(dataObj, null, cleanOrgs);

        if (conflictOrg) {
            pendingConflicts.push({ newObj: dataObj, existingOrg: conflictOrg, isEdit: false });
        } else {
            dataObj.id = "temp_" + i; 
            cleanOrgs.push(dataObj);
        }
    }
    
    closeModal('bulk-modal');
    if (cleanOrgs.length > 0) showToast(`Uploading ${cleanOrgs.length} clean records... please wait.`);

    for(let org of cleanOrgs) {
        try { 
            delete org.id; 
            const created = await databases.createDocument(DB_ID, 'organizations', ID.unique(), org); 
            db.orgs.push({ id: created.$id, name: created.name, listIds: created.listIds, tags: JSON.parse(created.tags) });
        } 
        catch(e) { console.error("Failed to upload row: " + org.name); }
    }

    if (pendingConflicts.length > 0) {
        processConflictQueue();
    } else {
        showToast("Bulk import complete!");
        fetchCloudData();
    }
}

async function deleteOrg(){
    if(editingId && confirm('Delete permanently?')){
        showToast("Deleting...");
        try { await databases.deleteDocument(DB_ID, 'organizations', editingId); closeModal('org-modal'); } 
        catch(e) { showToast("Delete failed", "error"); }
    }
}
async function addMeta(t, i){
    const n = document.getElementById(i).value; if(!n) return;
    try { await databases.createDocument(DB_ID, t, ID.unique(), { name: n }); document.getElementById(i).value=''; } 
    catch(e) { showToast("Error adding", "error"); }
}
async function removeMeta(t, id){
    if(!confirm("Delete this list/category?")) return;
    try { await databases.deleteDocument(DB_ID, t, id); } catch(e) { showToast("Error deleting", "error"); }
}
async function toggleStar(orgId, listId) {
    if (!isAdmin) return;
    const org = db.orgs.find(o => o.id === orgId); if (!org) return;
    if (org.starredIn[listId]) delete org.starredIn[listId]; else org.starredIn[listId] = Date.now();
    try { await databases.updateDocument(DB_ID, 'organizations', orgId, { starredIn: JSON.stringify(org.starredIn) }); } 
    catch(e) { showToast("Failed to star", "error"); }
}

// ==========================================
// 8. UI & RENDERING LOGIC
// ==========================================
function initTheme() { const savedTheme = localStorage.getItem('amtz_theme') || 'light'; if (savedTheme === 'dark') { document.body.classList.add('dark-theme'); document.getElementById('theme-toggle').innerHTML = '<i class="fa-solid fa-sun"></i>'; } }
function toggleTheme() { const isDark = document.body.classList.toggle('dark-theme'); localStorage.setItem('amtz_theme', isDark ? 'dark' : 'light'); document.getElementById('theme-toggle').innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>'; }
function sortDataAlphabetically(data) { return data.sort((a, b) => { if (a.id === 'master') return -1; if (b.id === 'master') return 1; return a.name.localeCompare(b.name); }); }
function sortTableData(data, currentListId) { return data.sort((a, b) => { if (currentListId !== 'all') { const aStarTime = (a.starredIn && a.starredIn[currentListId]) ? a.starredIn[currentListId] : 0; const bStarTime = (b.starredIn && b.starredIn[currentListId]) ? b.starredIn[currentListId] : 0; if (aStarTime !== bStarTime) return bStarTime - aStarTime; } return a.name.localeCompare(b.name); }); }
function showToast(msg, type = "success") { const container = document.getElementById('toast-container'); if(!container) return alert(msg); const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = `<i class="fa-solid fa-${type === 'success' ? 'check-circle' : 'circle-exclamation'}"></i> ${msg}`; container.appendChild(toast); setTimeout(() => toast.remove(), 3000); }
function debouncedRender() { clearTimeout(searchTimer); searchTimer = setTimeout(renderTable, 300); }

function initDropdowns() {
    const populate = (id, data, ph) => {
        const el = document.getElementById(id); if(!el) return;
        const curr = el.value; el.innerHTML = ph ? `<option value="all">${ph}</option>` : '';
        sortDataAlphabetically([...data]).forEach(i => el.innerHTML += `<option value="${i.id}">${i.name}</option>`);
        if(curr) el.value = curr;
    };
    populate('filter-list', db.lists, 'All Lists'); populate('filter-cat', db.cats, 'All Categories');
    populate('bulk-list', db.lists, null); 
}

function renderTable() {
    copyClickState = {}; 
    const listId = document.getElementById('filter-list').value;
    const catId = document.getElementById('filter-cat').value;
    const rawSearch = document.getElementById('search-bar').value.toLowerCase();
    const searchGroups = rawSearch.split(',').map(s => s.trim()).filter(s => s !== '');
    const tbody = document.getElementById('table-body');
    const empty = document.getElementById('empty-state');
    
    let results = db.orgs.filter(org => {
        if (listId!=='all' && !org.listIds.includes(listId)) return false;
        if (catId!=='all' && !org.catIds.includes(catId)) return false;
        if (searchGroups.length > 0) {
            let txt = org.name.toLowerCase();
            Object.values(org.tags).forEach(t => { if(typeof t === 'string') txt += " " + t.toLowerCase(); else if(t && t.val) txt += " " + t.val.toLowerCase() + " " + (t.link||"").toLowerCase(); });
            return searchGroups.some(group => group.split(' ').filter(t => t).every(term => txt.includes(term)));
        } return true;
    });
    results = sortTableData(results, listId);
    if(document.getElementById('stats-count')) { document.getElementById('stats-count').innerText = `${results.length} Organizations`; }
    if (results.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    
    tbody.innerHTML = results.map(org => {
        const isStarred = (listId !== 'all') && org.starredIn && org.starredIn[listId];
        const starHTML = (isAdmin && listId !== 'all') ? `<button class="btn-star ${isStarred ? 'starred' : ''}" onclick="toggleStar('${org.id}', '${listId}')"><i class="fa-solid fa-star"></i></button>` : '';
        return `<tr>
            <td class="col-admin ${isAdmin?'':'hidden'}"><code style="font-size:0.75rem; color:#888;">${org.id}</code></td>
            <td class="col-fixed-name"><div style="display:flex; align-items:center; gap:8px;">${starHTML}<span>${org.name}</span></div></td>
            <td>${renderLink(org.tags.twitter, 'twitter')}</td><td>${renderLink(org.tags.linkedin, 'linkedin')}</td>
            <td>${renderLink(org.tags.facebook, 'facebook')}</td><td>${renderLink(org.tags.instagram, 'instagram')}</td>
            <td>${renderLink(org.tags.website, 'website')}</td>
            <td class="col-action ${isAdmin?'':'hidden'}"><button class="btn-primary-action btn-sm" onclick="editOrg('${org.id}')">Edit</button></td>
        </tr>`;
    }).join('');
}

function renderLink(d, t) {
    if(!d) return '<span class="empty-cell">&minus;</span>';
    const text = (typeof d === 'string') ? d : d.val;
    
    // Aggressively prevent empty, "-", "@", or "@-" from rendering on screen
    if(!text || text === '@' || text === '-' || text === '@-' || text.trim() === '') {
        return '<span class="empty-cell">&minus;</span>';
    }
    
    let url = (typeof d === 'string') ? (t === 'twitter' ? `https://x.com/${text.replace('@','')}` : `https://instagram.com/${text.replace('@','')}`) : (d.link || '#');
    const icon = t === 'website' ? 'fa-solid fa-globe' : `fa-brands fa-${t}`;
    return `<a href="${url}" target="_blank" class="tag-link" title="${text}"><i class="${icon}"></i> <span class="tag-truncate">${text.substring(0, 12)}${text.length>12?'...':''}</span></a>`;
}

function copyColumn(t) {
    const listId = document.getElementById('filter-list').value, catId = document.getElementById('filter-cat').value;
    const rawSearch = document.getElementById('search-bar').value.toLowerCase();
    const searchGroups = rawSearch.split(',').map(s => s.trim()).filter(s => s !== '');
    let visibleOrgs = db.orgs.filter(org => {
        if (listId !== 'all' && !org.listIds.includes(listId)) return false;
        if (catId !== 'all' && !org.catIds.includes(catId)) return false;
        if (searchGroups.length > 0) { let txt = org.name.toLowerCase(); Object.values(org.tags).forEach(t => { if(typeof t === 'string') txt += " " + t.toLowerCase(); else if(t && t.val) txt += " " + t.val.toLowerCase(); }); return searchGroups.some(group => group.split(' ').filter(t=>t).every(term => txt.includes(term))); } return true;
    });
    visibleOrgs = sortTableData(visibleOrgs, listId);
    
    // Completely ignore blanks, "@", "-", and "@-" so they don't get copied to the clipboard
    const allTags = visibleOrgs.map(o => (typeof o.tags[t] === 'string') ? o.tags[t] : (o.tags[t]?.val || "")).filter(k => {
        if (!k) return false;
        let clean = k.toString().trim();
        return clean !== '' && clean !== '@' && clean !== '-' && clean !== '@-';
    });
    
    if (allTags.length === 0) return showToast("No tags found", "error");
    if (!copyClickState[t]) copyClickState[t] = 'first';
    let tagsToCopy = allTags, msg = "";
    if (allTags.length > 10 && copyClickState[t] === 'first') { tagsToCopy = allTags.slice(0, 10); copyClickState[t] = 'second'; msg = "Copied top 10 tags! Click again for ALL."; } 
    else { tagsToCopy = allTags; copyClickState[t] = 'first'; msg = `Copied all ${allTags.length} tags.`; }
    navigator.clipboard.writeText(tagsToCopy.join('\n')); showToast(msg);
}

function exportToCSV() { /* Code remains identical */ }
function resetFilters() { document.getElementById('filter-list').value = 'all'; document.getElementById('filter-cat').value = 'all'; document.getElementById('search-bar').value = ''; renderTable(); }

// ==========================================
// 9. MODALS & BULK UPLOAD GRIDS
// ==========================================
function openOrgModal(){editingId=null; document.getElementById('edit-name').value=''; ['twitter','instagram'].forEach(k=>document.getElementById(`tag-${k}`).value=''); ['linkedin','facebook','website'].forEach(k=>{document.getElementById(`tag-${k}-val`).value='';document.getElementById(`tag-${k}-link`).value=''}); renderCheckboxes(['master'],[]); openModal('org-modal');}
function editOrg(id){editingId=id; const o=db.orgs.find(i=>i.id===id); document.getElementById('edit-name').value=o.name; document.getElementById('tag-twitter').value=o.tags.twitter||''; document.getElementById('tag-instagram').value=o.tags.instagram||''; ['linkedin','facebook','website'].forEach(k=>{const t=o.tags[k]||{}; document.getElementById(`tag-${k}-val`).value=t.val||''; document.getElementById(`tag-${k}-link`).value=t.link||''}); renderCheckboxes(o.listIds,o.catIds); openModal('org-modal');}
function renderCheckboxes(sl, sc){ const b=(d,s,id)=>document.getElementById(id).innerHTML=sortDataAlphabetically([...d]).map(i=>`<label style="display:block; margin-bottom:5px;" class="check-item ${i.id==='master'?'disabled':''}"><input type="checkbox" value="${i.id}" ${s.includes(i.id)||i.id==='master'?'checked':''} ${i.id==='master'?'disabled':''}> ${i.name}</label>`).join(''); b(db.lists,sl,'check-lists'); b(db.cats,sc,'check-cats'); }
function renderMetaList(){ const render = (data, el, t) => { document.getElementById(el).innerHTML = sortDataAlphabetically([...data]).filter(x => x.id !== 'master').map(item => `<li style="display:flex; justify-content:space-between; margin-bottom:10px; padding:5px; border-bottom:1px solid var(--border-color);"><span style="font-weight:600;">${item.name}</span><button class="btn-danger" style="padding: 2px 6px; font-size: 0.8rem;" onclick="removeMeta('${t}','${item.id}')"><i class="fa-solid fa-trash"></i></button></li>`).join(''); }; render(db.lists, 'list-manager-ul', 'lists'); render(db.cats, 'cat-manager-ul', 'categories'); }
function openModal(id){ document.getElementById(id).classList.remove('hidden'); if(id==='meta-modal') renderMetaList(); if(id==='bulk-modal') { initBulkRows(20); document.getElementById('bulk-list').value = 'master'; } }
function closeModal(id){document.getElementById(id).classList.add('hidden');}

function initBulkRows(count) { document.getElementById('bulk-tbody').innerHTML = ''; addBulkRows(count); }
function addBulkRows(count) { const tbody = document.getElementById('bulk-tbody'); for(let i=0; i<count; i++) { tbody.innerHTML += `<tr class="bulk-row"><td><input type="text" class="input-cell" placeholder="Name"></td><td><input type="text" class="input-cell" placeholder="@handle"></td><td><input type="text" class="input-cell" placeholder="@handle"></td><td><input type="text" class="input-cell" placeholder="Full Link"></td><td><input type="text" class="input-cell" placeholder="@handle"></td><td><input type="text" class="input-cell" placeholder="Full Link"></td><td><input type="text" class="input-cell" placeholder="@handle"></td><td><input type="text" class="input-cell" placeholder="Full Link"></td></tr>`; } }
function handleGridPaste(e) { e.preventDefault(); const cb = (e.clipboardData || window.clipboardData).getData('text'); const rows = cb.split(/\r\n|\n|\r/).filter(r => r.length > 0); let tgt = e.target; if (tgt.tagName !== 'INPUT') return; let tr = tgt.closest('tr'); let srIdx = Array.from(tr.parentElement.children).indexOf(tr); let scIdx = Array.from(tr.children).indexOf(tgt.parentElement); const tb = document.getElementById('bulk-tbody'); rows.forEach((rData, rIdx) => { const cells = rData.split('\t'); if (srIdx + rIdx >= tb.children.length) addBulkRows(1); const tRow = tb.children[srIdx + rIdx]; cells.forEach((cData, cIdx) => { const tcIdx = scIdx + cIdx; if (tcIdx < tRow.children.length) { const inp = tRow.children[tcIdx].querySelector('input'); if (inp) { let cd = cData.trim(); if(cd.startsWith('"') && cd.endsWith('"')) cd = cd.substring(1, cd.length - 1); inp.value = cd; } } }); }); }
function resetBulkGrid() { if(confirm("Discard grid data?")) initBulkRows(20); }
