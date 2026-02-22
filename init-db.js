 const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function initDatabase() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'admin123'
    });

    try {
        await connection.query('CREATE DATABASE IF NOT EXISTS wrist_power_ranking CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        await connection.query('USE wrist_power_ranking');

        // 用户/管理员表
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                nickname VARCHAR(50) DEFAULT '',
                is_super_admin TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 地区表
        await connection.query(`
            CREATE TABLE IF NOT EXISTS regions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                province VARCHAR(50) DEFAULT '',
                description TEXT DEFAULT NULL,
                cover_image VARCHAR(255) DEFAULT NULL,
                creator_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (creator_id) REFERENCES users(id),
                UNIQUE KEY unique_region_name (name)
            )
        `);

        // 地区管理员关联表（一个地区可以有多个管理员）
        await connection.query(`
            CREATE TABLE IF NOT EXISTS region_admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                region_id INT NOT NULL,
                user_id INT NOT NULL,
                role ENUM('owner', 'admin') DEFAULT 'admin',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_region_user (region_id, user_id)
            )
        `);

        // 腕力排行榜选手表
        await connection.query(`
            CREATE TABLE IF NOT EXISTS players (
                id INT AUTO_INCREMENT PRIMARY KEY,
                region_id INT NOT NULL,
                hand ENUM('left', 'right') NOT NULL,
                rank_position INT NOT NULL,
                name VARCHAR(50) NOT NULL,
                avatar VARCHAR(255) DEFAULT NULL,
                power VARCHAR(50) DEFAULT '',
                skill VARCHAR(100) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
                UNIQUE KEY unique_region_hand_rank (region_id, hand, rank_position)
            )
        `);

        // 贡献榜成员表
        await connection.query(`
            CREATE TABLE IF NOT EXISTS contribution_members (
                id INT AUTO_INCREMENT PRIMARY KEY,
                region_id INT NOT NULL,
                type ENUM('resource', 'honor') NOT NULL,
                rank_position INT NOT NULL,
                name VARCHAR(50) NOT NULL,
                avatar VARCHAR(255) DEFAULT NULL,
                value VARCHAR(100) DEFAULT '',
                total VARCHAR(100) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
                UNIQUE KEY unique_region_type_rank (region_id, type, rank_position)
            )
        `);

        // 贡献榜说明历史表
        await connection.query(`
            CREATE TABLE IF NOT EXISTS contribution_notes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                member_id INT NOT NULL,
                note_text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (member_id) REFERENCES contribution_members(id) ON DELETE CASCADE
            )
        `);

        // 创建超级管理员
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await connection.query(
            `INSERT IGNORE INTO users (username, password, nickname, is_super_admin) VALUES (?, ?, ?, ?)`,
            ['admin', hashedPassword, '超级管理员', 1]
        );

        // 创建示例地区 - 郑州
        const [adminRows] = await connection.query('SELECT id FROM users WHERE username = ?', ['admin']);
        if (adminRows.length > 0) {
            const adminId = adminRows[0].id;
            const [existRegion] = await connection.query('SELECT id FROM regions WHERE name = ?', ['郑州潇洒']);
            if (existRegion.length === 0) {
                const [regionResult] = await connection.query(
                    'INSERT INTO regions (name, province, description, creator_id) VALUES (?, ?, ?, ?)',
                    ['郑州潇洒', '河南', '郑州潇洒腕力排行榜', adminId]
                );
                await connection.query(
                    'INSERT INTO region_admins (region_id, user_id, role) VALUES (?, ?, ?)',
                    [regionResult.insertId, adminId, 'owner']
                );
            }
        }

        console.log('✅ 数据库初始化完成！');
        console.log('📋 超级管理员账号: admin');
        console.log('🔑 超级管理员密码: admin123');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
    } finally {
        await connection.end();
    }
}

initDatabase();
