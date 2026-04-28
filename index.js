require('dotenv').config()

const express = require('express')
const cors = require('cors')
const cookieparser = require('cookie-parser')
const mysql = require('mysql2/promise')
const jwt = require('jsonwebtoken')
const emailValidator = require('node-email-verifier')
const bcrypt = require('bcryptjs')

// config
const PORT = process.env.PORT;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;
const COOKIE_NAME = 'auth-token'

// cookie beállítás
const COOKIE_OPTS = {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
}

// adatbázis beállítás
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
})

// APP
const app = express();

app.use(express.json())
app.use(cookieparser())
app.use(cors({
    origin: ['http://localhost:5173', 'https://mycarcards.netlify.app'],
    credentials: true,
}))

// Middleware
function auth(req, res, next) {
    const token = req.cookies[COOKIE_NAME]
    if (!token) {
        return res.status(401).json({ message: "You are not logged in." })
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET)
        next();
    } catch (error) {
        return res.status(401).json({ message: "Your session has expired." })
    }
}

// ========== ÉRTESÍTÉS KÜLDŐ SEGÉDFÜGGVÉNY ==========
async function sendNotification(userId, type, title, message, relatedId = null) {
    try {
        const sql = `
            INSERT INTO notifications (user_id, type, title, message, related_id, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
        `
        await db.query(sql, [userId, type, title, message, relatedId])
        console.log(`Notification sent to user ${userId}: ${title}`)
    } catch (error) {
        console.error("Error sending notification:", error)
    }
}

// ---------- VÉGPONTOK ----------

// REGISZTRÁCIÓ
app.post('/registration', async (req, res) => {
    const { email, username, password } = req.body
    if (!email || !username || !password) {
        return res.status(400).json({ message: "Missing data" })
    }

    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        const isValid = await emailValidator(email, { checkMx: false })
        if (!isValid) {
            await connection.rollback()
            return res.status(400).json({ message: "Email address is not valid." })
        }

        const usernameEmailSQL = 'SELECT * FROM users WHERE email = ? OR username = ?'
        const [exists] = await connection.query(usernameEmailSQL, [email, username])
        if (exists.length) {
            await connection.rollback()
            return res.status(409).json({ message: "The username or email is already taken." })
        }

        const hash = await bcrypt.hash(password, 10)
        const registrationSQL = 'INSERT INTO users (email, username, password) VALUES (?, ?, ?)'
        const [result] = await connection.query(registrationSQL, [email, username, hash])

        const newUserId = result.insertId

        // 10 pack hozzáadása az új felhasználónak
        const packValues = []
        for (let i = 0; i < 10; i++) {
            packValues.push([newUserId])
        }

        await connection.query(
            'INSERT INTO user_packs (user_id) VALUES ?',
            [packValues]
        )

        await connection.commit()

        console.log(`New user registered: ${username} (ID: ${newUserId}) with 10 starter packs`)

        return res.status(200).json({
            message: "Registration successful! You received 10 starter packs.",
            id: newUserId
        })

    } catch (error) {
        await connection.rollback()
        console.log(error)
        return res.status(500).json({ message: "Server error!" })
    } finally {
        connection.release()
    }
})

// BELÉPÉS
app.post('/login', async (req, res) => {
    const { usernameOrEmail, password } = req.body
    if (!usernameOrEmail || !password) {
        return res.status(400).json({ message: "Missing login data" })
    }

    try {
        const isEmail = await emailValidator(usernameOrEmail, { checkMx: false })
        let user = {}

        if (isEmail) {
            const sql = 'SELECT * FROM users WHERE email = ?'
            const [rows] = await db.query(sql, [usernameOrEmail])
            if (rows.length === 0) {
                return res.status(401).json({ message: "Incorrect email or password." })
            }
            user = rows[0]
        } else {
            const sql = 'SELECT * FROM users WHERE username = ?'
            const [rows] = await db.query(sql, [usernameOrEmail])
            if (rows.length === 0) {
                return res.status(401).json({ message: "Incorrect email or password." })
            }
            user = rows[0]
        }

        const passwordMatch = await bcrypt.compare(password, user.password)
        if (!passwordMatch) {
            return res.status(401).json({ message: "Wrong password" })
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        )

        res.cookie(COOKIE_NAME, token, COOKIE_OPTS)

        res.status(200).json({
            message: "Login successful",
            user: {
                id: user.id,
                email: user.email,
                username: user.username
            }
        })
    } catch (error) {
        console.log(error)
        return res.status(500).json({ message: "Server error!" })
    }
})

