// ==========================================
// 1. APPWRITE INITIALIZATION
// ==========================================
const { Client, Account, Databases, Storage, ID, Query } = Appwrite;

const client = new Client()
    .setEndpoint('https://sgp.cloud.appwrite.io/v1') 
    .setProject('69abc18f00304e23f121'); 

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

const DB_ID = '69abd4a8000d0b820e8b'; 
const TABLE_ID = 'directory';         
const BUCKET_ID = '69afc921002bc8f541d7';

// ==========================================
// 2. STATE & GLOBALS
// ==========================================
let isAdmin = false;
let departments = []; 
let editingId = null;
let currentImageId = null;
let draggedDeptId = null;

// ==========================================
// 3. STARTUP & CLOUD FETCHING
// ==========================================
async function initApp() {
    try { await account.get(); isAdmin = true; updateUIForAdmin(); } catch (e) { isAdmin = false; }
    await fetchCloudData();
    client.subscribe(`databases.${DB_ID}.collections.${TABLE_ID}.documents`, () => fetchCloudData());
}

// Fallback logic in case an item hasn't been sorted yet
const getSortVal = (d) => (d.order !== undefined && d.order !== null) ? d.order : new Date(d.$createdAt).getTime();

async function fetchCloudData() {
    try {
        const res = await databases.listDocuments(DB_ID, TABLE_ID, [Query.limit(100)]);
        departments = res.documents.sort((a,b) => getSortVal(a) - getSortVal(b)); 
        document.getElementById('loading-state').classList.add('hidden');
        renderGrid();
    } catch(e) {}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp); else initApp();

// ==========================================
// 4. RENDERING THE GRID
// ==========================================
function renderGrid() {
    const grid = document.getElementById('companies-grid'); grid.innerHTML = '';
    if (departments.length === 0) return grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center;">No organizations added yet.</p>';

    departments.forEach(dept => {
        let logoUrl = dept.imageId ? storage.getFileView(BUCKET_ID, dept.imageId).href : 'https://via.placeholder.com/150?text=No+Logo';
        let socialsHtml = '';
        
        // Correct fa-x-twitter class for FA 6.5.1
        if (dept.twitter) socialsHtml += `<a href="${dept.twitter}" class="social-link twitter" target="_blank"><i class="fa-brands fa-x-twitter"></i></a>`; 
        if (dept.linkedin) socialsHtml += `<a href="${dept.linkedin}" class="social-link linkedin" target="_blank"><i class="fab fa-linkedin-in"></i></a>`;
        if (dept.facebook) socialsHtml += `<a href="${dept.facebook}" class="social-link facebook" target="_blank"><i class="fab fa-facebook-f"></i></a>`;
        if (dept.instagram) socialsHtml += `<a href="${dept.instagram}" class="social-link instagram" target="_blank"><i class="fab fa-instagram"></i></a>`;
        
        let websiteHtml = dept.website ? `<a href="${dept.website}" class="website-link" target="_blank"><i class="fas fa-globe"></i> Visit Website</a>` : '';
        let adminBtn = isAdmin ? `<button class="btn-edit-card" onclick="editDept('${dept.$id}')"><i class="fa-solid fa-pen"></i> Edit</button>` : '';

        const dragAttrs = isAdmin ? `draggable="true" ondragstart="dragStart(event, '${dept.$id}')" ondragover="event.preventDefault()" ondrop="dropTarget(event, '${dept.$id}')" ondragend="this.classList.remove('dragging')" style="cursor:grab;"` : '';

        grid.innerHTML += `
            <div class="company-card" ${dragAttrs}>
                ${adminBtn}
                <div class="card-header"><div class="company-logo"><img src="${logoUrl}"></div><h2 class="company-name">${dept.name}</h2></div>
                <div class="card-body">${websiteHtml}<div class="social-links">${socialsHtml}</div></div>
            </div>`;
    });
}

// ==========================================
// 5. FLAWLESS DRAG & DROP MATH
// ==========================================
function dragStart(e, id) { if(!isAdmin) return; draggedDeptId = id; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => e.target.classList.add('dragging'), 0); }

