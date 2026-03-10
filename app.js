const { Client, Account, Databases, Storage, ID, Query } = Appwrite;
const client = new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('69abc18f00304e23f121');
const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

const DB_ID = '69abd4a8000d0b820e8b';
const TABLE_ID = 'apps';
const BUCKET_ID = '69afc921002bc8f541d7'; 

let isAdmin = false; let apps = []; let editingId = null; let currentImageId = null; let draggedId = null;

async function initApp() {
    try { await account.get(); isAdmin = true; updateUIForAdmin(); } catch (e) { isAdmin = false; }
    await fetchApps();
    client.subscribe(`databases.${DB_ID}.collections.${TABLE_ID}.documents`, response => fetchApps());
}

const getSortVal = (a) => (a.order !== undefined && a.order !== null) ? a.order : new Date(a.$createdAt).getTime();

async function fetchApps() {
    try {
        const res = await databases.listDocuments(DB_ID, TABLE_ID, [Query.limit(100)]);
        apps = res.documents.sort((a,b) => getSortVal(a) - getSortVal(b));
        document.getElementById('loading-state').classList.add('hidden');
        renderApps();
    } catch(e) {}
}

function renderApps() {
    const grid = document.getElementById('apps-grid'); grid.innerHTML = '';
    const visibleApps = isAdmin ? apps : apps.filter(a => a.visible);
    
    visibleApps.forEach(app => {
        let imageUrl = app.imageId ? storage.getFileView(BUCKET_ID, app.imageId).href : 'https://via.placeholder.com/300x300?text=App+Icon';

        const adminTools = isAdmin ? `
            <div class="admin-tools">
                <button class="btn-toggle ${app.visible?'':'off'}" onclick="event.preventDefault(); toggleVisibility('${app.$id}', ${app.visible})"><i class="fa-solid ${app.visible?'fa-eye':'fa-eye-slash'}"></i></button>
                <button class="btn-edit" onclick="event.preventDefault(); editApp('${app.$id}')"><i class="fa-solid fa-pen"></i></button>
            </div>` : '';

        const dragAttrs = isAdmin ? `draggable="true" ondragstart="dragStart(event, '${app.$id}')" ondragover="event.preventDefault()" ondrop="dropTarget(event, '${app.$id}')" ondragend="this.classList.remove('dragging')"` : '';

        // Injecting the new Square Card HTML Structure
        grid.innerHTML += `
            <a href="${app.url}" class="app-card ${!app.visible?'hidden-card':''}" ${dragAttrs}>
                ${adminTools}
                <div class="app-image-wrapper">
                    <img src="${imageUrl}" class="app-image" alt="${app.title}">
                </div>
                <div class="app-title">${app.title}</div>
            </a>`;
    });
}

function dragStart(e, id) { if(!isAdmin) return; draggedId = id; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => e.target.classList.add('dragging'), 0); }
async function dropTarget(e, targetId) {
    if(!isAdmin || !draggedId || draggedId === targetId) return;
    e.preventDefault();
    let sorted = [...apps].sort((a,b) => getSortVal(a) - getSortVal(b));
    const draggedIdx = sorted.findIndex(a => a.$id === draggedId);
    const targetIdx = sorted.findIndex(a => a.$id === targetId);

    const [draggedItem] = sorted.splice(draggedIdx, 1);
    sorted.splice(targetIdx, 0, draggedItem);

    const prev = targetIdx > 0 ? sorted[targetIdx - 1] : null;
    const next = targetIdx < sorted.length - 1 ? sorted[targetIdx + 1] : null;

    let pOrd = prev ? getSortVal(prev) : null; let nOrd = next ? getSortVal(next) : null;
    let newOrder;
    if (pOrd === null) newOrder = nOrd - 10000;
    else if (nOrd === null) newOrder = pOrd + 10000;
    else newOrder = (pOrd + nOrd) / 2;

    apps.find(a => a.$id === draggedId).order = newOrder;
    renderApps();
    try { await databases.updateDocument(DB_ID, TABLE_ID, draggedId, { order: newOrder }); } catch(err){}
}

