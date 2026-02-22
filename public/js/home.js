 // ==================== 全局状态 ====================
let currentUser = null;
let authToken = '';
let regionsData = [];
let currentProvince = '';

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    updateTime();
    setInterval(updateTime, 1000);
    checkAuth();
    loadProvinces();
    loadRegions();
    initSearch();
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
    const el = document.getElementById('currentTime');
    if (el) el.textContent = s;
}

// ==================== 认证 ====================
function checkAuth() {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    fetch('/api/verify', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.json()).then(d => {
            if (d.valid) {
                currentUser = d.user;
                authToken = token;
                showUserUI();
            } else {
                localStorage.removeItem('authToken');
            }
        })
        .catch(() => { localStorage.removeItem('authToken'); });
}

function showUserUI() {
    document.getElementById('loginArea').style.display = 'none';
    document.getElementById('userArea').style.display = 'flex';
    document.getElementById('userName').textContent = currentUser.nickname || currentUser.username;
    document.getElementById('createRegionBtn').style.display = '';
}

function hideUserUI() {
    document.getElementById('loginArea').style.display = '';
    document.getElementById('userArea').style.display = 'none';
    document.getElementById('createRegionBtn').style.display = 'none';
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
    })
        .then(r => r.json()).then(d => {
            if (d.token) {
                currentUser = d.user;
                authToken = d.token;
                localStorage.setItem('authToken', d.token);
                showUserUI();
                closeModal('loginModal');
                showToast('登录成功！', 'success');
            } else showToast(d.error || '登录失败', 'error');
        })
        .catch(() => showToast('网络错误', 'error'));
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p, nickname: n || u })
    })
        .then(r => r.json()).then(d => {
            if (d.success) {
                currentUser = d.user;
                authToken = d.token;
                localStorage.setItem('authToken', d.token);
                showUserUI();
                closeModal('registerModal');
                showToast('注册成功！', 'success');
            } else showToast(d.error || '注册失败', 'error');
        })
        .catch(() => showToast('网络错误', 'error'));
}

// ==================== 登出 ====================
function logout() {
    currentUser = null;
    authToken = '';
    localStorage.removeItem('authToken');
    hideUserUI();
    showToast('已退出', 'info');
}

// ==================== 修改密码 ====================
function showChangePasswordModal() {
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    openModal('passwordModal');
}
function doChangePassword() {
    const o = document.getElementById('oldPassword').value.trim();
    const n = document.getElementById('newPassword').value.trim();
    const c = document.getElementById('confirmPassword').value.trim();
    if (!o || !n || !c) { showToast('请填写所有字段', 'error'); return; }
    if (n !== c) { showToast('两次密码不一致', 'error'); return; }
    if (n.length < 6) { showToast('密码不能少于6位', 'error'); return; }
    fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ oldPassword: o, newPassword: n })
    })
        .then(r => r.json()).then(d => {
            if (d.success) { closeModal('passwordModal'); showToast('密码修改成功', 'success'); }
            else showToast(d.error, 'error');
        }).catch(() => showToast('网络错误', 'error'));
}

// ==================== 省份筛选 ====================
function loadProvinces() {
    fetch('/api/provinces').then(r => r.json()).then(provinces => {
        const container = document.getElementById('provinceList');
        let h = '';
        provinces.forEach(p => {
            h += `<button class="province-btn" data-province="${esc(p)}">${esc(p)}</button>`;
        });
        container.innerHTML = h;
        // 绑定事件
        document.querySelectorAll('.province-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.province-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentProvince = btn.dataset.province;
                loadRegions();
            });
        });
    });
}

// ==================== 搜索 ====================
function initSearch() {
    let timer;
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => loadRegions(), 300);
    });
}

// ==================== 加载地区 ====================
function loadRegions() {
    const keyword = document.getElementById('searchInput').value.trim();
    let url = '/api/regions?';
    if (currentProvince) url += `province=${encodeURIComponent(currentProvince)}&`;
    if (keyword) url += `keyword=${encodeURIComponent(keyword)}&`;

    fetch(url).then(r => r.json()).then(data => {
        regionsData = data;
        renderRegions();
        updateStats();
    }).catch(() => showToast('加载失败', 'error'));
}

function renderRegions() {
    const grid = document.getElementById('regionsGrid');
    const empty = document.getElementById('emptyState');

    if (!regionsData.length) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    let h = '';
    regionsData.forEach((r, i) => {
        const cover = r.cover_image
            ? `<img src="${r.cover_image}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : '';
        const date = new Date(r.created_at).toLocaleDateString('zh-CN');

        h += `<div class="region-card" onclick="location.href='/region/${r.id}'" style="animation-delay:${i * 0.05}s">
            <div class="region-card-cover">
                ${cover}
                <i class="fas fa-fist-raised cover-placeholder" ${r.cover_image ? 'style="display:none"' : ''}></i>
                <div class="region-card-province">${esc(r.province)}</div>
            </div>
            <div class="region-card-body">
                <div class="region-card-name">${esc(r.name)}</div>
                <div class="region-card-desc">${esc(r.description || '暂无简介')}</div>
                <div class="region-card-stats">
                    <span><i class="fas fa-users"></i> ${r.player_count || 0} 名选手</span>
                    <span><i class="fas fa-hands-helping"></i> ${r.contrib_count || 0} 名贡献者</span>
                </div>
            </div>
            <div class="region-card-footer">
                <span><i class="fas fa-user"></i> ${esc(r.creator_name || '未知')}</span>
                <span>${date}</span>
            </div>
        </div>`;
    });
    grid.innerHTML = h;
}

function updateStats() {
    // 统计
    fetch('/api/regions').then(r => r.json()).then(all => {
        document.getElementById('statRegions').textContent = all.length;
        let total = 0;
        all.forEach(r => total += (r.player_count || 0));
        document.getElementById('statPlayers').textContent = total;
    });
}

// ==================== 创建地区 ====================
function showCreateRegionModal() {
    if (!currentUser) { showToast('请先登录', 'error'); return; }
    document.getElementById('regionName').value = '';
    document.getElementById('regionProvince').value = '';
    document.getElementById('regionDesc').value = '';
    openModal('createRegionModal');
}
function doCreateRegion() {
    const name = document.getElementById('regionName').value.trim();
    const province = document.getElementById('regionProvince').value;
    const desc = document.getElementById('regionDesc').value.trim();
    if (!name) { showToast('请输入地区名称', 'error'); return; }
    if (!province) { showToast('请选择省份', 'error'); return; }
    fetch('/api/regions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ name, province, description: desc })
    })
        .then(r => r.json()).then(d => {
            if (d.success) {
                closeModal('createRegionModal');
                showToast('创建成功！', 'success');
                loadProvinces();
                loadRegions();
            } else showToast(d.error, 'error');
        }).catch(() => showToast('网络错误', 'error'));
}

// ==================== 工具函数 ====================
function esc(t) {
    if (!t) return '';
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

function openModal(id) {
    document.getElementById(id).classList.add('show');
    document.body.style.overflow = 'hidden';
}
function closeModal(id) {
    document.getElementById(id).classList.remove('show');
    document.body.style.overflow = '';
}
document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => {
        if (e.target === o) { o.classList.remove('show'); document.body.style.overflow = ''; }
    });
});

function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    const ic = {
        success: '<i class="fas fa-check-circle"></i>',
        error: '<i class="fas fa-times-circle"></i>',
        info: '<i class="fas fa-info-circle"></i>'
    };
    t.className = `toast ${type}`;
    t.innerHTML = `${ic[type] || ''} ${msg}`;
    t.offsetHeight;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
