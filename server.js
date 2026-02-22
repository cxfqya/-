 const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'china_wrist_power_2024_secret_key';

// ==================== 文件上传配置 ====================
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const u = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, u + path.extname(file.originalname));
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/jpeg|jpg|png|gif|webp/.test(file.mimetype)) return cb(null, true);
        cb(new Error('只允许上传图片文件！'));
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ==================== 数据库连接池 ====================
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'admin123',
    database: 'wrist_power_ranking',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4'
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

// 可选认证：有 token 就解析，没有也放行
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) req.user = user;
        next();
    });
}

// 检查是否是某地区管理员
async function checkRegionAdmin(userId, regionId) {
    const [rows] = await pool.query(
        'SELECT * FROM region_admins WHERE user_id = ? AND region_id = ?',
        [userId, regionId]
    );
    return rows.length > 0;
}

// 检查是否是某地区 owner
async function checkRegionOwner(userId, regionId) {
    const [rows] = await pool.query(
        'SELECT * FROM region_admins WHERE user_id = ? AND region_id = ? AND role = "owner"',
        [userId, regionId]
    );
    return rows.length > 0;
}

// 检查是否是超级管理员
async function checkSuperAdmin(userId) {
    const [rows] = await pool.query('SELECT is_super_admin FROM users WHERE id = ?', [userId]);
    return rows.length > 0 && rows[0].is_super_admin === 1;
}

function deleteAvatarFile(avatarPath) {
    if (!avatarPath) return;
    const full = path.join(__dirname, 'public', avatarPath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
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

// 注册
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, nickname } = req.body;
        if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
        if (username.length < 3) return res.status(400).json({ error: '用户名至少3个字符' });
        if (password.length < 6) return res.status(400).json({ error: '密码至少6个字符' });

        const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) return res.status(400).json({ error: '用户名已存在' });

        const hashed = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)',
            [username, hashed, nickname || username]
        );

        const token = jwt.sign(
            { id: result.insertId, username, nickname: nickname || username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: { id: result.insertId, username, nickname: nickname || username, is_super_admin: 0 }
        });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// 登录
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: '用户名或密码错误' });
        const valid = await bcrypt.compare(password, rows[0].password);
        if (!valid) return res.status(401).json({ error: '用户名或密码错误' });
        const token = jwt.sign(
            { id: rows[0].id, username: rows[0].username, nickname: rows[0].nickname },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({
            token,
            user: {
                id: rows[0].id,
                username: rows[0].username,
                nickname: rows[0].nickname,
                is_super_admin: rows[0].is_super_admin
            }
        });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// 验证令牌
app.get('/api/verify', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, nickname, is_super_admin FROM users WHERE id = ?', [req.user.id]);
        if (rows.length === 0) return res.status(404).json({ valid: false });
        res.json({ valid: true, user: rows[0] });
    } catch (e) { res.status(500).json({ valid: false }); }
});

