const { Client, Account, Databases, Storage, ID, Query } = Appwrite;
const client = new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('69abc18f00304e23f121');
const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

const DB_ID = '69abd4a8000d0b820e8b';
const PAGES_TABLE = 'link_pages';
const LINKS_TABLE = 'bio_links';
const BUCKET_ID = '69afc921002bc8f541d7'; 

let isAdmin = false;
let currentSlug = new URLSearchParams(window.location.search).get('d');
let pages = [];
let bioLinks = [];
let editingPageId = null;
let editingLinkId = null;
let currentImageId = null;
let currentLinkImageId = null; 

async function initApp() {
    try { await account.get(); isAdmin = true; updateUIForAdmin(); } catch (e) { isAdmin = false; document.getElementById('login-trigger').classList.remove('hidden'); }
    
    if (currentSlug) {
        document.getElementById('public-link-view').classList.remove('hidden');
        await loadPublicView(currentSlug);
    } else {
        if (!isAdmin) return document.getElementById('login-modal').classList.remove('hidden');
        document.getElementById('admin-dashboard-view').classList.remove('hidden');
        await fetchPages();
    }
}

// Navigates purely back to the dashboard from a specific department page
function goBackToDashboard() {
    window.location.href = window.location.pathname; 
}

// ==========================================
// VIEW 1: ADMIN DASHBOARD (Manage Pages)
// ==========================================
async function fetchPages() {
    try {
        const res = await databases.listDocuments(DB_ID, PAGES_TABLE, [Query.limit(100)]);
        pages = res.documents;
        renderPagesGrid();
    } catch(e) {}
}

function renderPagesGrid() {
    const grid = document.getElementById('pages-grid'); grid.innerHTML = '';
    pages.forEach(p => {
        let logo = p.imageId ? storage.getFileView(BUCKET_ID, p.imageId).href : 'https://via.placeholder.com/150';
        let url = `${window.location.origin}${window.location.pathname}?d=${p.slug}`;
        
        grid.innerHTML += `
            <div class="page-card">
                <button class="btn-edit-page" onclick="editPage('${p.$id}')"><i class="fa-solid fa-pen"></i></button>
                <img src="${logo}" class="page-card-logo">
                <h3>${p.name}</h3>
                <a href="${url}" class="page-link" target="_blank">${url}</a>
            </div>`;
    });
}

function openPageModal() { editingPageId=null; currentImageId=null; document.getElementById('edit-page-name').value=''; document.getElementById('edit-page-slug').value=''; document.getElementById('edit-page-logo').value=''; document.getElementById('btn-delete-page').classList.add('hidden'); openModal('page-modal'); }
function editPage(id) { const p = pages.find(x=>x.$id===id); editingPageId=id; currentImageId=p.imageId; document.getElementById('edit-page-name').value=p.name; document.getElementById('edit-page-slug').value=p.slug; document.getElementById('btn-delete-page').classList.remove('hidden'); openModal('page-modal'); }

async function savePage() {
    const name = document.getElementById('edit-page-name').value.trim();
    const slug = document.getElementById('edit-page-slug').value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name || !slug) return showToast("Name and Slug required", "error");

    let newImgId = currentImageId;
    const file = document.getElementById('edit-page-logo').files[0];
    if (file) {
        showToast("Uploading logo...");
        const uploaded = await storage.createFile(BUCKET_ID, ID.unique(), file);
        newImgId = uploaded.$id;
        if(currentImageId) { try { await storage.deleteFile(BUCKET_ID, currentImageId); } catch(e){} }
    }

    const data = { name, slug, imageId: newImgId || '' };
    try {
        if(editingPageId) await databases.updateDocument(DB_ID, PAGES_TABLE, editingPageId, data);
        else await databases.createDocument(DB_ID, PAGES_TABLE, ID.unique(), data);
        closeModal('page-modal'); fetchPages(); showToast("Page Saved");
    } catch(e){ showToast("Error saving", "error"); }
}
async function deletePage() { if(confirm("Delete this entire page?")) { await databases.deleteDocument(DB_ID, PAGES_TABLE, editingPageId); closeModal('page-modal'); fetchPages(); } }

