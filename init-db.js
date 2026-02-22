require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        console.error('❌ 请在 .env 文件中设置 DATABASE_URL');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                nickname VARCHAR(50) DEFAULT '',
                is_super_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS regions (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                province VARCHAR(50) DEFAULT '',
                description TEXT DEFAULT NULL,
                cover_image VARCHAR(500) DEFAULT NULL,
                creator_id INT NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS region_admins (
                id SERIAL PRIMARY KEY,
                region_id INT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
                user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(10) DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (region_id, user_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                region_id INT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
                hand VARCHAR(10) NOT NULL CHECK (hand IN ('left', 'right')),
                rank_position INT NOT NULL,
                name VARCHAR(50) NOT NULL,
                avatar VARCHAR(500) DEFAULT NULL,
                power VARCHAR(50) DEFAULT '',
                skill VARCHAR(100) DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (region_id, hand, rank_position)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS contribution_members (
                id SERIAL PRIMARY KEY,
                region_id INT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
                type VARCHAR(10) NOT NULL CHECK (type IN ('resource', 'honor')),
                rank_position INT NOT NULL,
                name VARCHAR(50) NOT NULL,
                avatar VARCHAR(500) DEFAULT NULL,
                value VARCHAR(100) DEFAULT '',
                total VARCHAR(100) DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (region_id, type, rank_position)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS contribution_notes (
                id SERIAL PRIMARY KEY,
                member_id INT NOT NULL REFERENCES contribution_members(id) ON DELETE CASCADE,
                note_text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        const hashedPassword = await bcrypt.hash('admin123', 10);
        await pool.query(
            `INSERT INTO users (username, password, nickname, is_super_admin)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (username) DO NOTHING`,
            ['admin', hashedPassword, '超级管理员', true]
        );

        const { rows: adminRows } = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
        if (adminRows.length > 0) {
            const adminId = adminRows[0].id;
            const { rows: existRegion } = await pool.query('SELECT id FROM regions WHERE name = $1', ['郑州潇洒']);
            if (existRegion.length === 0) {
                const { rows: regionRows } = await pool.query(
                    'INSERT INTO regions (name, province, description, creator_id) VALUES ($1, $2, $3, $4) RETURNING id',
                    ['郑州潇洒', '河南', '郑州潇洒腕力排行榜', adminId]
                );
                await pool.query(
                    'INSERT INTO region_admins (region_id, user_id, role) VALUES ($1, $2, $3)',
                    [regionRows[0].id, adminId, 'owner']
                );
            }
        }

        console.log('✅ 数据库初始化完成！');
        console.log('📋 超级管理员账号: admin');
        console.log('🔑 超级管理员密码: admin123');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error.message);
    } finally {
        await pool.end();
    }
}

initDatabase();