// KIJELENTKEZÉS
app.post('/logout', auth, async (req, res) => {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/'
    });
    res.status(200).json({ message: "Logout successful" })
})

// SAJÁT ADATOK
app.get('/adataim', auth, async (req, res) => {
    res.status(200).json(req.user)
})

// EMAIL MÓDOSÍTÁS
app.put('/email', auth, async (req, res) => {
    const { newEmail } = req.body
    if (!newEmail) {
        return res.status(400).json({ message: "Email is required." })
    }

    const isValid = await emailValidator(newEmail)
    if (!isValid) {
        return res.status(400).json({ message: "Enter a valid email." })
    }

    try {
        const sql1 = 'SELECT * FROM users WHERE email = ?'
        const [result] = await db.query(sql1, [newEmail])
        if (result.length) {
            return res.status(409).json({ message: "Email is already taken." })
        }

        const sql2 = 'UPDATE users SET email = ? WHERE id = ?'
        await db.query(sql2, [newEmail, req.user.id])
        return res.status(200).json({ message: "Email successfully updated." })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error!" })
    }
})

// FELHASZNÁLÓNÉV MÓDOSÍTÁS
app.put('/username', auth, async (req, res) => {
    const { newUsername } = req.body
    if (!newUsername) {
        return res.status(400).json({ message: "New username is required" })
    }

    try {
        const sql1 = 'SELECT * FROM users WHERE username = ?'
        const [result] = await db.query(sql1, [newUsername])
        if (result.length) {
            return res.status(409).json({ message: "Username is already taken." })
        }

        const sql2 = 'UPDATE users SET username = ? WHERE id = ?'
        await db.query(sql2, [newUsername, req.user.id])
        return res.status(200).json({ message: "Username successfully updated." })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error" })
    }
})

// JELSZÓ MÓDOSÍTÁS
app.put('/password', auth, async (req, res) => {
    const { nowPassword, newPassword } = req.body
    if (!nowPassword || !newPassword) {
        return res.status(400).json({ message: "Missing data" })
    }

    try {
        const sql = 'SELECT * FROM users WHERE id = ?'
        const [rows] = await db.query(sql, [req.user.id])
        const user = rows[0];
        const hashPassword = user.password;

        const passwordMatch = await bcrypt.compare(nowPassword, hashPassword)
        if (!passwordMatch) {
            return res.status(401).json({ message: "Incorrect password." })
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        const sql2 = 'UPDATE users SET password = ? WHERE id = ?'
        await db.query(sql2, [newHash, req.user.id])
        res.status(200).json({ message: "New password set successfully." })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error" })
    }
})

// FELHASZNÁLÓ TÖRLÉSE
app.delete('/account', auth, async (req, res) => {
    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()
        await connection.query('DELETE FROM notifications WHERE user_id = ?', [req.user.id])
        await connection.query('DELETE FROM market_offers WHERE offered_user_card_id IN (SELECT id FROM user_cards WHERE user_id = ?)', [req.user.id])
        await connection.query('DELETE FROM market_offers WHERE listing_id IN (SELECT id FROM market_listings WHERE user_card_id IN (SELECT id FROM user_cards WHERE user_id = ?))', [req.user.id])
        await connection.query('DELETE FROM market_listings WHERE user_card_id IN (SELECT id FROM user_cards WHERE user_id = ?)', [req.user.id])
        await connection.query('DELETE FROM user_cards WHERE user_id = ?', [req.user.id])
        await connection.query('DELETE FROM user_packs WHERE user_id = ?', [req.user.id])
        const [result] = await connection.query('DELETE FROM users WHERE id = ?', [req.user.id])

        if (result.affectedRows === 0) {
            await connection.rollback()
            return res.status(404).json({ message: "User not found" })
        }

        await connection.commit()

        // Cookie törlése
        res.clearCookie(COOKIE_NAME, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            path: '/'
        })

        res.status(200).json({ message: "Account successfully deleted" })

    } catch (error) {
        await connection.rollback()
        console.error("Error deleting account:", error)
        res.status(500).json({ message: "Server error: " + error.message })
    } finally {
        connection.release()
    }
})