// ==========================================
// VIEW 2: PUBLIC LINK TREE
// ==========================================
async function loadPublicView(slug) {
    try {
        const pageRes = await databases.listDocuments(DB_ID, PAGES_TABLE, [Query.equal('slug', slug)]);
        if (pageRes.documents.length === 0) return document.getElementById('public-name').innerText = "Page Not Found";
        
        const page = pageRes.documents[0];
        document.getElementById('public-name').innerText = page.name;
        document.title = `${page.name} | Links`;
        if (page.imageId) document.getElementById('public-logo').src = storage.getFileView(BUCKET_ID, page.imageId).href;

        if (isAdmin) {
            document.getElementById('page-admin-controls').classList.remove('hidden');
            document.getElementById('public-admin-header').classList.remove('hidden');
        }

        fetchLinks(slug);
    } catch(e) {}
}

async function fetchLinks(slug) {
    try {
        const res = await databases.listDocuments(DB_ID, LINKS_TABLE, [Query.equal('pageSlug', slug), Query.limit(100)]);
        bioLinks = res.documents.sort((a,b) => (a.order||0) - (b.order||0));
        renderBioLinks();
    } catch(e) {}
}

function renderBioLinks() {
    const container = document.getElementById('public-links'); container.innerHTML = '';
    const now = new Date().getTime();

    bioLinks.forEach(link => {
        const hasExpired = link.expiresAt && new Date(link.expiresAt).getTime() < now;
        
        // Hide from public if expired, but SHOW to admin with a red warning badge
        if (hasExpired && !isAdmin) return; 

        let adminTools = isAdmin ? `
            <div class="admin-link-tools" draggable="true" ondragstart="dragStart(event, '${link.$id}')" ondragover="event.preventDefault()" ondrop="dropTarget(event, '${link.$id}')" ondragend="this.classList.remove('dragging')">
                <button onclick="event.preventDefault(); editLink('${link.$id}')"><i class="fa-solid fa-pen"></i></button>
                <button style="cursor:grab;"><i class="fa-solid fa-grip-vertical"></i></button>
            </div>` : '';

        let badge = (hasExpired && isAdmin) ? `<span class="expired-badge">EXPIRED</span>` : '';
        
        // Thumbnail Image Logic
        let imgHtml = '';
        if (link.imageId) {
            const imgUrl = storage.getFileView(BUCKET_ID, link.imageId).href;
            imgHtml = `<img src="${imgUrl}" class="link-thumbnail" alt="Icon">`;
        }

        container.innerHTML += `
            <a href="${link.url}" class="bio-link-btn" target="_blank" style="${hasExpired ? 'opacity:0.6;' : ''}">
                ${imgHtml}
                <span class="link-title-text">${badge} ${link.title}</span>
                ${adminTools}
            </a>`;
    });
}

// Drag & Drop for Links
let draggedLinkId = null;
function dragStart(e, id) { draggedLinkId = id; e.dataTransfer.effectAllowed = 'move'; }
async function dropTarget(e, targetId) {
    e.preventDefault(); if(!isAdmin || !draggedLinkId || draggedLinkId === targetId) return;
    let sorted = [...bioLinks];
    const draggedIdx = sorted.findIndex(l => l.$id === draggedLinkId);
    const targetIdx = sorted.findIndex(l => l.$id === targetId);
    const [draggedItem] = sorted.splice(draggedIdx, 1);
    sorted.splice(targetIdx, 0, draggedItem);

    const prev = targetIdx > 0 ? sorted[targetIdx - 1] : null; const next = targetIdx < sorted.length - 1 ? sorted[targetIdx + 1] : null;
    let pOrd = prev ? (prev.order||0) : null; let nOrd = next ? (next.order||0) : null;
    let newOrder = pOrd === null ? nOrd - 10000 : (nOrd === null ? pOrd + 10000 : (pOrd + nOrd) / 2);

    bioLinks.find(l => l.$id === draggedLinkId).order = newOrder; renderBioLinks();
    try { await databases.updateDocument(DB_ID, LINKS_TABLE, draggedLinkId, { order: newOrder }); } catch(err){}
}

