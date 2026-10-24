const {
    loadDB, withDB, noSave, getAuth, verifyPassword, isLegacyHash, hashPassword, signToken,
    send, sendError, fail, readBody, rateLimit, resetRateLimit, clientIp,
} = require('./_lib');

module.exports = async (req, res) => {
    // Revoke every admin token WITHOUT changing the password: bumping
    // token_version invalidates all issued tokens (used by the dashboard
    // logout button, best-effort). The caller's own token is revoked too,
    // which is exactly what a logout wants.
    if (req.method === 'DELETE') {
        try {
            const db = await loadDB();
            const auth = getAuth(req, db);
            if (!auth || !auth.admin) {
                return sendError(res, 401, 'Unauthorized');
            }
            const revoked = await withDB(async (fresh) => {
                const innerAuth = getAuth(req, fresh);
                if (!innerAuth || !innerAuth.admin) {
                    return noSave(false);
                }
                fresh.settings.token_version = (fresh.settings.token_version ?? 0) + 1;
                return true;
            });
            if (revoked !== true) {
                return sendError(res, 401, 'Unauthorized');
            }
            return send(res, 200, { status: true });
        } catch (err) {
            return fail(res, err);
        }
    }
    if (req.method !== 'POST') {
        return sendError(res, 405, 'Method not allowed');
    }
    try {
        // Throttle password guessing (audit fix).
        if (!rateLimit(`login:${clientIp(req)}`, 10, 15 * 60 * 1000)) {
            return sendError(res, 429, 'Terlalu banyak percobaan login. Coba lagi nanti.');
        }
        const db = await loadDB();
        const { email, password } = await readBody(req);
        if (!email || !password ||
            email !== db.settings.email ||
            !verifyPassword(password, db.settings.password)) {
            return sendError(res, 401, 'Email atau password salah');
        }
        // A successful login resets its own rate-limit bucket, so
        // legitimate logins never consume the login quota.
        resetRateLimit(`login:${clientIp(req)}`);
        // Opportunistically upgrade a legacy SHA-256 password hash to
        // scrypt (audit fix); a failed upgrade never blocks the login.
        if (isLegacyHash(db.settings.password)) {
            const upgraded = hashPassword(password);
            await withDB(async (fresh) => {
                if (fresh.settings.email === db.settings.email &&
                    isLegacyHash(fresh.settings.password)) {
                    fresh.settings.password = upgraded;
                }
            }).catch(() => null);
        }
        const token = signToken({
            sub: 'admin',
            name: db.settings.name,
            email: db.settings.email,
            tv: db.settings.token_version ?? 0,
            exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        });
        return send(res, 200, { token });
    } catch (err) {
        return fail(res, err);
    }
};