// SAJÁT KÁRTYÁK LEKÉRÉSE 
app.get('/my-cards', auth, async (req, res) => {
    try {
        const sql = `
            SELECT 
                uc.id as user_card_id,
                uc.card_id,
                uc.acquired_at,
                c.*,
                CASE WHEN ml.id IS NOT NULL AND ml.status = 'active' THEN true ELSE false END as is_listed,
                CASE WHEN mo.id IS NOT NULL AND mo.status = 'pending' THEN true ELSE false END as is_offered
            FROM user_cards uc
            INNER JOIN cards c ON uc.card_id = c.id
            LEFT JOIN market_listings ml ON uc.id = ml.user_card_id AND ml.status = 'active'
            LEFT JOIN market_offers mo ON uc.id = mo.offered_user_card_id AND mo.status = 'pending'
            WHERE uc.user_id = ?
            ORDER BY c.manufacturer, c.name
        `
        const [rows] = await db.query(sql, [req.user.id])

        console.log("Backend /my-cards válasz:", rows)
        res.status(200).json({
            message: "Cards retrieved successfully",
            cards: rows
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error!" })
    }
})

// MARKET LISTINGOK LEKÉRÉSE
app.get('/market-listings', auth, async (req, res) => {
    try {
        const sql = `
            SELECT 
                ml.id as listing_id,
                ml.status,
                uc.id as user_card_id,
                uc.acquired_at,
                c.*,
                u.id as seller_id,
                u.username as seller_username
            FROM market_listings ml
            INNER JOIN user_cards uc ON ml.user_card_id = uc.id
            INNER JOIN cards c ON uc.card_id = c.id
            INNER JOIN users u ON uc.user_id = u.id
            WHERE ml.status = 'active'
            ORDER BY ml.id DESC
        `
        const [rows] = await db.query(sql)

        res.status(200).json({
            message: "Market listings retrieved successfully",
            listings: rows
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error!", listings: [] })
    }
})

// ÚJ LISTING LÉTREHOZÁSA
app.post('/create-listing', auth, async (req, res) => {
    const { userCardId } = req.body

    if (!userCardId) {
        return res.status(400).json({ message: "Missing data" })
    }

    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        // Ellenőrizzük, hogy a kártya a felhasználóé-e
        const checkSql = 'SELECT * FROM user_cards WHERE id = ? AND user_id = ?'
        const [userCard] = await connection.query(checkSql, [userCardId, req.user.id])

        if (userCard.length === 0) {
            await connection.rollback()
            return res.status(403).json({ message: "You don't own this card" })
        }

        // Ellenőrizzük, hogy nincs-e már aktív listingje
        const existingSql = 'SELECT * FROM market_listings WHERE user_card_id = ? AND status = "active"'
        const [existing] = await connection.query(existingSql, [userCardId])

        if (existing.length > 0) {
            await connection.rollback()
            return res.status(400).json({ message: "This card is already listed" })
        }

        // Ellenőrizzük, hogy nincs-e függőben lévő offer a kártyára
        const offerSql = 'SELECT * FROM market_offers WHERE offered_user_card_id = ? AND status = "pending"'
        const [offers] = await connection.query(offerSql, [userCardId])

        if (offers.length > 0) {
            await connection.rollback()
            return res.status(400).json({ message: "This card has pending offers" })
        }

        // Új listing létrehozása
        const insertSql = 'INSERT INTO market_listings (user_card_id, status) VALUES (?, "active")'
        const [result] = await connection.query(insertSql, [userCardId])

        await connection.commit()

        res.status(200).json({
            message: "Listing created successfully",
            listingId: result.insertId
        })
    } catch (error) {
        await connection.rollback()
        console.log(error)
        res.status(500).json({ message: "Server error!" })
    } finally {
        connection.release()
    }
})

// AJÁNLAT TÉTELE
app.post('/make-offer', auth, async (req, res) => {
    const { listingId, offeredUserCardId } = req.body

    if (!listingId || !offeredUserCardId) {
        return res.status(400).json({ message: "Missing data" })
    }

    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        // Ellenőrizzük, hogy a listing létezik-e és aktív-e
        const listingSql = 'SELECT * FROM market_listings WHERE id = ? AND status = "active"'
        const [listing] = await connection.query(listingSql, [listingId])

        if (listing.length === 0) {
            await connection.rollback()
            return res.status(404).json({ message: "Listing not found or not active" })
        }

        // Ellenőrizzük, hogy a felajánlott kártya a felhasználóé-e
        const cardSql = 'SELECT * FROM user_cards WHERE id = ? AND user_id = ?'
        const [userCard] = await connection.query(cardSql, [offeredUserCardId, req.user.id])

        if (userCard.length === 0) {
            await connection.rollback()
            return res.status(403).json({ message: "You don't own this card" })
        }

        // Ellenőrizzük, hogy nem a saját listingjére tesz-e ajánlatot
        const ownerSql = `
            SELECT uc.user_id 
            FROM market_listings ml
            INNER JOIN user_cards uc ON ml.user_card_id = uc.id
            WHERE ml.id = ?
        `
        const [owner] = await connection.query(ownerSql, [listingId])

        if (owner[0].user_id === req.user.id) {
            await connection.rollback()
            return res.status(400).json({ message: "You cannot offer on your own listing" })
        }

        // Kártyák adatainak lekérése az értesítéshez
        const [listingCard] = await connection.query(
            'SELECT c.manufacturer, c.name FROM user_cards uc JOIN cards c ON uc.card_id = c.id WHERE uc.id = ?',
            [listing[0].user_card_id]
        )
        const [offeredCard] = await connection.query(
            'SELECT c.manufacturer, c.name FROM user_cards uc JOIN cards c ON uc.card_id = c.id WHERE uc.id = ?',
            [offeredUserCardId]
        )

        const listingManufacturer = listingCard[0].manufacturer
        const listingName = listingCard[0].name
        const offeredManufacturer = offeredCard[0].manufacturer
        const offeredName = offeredCard[0].name

        // Ellenőrizzük, hogy a felajánlott kártyának nincs-e már aktív listingje
        const cardListingSql = 'SELECT * FROM market_listings WHERE user_card_id = ? AND status = "active"'
        const [cardListing] = await connection.query(cardListingSql, [offeredUserCardId])

        if (cardListing.length > 0) {
            await connection.rollback()
            return res.status(400).json({ message: "This card is already listed" })
        }

        // Ellenőrizzük, hogy a felajánlott kártyának nincs-e már függőben lévő offerje
        const cardOfferSql = 'SELECT * FROM market_offers WHERE offered_user_card_id = ? AND status = "pending"'
        const [cardOffer] = await connection.query(cardOfferSql, [offeredUserCardId])

        if (cardOffer.length > 0) {
            await connection.rollback()
            return res.status(400).json({ message: "This card already has a pending offer" })
        }

        // Ajánlat létrehozása
        const offerSql = 'INSERT INTO market_offers (listing_id, offered_user_card_id, status, created_at) VALUES (?, ?, "pending", NOW())'
        const [result] = await connection.query(offerSql, [listingId, offeredUserCardId])

        // Értesítés küldése a listing tulajdonosának
        await sendNotification(
            owner[0].user_id,
            'incoming_offer',
            'New Offer Received!',
            `${req.user.username} offered their ${offeredManufacturer} ${offeredName} for your ${listingManufacturer} ${listingName}`,
            result.insertId
        )

        await connection.commit()

        res.status(200).json({
            message: "Offer created successfully",
            offerId: result.insertId
        })
    } catch (error) {
        await connection.rollback()
        console.log(error)
        res.status(500).json({ message: "Server error!" })
    } finally {
        connection.release()
    }
})

// SAJÁT FÜGGŐBEN LÉVŐ OFFEREK LEKÉRÉSE
app.get('/my-pending-offers', auth, async (req, res) => {
    try {
        const sql = `
            SELECT 
                mo.id as offer_id,
                mo.offered_user_card_id,
                mo.status,
                mo.created_at,
                ml.id as listing_id,
                c.manufacturer,
                c.name,
                c.horsepower,
                c.acceleration,
                c.fuel,
                c.image_url
            FROM market_offers mo
            INNER JOIN market_listings ml ON mo.listing_id = ml.id
            INNER JOIN user_cards uc ON mo.offered_user_card_id = uc.id
            INNER JOIN cards c ON uc.card_id = c.id
            WHERE uc.user_id = ? AND mo.status = 'pending'
            ORDER BY mo.created_at DESC
        `
        const [rows] = await db.query(sql, [req.user.id])

        res.status(200).json({
            message: "Pending offers retrieved successfully",
            offers: rows
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error!", offers: [] })
    }
})

// AJÁNLAT ELFOGADÁSA 
app.post('/accept-offer/:offerId', auth, async (req, res) => {
    const { offerId } = req.params

    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        // Ajánlat lekérése - JAVÍTVA: az offerer_id-t a user_cards táblából kell lekérni
        const offerSql = `
            SELECT 
                mo.*, 
                ml.user_card_id as listing_card_id, 
                uc.user_id as listing_owner_id,
                uc_offer.user_id as offerer_id,
                c_listing.manufacturer as listing_manufacturer, 
                c_listing.name as listing_name,
                c_offer.manufacturer as offered_manufacturer, 
                c_offer.name as offered_name
            FROM market_offers mo
            INNER JOIN market_listings ml ON mo.listing_id = ml.id
            INNER JOIN user_cards uc ON ml.user_card_id = uc.id
            INNER JOIN user_cards uc_offer ON mo.offered_user_card_id = uc_offer.id
            INNER JOIN cards c_listing ON uc.card_id = c_listing.id
            INNER JOIN cards c_offer ON uc_offer.card_id = c_offer.id
            WHERE mo.id = ? AND mo.status = "pending"
        `
        const [offer] = await connection.query(offerSql, [offerId])

        if (offer.length === 0) {
            await connection.rollback()
            return res.status(404).json({ message: "Offer not found" })
        }

        // Ellenőrizzük, hogy a bejelentkezett felhasználó a listing tulajdonosa-e
        if (offer[0].listing_owner_id !== req.user.id) {
            await connection.rollback()
            return res.status(403).json({ message: "You are not the owner of this listing" })
        }

        // Kártyák cseréje
        // 1. A listing kártya átmegy az ajánlattevőhöz
        await connection.query(
            'UPDATE user_cards SET user_id = ? WHERE id = ?',
            [offer[0].offerer_id, offer[0].listing_card_id]
        )

        // 2. Az ajánlott kártya átmegy a listing tulajdonosához
        await connection.query(
            'UPDATE user_cards SET user_id = ? WHERE id = ?',
            [req.user.id, offer[0].offered_user_card_id]
        )

        // Listing státusz frissítése
        await connection.query(
            'UPDATE market_listings SET status = "traded" WHERE id = ?',
            [offer[0].listing_id]
        )

        // Ajánlat státusz frissítése
        await connection.query(
            'UPDATE market_offers SET status = "accepted" WHERE id = ?',
            [offerId]
        )

        // Többi függőben lévő ajánlat elutasítása
        await connection.query(
            'UPDATE market_offers SET status = "rejected" WHERE listing_id = ? AND id != ? AND status = "pending"',
            [offer[0].listing_id, offerId]
        )

        // Értesítés küldése az ajánlattevőnek
        try {
            await sendNotification(
                offer[0].offerer_id,
                'offer_accepted',
                'Your Offer Was Accepted!',
                `Your offer was accepted! You received ${offer[0].listing_manufacturer} ${offer[0].listing_name} in exchange for your ${offer[0].offered_manufacturer} ${offer[0].offered_name}`,
                offerId
            )
        } catch (notifyError) {
            console.error("Error sending notification:", notifyError)
            // Nem dobjuk tovább a hibát
        }

        await connection.commit()

        res.status(200).json({ message: "Offer accepted successfully" })
    } catch (error) {
        await connection.rollback()
        console.error("Error in accept-offer:", error)
        res.status(500).json({ message: "Server error: " + error.message })
    } finally {
        connection.release()
    }
})

// AJÁNLAT ELUTASÍTÁSA (JAVÍTVA)
app.post('/reject-offer/:offerId', auth, async (req, res) => {
    const { offerId } = req.params

    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        // Ajánlat lekérése a listing tulajdonosának ellenőrzéséhez
        const offerSql = `
            SELECT 
                mo.*,
                ml.user_card_id as listing_card_id,
                uc_listing.user_id as listing_owner_id,
                uc_offer.user_id as offerer_id,
                c_listing.manufacturer as listing_manufacturer,
                c_listing.name as listing_name,
                c_offer.manufacturer as offered_manufacturer,
                c_offer.name as offered_name
            FROM market_offers mo
            INNER JOIN market_listings ml ON mo.listing_id = ml.id
            INNER JOIN user_cards uc_listing ON ml.user_card_id = uc_listing.id
            INNER JOIN user_cards uc_offer ON mo.offered_user_card_id = uc_offer.id
            INNER JOIN cards c_listing ON uc_listing.card_id = c_listing.id
            INNER JOIN cards c_offer ON uc_offer.card_id = c_offer.id
            WHERE mo.id = ? AND mo.status = 'pending'
        `
        const [offer] = await connection.query(offerSql, [offerId])

        if (offer.length === 0) {
            await connection.rollback()
            return res.status(404).json({ message: "Offer not found or already processed" })
        }

        // Ellenőrizzük, hogy a bejelentkezett felhasználó a listing tulajdonosa-e
        if (offer[0].listing_owner_id !== req.user.id) {
            await connection.rollback()
            return res.status(403).json({ message: "You are not the owner of this listing" })
        }

        // Ajánlat státuszának frissítése rejected-re
        await connection.query(
            'UPDATE market_offers SET status = "rejected" WHERE id = ?',
            [offerId]
        )

        // Értesítés küldése az ajánlattevőnek
        await sendNotification(
            offer[0].offerer_id,
            'offer_rejected',
            'Your Offer Was Rejected',
            `Your offer for ${offer[0].listing_manufacturer} ${offer[0].listing_name} was rejected.`,
            offerId
        )

        await connection.commit()

        res.status(200).json({ message: "Offer rejected successfully" })
    } catch (error) {
        await connection.rollback()
        console.error("Error in reject-offer:", error)
        res.status(500).json({ message: "Server error: " + error.message })
    } finally {
        connection.release()
    }
})

// SAJÁT LISTINGEK LEKÉRÉSE
app.get('/my-listings', auth, async (req, res) => {
    try {
        const sql = `
            SELECT 
                ml.id as listing_id,
                ml.status,
                uc.id as user_card_id,
                uc.acquired_at,
                c.*
            FROM market_listings ml
            INNER JOIN user_cards uc ON ml.user_card_id = uc.id
            INNER JOIN cards c ON uc.card_id = c.id
            WHERE uc.user_id = ?
            ORDER BY ml.id DESC
        `
        const [rows] = await db.query(sql, [req.user.id])

        res.status(200).json({
            message: "My listings retrieved successfully",
            listings: rows
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error!", listings: [] })
    }
})

// LISTING TÖRLÉSE (CANCELLED státusz)
app.delete('/listing/:listingId', auth, async (req, res) => {
    const { listingId } = req.params

    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        // Ellenőrizzük, hogy a listing a felhasználóé-e
        const checkSql = `
            SELECT ml.*, uc.id as user_card_id
            FROM market_listings ml
            INNER JOIN user_cards uc ON ml.user_card_id = uc.id
            WHERE ml.id = ? AND uc.user_id = ?
        `
        const [listing] = await connection.query(checkSql, [listingId, req.user.id])

        if (listing.length === 0) {
            await connection.rollback()
            return res.status(403).json({ message: "You don't own this listing" })
        }

        // Csak aktív listinget lehet törölni
        if (listing[0].status !== 'active') {
            await connection.rollback()
            return res.status(400).json({ message: "Only active listings can be deleted" })
        }

        // Listing törlése (státusz frissítése cancelled-re)
        await connection.query('UPDATE market_listings SET status = "cancelled" WHERE id = ?', [listingId])

        // A hozzá tartozó függőben lévő offerek státuszának frissítése
        await connection.query(
            'UPDATE market_offers SET status = "rejected" WHERE listing_id = ? AND status = "pending"',
            [listingId]
        )

        // Ha a kártyának voltak saját offerjei (ahol ő ajánlotta fel), azokat is elutasítjuk
        await connection.query(
            'UPDATE market_offers SET status = "rejected" WHERE offered_user_card_id = ? AND status = "pending"',
            [listing[0].user_card_id]
        )

        await connection.commit()

        res.status(200).json({ message: "Listing cancelled successfully" })
    } catch (error) {
        await connection.rollback()
        console.log(error)
        res.status(500).json({ message: "Server error!" })
    } finally {
        connection.release()
    }
})

// OFFER TÖRLÉSE
app.delete('/offer/:offerId', auth, async (req, res) => {
    const { offerId } = req.params

    try {
        // Ellenőrizzük, hogy az offer a felhasználóé-e (ő ajánlotta fel a kártyáját)
        const checkSql = `
            SELECT mo.*, uc.user_id as offer_owner_id
            FROM market_offers mo
            INNER JOIN user_cards uc ON mo.offered_user_card_id = uc.id
            WHERE mo.id = ?
        `
        const [offer] = await db.query(checkSql, [offerId])

        if (offer.length === 0) {
            return res.status(404).json({ message: "Offer not found" })
        }

        // Ellenőrizzük, hogy a bejelentkezett felhasználó a tulajdonosa-e az offernek
        if (offer[0].offer_owner_id !== req.user.id) {
            return res.status(403).json({ message: "You don't own this offer" })
        }

        // Csak pending státuszú offert lehet törölni
        if (offer[0].status !== 'pending') {
            return res.status(400).json({ message: "Only pending offers can be deleted" })
        }

        // Offer törlése (státusz frissítése rejected-re)
        await db.query('UPDATE market_offers SET status = "rejected" WHERE id = ?', [offerId])

        res.status(200).json({ message: "Offer cancelled successfully" })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error!" })
    }
})

// PACKOK LEKÉRÉSE
app.get('/my-packs', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT COUNT(*) as pack_count FROM user_packs WHERE user_id = ?',
            [req.user.id]
        )
        console.log(`User ${req.user.id} has ${rows[0].pack_count} packs`)
        return res.status(200).json({
            message: "Packs retrieved successfully",
            packs: rows[0].pack_count || 0
        })
    } catch (error) {
        console.error("Error in /my-packs:", error)
        res.status(500).json({ message: "Server error!", packs: 0 })
    }
})

