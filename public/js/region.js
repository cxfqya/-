// ==================== 全局状态 ====================
let regionId = null;
let regionInfo = null;
let currentUser = null;
let authToken = '';
let isAdmin = false;
let isOwner = false;
let currentHand = 'right';
let currentPage = 'ranking';
let currentContribType = 'resource';
let playersData = [];
let contribData = [];
let avatarUploadId = null;
let contribAvatarUploadId = null;
let noteHistoryMemberId = null;

// 拖拽
let dragState = {
    dragging: false, draggedRow: null, currentTarget: null,
    insertPos: null, ghost: null, scrollRAF: null, scrollSpeed: 0,
    context: '', isTouch: false, touchId: null
};
const SCROLL_ZONE = 100, SCROLL_MAX = 25;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    const parts = location.pathname.split('/');
    regionId = parseInt(parts[parts.length - 1]);
    if (!regionId || isNaN(regionId)) { location.href = '/'; return; }

    initParticles();
    updateTime(); setInterval(updateTime, 1000);
    checkAuth();
    initPageNav();
    initHandSwitch();
    initContribTabs();
});

// ==================== 粒子背景 ====================
function initParticles() {
    const c = document.getElementById('particleCanvas'), ctx = c.getContext('2d');
    let ps = [];
    function resize() { c.width = innerWidth; c.height = innerHeight; }
    resize(); addEventListener('resize', resize);
    class P {
        constructor() { this.r(); }
        r() {
            this.x = Math.random() * c.width; this.y = Math.random() * c.height;
            this.s = Math.random() * 2 + 0.5;
            this.sx = (Math.random() - 0.5) * 0.4; this.sy = (Math.random() - 0.5) * 0.4;
            this.o = Math.random() * 0.4 + 0.1;
            this.c = ['#ffd700', '#3b82f6', '#8b5cf6', '#06b6d4'][Math.floor(Math.random() * 4)];
        }
        u() {
            this.x += this.sx; this.y += this.sy;
            if (this.x < 0 || this.x > c.width) this.sx *= -1;
            if (this.y < 0 || this.y > c.height) this.sy *= -1;
        }
        d() {
            ctx.beginPath(); ctx.arc(this.x, this.y, this.s, 0, Math.PI * 2);
            ctx.fillStyle = this.c; ctx.globalAlpha = this.o; ctx.fill(); ctx.globalAlpha = 1;
        }
    }
    for (let i = 0; i < 50; i++) ps.push(new P());
    (function a() {
        ctx.clearRect(0, 0, c.width, c.height);
        ps.forEach(p => { p.u(); p.d(); });
        for (let i = 0; i < ps.length; i++) {
            for (let j = i + 1; j < ps.length; j++) {
                const dx = ps[i].x - ps[j].x, dy = ps[i].y - ps[j].y, d = Math.sqrt(dx * dx + dy * dy);
                if (d < 150) {
                    ctx.beginPath(); ctx.strokeStyle = '#3b82f6';
                    ctx.globalAlpha = 0.04 * (1 - d / 150); ctx.lineWidth = 0.5;
                    ctx.moveTo(ps[i].x, ps[i].y); ctx.lineTo(ps[j].x, ps[j].y);
                    ctx.stroke(); ctx.globalAlpha = 1;
                }
            }
        }
        requestAnimationFrame(a);
    })();
}

