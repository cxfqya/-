require('dotenv').config();
const express = require('express');
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
const multer = require('multer');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { put, del } = require('@vercel/blob');

neonConfig.webSocketConstructor = ws;

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'china_wrist_power_2024_secret_key';

// ==================== Multer（内存存储，用于Vercel Blob） ====================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/jpeg|jpg|png|gif|webp/.test(file.mimetype)) return cb(null, true);
        cb(new Error('只允许上传图片文件！'));
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 数据库连接 ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10
});

// ==================== 中间件 ====================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未授权访问' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: '令牌无效或已过期' });
        req.user = user;
        next();
    });
}

function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) req.user = user;
        next();
    });
}

async function checkRegionAdmin(userId, regionId) {
    const { rows } = await pool.query(
        'SELECT * FROM region_admins WHERE user_id = $1 AND region_id = $2',
        [userId, regionId]
    );
    return rows.length > 0;
}

async function checkRegionOwner(userId, regionId) {
    const { rows } = await pool.query(
        'SELECT * FROM region_admins WHERE user_id = $1 AND region_id = $2 AND role = $3',
        [userId, regionId, 'owner']
    );
    return rows.length > 0;
}

async function checkSuperAdmin(userId) {
    const { rows } = await pool.query('SELECT is_super_admin FROM users WHERE id = $1', [userId]);
    return rows.length > 0 && rows[0].is_super_admin === true;
}

async function deleteAvatarFile(avatarUrl) {
    if (!avatarUrl) return;
    try { await del(avatarUrl); } catch (e) { /* ignore blob delete errors */ }
}

function getTitle(r) {
    const n = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    if (r >= 1 && r <= 10) return `天榜第${n[r - 1]}`;
    if (r >= 11 && r <= 20) return `地榜第${n[r - 11]}`;
    if (r >= 21 && r <= 30) return `人榜第${n[r - 21]}`;
    return '';
}

// ==================== 页面路由 ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/region/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'region.html'));
});

// ==================== 认证 API ====================

app.post('/api/register', async (req, res) => {
    try {
        const { username, password, nickname } = req.body;
        if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
        if (username.length < 3) return res.status(400).json({ error: '用户名至少3个字符' });
        if (password.length < 6) return res.status(400).json({ error: '密码至少6个字符' });

        const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.length > 0) return res.status(400).json({ error: '用户名已存在' });

        const hashed = await bcrypt.hash(password, 10);
        const { rows: result } = await pool.query(
            'INSERT INTO users (username, password, nickname) VALUES ($1, $2, $3) RETURNING id',
            [username, hashed, nickname || username]
        );

        const token = jwt.sign(
            { id: result[0].id, username, nickname: nickname || username },
            JWT_SECRET, { expiresIn: '7d' }
        );
        res.json({
            success: true, token,
            user: { id: result[0].id, username, nickname: nickname || username, is_super_admin: false }
        });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (rows.length === 0) return res.status(401).json({ error: '用户名或密码错误' });
        const valid = await bcrypt.compare(password, rows[0].password);
        if (!valid) return res.status(401).json({ error: '用户名或密码错误' });
        const token = jwt.sign(
            { id: rows[0].id, username: rows[0].username, nickname: rows[0].nickname },
            JWT_SECRET, { expiresIn: '7d' }
        );
        res.json({
            token,
            user: { id: rows[0].id, username: rows[0].username, nickname: rows[0].nickname, is_super_admin: rows[0].is_super_admin }
        });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.get('/api/verify', authenticateToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, username, nickname, is_super_admin FROM users WHERE id = $1', [req.user.id]);
        if (rows.length === 0) return res.status(404).json({ valid: false });
        res.json({ valid: true, user: rows[0] });
    } catch (e) { res.status(500).json({ valid: false }); }
});