// PACK NYITÁS
app.post('/open-pack', auth, async (req, res) => {
    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        // 1. Ellenőrizzük, hogy van-e packja
        const [packRows] = await connection.query(
            'SELECT id FROM user_packs WHERE user_id = ? LIMIT 1',
            [req.user.id]
        )

        if (packRows.length === 0) {
            await connection.rollback()
            return res.status(400).json({ message: "You don't have any packs to open!" })
        }

        // 2. Válassz egy random kártyát (kivéve a teszt kártyákat 1-4)
        const [cards] = await connection.query(
            'SELECT * FROM cards WHERE id > 4 ORDER BY RAND() LIMIT 1'
        )

        if (cards.length === 0) {
            await connection.rollback()
            return res.status(404).json({ message: "No cards available in the database" })
        }

        const selectedCard = cards[0]

        // 3. Add hozzá a user_cards táblához
        const [insertResult] = await connection.query(
            'INSERT INTO user_cards (user_id, card_id, acquired_at) VALUES (?, ?, NOW())',
            [req.user.id, selectedCard.id]
        )

        // 4. Töröld a felhasznált packot
        await connection.query(
            'DELETE FROM user_packs WHERE id = ?',
            [packRows[0].id]
        )

        await connection.commit()

        console.log(`User ${req.user.id} opened a pack and got: ${selectedCard.manufacturer} ${selectedCard.name}`)

        res.status(200).json({
            message: "Pack opened successfully!",
            card: {
                id: selectedCard.id,
                user_card_id: insertResult.insertId,
                card_name: selectedCard.name,
                manufacturer: selectedCard.manufacturer,
                horsepower: selectedCard.horsepower,
                acceleration: selectedCard.acceleration,
                fuel: selectedCard.fuel,
                image_url: selectedCard.image_url
            }
        })

    } catch (error) {
        await connection.rollback()
        console.error("Error in /open-pack:", error)
        res.status(500).json({ message: "Server error during pack opening!" })
    } finally {
        connection.release()
    }
})