// ==================== 时间 ====================
function updateTime() {
    const n = new Date(), p = v => String(v).padStart(2, '0');
    const w = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const s = `${n.getFullYear()}年${p(n.getMonth() + 1)}月${p(n.getDate())}日 ${w[n.getDay()]} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
    const el1 = document.getElementById('currentTime'); if (el1) el1.textContent = s;
    const el2 = document.getElementById('contribTime'); if (el2) el2.textContent = s;
}

// ==================== 认证 ====================
function checkAuth() {
    const token = localStorage.getItem('authToken');
    if (!token) { loadRegionInfo(); return; }
    fetch('/api/verify', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.json()).then(d => {
            if (d.valid) { currentUser = d.user; authToken = token; showUserUI(); }
            else { localStorage.removeItem('authToken'); }
            loadRegionInfo();
        })
        .catch(() => { localStorage.removeItem('authToken'); loadRegionInfo(); });
}

function showUserUI() {
    document.getElementById('loginArea').style.display = 'none';
    document.getElementById('userArea').style.display = 'flex';
    document.getElementById('userName').textContent = currentUser.nickname || currentUser.username;
}

function hideUserUI() {
    document.getElementById('loginArea').style.display = '';
    document.getElementById('userArea').style.display = 'none';
    isAdmin = false; isOwner = false;
    updateAdminUI();
}

function updateAdminUI() {
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = isAdmin ? '' : 'none'; });
    document.querySelectorAll('.owner-only').forEach(el => { el.style.display = isOwner ? '' : 'none'; });
    renderPlayers();
    renderContribMembers();
}

// ==================== 加载地区信息 ====================
function loadRegionInfo() {
    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    fetch(`/api/regions/${regionId}`, { headers })
        .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
        .then(info => {
            regionInfo = info;
            isAdmin = info.isAdmin || false;
            isOwner = info.isOwner || false;
            document.getElementById('regionTitle').textContent = info.name + '腕力排行榜';
            document.getElementById('contribTitle').textContent = info.name + '推广贡献榜';
            document.title = info.name + ' - 腕力排行榜';
            document.getElementById('footerText').textContent = `💪 ${info.name} · 实力铸就荣耀 💪`;
            updateAdminUI();
            loadPlayers();
        })
        .catch(() => { showToast('地区不存在', 'error'); setTimeout(() => location.href = '/', 1500); });
}

// ==================== 登录 ====================
function showLoginModal() {
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    openModal('loginModal');
}
function doLogin() {
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value.trim();
    if (!u || !p) { showToast('请输入用户名和密码', 'error'); return; }
    fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
    }).then(r => r.json()).then(d => {
        if (d.token) {
            currentUser = d.user; authToken = d.token;
            localStorage.setItem('authToken', d.token);
            showUserUI(); closeModal('loginModal'); showToast('登录成功！', 'success');
            loadRegionInfo();
        } else showToast(d.error || '登录失败', 'error');
    }).catch(() => showToast('网络错误', 'error'));
}

// ==================== 注册 ====================
function showRegisterModal() {
    document.getElementById('regUsername').value = '';
    document.getElementById('regNickname').value = '';
    document.getElementById('regPassword').value = '';
    document.getElementById('regConfirm').value = '';
    openModal('registerModal');
}
function doRegister() {
    const u = document.getElementById('regUsername').value.trim();
    const n = document.getElementById('regNickname').value.trim();
    const p = document.getElementById('regPassword').value.trim();
    const c = document.getElementById('regConfirm').value.trim();
    if (!u || !p) { showToast('请输入用户名和密码', 'error'); return; }
    if (u.length < 3) { showToast('用户名至少3个字符', 'error'); return; }
    if (p.length < 6) { showToast('密码至少6个字符', 'error'); return; }
    if (p !== c) { showToast('两次密码不一致', 'error'); return; }
    fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p, nickname: n || u })
    }).then(r => r.json()).then(d => {
        if (d.success) {
            currentUser = d.user; authToken = d.token;
            localStorage.setItem('authToken', d.token);
            showUserUI(); closeModal('registerModal'); showToast('注册成功！', 'success');
            loadRegionInfo();
        } else showToast(d.error || '注册失败', 'error');
    }).catch(() => showToast('网络错误', 'error'));
}

// ==================== 登出 ====================
function logout() {
    currentUser = null; authToken = ''; isAdmin = false; isOwner = false;
    localStorage.removeItem('authToken');
    hideUserUI(); showToast('已退出', 'info');
}

// ==================== 页面导航 ====================
function initPageNav() {
    document.querySelectorAll('.nav-switch-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;
            if (page === currentPage) return;
            currentPage = page;
            document.querySelectorAll('.nav-switch-btn[data-page]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
            document.getElementById(page + 'Page').classList.add('active');
            if (page === 'contribution') loadContribMembers();
        });
    });
}

// ==================== 手别切换 ====================
function initHandSwitch() {
    document.querySelectorAll('.hand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.hand === currentHand) return;
            currentHand = btn.dataset.hand;
            document.querySelectorAll('.hand-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadPlayers();
        });
    });
}

// ==================== 贡献榜标签切换 ====================
function initContribTabs() {
    document.querySelectorAll('.contrib-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.ctype === currentContribType) return;
            currentContribType = tab.dataset.ctype;
            document.querySelectorAll('.contrib-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('contribValueHeader').textContent = currentContribType === 'resource' ? '成员贡献值' : '成员荣誉';
            loadContribMembers();
        });
    });
}

// ==================== 腕力排行榜 ====================
function loadPlayers() {
    if (!regionId) return;
    fetch(`/api/regions/${regionId}/players/${currentHand}`)
        .then(r => r.json()).then(d => { playersData = d; renderPlayers(); })
        .catch(() => showToast('加载失败', 'error'));
}

function renderPlayers() {
    const tbody = document.getElementById('rankingBody'), empty = document.getElementById('emptyState');
    if (!tbody) return;
    if (!playersData.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    let h = '';
    playersData.forEach((p, i) => {
        const tier = p.rank_position <= 10 ? 'heaven' : p.rank_position <= 20 ? 'earth' : 'human';
        const rc = p.rank_position === 1 ? 'rank-1' : p.rank_position === 2 ? 'rank-2' : p.rank_position === 3 ? 'rank-3' : 'rank-normal';
        const tc = tier === 'heaven' ? 'title-heaven' : tier === 'earth' ? 'title-earth' : 'title-human';
        const av = p.avatar
            ? `<img src="${p.avatar}" class="avatar ${isAdmin ? 'avatar-editable' : ''}" onclick="${isAdmin ? 'clickAvatar(' + p.id + ')' : ''}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="avatar-placeholder ${isAdmin ? 'avatar-editable' : ''}" style="display:none" onclick="${isAdmin ? 'clickAvatar(' + p.id + ')' : ''}"><i class="fas fa-user"></i></div>`
            : `<div class="avatar-placeholder ${isAdmin ? 'avatar-editable' : ''}" onclick="${isAdmin ? 'clickAvatar(' + p.id + ')' : ''}"><i class="fas fa-${isAdmin ? 'camera' : 'user'}"></i></div>`;
        h += `<tr class="tier-${tier}" data-id="${p.id}" data-name="${esc(p.name)}" draggable="${isAdmin}" style="animation-delay:${i * 0.04}s">
            <td><span class="rank-badge ${rc}">${p.rank_position}</span></td>
            <td><div class="avatar-wrapper">${av}</div></td>
            <td><span class="player-name">${esc(p.name)}</span></td>
            <td><span class="title-badge ${tc}">${p.title}</span></td>
            <td><span class="power-value">${esc(p.power || '-')}</span></td>
            <td>${p.skill ? `<span class="skill-tag">${esc(p.skill)}</span>` : '<span style="color:var(--text-secondary)">-</span>'}</td>
            ${isAdmin ? `<td class="admin-only"><div class="action-btns">
                <button class="action-btn drag-btn"><i class="fas fa-grip-vertical"></i></button>
                <button class="action-btn edit-btn" onclick="showEditModal(${p.id})"><i class="fas fa-edit"></i></button>
                <button class="action-btn delete-btn" onclick="confirmDelete(${p.id},'${esc(p.name)}')"><i class="fas fa-trash-alt"></i></button>
            </div></td>` : ''}</tr>`;
    });
    tbody.innerHTML = h;
    if (isAdmin) bindDrag('rankingBody', 'ranking');
}