async function dropTarget(e, targetId) {
    if(!isAdmin || !draggedDeptId || draggedDeptId === targetId) return;
    e.preventDefault();

    let sorted = [...departments].sort((a,b) => getSortVal(a) - getSortVal(b));
    
    const draggedIdx = sorted.findIndex(d => d.$id === draggedDeptId);
    const targetIdx = sorted.findIndex(d => d.$id === targetId);

    // Logically pull the item out of the array and insert it at the target position
    const [draggedItem] = sorted.splice(draggedIdx, 1);
    sorted.splice(targetIdx, 0, draggedItem);

    // Calculate the new numerical order based on the items newly neighboring it
    const prev = targetIdx > 0 ? sorted[targetIdx - 1] : null;
    const next = targetIdx < sorted.length - 1 ? sorted[targetIdx + 1] : null;

    let pOrd = prev ? getSortVal(prev) : null;
    let nOrd = next ? getSortVal(next) : null;

    let newOrder;
    if (pOrd === null) newOrder = nOrd - 10000;
    else if (nOrd === null) newOrder = pOrd + 10000;
    else newOrder = (pOrd + nOrd) / 2;

    departments.find(d => d.$id === draggedDeptId).order = newOrder;
    renderGrid();
    try { await databases.updateDocument(DB_ID, TABLE_ID, draggedDeptId, { order: newOrder }); } catch(err){}
}

// ==========================================
// 6. ADMIN & CRUD
// ==========================================
async function login() { 
    try { await account.createEmailPasswordSession(document.getElementById('login-email').value, document.getElementById('login-pass').value); isAdmin = true; updateUIForAdmin(); closeModal('login-modal'); } catch(e) {} 
}
function updateUIForAdmin() { document.getElementById('admin-panel').classList.remove('hidden'); document.getElementById('login-trigger').classList.add('hidden'); renderGrid(); }
async function logout(){ try { await account.deleteSession('current'); } catch(e){} location.reload(); }

function openDeptModal() { editingId = null; currentImageId = null; document.getElementById('modal-title').innerText = "Add Department"; document.getElementById('btn-delete-dept').classList.add('hidden'); document.getElementById('current-logo-text').style.display = 'none'; ['name', 'website', 'twitter', 'linkedin', 'facebook', 'instagram', 'logo'].forEach(id => document.getElementById(`edit-${id}`).value = ''); openModal('dept-modal'); }
function editDept(id) { const dept = departments.find(d => d.$id === id); if (!dept) return; editingId = id; currentImageId = dept.imageId || null; document.getElementById('modal-title').innerText = "Edit Department"; document.getElementById('btn-delete-dept').classList.remove('hidden'); document.getElementById('edit-name').value = dept.name || ''; document.getElementById('edit-website').value = dept.website || ''; document.getElementById('edit-twitter').value = dept.twitter || ''; document.getElementById('edit-linkedin').value = dept.linkedin || ''; document.getElementById('edit-facebook').value = dept.facebook || ''; document.getElementById('edit-instagram').value = dept.instagram || ''; document.getElementById('edit-logo').value = ''; if (currentImageId) document.getElementById('current-logo-text').style.display = 'block'; openModal('dept-modal'); }

async function saveDept() {
    const btn = document.getElementById('btn-save'); const name = document.getElementById('edit-name').value.trim();
    if (!name) return showToast("Department Name is required!", "error");
    btn.innerText = "Saving..."; btn.disabled = true;
    try {
        const fileInput = document.getElementById('edit-logo'); let newImageId = currentImageId;
        if (fileInput.files.length > 0) {
            const uploadedFile = await storage.createFile(BUCKET_ID, ID.unique(), fileInput.files[0]);
            newImageId = uploadedFile.$id;
            if (currentImageId) { try { await storage.deleteFile(BUCKET_ID, currentImageId); } catch(e){} }
        }
        const dataObj = { name: name, website: document.getElementById('edit-website').value.trim(), twitter: document.getElementById('edit-twitter').value.trim(), linkedin: document.getElementById('edit-linkedin').value.trim(), facebook: document.getElementById('edit-facebook').value.trim(), instagram: document.getElementById('edit-instagram').value.trim(), imageId: newImageId };
        
        if (!editingId) dataObj.order = Date.now(); 

        if (editingId) await databases.updateDocument(DB_ID, TABLE_ID, editingId, dataObj); else await databases.createDocument(DB_ID, TABLE_ID, ID.unique(), dataObj);
        closeModal('dept-modal'); showToast("Saved successfully!");
    } catch(e) { showToast("Error saving", "error"); } finally { btn.innerText = "Save to Cloud"; btn.disabled = false; }
}

async function deleteDept() { if(!editingId || !confirm("Delete completely?")) return; try { if (currentImageId) { try { await storage.deleteFile(BUCKET_ID, currentImageId); } catch(e){} } await databases.deleteDocument(DB_ID, TABLE_ID, editingId); showToast("Deleted successfully."); closeModal('dept-modal'); } catch(e) { showToast("Error deleting", "error"); } }

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function showToast(msg, type = "success") { const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = msg; container.appendChild(toast); setTimeout(() => toast.remove(), 3000); }