// 修改密码
app.post('/api/change-password', authenticateToken, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
        if (!await bcrypt.compare(oldPassword, rows[0].password)) return res.status(401).json({ error: '原密码错误' });
        if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6个字符' });
        await pool.query('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), req.user.id]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// ==================== 地区 API ====================

// 获取所有地区
app.get('/api/regions', async (req, res) => {
    try {
        const { province, keyword } = req.query;
        let sql = `
            SELECT r.*, u.nickname as creator_name,
            (SELECT COUNT(*) FROM players WHERE region_id = r.id) as player_count,
            (SELECT COUNT(*) FROM contribution_members WHERE region_id = r.id) as contrib_count
            FROM regions r
            LEFT JOIN users u ON r.creator_id = u.id
        `;
        const params = [];
        const conditions = [];

        if (province) {
            conditions.push('r.province = ?');
            params.push(province);
        }
        if (keyword) {
            conditions.push('(r.name LIKE ? OR r.province LIKE ?)');
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY r.created_at DESC';

        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// 获取所有省份列表
app.get('/api/provinces', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT DISTINCT province FROM regions WHERE province != "" ORDER BY province');
        res.json(rows.map(r => r.province));
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// 获取单个地区信息
app.get('/api/regions/:id', optionalAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT r.*, u.nickname as creator_name
             FROM regions r LEFT JOIN users u ON r.creator_id = u.id
             WHERE r.id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: '地区不存在' });

        const region = rows[0];

        // 检查当前用户是否是该地区管理员
        let isAdmin = false;
        let isOwner = false;
        let isSuperAdmin = false;
        if (req.user) {
            isAdmin = await checkRegionAdmin(req.user.id, region.id);
            isOwner = await checkRegionOwner(req.user.id, region.id);
            isSuperAdmin = await checkSuperAdmin(req.user.id);
        }

        res.json({ ...region, isAdmin: isAdmin || isSuperAdmin, isOwner: isOwner || isSuperAdmin });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// 创建地区
app.post('/api/regions', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { name, province, description } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入地区名称' });
        if (!province || !province.trim()) return res.status(400).json({ error: '请选择省份' });

        const [existing] = await conn.query('SELECT id FROM regions WHERE name = ?', [name.trim()]);
        if (existing.length > 0) return res.status(400).json({ error: '该地区名称已存在' });

        await conn.beginTransaction();

        const [result] = await conn.query(
            'INSERT INTO regions (name, province, description, creator_id) VALUES (?, ?, ?, ?)',
            [name.trim(), province.trim(), description || '', req.user.id]
        );

        await conn.query(
            'INSERT INTO region_admins (region_id, user_id, role) VALUES (?, ?, ?)',
            [result.insertId, req.user.id, 'owner']
        );

        await conn.commit();
        res.json({ success: true, id: result.insertId });
    } catch (e) {
        await conn.rollback();
        console.error(e);
        res.status(500).json({ error: '服务器错误' });
    } finally {
        conn.release();
    }
});

// 更新地区信息
app.put('/api/regions/:id', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        const { name, province, description } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入地区名称' });

        // 检查名称是否被其他地区占用
        const [existing] = await pool.query('SELECT id FROM regions WHERE name = ? AND id != ?', [name.trim(), regionId]);
        if (existing.length > 0) return res.status(400).json({ error: '该地区名称已存在' });

        await pool.query(
            'UPDATE regions SET name = ?, province = ?, description = ? WHERE id = ?',
            [name.trim(), province || '', description || '', regionId]
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// 删除地区
app.delete('/api/regions/:id', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const regionId = req.params.id;
        const isOwner = await checkRegionOwner(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isOwner && !isSuperAdmin) return res.status(403).json({ error: '只有创建者或超级管理员可以删除地区' });

        await conn.beginTransaction();

        // 删除相关头像文件
        const [players] = await conn.query('SELECT avatar FROM players WHERE region_id = ?', [regionId]);
        const [contribs] = await conn.query('SELECT avatar FROM contribution_members WHERE region_id = ?', [regionId]);
        players.forEach(p => deleteAvatarFile(p.avatar));
        contribs.forEach(c => deleteAvatarFile(c.avatar));

        // 级联删除会自动处理关联数据
        await conn.query('DELETE FROM regions WHERE id = ?', [regionId]);

        await conn.commit();
        res.json({ success: true });
    } catch (e) {
        await conn.rollback();
        console.error(e);
        res.status(500).json({ error: '服务器错误' });
    } finally {
        conn.release();
    }
});

// 上传地区封面
app.post('/api/regions/:id/cover', authenticateToken, upload.single('cover'), async (req, res) => {
    try {
        const regionId = req.params.id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        if (!req.file) return res.status(400).json({ error: '请选择图片' });

        const [rows] = await pool.query('SELECT cover_image FROM regions WHERE id = ?', [regionId]);
        if (rows.length > 0) deleteAvatarFile(rows[0].cover_image);

        const coverPath = '/uploads/' + req.file.filename;
        await pool.query('UPDATE regions SET cover_image = ? WHERE id = ?', [coverPath, regionId]);
        res.json({ success: true, cover: coverPath });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// ==================== 地区管理员管理 ====================

// 获取地区管理员列表
app.get('/api/regions/:id/admins', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT ra.*, u.username, u.nickname
             FROM region_admins ra
             LEFT JOIN users u ON ra.user_id = u.id
             WHERE ra.region_id = ?
             ORDER BY ra.role DESC, ra.created_at ASC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// 添加地区管理员
app.post('/api/regions/:id/admins', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.id;
        const isOwner = await checkRegionOwner(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isOwner && !isSuperAdmin) return res.status(403).json({ error: '只有创建者可以添加管理员' });

        const { username } = req.body;
        if (!username) return res.status(400).json({ error: '请输入用户名' });

        const [users] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(404).json({ error: '用户不存在' });

        const [existing] = await pool.query(
            'SELECT id FROM region_admins WHERE region_id = ? AND user_id = ?',
            [regionId, users[0].id]
        );
        if (existing.length > 0) return res.status(400).json({ error: '该用户已是管理员' });

        await pool.query(
            'INSERT INTO region_admins (region_id, user_id, role) VALUES (?, ?, ?)',
            [regionId, users[0].id, 'admin']
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// 移除地区管理员
app.delete('/api/regions/:id/admins/:userId', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.id;
        const userId = req.params.userId;
        const isOwner = await checkRegionOwner(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isOwner && !isSuperAdmin) return res.status(403).json({ error: '只有创建者可以移除管理员' });

        // 不能移除 owner
        const [target] = await pool.query(
            'SELECT role FROM region_admins WHERE region_id = ? AND user_id = ?',
            [regionId, userId]
        );
        if (target.length > 0 && target[0].role === 'owner') {
            return res.status(400).json({ error: '不能移除创建者' });
        }

        await pool.query('DELETE FROM region_admins WHERE region_id = ? AND user_id = ?', [regionId, userId]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// ==================== 腕力排行榜 API ====================

app.get('/api/regions/:regionId/players/:hand', async (req, res) => {
    try {
        const { regionId, hand } = req.params;
        if (!['left', 'right'].includes(hand)) return res.status(400).json({ error: '无效参数' });
        const [rows] = await pool.query(
            'SELECT * FROM players WHERE region_id = ? AND hand = ? ORDER BY rank_position ASC',
            [regionId, hand]
        );
        res.json(rows.map(p => ({ ...p, title: getTitle(p.rank_position) })));
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions/:regionId/players', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        const { hand, name, power, skill } = req.body;
        if (!['left', 'right'].includes(hand)) return res.status(400).json({ error: '无效参数' });
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入姓名' });

        const [mx] = await pool.query(
            'SELECT MAX(rank_position) as m FROM players WHERE region_id = ? AND hand = ?',
            [regionId, hand]
        );
        const next = (mx[0].m || 0) + 1;
        if (next > 30) return res.status(400).json({ error: '排行榜已满（最多30人）' });

        await pool.query(
            'INSERT INTO players (region_id, hand, rank_position, name, power, skill) VALUES (?,?,?,?,?,?)',
            [regionId, hand, next, name.trim(), power || '', skill || '']
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.put('/api/regions/:regionId/players/:id', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        const { name, power, skill } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入姓名' });

        await pool.query(
            'UPDATE players SET name=?, power=?, skill=? WHERE id=? AND region_id=?',
            [name.trim(), power || '', skill || '', req.params.id, regionId]
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions/:regionId/players/:id/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        if (!req.file) return res.status(400).json({ error: '请选择图片' });

        const [rows] = await pool.query('SELECT avatar FROM players WHERE id=? AND region_id=?', [req.params.id, regionId]);
        if (rows.length > 0) deleteAvatarFile(rows[0].avatar);

        const ap = '/uploads/' + req.file.filename;
        await pool.query('UPDATE players SET avatar=? WHERE id=? AND region_id=?', [ap, req.params.id, regionId]);
        res.json({ success: true, avatar: ap });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.delete('/api/regions/:regionId/players/:id', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) { conn.release(); return res.status(403).json({ error: '无权限' }); }

        await conn.beginTransaction();
        const [rows] = await conn.query('SELECT * FROM players WHERE id=? AND region_id=?', [req.params.id, regionId]);
        if (rows.length === 0) { await conn.rollback(); conn.release(); return res.status(404).json({ error: '不存在' }); }

        const p = rows[0];
        deleteAvatarFile(p.avatar);
        await conn.query('DELETE FROM players WHERE id=?', [req.params.id]);

        const [remaining] = await conn.query(
            'SELECT id, rank_position FROM players WHERE region_id=? AND hand=? AND rank_position>? ORDER BY rank_position ASC',
            [regionId, p.hand, p.rank_position]
        );
        for (const r of remaining) {
            await conn.query('UPDATE players SET rank_position=? WHERE id=?', [r.rank_position - 1, r.id]);
        }
        await conn.commit();
        res.json({ success: true });
    } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { conn.release(); }
});

app.post('/api/regions/:regionId/players/reorder', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) { conn.release(); return res.status(403).json({ error: '无权限' }); }

        const { hand, orderedIds } = req.body;
        if (!['left', 'right'].includes(hand) || !Array.isArray(orderedIds)) {
            conn.release();
            return res.status(400).json({ error: '无效参数' });
        }

        await conn.beginTransaction();
        for (let i = 0; i < orderedIds.length; i++)
            await conn.query('UPDATE players SET rank_position=? WHERE id=? AND region_id=? AND hand=?', [-(i + 1), orderedIds[i], regionId, hand]);
        for (let i = 0; i < orderedIds.length; i++)
            await conn.query('UPDATE players SET rank_position=? WHERE id=? AND region_id=? AND hand=?', [i + 1, orderedIds[i], regionId, hand]);
        await conn.commit();
        res.json({ success: true });
    } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { conn.release(); }
});

// ==================== 贡献榜 API ====================

app.get('/api/regions/:regionId/contribution/:type', async (req, res) => {
    try {
        const { regionId, type } = req.params;
        if (!['resource', 'honor'].includes(type)) return res.status(400).json({ error: '无效参数' });

        const [members] = await pool.query(
            'SELECT * FROM contribution_members WHERE region_id=? AND type=? ORDER BY rank_position ASC',
            [regionId, type]
        );

        for (const m of members) {
            const [notes] = await pool.query(
                'SELECT * FROM contribution_notes WHERE member_id=? ORDER BY created_at ASC',
                [m.id]
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
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        const { type, name, value, total, note } = req.body;
        if (!['resource', 'honor'].includes(type)) return res.status(400).json({ error: '无效参数' });
        if (!name || !name.trim()) return res.status(400).json({ error: '请输入名称' });

        const [mx] = await pool.query(
            'SELECT MAX(rank_position) as m FROM contribution_members WHERE region_id=? AND type=?',
            [regionId, type]
        );
        const next = (mx[0].m || 0) + 1;

        const [result] = await pool.query(
            'INSERT INTO contribution_members (region_id, type, rank_position, name, value, total) VALUES (?,?,?,?,?,?)',
            [regionId, type, next, name.trim(), value || '', total || '']
        );

        if (note && note.trim()) {
            await pool.query('INSERT INTO contribution_notes (member_id, note_text) VALUES (?,?)', [result.insertId, note.trim()]);
        }

        res.json({ success: true, id: result.insertId });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.put('/api/regions/:regionId/contribution/:id', authenticateToken, async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        const { name, value, total } = req.body;
        await pool.query(
            'UPDATE contribution_members SET name=?, value=?, total=? WHERE id=? AND region_id=?',
            [name, value || '', total || '', req.params.id, regionId]
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/regions/:regionId/contribution/:id/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        if (!req.file) return res.status(400).json({ error: '请选择图片' });

        const [rows] = await pool.query('SELECT avatar FROM contribution_members WHERE id=? AND region_id=?', [req.params.id, regionId]);
        if (rows.length > 0) deleteAvatarFile(rows[0].avatar);

        const ap = '/uploads/' + req.file.filename;
        await pool.query('UPDATE contribution_members SET avatar=? WHERE id=? AND region_id=?', [ap, req.params.id, regionId]);
        res.json({ success: true, avatar: ap });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.delete('/api/regions/:regionId/contribution/:id', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) { conn.release(); return res.status(403).json({ error: '无权限' }); }

        await conn.beginTransaction();
        const [rows] = await conn.query('SELECT * FROM contribution_members WHERE id=? AND region_id=?', [req.params.id, regionId]);
        if (rows.length === 0) { await conn.rollback(); conn.release(); return res.status(404).json({ error: '不存在' }); }

        const m = rows[0];
        deleteAvatarFile(m.avatar);
        await conn.query('DELETE FROM contribution_members WHERE id=?', [req.params.id]);

        const [remaining] = await conn.query(
            'SELECT id, rank_position FROM contribution_members WHERE region_id=? AND type=? AND rank_position>? ORDER BY rank_position ASC',
            [regionId, m.type, m.rank_position]
        );
        for (const r of remaining)
            await conn.query('UPDATE contribution_members SET rank_position=? WHERE id=?', [r.rank_position - 1, r.id]);

        await conn.commit();
        res.json({ success: true });
    } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { conn.release(); }
});

app.post('/api/regions/:regionId/contribution/reorder', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const regionId = req.params.regionId;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) { conn.release(); return res.status(403).json({ error: '无权限' }); }

        const { type, orderedIds } = req.body;
        if (!['resource', 'honor'].includes(type) || !Array.isArray(orderedIds)) {
            conn.release();
            return res.status(400).json({ error: '无效参数' });
        }

        await conn.beginTransaction();
        for (let i = 0; i < orderedIds.length; i++)
            await conn.query('UPDATE contribution_members SET rank_position=? WHERE id=? AND region_id=? AND type=?', [-(i + 1), orderedIds[i], regionId, type]);
        for (let i = 0; i < orderedIds.length; i++)
            await conn.query('UPDATE contribution_members SET rank_position=? WHERE id=? AND region_id=? AND type=?', [i + 1, orderedIds[i], regionId, type]);
        await conn.commit();
        res.json({ success: true });
    } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: '服务器错误' }); }
    finally { conn.release(); }
});

// ==================== 说明历史 API ====================

app.get('/api/contribution/:memberId/notes', async (req, res) => {
    try {
        const [notes] = await pool.query(
            'SELECT * FROM contribution_notes WHERE member_id=? ORDER BY created_at ASC',
            [req.params.memberId]
        );
        res.json(notes);
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.post('/api/contribution/:memberId/notes', authenticateToken, async (req, res) => {
    try {
        // 验证权限：获取 member 所属 region
        const [members] = await pool.query('SELECT region_id FROM contribution_members WHERE id = ?', [req.params.memberId]);
        if (members.length === 0) return res.status(404).json({ error: '成员不存在' });

        const regionId = members[0].region_id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: '说明不能为空' });

        await pool.query('INSERT INTO contribution_notes (member_id, note_text) VALUES (?,?)', [req.params.memberId, text.trim()]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.put('/api/contribution/notes/:noteId', authenticateToken, async (req, res) => {
    try {
        // 验证权限
        const [notes] = await pool.query(
            `SELECT cn.*, cm.region_id FROM contribution_notes cn
             JOIN contribution_members cm ON cn.member_id = cm.id
             WHERE cn.id = ?`,
            [req.params.noteId]
        );
        if (notes.length === 0) return res.status(404).json({ error: '说明不存在' });

        const regionId = notes[0].region_id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: '说明不能为空' });

        await pool.query('UPDATE contribution_notes SET note_text=? WHERE id=?', [text.trim(), req.params.noteId]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

app.delete('/api/contribution/notes/:noteId', authenticateToken, async (req, res) => {
    try {
        const [notes] = await pool.query(
            `SELECT cn.*, cm.region_id FROM contribution_notes cn
             JOIN contribution_members cm ON cn.member_id = cm.id
             WHERE cn.id = ?`,
            [req.params.noteId]
        );
        if (notes.length === 0) return res.status(404).json({ error: '说明不存在' });

        const regionId = notes[0].region_id;
        const isAdmin = await checkRegionAdmin(req.user.id, regionId);
        const isSuperAdmin = await checkSuperAdmin(req.user.id);
        if (!isAdmin && !isSuperAdmin) return res.status(403).json({ error: '无权限' });

        await pool.query('DELETE FROM contribution_notes WHERE id=?', [req.params.noteId]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
});

// ==================== 启动服务器 ====================
app.listen(PORT, () => {
    console.log(`🚀 中国腕力排行榜服务器运行在 http://localhost:${PORT}`);
});