// BEÉRKEZŐ AJÁNLATOK LEKÉRÉSE (ahol NEKED ajánlottak)
app.get('/incoming-offers', auth, async (req, res) => {
    try {
        const sql = `
            SELECT 
                mo.id as offer_id,
                mo.status,
                mo.created_at,
                ml.id as listing_id,
                c_listing.manufacturer as listing_manufacturer,
                c_listing.name as listing_name,
                c_listing.image_url as listing_image,
                uc_offer.id as offered_user_card_id,
                c_offer.manufacturer as offered_manufacturer,
                c_offer.name as offered_name,
                c_offer.image_url as offered_image,
                u_offer.id as offerer_id,
                u_offer.username as offerer_username,
                u_offer.email as offerer_email
            FROM market_offers mo
            INNER JOIN market_listings ml ON mo.listing_id = ml.id
            INNER JOIN user_cards uc_listing ON ml.user_card_id = uc_listing.id
            INNER JOIN cards c_listing ON uc_listing.card_id = c_listing.id
            INNER JOIN user_cards uc_offer ON mo.offered_user_card_id = uc_offer.id
            INNER JOIN cards c_offer ON uc_offer.card_id = c_offer.id
            INNER JOIN users u_offer ON uc_offer.user_id = u_offer.id
            WHERE uc_listing.user_id = ? AND mo.status = 'pending'
            ORDER BY mo.created_at DESC
        `
        const [rows] = await db.query(sql, [req.user.id])

        res.status(200).json({
            message: "Incoming offers retrieved successfully",
            offers: rows
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Server error!", offers: [] })
    }
})

// ========== ÉRTESÍTÉSEK VÉGPONTOK ==========

// ÉRTESÍTÉSEK LEKÉRÉSE
// ========== ÉRTESÍTÉSEK VÉGPONTOK ==========

// ÉRTESÍTÉSEK LEKÉRÉSE
app.get('/notifications', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, type, title, message, related_id, is_read, created_at 
             FROM notifications 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 50`,
            [req.user.id]
        );

        res.status(200).json({
            message: "Notifications retrieved successfully",
            notifications: rows
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error!", notifications: [] });
    }
});

// ÉRTESÍTÉS MEGJELÖLÉSE OLVASOTTKÉNT
app.put('/notifications/:id/read', auth, async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [id, req.user.id]
        );
        res.status(200).json({ message: "Notification marked as read" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error!" });
    }
});

// ÖSSZES ÉRTESÍTÉS MEGJELÖLÉSE OLVASOTTKÉNT
app.put('/notifications/read-all', auth, async (req, res) => {
    try {
        await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ?',
            [req.user.id]
        );
        res.status(200).json({ message: "All notifications marked as read" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error!" });
    }
});


// SZERVER INDÍTÁSA
app.listen(PORT, () => {
    console.log(`API fut: http://localhost:${PORT}/`)
})