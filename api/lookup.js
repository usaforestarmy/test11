const axios = require('axios');
const { neon } = require('@neondatabase/serverless');

const stripSymbols = (s) => String(s).replace(/[\s\-().+]/g, "").toLowerCase();

const isBlocked = (input, blocklist) => {
    const raw      = String(input).toLowerCase().trim();
    const stripped = stripSymbols(input);
    for (const entry of blocklist) {
        const e  = entry.toLowerCase().trim();
        const eS = stripSymbols(e);
        if (stripped === eS)       return true;
        if (stripped.includes(eS)) return true;
        if (raw === e)             return true;
        if (raw.includes(e))       return true;
    }
    return false;
};

const extractValues = (obj, out = []) => {
    if (!obj || typeof obj !== "object") return out;
    for (const v of Object.values(obj)) {
        if (typeof v === "string" || typeof v === "number")
            out.push(String(v).toLowerCase().trim());
        else if (typeof v === "object") extractValues(v, out);
    }
    return out;
};

const responseIsBlocked = (obj, blocklist) => {
    for (const val of extractValues(obj)) {
        for (const entry of blocklist) {
            const e  = entry.toLowerCase().trim();
            const eS = stripSymbols(e);
            if (val === e || val.includes(e) ||
                stripSymbols(val) === eS ||
                stripSymbols(val).includes(eS)) return true;
        }
    }
    return false;
};

module.exports = async (req, res) => {
    try {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method Not Allowed" });
        }

        const { type, term } = req.body || {};

        const LOOKUP_API_KEY = process.env.LOOKUP_API_KEY || "7demo";

        const blockedResp = {
            blocked: true,
            msg: "- Content Protected",
            status: "- Access Denied",
            tag: "@forestarmy",
            url: "forestarmy.t.me"
        };

        const invalidResp = {
            invalid: true,
            msg: "- Invalid Input",
            tag: "@forestarmy",
            url: "forestarmy.t.me"
        };

        // STEP 1 — VALIDATE INPUT
        if (!term || typeof term !== "string" || term.trim().length < 5) {
            return res.status(200).json(invalidResp);
        }
        const VALID_TYPES = ["mobile", "user", "vehicle"];
        if (!VALID_TYPES.includes(type)) {
            return res.status(200).json(invalidResp);
        }

        // STEP 2 — LOAD BLOCKLIST FROM NEON DATABASE
        const sql = neon(process.env.DATABASE_URL);
        await sql`CREATE TABLE IF NOT EXISTS blocklist (id SERIAL PRIMARY KEY, entry TEXT UNIQUE NOT NULL)`;
        const rows = await sql`SELECT entry FROM blocklist`;
        const BLOCKLIST = rows.map(r => r.entry);

        // STEP 3 — CHECK INPUT AGAINST BLOCKLIST
        if (isBlocked(term.trim(), BLOCKLIST)) {
            return res.status(200).json(blockedResp);
        }

        // STEP 4 — SANITISE
        const sanitised = term.trim()
            .replace(/[<>"'`;\\]/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();

        // STEP 5 — CALL LOOKUP API
        const apiUrl = `https://users-xinfo-admin.vercel.app/api` +
                       `?key=${LOOKUP_API_KEY}` +
                       `&type=${encodeURIComponent(type)}` +
                       `&term=${encodeURIComponent(sanitised)}`;

        const response = await axios.get(apiUrl, { timeout: 10000 });
        const parsed   = response.data;

        const notFound =
            !parsed ||
            parsed.success === false ||
            parsed.result?.result?.success === false ||
            (Array.isArray(parsed.result?.data?.results) && parsed.result.data.results.length === 0);

        if (notFound) {
            return res.status(200).json(blockedResp);
        }

        // STEP 6 — CHECK RESPONSE AGAINST BLOCKLIST
        if (responseIsBlocked(parsed, BLOCKLIST)) {
            return res.status(200).json(blockedResp);
        }

        // STEP 7 — CLEAN & RETURN
        let clean = JSON.stringify(parsed)
            .replace(/"success":\s*(true|false)/g, `"provider": "@forestarmy"`)
            .replace(/@UsersXinfo_admin/gi, "@forestarmy");

        const final    = JSON.parse(clean);
        final.url      = "forestarmy.t.me";
        final.provider = "@forestarmy";

        return res.status(200).json(final);

    } catch (_) {
        return res.status(200).json({
            blocked: true,
            msg: "- Content Protected",
            tag: "@forestarmy",
            url: "forestarmy.t.me"
        });
    }
};