app.post('/api/change-password', authenticateToken, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
        if (!await bcrypt.compare(oldPassword, rows[0].password)) return res.status(401).json({ error: '原密码错误' });
        if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6个字符' });
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [await bcrypt.hash(newPassword, 10), req.user.id]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// ==================== 地区 API ====================

app.get('/api/regions', async (req, res) => {
    try {
        const { province, keyword } = req.query;
        let sql = `
            SELECT r.*, u.nickname as creator_name,
            (SELECT COUNT(*)::integer FROM players WHERE region_id = r.id) as player_count,
            (SELECT COUNT(*)::integer FROM contribution_members WHERE region_id = r.id) as contrib_count
            FROM regions r LEFT JOIN users u ON r.creator_id = u.id
        `;
        const params = [];
        const conditions = [];
        let idx = 1;

        if (province) { conditions.push(`r.province = $${idx++}`); params.push(province); }
        if (keyword) {
            conditions.push(`(r.name ILIKE $${idx++} OR r.province ILIKE $${idx++})`);
            params.push(`%${keyword}%`, `%${keyword}%`);
        }
        if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
        sql += ' ORDER BY r.created_at DESC';

        const { rows } = await pool.query(sql, params);
        res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.get('/api/provinces', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT DISTINCT province FROM regions WHERE province != '' ORDER BY province");
        res.json(rows.map(r => r.province));
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.get('/api/regions/:id', optionalAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT r.*, u.nickname as creator_name FROM regions r LEFT JOIN users u ON r.creator_id = u.id WHERE r.id = $1`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: '地区不存在' });
        const region = rows[0];
        let isAdmin = false, isOwner = false;
        if (req.user) {
            const isSA = await checkSuperAdmin(req.user.id);
            isAdmin = (await checkRegionAdmin(req.user.id, region.id)) || isSA;
            isOwner = (await checkRegionOwner(req.user.id, region.id)) || isSA;
        }
        res.json({ ...region, isAdmin, isOwner });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const { name, province, description } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入地区名称' });
        if (!province || !province.trim()) return res.status(400).json({ error: '请选择省份' });

        const { rows: existing } = await client.query('SELECT id FROM regions WHERE name = $1', [name.trim()]);
        if (existing.length > 0) return res.status(400).json({ error: '该地区名称已存在' });

        await client.query('BEGIN');
        const { rows: regionRows } = await client.query(
            'INSERT INTO regions (name, province, description, creator_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [name.trim(), province.trim(), description || '', req.user.id]
        );
        await client.query(
            'INSERT INTO region_admins (region_id, user_id, role) VALUES ($1, $2, $3)',
            [regionRows[0].id, req.user.id, 'owner']
        );
        await client.query('COMMIT');
        res.json({ success: true, id: regionRows[0].id });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e); res.status(500).json({ error: '服务器错误' });
    } finally { client.release(); }
});

app.put('/api/regions/:id', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });

        const { name, province, description } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入地区名称' });

        const { rows: existing } = await pool.query('SELECT id FROM regions WHERE name = $1 AND id != $2', [name.trim(), regionId]);
        if (existing.length > 0) return res.status(400).json({ error: '该地区名称已存在' });

        await pool.query(
            'UPDATE regions SET name = $1, province = $2, description = $3, updated_at = NOW() WHERE id = $4',
            [name.trim(), province || '', description || '', regionId]
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.delete('/api/regions/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const regionId = req.params.id;
        const isOwner = await checkRegionOwner(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isOwner && !isSA) return res.status(403).json({ error: '只有创建者或超级管理员可以删除地区' });

        await client.query('BEGIN');
        const { rows: players } = await client.query('SELECT avatar FROM players WHERE region_id = $1', [regionId]);
        const { rows: contribs } = await client.query('SELECT avatar FROM contribution_members WHERE region_id = $1', [regionId]);
        for (const p of players) await deleteAvatarFile(p.avatar);
        for (const c of contribs) await deleteAvatarFile(c.avatar);
        await client.query('DELETE FROM regions WHERE id = $1', [regionId]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { client.release(); }
});

// ==================== 地区管理员 API ====================

app.get('/api/regions/:id/admins', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT ra.*, u.username, u.nickname FROM region_admins ra
             LEFT JOIN users u ON ra.user_id = u.id WHERE ra.region_id = $1
             ORDER BY ra.role DESC, ra.created_at ASC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions/:id/admins', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.id;
        const isOwner = await checkRegionOwner(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isOwner && !isSA) return res.status(403).json({ error: '只有创建者可以添加管理员' });

        const { username } = req.body;
        if (!username) return res.status(400).json({ error: '请输入用户名' });

        const { rows: users } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (users.length === 0) return res.status(404).json({ error: '用户不存在' });

        const { rows: existing } = await pool.query(
            'SELECT id FROM region_admins WHERE region_id = $1 AND user_id = $2', [regionId, users[0].id]
        );
        if (existing.length > 0) return res.status(400).json({ error: '该用户已是管理员' });

        await pool.query('INSERT INTO region_admins (region_id, user_id, role) VALUES ($1, $2, $3)', [regionId, users[0].id, 'admin']);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.delete('/api/regions/:id/admins/:userId', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.id;
        const isOwner = await checkRegionOwner(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isOwner && !isSA) return res.status(403).json({ error: '只有创建者可以移除管理员' });

        const { rows: target } = await pool.query(
            'SELECT role FROM region_admins WHERE region_id = $1 AND user_id = $2', [regionId, req.params.userId]
        );
        if (target.length > 0 && target[0].role === 'owner') return res.status(400).json({ error: '不能移除创建者' });

        await pool.query('DELETE FROM region_admins WHERE region_id = $1 AND user_id = $2', [regionId, req.params.userId]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// ==================== 腕力排行榜 API ====================

app.get('/api/regions/:regionId/players/:hand', async (req, res) => {
    try {
        const { regionId, hand } = req.params;
        if (!['left', 'right'].includes(hand)) return res.status(400).json({ error: '无效参数' });
        const { rows } = await pool.query(
            'SELECT * FROM players WHERE region_id = $1 AND hand = $2 ORDER BY rank_position ASC',
            [regionId, hand]
        );
        res.json(rows.map(p => ({ ...p, title: getTitle(p.rank_position) })));
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions/:regionId/players', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });

        const { hand, name, power, skill } = req.body;
        if (!['left', 'right'].includes(hand)) return res.status(400).json({ error: '无效参数' });
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入姓名' });

        const { rows: mx } = await pool.query(
            'SELECT MAX(rank_position) as m FROM players WHERE region_id = $1 AND hand = $2', [regionId, hand]
        );
        const next = (mx[0].m || 0) + 1;
        if (next > 30) return res.status(400).json({ error: '排行榜已满（最多30人）' });

        await pool.query(
            'INSERT INTO players (region_id, hand, rank_position, name, power, skill) VALUES ($1,$2,$3,$4,$5,$6)',
            [regionId, hand, next, name.trim(), power || '', skill || '']
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.put('/api/regions/:regionId/players/:id', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });

        const { name, power, skill } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入姓名' });

        await pool.query(
            'UPDATE players SET name=$1, power=$2, skill=$3, updated_at=NOW() WHERE id=$4 AND region_id=$5',
            [name.trim(), power || '', skill || '', req.params.id, regionId]
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions/:regionId/players/:id/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });
        if (!req.file) return res.status(400).json({ error: '请选择图片' });

        const { rows } = await pool.query('SELECT avatar FROM players WHERE id=$1 AND region_id=$2', [req.params.id, regionId]);
        if (rows.length > 0) await deleteAvatarFile(rows[0].avatar);

        const blob = await put(`avatars/player-${req.params.id}-${Date.now()}${path.extname(req.file.originalname)}`, req.file.buffer, { access: 'public' });
        await pool.query('UPDATE players SET avatar=$1 WHERE id=$2 AND region_id=$3', [blob.url, req.params.id, regionId]);
        res.json({ success: true, avatar: blob.url });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.delete('/api/regions/:regionId/players/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) { client.release(); return res.status(403).json({ error: '无权限' }); }

        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM players WHERE id=$1 AND region_id=$2', [req.params.id, regionId]);
        if (rows.length === 0) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: '不存在' }); }

        const p = rows[0];
        await deleteAvatarFile(p.avatar);
        await client.query('DELETE FROM players WHERE id=$1', [req.params.id]);

        const { rows: remaining } = await client.query(
            'SELECT id, rank_position FROM players WHERE region_id=$1 AND hand=$2 AND rank_position>$3 ORDER BY rank_position ASC',
            [regionId, p.hand, p.rank_position]
        );
        for (const r of remaining) {
            await client.query('UPDATE players SET rank_position=$1 WHERE id=$2', [r.rank_position - 1, r.id]);
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { client.release(); }
});

app.post('/api/regions/:regionId/players/reorder', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) { client.release(); return res.status(403).json({ error: '无权限' }); }

        const { hand, orderedIds } = req.body;
        if (!['left', 'right'].includes(hand) || !Array.isArray(orderedIds)) {
            client.release(); return res.status(400).json({ error: '无效参数' });
        }

        await client.query('BEGIN');
        for (let i = 0; i < orderedIds.length; i++)
            await client.query('UPDATE players SET rank_position=$1 WHERE id=$2 AND region_id=$3 AND hand=$4', [-(i + 1), orderedIds[i], regionId, hand]);
        for (let i = 0; i < orderedIds.length; i++)
            await client.query('UPDATE players SET rank_position=$1 WHERE id=$2 AND region_id=$3 AND hand=$4', [i + 1, orderedIds[i], regionId, hand]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { client.release(); }
});

// ==================== 贡献榜 API ====================

app.get('/api/regions/:regionId/contribution/:type', async (req, res) => {
    try {
        const { regionId, type } = req.params;
        if (!['resource', 'honor'].includes(type)) return res.status(400).json({ error: '无效参数' });

        const { rows: members } = await pool.query(
            'SELECT * FROM contribution_members WHERE region_id=$1 AND type=$2 ORDER BY rank_position ASC',
            [regionId, type]
        );
        for (const m of members) {
            const { rows: notes } = await pool.query(
                'SELECT * FROM contribution_notes WHERE member_id=$1 ORDER BY created_at ASC', [m.id]
            );
            m.notes = notes;
            m.latestNote = notes.length > 0 ? notes[notes.length - 1].note_text : '';
        }
        res.json(members);
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions/:regionId/contribution', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });

        const { type, name, value, total, note } = req.body;
        if (!['resource', 'honor'].includes(type)) return res.status(400).json({ error: '无效参数' });
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入名称' });

        const { rows: mx } = await pool.query(
            'SELECT MAX(rank_position) as m FROM contribution_members WHERE region_id=$1 AND type=$2', [regionId, type]
        );
        const next = (mx[0].m || 0) + 1;

        const { rows: result } = await pool.query(
            'INSERT INTO contribution_members (region_id, type, rank_position, name, value, total) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
            [regionId, type, next, name.trim(), value || '', total || '']
        );

        if (note && note.trim()) {
            await pool.query('INSERT INTO contribution_notes (member_id, note_text) VALUES ($1,$2)', [result[0].id, note.trim()]);
        }
        res.json({ success: true, id: result[0].id });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.put('/api/regions/:regionId/contribution/:id', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });

        const { name, value, total } = req.body;
        await pool.query(
            'UPDATE contribution_members SET name=$1, value=$2, total=$3, updated_at=NOW() WHERE id=$4 AND region_id=$5',
            [name, value || '', total || '', req.params.id, regionId]
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions/:regionId/contribution/:id/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });
        if (!req.file) return res.status(400).json({ error: '请选择图片' });

        const { rows } = await pool.query('SELECT avatar FROM contribution_members WHERE id=$1 AND region_id=$2', [req.params.id, regionId]);
        if (rows.length > 0) await deleteAvatarFile(rows[0].avatar);

        const blob = await put(`avatars/contrib-${req.params.id}-${Date.now()}${path.extname(req.file.originalname)}`, req.file.buffer, { access: 'public' });
        await pool.query('UPDATE contribution_members SET avatar=$1 WHERE id=$2 AND region_id=$3', [blob.url, req.params.id, regionId]);
        res.json({ success: true, avatar: blob.url });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.delete('/api/regions/:regionId/contribution/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) { client.release(); return res.status(403).json({ error: '无权限' }); }

        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM contribution_members WHERE id=$1 AND region_id=$2', [req.params.id, regionId]);
        if (rows.length === 0) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: '不存在' }); }

        const m = rows[0];
        await deleteAvatarFile(m.avatar);
        await client.query('DELETE FROM contribution_members WHERE id=$1', [req.params.id]);

        const { rows: remaining } = await client.query(
            'SELECT id, rank_position FROM contribution_members WHERE region_id=$1 AND type=$2 AND rank_position>$3 ORDER BY rank_position ASC',
            [regionId, m.type, m.rank_position]
        );
        for (const r of remaining)
            await client.query('UPDATE contribution_members SET rank_position=$1 WHERE id=$2', [r.rank_position - 1, r.id]);

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { client.release(); }
});

app.post('/api/regions/:regionId/contribution/reorder', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) { client.release(); return res.status(403).json({ error: '无权限' }); }

        const { type, orderedIds } = req.body;
        if (!['resource', 'honor'].includes(type) || !Array.isArray(orderedIds)) {
            client.release(); return res.status(400).json({ error: '无效参数' });
        }

        await client.query('BEGIN');
        for (let i = 0; i < orderedIds.length; i++)
            await client.query('UPDATE contribution_members SET rank_position=$1 WHERE id=$2 AND region_id=$3 AND type=$4', [-(i + 1), orderedIds[i], regionId, type]);
        for (let i = 0; i < orderedIds.length; i++)
            await client.query('UPDATE contribution_members SET rank_position=$1 WHERE id=$2 AND region_id=$3 AND type=$4', [i + 1, orderedIds[i], regionId, type]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { client.release(); }
});

// ==================== 说明历史 API ====================

app.get('/api/contribution/:memberId/notes', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM contribution_notes WHERE member_id=$1 ORDER BY created_at ASC', [req.params.memberId]
        );
        res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/contribution/:memberId/notes', authenticateToken, async (req, res) => {
    try {
        const { rows: members } = await pool.query('SELECT region_id FROM contribution_members WHERE id = $1', [req.params.memberId]);
        if (members.length === 0) return res.status(404).json({ error: '成员不存在' });

        const regionId = members[0].region_id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });

        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: '说明不能为空' });

        await pool.query('INSERT INTO contribution_notes (member_id, note_text) VALUES ($1,$2)', [req.params.memberId, text.trim()]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.put('/api/contribution/notes/:noteId', authenticateToken, async (req, res) => {
    try {
        const { rows: notes } = await pool.query(
            `SELECT cn.*, cm.region_id FROM contribution_notes cn
             JOIN contribution_members cm ON cn.member_id = cm.id WHERE cn.id = $1`,
            [req.params.noteId]
        );
        if (notes.length === 0) return res.status(404).json({ error: '说明不存在' });

        const regionId = notes[0].region_id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });

        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: '说明不能为空' });

        await pool.query('UPDATE contribution_notes SET note_text=$1 WHERE id=$2', [text.trim(), req.params.noteId]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.delete('/api/contribution/notes/:noteId', authenticateToken, async (req, res) => {
    try {
        const { rows: notes } = await pool.query(
            `SELECT cn.*, cm.region_id FROM contribution_notes cn
             JOIN contribution_members cm ON cn.member_id = cm.id WHERE cn.id = $1`,
            [req.params.noteId]
        );
        if (notes.length === 0) return res.status(404).json({ error: '说明不存在' });

        const regionId = notes[0].region_id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSA = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSA) return res.status(403).json({ error: '无权限' });

        await pool.query('DELETE FROM contribution_notes WHERE id=$1', [req.params.noteId]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// ==================== 启动 ====================
app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
});

module.exports = app;