function openLinkModal() { 
    editingLinkId = null; 
    currentLinkImageId = null;
    document.getElementById('edit-link-title').value = ''; 
    document.getElementById('edit-link-url').value = ''; 
    document.getElementById('edit-link-expiry').value = ''; 
    document.getElementById('edit-link-image').value = '';
    document.getElementById('current-link-image-text').style.display = 'none';
    document.getElementById('btn-delete-link').classList.add('hidden'); 
    openModal('link-modal'); 
}

function editLink(id) { 
    const l = bioLinks.find(x=>x.$id===id); 
    editingLinkId = id; 
    currentLinkImageId = l.imageId || null;
    document.getElementById('edit-link-title').value = l.title; 
    document.getElementById('edit-link-url').value = l.url; 
    document.getElementById('edit-link-expiry').value = l.expiresAt ? new Date(l.expiresAt).toISOString().slice(0,16) : ''; 
    document.getElementById('edit-link-image').value = '';
    document.getElementById('current-link-image-text').style.display = currentLinkImageId ? 'block' : 'none';
    document.getElementById('btn-delete-link').classList.remove('hidden'); 
    openModal('link-modal'); 
}

async function saveLink() {
    const btn = document.getElementById('btn-save-link');
    const title = document.getElementById('edit-link-title').value.trim();
    const url = document.getElementById('edit-link-url').value.trim();
    const expiresAt = document.getElementById('edit-link-expiry').value;
    if (!title || !url) return showToast("Title and URL required", "error");

    btn.innerText = "Saving..."; btn.disabled = true;

    try {
        let newImgId = currentLinkImageId;
        const file = document.getElementById('edit-link-image').files[0];
        if (file) {
            showToast("Uploading image...");
            const uploaded = await storage.createFile(BUCKET_ID, ID.unique(), file);
            newImgId = uploaded.$id;
            if(currentLinkImageId) { try { await storage.deleteFile(BUCKET_ID, currentLinkImageId); } catch(e){} }
        }

        const data = { pageSlug: currentSlug, title, url, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, imageId: newImgId || '' };
        if(!editingLinkId) data.order = Date.now();

        if(editingLinkId) await databases.updateDocument(DB_ID, LINKS_TABLE, editingLinkId, data);
        else await databases.createDocument(DB_ID, LINKS_TABLE, ID.unique(), data);
        closeModal('link-modal'); fetchLinks(currentSlug); showToast("Link Saved");
    } catch(e) { 
        showToast("Error saving link", "error"); 
    } finally {
        btn.innerText = "Save Link"; btn.disabled = false;
    }
}

async function deleteLink() { 
    if(confirm("Delete this link?")) { 
        if (currentLinkImageId) { try { await storage.deleteFile(BUCKET_ID, currentLinkImageId); } catch(e){} }
        await databases.deleteDocument(DB_ID, LINKS_TABLE, editingLinkId); 
        closeModal('link-modal'); 
        fetchLinks(currentSlug); 
    } 
}

// ==========================================
// UTILS
// ==========================================
async function login() { try { await account.createEmailPasswordSession(document.getElementById('login-email').value, document.getElementById('login-pass').value); location.reload(); } catch(e){ showToast("Login Failed", "error"); } }
async function logout(){ try { await account.deleteSession('current'); } catch(e){} location.reload(); }
function updateUIForAdmin() { document.getElementById('admin-panel').classList.remove('hidden'); document.getElementById('login-trigger').classList.add('hidden'); }
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function showToast(msg, type = "success") { const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = msg; container.appendChild(toast); setTimeout(() => toast.remove(), 3000); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp); else initApp();