async function login() { 
    try { await account.createEmailPasswordSession(document.getElementById('login-email').value, document.getElementById('login-pass').value); isAdmin = true; updateUIForAdmin(); closeModal('login-modal'); } catch(e){ showToast("Login Failed", "error"); } 
}
function updateUIForAdmin() { document.getElementById('admin-panel').classList.remove('hidden'); document.getElementById('login-trigger').classList.add('hidden'); renderApps(); }
async function logout(){ try { await account.deleteSession('current'); } catch(e){} location.reload(); }

async function toggleVisibility(id, curr) { await databases.updateDocument(DB_ID, TABLE_ID, id, { visible: !curr }); }

function openAppModal(){ 
    editingId=null; currentImageId=null; 
    document.getElementById('edit-title').value=''; 
    document.getElementById('edit-url').value=''; 
    document.getElementById('edit-image').value=''; 
    document.getElementById('current-image-text').style.display='none';
    document.getElementById('btn-delete').classList.add('hidden'); 
    openModal('app-modal'); 
}

function editApp(id){ 
    const a = apps.find(x=>x.$id===id); 
    editingId=id; 
    currentImageId = a.imageId || null;
    document.getElementById('edit-title').value=a.title; 
    document.getElementById('edit-url').value=a.url; 
    document.getElementById('edit-image').value=''; 
    document.getElementById('current-image-text').style.display = currentImageId ? 'block' : 'none';
    document.getElementById('btn-delete').classList.remove('hidden'); 
    openModal('app-modal'); 
}

async function saveApp() {
    const btn = document.getElementById('btn-save'); 
    const title = document.getElementById('edit-title').value.trim();
    const url = document.getElementById('edit-url').value.trim();
    
    if (!title || !url) return showToast("Title and URL are required", "error");

    btn.innerText = "Saving..."; btn.disabled = true;
    try {
        let newImageId = currentImageId;
        const fileInput = document.getElementById('edit-image');
        
        // Handle Image
        if (fileInput.files.length > 0) {
            showToast("Uploading image...");
            const uploadedFile = await storage.createFile(BUCKET_ID, ID.unique(), fileInput.files[0]);
            newImageId = uploadedFile.$id;
            if (currentImageId) { try { await storage.deleteFile(BUCKET_ID, currentImageId); } catch(e){} }
        }
        
        // Passing icon: '' explicitly bypasses the old Appwrite 'required' error
        const data = { title: title, url: url, imageId: newImageId || '', icon: '', visible: true };
        if(!editingId) data.order = Date.now(); 
        
        if(editingId) {
            await databases.updateDocument(DB_ID, TABLE_ID, editingId, data); 
        } else {
            await databases.createDocument(DB_ID, TABLE_ID, ID.unique(), data); 
        }
        
        closeModal('app-modal'); 
        showToast("App saved successfully!");
        fetchApps();
    } catch(e) {
        console.error("Save Error: ", e);
        showToast(e.message, "error"); // Surfaces the exact Appwrite error if it fails
    } finally { 
        btn.innerText = "Save App"; btn.disabled = false; 
    }
}

async function deleteApp() { 
    if(confirm("Delete App?")) { 
        if (currentImageId) { try { await storage.deleteFile(BUCKET_ID, currentImageId); } catch(e){} }
        await databases.deleteDocument(DB_ID, TABLE_ID, editingId); 
        closeModal('app-modal'); 
    } 
}

function openModal(id){ document.getElementById(id).classList.remove('hidden'); }
function closeModal(id){ document.getElementById(id).classList.add('hidden'); }
function showToast(msg, type = "success") { const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = msg; container.appendChild(toast); setTimeout(() => toast.remove(), 3000); }

initApp();
