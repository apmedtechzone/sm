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

// ==========================================
// 3. STARTUP & CLOUD FETCHING
// ==========================================
async function initApp() {
    initTheme();
    initBulkRows(20); 
    
    // Check if admin is already logged in
    try {
        await account.get();
        isAdmin = true;
        updateUIForAdmin();
    } catch (e) { isAdmin = false; }

    // Fetch live data from Appwrite
    await fetchCloudData();

    // SETUP REAL-TIME LIVE UPDATES
    client.subscribe([
        `databases.${DB_ID}.collections.organizations.documents`,
        `databases.${DB_ID}.collections.lists.documents`,
        `databases.${DB_ID}.collections.categories.documents`
    ], response => {
        console.log("Live update detected! Syncing...");
        fetchCloudData(); // Auto-refresh the screen when data changes in the cloud
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
    } catch(e) {
        console.error(e);
        showToast("Error connecting to database.", "error");
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();

// ==========================================
// 4. AUTHENTICATION
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
        document.getElementById('login-email').value = '';
        document.getElementById('login-pass').value = '';
    } catch (e) {
        showToast(e.message, "error");
    }
}

function updateUIForAdmin() { 
    document.getElementById('admin-panel').classList.remove('hidden'); 
    document.getElementById('login-trigger').classList.add('hidden'); 
    document.getElementById('add-btn').classList.remove('hidden'); 
    document.querySelectorAll('.col-action').forEach(el=>el.classList.remove('hidden')); 
    renderTable(); 
}

async function logout(){ 
    try { await account.deleteSession('current'); } catch(e){}
    location.reload(); 
}

// ==========================================
// 5. CRUD OPERATIONS (CLOUD SAVING)
// ==========================================
async function saveOrg(){ 
    const n = document.getElementById('edit-name').value; if(!n) return showToast("Name required", "error");
    const l = Array.from(document.querySelectorAll('#check-lists input:checked')).map(c=>c.value); if(!l.includes('master'))l.push('master'); 
    const c = Array.from(document.querySelectorAll('#check-cats input:checked')).map(x=>x.value); 
    const tags = {
        twitter: ensureHandle(document.getElementById('tag-twitter').value), instagram: ensureHandle(document.getElementById('tag-instagram').value), 
        linkedin:{val:document.getElementById('tag-linkedin-val').value.trim(), link:document.getElementById('tag-linkedin-link').value.trim()}, 
        facebook:{val:document.getElementById('tag-facebook-val').value.trim(), link:document.getElementById('tag-facebook-link').value.trim()}, 
        website:{val:document.getElementById('tag-website-val').value.trim(), link:document.getElementById('tag-website-link').value.trim()}
    }; 
    
    showToast("Saving...");
    try {
        const dataObj = { name: n, listIds: l, catIds: c, tags: JSON.stringify(tags) };
        if(editingId){
            await databases.updateDocument(DB_ID, 'organizations', editingId, dataObj);
        } else {
            dataObj.starredIn = JSON.stringify({});
            await databases.createDocument(DB_ID, 'organizations', ID.unique(), dataObj);
        } 
        closeModal('org-modal'); 
    } catch (e) { showToast("Error saving: " + e.message, "error"); }
}

async function deleteOrg(){
    if(editingId && confirm('Delete permanently?')){
        showToast("Deleting...");
        try {
            await databases.deleteDocument(DB_ID, 'organizations', editingId);
            closeModal('org-modal');
        } catch(e) { showToast("Delete failed", "error"); }
    }
}

async function addMeta(t, i){
    const n = document.getElementById(i).value; 
    if(!n) return;
    try {
        await databases.createDocument(DB_ID, t, ID.unique(), { name: n });
        document.getElementById(i).value=''; 
    } catch(e) { showToast("Error adding", "error"); }
}

async function removeMeta(t, id){
    if(!confirm("Delete this list/category?")) return;
    try {
        await databases.deleteDocument(DB_ID, t, id);
    } catch(e) { showToast("Error deleting", "error"); }
}

async function toggleStar(orgId, listId) {
    if (!isAdmin) return;
    const org = db.orgs.find(o => o.id === orgId);
    if (!org) return;
    
    if (org.starredIn[listId]) delete org.starredIn[listId];
    else org.starredIn[listId] = Date.now();
    
    try {
        await databases.updateDocument(DB_ID, 'organizations', orgId, {
            starredIn: JSON.stringify(org.starredIn)
        });
    } catch(e) { showToast("Failed to star", "error"); }
}

// ==========================================
// 6. UI & RENDERING LOGIC
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
    if(!text) return '<span class="empty-cell">&minus;</span>';
    let url = (typeof d === 'string') ? (t === 'twitter' ? `https://x.com/${d.replace('@','')}` : `https://instagram.com/${d.replace('@','')}`) : (d.link || '#');
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
    const allTags = visibleOrgs.map(o => (typeof o.tags[t] === 'string') ? o.tags[t] : (o.tags[t]?.val || "")).filter(k => k);
    if (allTags.length === 0) return showToast("No tags found", "error");
    if (!copyClickState[t]) copyClickState[t] = 'first';
    let tagsToCopy = allTags, msg = "";
    if (allTags.length > 10 && copyClickState[t] === 'first') { tagsToCopy = allTags.slice(0, 10); copyClickState[t] = 'second'; msg = "Copied top 10 tags! Click again for ALL."; } 
    else { tagsToCopy = allTags; copyClickState[t] = 'first'; msg = `Copied all ${allTags.length} tags.`; }
    navigator.clipboard.writeText(tagsToCopy.join('\n')); showToast(msg);
}