// ==================== 选手 CRUD ====================
function showAddModal() {
    document.getElementById('addHand').value = currentHand;
    document.getElementById('addName').value = '';
    document.getElementById('addPower').value = '';
    document.getElementById('addSkill').value = '';
    openModal('addModal');
}
function doAddPlayer() {
    const hand = document.getElementById('addHand').value, name = document.getElementById('addName').value.trim(),
        power = document.getElementById('addPower').value.trim(), skill = document.getElementById('addSkill').value.trim();
    if (!name) { showToast('请输入姓名', 'error'); return; }
    fetch(`/api/regions/${regionId}/players`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ hand, name, power, skill })
    }).then(r => r.json()).then(d => {
        if (d.success) { closeModal('addModal'); showToast('添加成功', 'success'); if (hand === currentHand) loadPlayers(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
}
function showEditModal(id) {
    const p = playersData.find(x => x.id === id); if (!p) return;
    document.getElementById('editId').value = id;
    document.getElementById('editName').value = p.name;
    document.getElementById('editPower').value = p.power || '';
    document.getElementById('editSkill').value = p.skill || '';
    openModal('editModal');
}
function doEditPlayer() {
    const id = document.getElementById('editId').value, name = document.getElementById('editName').value.trim(),
        power = document.getElementById('editPower').value.trim(), skill = document.getElementById('editSkill').value.trim();
    if (!name) { showToast('请输入姓名', 'error'); return; }
    fetch(`/api/regions/${regionId}/players/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ name, power, skill })
    }).then(r => r.json()).then(d => {
        if (d.success) { closeModal('editModal'); showToast('修改成功', 'success'); loadPlayers(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
}
function confirmDelete(id, name) {
    showConfirm(`确定移除"${name}"？`, () => {
        fetch(`/api/regions/${regionId}/players/${id}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` }
        }).then(r => r.json()).then(d => {
            if (d.success) { showToast('已移除', 'success'); loadPlayers(); }
            else showToast(d.error, 'error');
        }).catch(() => showToast('网络错误', 'error'));
    });
}
function clickAvatar(id) { if (!isAdmin) return; avatarUploadId = id; document.getElementById('avatarInput').click(); }
function uploadAvatar(e) {
    const f = e.target.files[0]; if (!f || !avatarUploadId) return;
    const fd = new FormData(); fd.append('avatar', f);
    fetch(`/api/regions/${regionId}/players/${avatarUploadId}/avatar`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` }, body: fd
    }).then(r => r.json()).then(d => {
        if (d.success) { showToast('头像上传成功', 'success'); loadPlayers(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
    e.target.value = ''; avatarUploadId = null;
}

// ==================== 贡献榜 ====================
function loadContribMembers() {
    if (!regionId) return;
    fetch(`/api/regions/${regionId}/contribution/${currentContribType}`)
        .then(r => r.json()).then(d => { contribData = d; renderContribMembers(); })
        .catch(() => showToast('加载失败', 'error'));
}

function renderContribMembers() {
    const body = document.getElementById('contribBody'), empty = document.getElementById('contribEmpty');
    if (!body) return;
    const header = document.querySelector('.contrib-header');
    if (header) { if (isAdmin) header.classList.remove('no-action'); else header.classList.add('no-action'); }
    if (!contribData.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    let h = '';
    contribData.forEach((m, i) => {
        const avClass = isAdmin ? 'contrib-avatar-edit' : '';
        const av = m.avatar
            ? `<img src="${m.avatar}" class="contrib-avatar ${avClass}" onclick="${isAdmin ? 'clickContribAvatar(' + m.id + ')' : ''}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="contrib-avatar-ph ${avClass}" style="display:none" onclick="${isAdmin ? 'clickContribAvatar(' + m.id + ')' : ''}"><i class="fas fa-user"></i></div>`
            : `<div class="contrib-avatar-ph ${avClass}" onclick="${isAdmin ? 'clickContribAvatar(' + m.id + ')' : ''}"><i class="fas fa-${isAdmin ? 'camera' : 'user'}"></i></div>`;
        h += `<div class="contrib-row ${isAdmin ? '' : 'no-action'}" data-id="${m.id}" data-name="${esc(m.name)}" draggable="${isAdmin}" style="animation-delay:${i * 0.04}s">
            <div class="contrib-rank">第${m.rank_position}名</div>
            <div class="contrib-avatar-wrap">${av}</div>
            <div class="contrib-name-value"><span class="contrib-name">${esc(m.name)}</span><span class="contrib-value">${esc(m.value || '')}</span></div>
            <div class="contrib-note" onclick="openNoteHistory(${m.id})" title="点击查看历史">${esc(m.latestNote || '-')}</div>
            <div class="contrib-total">${esc(m.total || '-')}</div>
            ${isAdmin ? `<div class="contrib-actions">
                <button class="action-btn drag-btn"><i class="fas fa-grip-vertical"></i></button>
                <button class="action-btn edit-btn" onclick="showContribEditModal(${m.id})"><i class="fas fa-edit"></i></button>
                <button class="action-btn delete-btn" onclick="confirmDeleteContrib(${m.id},'${esc(m.name)}')"><i class="fas fa-trash-alt"></i></button>
            </div>` : ''}</div>`;
    });
    body.innerHTML = h;
    if (isAdmin) bindDrag('contribBody', 'contribution');
}

// ==================== 贡献榜 CRUD ====================
function showContribAddModal() {
    document.getElementById('contribEditId').value = '';
    document.getElementById('contribModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> 添加成员';
    document.getElementById('contribName').value = '';
    document.getElementById('contribValue').value = '';
    document.getElementById('contribNote').value = '';
    document.getElementById('contribTotal').value = '';
    openModal('contribModal');
}
function showContribEditModal(id) {
    const m = contribData.find(x => x.id === id); if (!m) return;
    document.getElementById('contribEditId').value = id;
    document.getElementById('contribModalTitle').innerHTML = '<i class="fas fa-edit"></i> 编辑成员';
    document.getElementById('contribName').value = m.name;
    document.getElementById('contribValue').value = m.value || '';
    document.getElementById('contribNote').value = '';
    document.getElementById('contribTotal').value = m.total || '';
    openModal('contribModal');
}
function doSaveContribMember() {
    const id = document.getElementById('contribEditId').value, name = document.getElementById('contribName').value.trim(),
        value = document.getElementById('contribValue').value.trim(), note = document.getElementById('contribNote').value.trim(),
        total = document.getElementById('contribTotal').value.trim();
    if (!name) { showToast('请输入名称', 'error'); return; }
    if (id) {
        fetch(`/api/regions/${regionId}/contribution/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ name, value, total })
        }).then(r => r.json()).then(d => {
            if (d.success) {
                if (note) {
                    fetch(`/api/contribution/${id}/notes`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                        body: JSON.stringify({ text: note })
                    }).then(() => { closeModal('contribModal'); showToast('修改成功', 'success'); loadContribMembers(); });
                } else { closeModal('contribModal'); showToast('修改成功', 'success'); loadContribMembers(); }
            } else showToast(d.error, 'error');
        }).catch(() => showToast('网络错误', 'error'));
    } else {
        fetch(`/api/regions/${regionId}/contribution`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ type: currentContribType, name, value, total, note })
        }).then(r => r.json()).then(d => {
            if (d.success) { closeModal('contribModal'); showToast('添加成功', 'success'); loadContribMembers(); }
            else showToast(d.error, 'error');
        }).catch(() => showToast('网络错误', 'error'));
    }
}
function confirmDeleteContrib(id, name) {
    showConfirm(`确定移除"${name}"？`, () => {
        fetch(`/api/regions/${regionId}/contribution/${id}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` }
        }).then(r => r.json()).then(d => {
            if (d.success) { showToast('已移除', 'success'); loadContribMembers(); }
            else showToast(d.error, 'error');
        }).catch(() => showToast('网络错误', 'error'));
    });
}
function clickContribAvatar(id) { if (!isAdmin) return; contribAvatarUploadId = id; document.getElementById('contribAvatarInput').click(); }
function uploadContribAvatar(e) {
    const f = e.target.files[0]; if (!f || !contribAvatarUploadId) return;
    const fd = new FormData(); fd.append('avatar', f);
    fetch(`/api/regions/${regionId}/contribution/${contribAvatarUploadId}/avatar`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` }, body: fd
    }).then(r => r.json()).then(d => {
        if (d.success) { showToast('头像上传成功', 'success'); loadContribMembers(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
    e.target.value = ''; contribAvatarUploadId = null;
}

// ==================== 说明历史 ====================
function openNoteHistory(memberId) {
    noteHistoryMemberId = memberId;
    fetch(`/api/contribution/${memberId}/notes`).then(r => r.json()).then(notes => {
        const list = document.getElementById('noteHistoryList');
        if (!notes.length) {
            list.innerHTML = '<div class="note-empty">暂无说明记录</div>';
        } else {
            let h = '';
            notes.forEach(n => {
                const safeText = esc(n.note_text).replace(/'/g, "\\'");
                h += `<div class="note-item"><div class="note-item-text">${esc(n.note_text)}</div>${isAdmin ? `<div class="note-item-actions"><button class="note-item-btn edit" onclick="editNote(${n.id},'${safeText}')">编辑</button><button class="note-item-btn del" onclick="deleteNote(${n.id})">删除</button></div>` : ''}</div>`;
            });
            list.innerHTML = h;
        }
        openModal('noteHistoryModal');
    }).catch(() => showToast('加载失败', 'error'));
}
function doAddNote() {
    const input = document.getElementById('newNoteInput'), text = input.value.trim();
    if (!text) { showToast('请输入说明', 'error'); return; }
    fetch(`/api/contribution/${noteHistoryMemberId}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ text })
    }).then(r => r.json()).then(d => {
        if (d.success) { input.value = ''; openNoteHistory(noteHistoryMemberId); loadContribMembers(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
}
function editNote(noteId, oldText) {
    const newText = prompt('编辑说明:', oldText);
    if (newText === null || !newText.trim()) return;
    fetch(`/api/contribution/notes/${noteId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ text: newText.trim() })
    }).then(r => r.json()).then(d => {
        if (d.success) { openNoteHistory(noteHistoryMemberId); loadContribMembers(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
}
function deleteNote(noteId) {
    if (!confirm('确定删除这条说明？')) return;
    fetch(`/api/contribution/notes/${noteId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` }
    }).then(r => r.json()).then(d => {
        if (d.success) { openNoteHistory(noteHistoryMemberId); loadContribMembers(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
}

// ==================== 管理面板 ====================
function showAdminPanel() {
    if (!isAdmin) return;
    document.getElementById('adminRegionName').value = regionInfo.name || '';
    document.getElementById('adminRegionProvince').value = regionInfo.province || '';
    document.getElementById('adminRegionDesc').value = regionInfo.description || '';
    loadAdminList();
    openModal('adminPanelModal');
}
function loadAdminList() {
    fetch(`/api/regions/${regionId}/admins`).then(r => r.json()).then(admins => {
        const list = document.getElementById('adminList');
        let h = '';
        admins.forEach(a => {
            h += `<div class="admin-list-item">
                <div class="admin-info">
                    <span>${esc(a.nickname || a.username)}</span>
                    <span class="role-badge ${a.role === 'owner' ? 'role-owner' : 'role-admin'}">${a.role === 'owner' ? '创建者' : '管理员'}</span>
                </div>
                ${isOwner && a.role !== 'owner' ? `<button class="action-btn delete-btn" onclick="removeAdmin(${a.user_id})"><i class="fas fa-times"></i></button>` : ''}
            </div>`;
        });
        list.innerHTML = h;
    });
}
function doUpdateRegion() {
    const name = document.getElementById('adminRegionName').value.trim(),
        province = document.getElementById('adminRegionProvince').value.trim(),
        desc = document.getElementById('adminRegionDesc').value.trim();
    if (!name) { showToast('请输入名称', 'error'); return; }
    fetch(`/api/regions/${regionId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ name, province, description: desc })
    }).then(r => r.json()).then(d => {
        if (d.success) { showToast('更新成功', 'success'); loadRegionInfo(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
}
function doAddAdmin() {
    const username = document.getElementById('newAdminUsername').value.trim();
    if (!username) { showToast('请输入用户名', 'error'); return; }
    fetch(`/api/regions/${regionId}/admins`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ username })
    }).then(r => r.json()).then(d => {
        if (d.success) { document.getElementById('newAdminUsername').value = ''; showToast('添加成功', 'success'); loadAdminList(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
}
function removeAdmin(userId) {
    if (!confirm('确定移除该管理员？')) return;
    fetch(`/api/regions/${regionId}/admins/${userId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` }
    }).then(r => r.json()).then(d => {
        if (d.success) { showToast('已移除', 'success'); loadAdminList(); }
        else showToast(d.error, 'error');
    }).catch(() => showToast('网络错误', 'error'));
}
function confirmDeleteRegion() {
    showConfirm('确定删除此地区？所有数据将被永久删除！', () => {
        fetch(`/api/regions/${regionId}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` }
        }).then(r => r.json()).then(d => {
            if (d.success) { showToast('已删除', 'success'); setTimeout(() => location.href = '/', 1000); }
            else showToast(d.error, 'error');
        }).catch(() => showToast('网络错误', 'error'));
    });
}

// ==================== 通用拖拽系统 ====================
function bindDrag(containerId, context) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('dragstart', e => {
        const row = e.target.closest('[data-id]'); if (!row) return;
        dragState = { dragging: true, draggedRow: row, currentTarget: null, insertPos: null, ghost: null, scrollRAF: null, scrollSpeed: 0, context: context, isTouch: false, touchId: null };
        row.classList.add('dragging'); document.body.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', '');
        const img = new Image(); img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);
        createGhost(row.dataset.name || '移动中');
        document.addEventListener('dragover', onGlobalDragOver); document.addEventListener('drop', onGlobalDrop);
        startScroll();
    });
    container.addEventListener('dragend', () => cleanDrag());
    container.addEventListener('touchstart', function (e) {
        const dragBtn = e.target.closest('.drag-btn'); if (!dragBtn) return;
        const row = dragBtn.closest('[data-id]'); if (!row) return;
        e.preventDefault();
        const touch = e.touches[0];
        dragState = { dragging: true, draggedRow: row, currentTarget: null, insertPos: null, ghost: null, scrollRAF: null, scrollSpeed: 0, context: context, isTouch: true, touchId: touch.identifier };
        row.classList.add('dragging'); document.body.classList.add('is-dragging');
        createGhost(row.dataset.name || '移动中');
        if (dragState.ghost) { dragState.ghost.style.left = (touch.clientX + 15) + 'px'; dragState.ghost.style.top = (touch.clientY - 10) + 'px'; }
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
        document.addEventListener('touchcancel', onTouchCancel);
        startScroll();
    }, { passive: false });
}
function onGlobalDragOver(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!dragState.dragging) return;
    if (dragState.ghost) { dragState.ghost.style.left = (e.clientX + 15) + 'px'; dragState.ghost.style.top = (e.clientY - 10) + 'px'; }
    handleAutoScroll(e.clientY); handleTargetDetect(e.clientX, e.clientY);
}
function onGlobalDrop(e) { e.preventDefault(); performDrop(); }
function onTouchMove(e) {
    if (!dragState.dragging || !dragState.isTouch) return; e.preventDefault();
    const touch = findTouch(e.touches); if (!touch) return;
    if (dragState.ghost) { dragState.ghost.style.left = (touch.clientX + 15) + 'px'; dragState.ghost.style.top = (touch.clientY - 10) + 'px'; }
    handleAutoScroll(touch.clientY); handleTargetDetect(touch.clientX, touch.clientY);
}
function onTouchEnd(e) { if (!dragState.dragging || !dragState.isTouch) return; e.preventDefault(); performDrop(); }
function onTouchCancel() { cleanDrag(); }
function findTouch(touches) { for (let i = 0; i < touches.length; i++) { if (touches[i].identifier === dragState.touchId) return touches[i]; } return null; }
function handleAutoScroll(clientY) {
    const vh = innerHeight;
    if (clientY < SCROLL_ZONE) { dragState.scrollSpeed = -SCROLL_MAX * Math.pow(1 - clientY / SCROLL_ZONE, 2); }
    else if (clientY > vh - SCROLL_ZONE) { dragState.scrollSpeed = SCROLL_MAX * Math.pow(1 - (vh - clientY) / SCROLL_ZONE, 2); }
    else { dragState.scrollSpeed = 0; }
}
function handleTargetDetect(clientX, clientY) {
    const target = getRow(clientX, clientY);
    if (!target || target === dragState.draggedRow) { clearHL(); return; }
    const rect = target.getBoundingClientRect();
    const pos = clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
    if (target === dragState.currentTarget && pos === dragState.insertPos) return;
    clearHL(); dragState.currentTarget = target; dragState.insertPos = pos;
    target.classList.add('drag-target');
    target.classList.add(pos === 'top' ? 'drag-insert-top' : 'drag-insert-bottom');
}
function performDrop() {
    if (!dragState.dragging || !dragState.currentTarget || !dragState.draggedRow) { cleanDrag(); return; }
    const ctx = dragState.context, containerId = ctx === 'ranking' ? 'rankingBody' : 'contribBody';
    const container = document.getElementById(containerId);
    const rows = Array.from(container.querySelectorAll('[data-id]'));
    const draggedId = parseInt(dragState.draggedRow.dataset.id), targetId = parseInt(dragState.currentTarget.dataset.id);
    const pos = dragState.insertPos;
    let ids = rows.map(r => parseInt(r.dataset.id));
    const fi = ids.indexOf(draggedId); if (fi === -1) { cleanDrag(); return; }
    ids.splice(fi, 1);
    let ti = ids.indexOf(targetId); if (ti === -1) { cleanDrag(); return; }
    if (pos === 'bottom') ti++;
    ids.splice(ti, 0, draggedId);
    cleanDrag();
    if (ctx === 'ranking') {
        fetch(`/api/regions/${regionId}/players/reorder`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ hand: currentHand, orderedIds: ids })
        }).then(r => r.json()).then(d => {
            if (d.success) { showToast('排序已更新', 'success'); loadPlayers(); } else { showToast(d.error, 'error'); loadPlayers(); }
        }).catch(() => { showToast('网络错误', 'error'); loadPlayers(); });
    } else {
        fetch(`/api/regions/${regionId}/contribution/reorder`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ type: currentContribType, orderedIds: ids })
        }).then(r => r.json()).then(d => {
            if (d.success) { showToast('排序已更新', 'success'); loadContribMembers(); } else { showToast(d.error, 'error'); loadContribMembers(); }
        }).catch(() => { showToast('网络错误', 'error'); loadContribMembers(); });
    }
}
function getRow(x, y) {
    if (!dragState.draggedRow) return null;
    const old = dragState.draggedRow.style.visibility;
    dragState.draggedRow.style.visibility = 'hidden';
    const el = document.elementFromPoint(x, y);
    dragState.draggedRow.style.visibility = old;
    if (!el) return null;
    const row = el.closest('[data-id]');
    return row === dragState.draggedRow ? null : row;
}
function clearHL() {
    if (dragState.currentTarget) {
        dragState.currentTarget.classList.remove('drag-target', 'drag-insert-top', 'drag-insert-bottom');
        dragState.currentTarget = null; dragState.insertPos = null;
    }
}
function createGhost(n) {
    removeGhost(); const g = document.createElement('div'); g.className = 'drag-ghost';
    g.innerHTML = `<i class="fas fa-arrows-alt" style="margin-right:6px"></i>${n}`;
    document.body.appendChild(g); dragState.ghost = g;
}
function removeGhost() { if (dragState.ghost) { dragState.ghost.remove(); dragState.ghost = null; } }
function startScroll() { (function loop() { if (!dragState.dragging) return; if (dragState.scrollSpeed) scrollBy(0, dragState.scrollSpeed); dragState.scrollRAF = requestAnimationFrame(loop); })(); }
function stopScroll() { if (dragState.scrollRAF) { cancelAnimationFrame(dragState.scrollRAF); dragState.scrollRAF = null; } }
function cleanDrag() {
    if (dragState.draggedRow) { dragState.draggedRow.classList.remove('dragging'); dragState.draggedRow.style.visibility = ''; }
    clearHL(); removeGhost(); stopScroll(); document.body.classList.remove('is-dragging');
    document.removeEventListener('dragover', onGlobalDragOver); document.removeEventListener('drop', onGlobalDrop);
    document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd); document.removeEventListener('touchcancel', onTouchCancel);
    dragState.dragging = false; dragState.draggedRow = null; dragState.scrollSpeed = 0; dragState.isTouch = false; dragState.touchId = null;
}

// ==================== 工具函数 ====================
function esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function openModal(id) { document.getElementById(id).classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('show'); document.body.style.overflow = ''; }
document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) { o.classList.remove('show'); document.body.style.overflow = ''; } });
});

function showConfirm(msg, onYes) {
    let o = document.querySelector('.confirm-overlay'); if (o) o.remove();
    o = document.createElement('div'); o.className = 'confirm-overlay show';
    o.innerHTML = `<div class="confirm-box"><div class="confirm-icon"><i class="fas fa-exclamation-triangle"></i></div><div class="confirm-message">${msg}</div><div class="confirm-btns"><button class="confirm-btn confirm-no" onclick="this.closest('.confirm-overlay').remove()">取消</button><button class="confirm-btn confirm-yes" id="cfmY">确定</button></div></div>`;
    document.body.appendChild(o);
    document.getElementById('cfmY').addEventListener('click', () => { o.remove(); onYes(); });
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });
}

function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    const ic = { success: '<i class="fas fa-check-circle"></i>', error: '<i class="fas fa-times-circle"></i>', info: '<i class="fas fa-info-circle"></i>' };
    t.className = `toast ${type}`; t.innerHTML = `${ic[type] || ''} ${msg}`;
    t.offsetHeight; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}