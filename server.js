const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ฐานข้อมูลในหน่วยความจำ (RAM) - หากต้องการบันทึกถาวรให้ปรับไปใช้ MongoDB/MySQL
const keysDB = {};

// ฟังก์ชันสร้างคีย์สุ่มความยาว 67 ตัวอักษร
function generate67CharKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const bytes = crypto.randomBytes(67);
    for (let i = 0; i < 67; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}

// --------------------------------------------------
// API 1: สำหรับ Admin สร้างคีย์ (1-10, 20, 30 วัน หรือ 'lifetime')
// --------------------------------------------------
app.post('/api/admin/create-key', (req, res) => {
    const { days } = req.body;
    const key = generate67CharKey();

    keysDB[key] = {
        keyCode: key,
        typeDays: days,
        lockedIp: null,
        activatedAt: null,
        expiresAt: null,
        isActive: true
    };

    res.json({
        status: 'success',
        key: key,
        typeDays: days
    });
});

// --------------------------------------------------
// API 2: สำหรับ ตรวจสอบและเปิดใช้งานคีย์ (User/Client)
// --------------------------------------------------
app.post('/api/verify-key', (req, res) => {
    const { key } = req.body;
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    const keyData = keysDB[key];

    if (!keyData) {
        return res.status(404).json({ status: 'error', message: 'ไม่พบรหัสคีย์นี้ในระบบ' });
    }

    if (!keyData.isActive) {
        return res.status(403).json({ status: 'error', message: 'คีย์นี้ถูกระงับการใช้งาน' });
    }

    const now = new Date();

    // กรณีสแกนใช้งานครั้งแรก ➔ บันทึก IP และคำนวณวันหมดอายุ
    if (!keyData.lockedIp) {
        keyData.lockedIp = clientIp;
        keyData.activatedAt = now;

        if (keyData.typeDays === 'lifetime') {
            keyData.expiresAt = 'LIFETIME';
        } else {
            const exp = new Date(now);
            exp.setDate(exp.getDate() + parseInt(keyData.typeDays));
            keyData.expiresAt = exp;
        }
    } else {
        // กรณีสแกนครั้งถัดไป ➔ เช็กว่า IP ตรงกับที่ล็อคไว้หรือไม่
        if (keyData.lockedIp !== clientIp) {
            return res.status(403).json({
                status: 'error',
                message: `คีย์นี้ถูกล็อคกับ IP: ${keyData.lockedIp} แล้ว (IP ของคุณ: ${clientIp})`
            });
        }
    }

    // เช็กสถานะวันหมดอายุ
    if (keyData.expiresAt !== 'LIFETIME' && now > new Date(keyData.expiresAt)) {
        return res.status(403).json({
            status: 'error',
            message: 'คีย์นี้หมดอายุการใช้งานแล้ว',
            expiresAt: keyData.expiresAt
        });
    }

    // คำนวณเวลาที่เหลือ
    let remainingText = 'ถาวร (Lifetime)';
    if (keyData.expiresAt !== 'LIFETIME') {
        const diffMs = new Date(keyData.expiresAt) - now;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        remainingText = `เหลือเวลาอีก ${diffDays} วัน ${diffHours % 24} ชั่วโมง`;
    }

    return res.json({
        status: 'success',
        message: 'ยืนยันคีย์สำเร็จ! เข้าใช้งานระบบได้',
        typeDays: keyData.typeDays === 'lifetime' ? 'ถาวร' : `${keyData.typeDays} วัน`,
        lockedIp: keyData.lockedIp,
        expiresAt: keyData.expiresAt,
        remainingText: remainingText
    });
});

// --------------------------------------------------
// API 3: สำหรับ Admin ดึงรายการคีย์ทั้งหมดไปแสดงในตาราง
// --------------------------------------------------
app.get('/api/admin/keys', (req, res) => {
    res.json(Object.values(keysDB));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Key System Running on http://localhost:${PORT}`));