function exportToCSV() {
    const listId = document.getElementById('filter-list').value;
    const catId = document.getElementById('filter-cat').value;
    let visibleOrgs = db.orgs.filter(org => {
        if (listId !== 'all' && !org.listIds.includes(listId)) return false;
        if (catId !== 'all' && !org.catIds.includes(catId)) return false;
        return true;
    });
    if (visibleOrgs.length === 0) return showToast("No data to export", "error");
    let csvContent = "data:text/csv;charset=utf-8,Organization,Twitter,LinkedIn,Facebook,Instagram,Website\n";
    visibleOrgs.forEach(org => {
        const row = [
            `"${org.name}"`,
            `"${org.tags.twitter || ''}"`,
            `"${org.tags.linkedin?.val || ''}"`,
            `"${org.tags.facebook?.val || ''}"`,
            `"${org.tags.instagram || ''}"`,
            `"${org.tags.website?.link || ''}"`
        ];
        csvContent += row.join(",") + "\n";
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "AMTZ_Tags_Export.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function resetFilters() { document.getElementById('filter-list').value = 'all'; document.getElementById('filter-cat').value = 'all'; document.getElementById('search-bar').value = ''; renderTable(); }

// ==========================================
// 7. MODALS & BULK UPLOAD LOGIC
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
function validateTag(val) { return val.trim().startsWith('@') ? val.trim() : ''; }
function ensureHandle(val) { val = val.trim(); if (!val) return ''; return val.startsWith('@') ? val : '@' + val; }

async function analyzeBulkUpload() {
    const rows = document.querySelectorAll('.bulk-row');
    const targetList = document.getElementById('bulk-list').value;
    const targetListIds = ['master']; if(targetList && targetList !== 'master') targetListIds.push(targetList);
    showToast("Processing bulk upload to Cloud... please wait.");

    for(let i=0; i<rows.length; i++) {
        const inputs = rows[i].querySelectorAll('input');
        const name = inputs[0].value.trim();
        if(!name) continue;
        
        const tags = {
            twitter: validateTag(inputs[1].value), linkedin: { val: validateTag(inputs[2].value), link: inputs[3].value.trim() },
            facebook: { val: validateTag(inputs[4].value), link: inputs[5].value.trim() }, instagram: validateTag(inputs[6].value),
            website: { val: inputs[7].value.trim() ? "Visit Site" : "", link: inputs[7].value.trim() }
        };
        try {
            await databases.createDocument(DB_ID, 'organizations', ID.unique(), {
                name: name, listIds: [...targetListIds], catIds: [], tags: JSON.stringify(tags), starredIn: JSON.stringify({})
            });
        } catch(e) { console.error("Failed to upload row: " + name); }
    }
    closeModal('bulk-modal');
    showToast("Bulk import complete!");
}
