const { loadDB, withDB, noSave, getAuth, hashPassword, verifyPassword, send, sendError, fail, httpError, readBody, defaultSite, deleteMedia } = require('./_lib');

// Uploaded media names referenced by a site document (photo/audio
// fields plus the gallery, which may be a string or an array).
const MEDIA_NAME_RE = /\/api\/media\/(media-\d+-[a-f0-9]+\.(?:webp|png|jpg|gif|mp3|ogg|m4a|aac))/g;
const collectMediaNames = (site) => {
    if (!site || typeof site !== 'object') {
        return [];
    }
    const names = new Set();
    for (const key of ['album_art', 'groom_photo', 'bride_photo', 'music_url', 'gallery_urls']) {
        const value = site[key];
        const text = Array.isArray(value) ? value.join('\n') : (typeof value === 'string' ? value : '');
        for (const m of text.matchAll(MEDIA_NAME_RE)) {
            names.add(m[1]);
        }
    }
    return [...names];
};

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            const db = await loadDB();
            const auth = getAuth(req, db);
            if (!auth || !auth.admin) {
                return sendError(res, 401, 'Unauthorized');
            }
            const s = db.settings;
            return send(res, 200, {
                name: s.name,
                email: s.email,
                access_key: s.access_key,
                is_filter: s.is_filter,
                can_reply: s.can_reply,
                can_edit: s.can_edit,
                can_delete: s.can_delete,
                site: s.site || defaultSite(),
            });
        }

        if (req.method === 'PATCH') {
            const body = await readBody(req);
            // Snapshot referenced media before the change, so blobs
            // replaced by this PATCH can be cleaned up afterwards.
            const oldNames = await loadDB().then((db) => collectMediaNames(db.settings.site)).catch(() => []);
            const site = await withDB(async (db) => {
                const auth = getAuth(req, db);
                if (!auth || !auth.admin) {
                    return noSave(null);
                }
                const s = db.settings;
                if (body.old_password !== undefined || body.new_password !== undefined) {
                    if (!body.old_password || !verifyPassword(body.old_password, s.password)) {
                        throw httpError(401, 'Password lama salah.');
                    }
                    if (!body.new_password || body.new_password.length < 8) {
                        throw httpError(400, 'Password baru minimal 8 karakter.');
                    }
                    s.password = hashPassword(body.new_password);
                    // Revoke every previously issued admin token (audit fix).
                    s.token_version = (s.token_version ?? 0) + 1;
                }
                if (typeof body.name === 'string' && body.name.trim().length > 0) {
                    if (body.name.trim().length > 100) {
                        throw httpError(400, 'Nama terlalu panjang.');
                    }
                    s.name = body.name.trim();
                }
                if (typeof body.filter === 'boolean') {
                    s.is_filter = body.filter;
                }
                if (typeof body.can_reply === 'boolean') {
                    s.can_reply = body.can_reply;
                }
                if (typeof body.can_edit === 'boolean') {
                    s.can_edit = body.can_edit;
                }
                if (typeof body.can_delete === 'boolean') {
                    s.can_delete = body.can_delete;
                }
                // Site content: whitelist-merge string fields only, so
                // the dashboard form can never smuggle unexpected keys
                // or non-string values into the stored document.
                if (body.site && typeof body.site === 'object' && !Array.isArray(body.site)) {
                    const allowed = Object.keys(defaultSite());
                    // Date fields must stay valid: a bad wedding_iso
                    // breaks the public countdown for every visitor
                    // (NaN cells), and the API used to accept any string.
                    if (typeof body.site.wedding_iso === 'string'
                        && Number.isNaN(Date.parse(body.site.wedding_iso))) {
                        throw httpError(400, 'Tanggal pernikahan tidak valid.');
                    }
                    for (const key of ['cal_start', 'cal_end']) {
                        if (typeof body.site[key] === 'string' && !/^\d{8}T\d{6}Z$/.test(body.site[key])) {
                            throw httpError(400, 'Waktu kalender tidak valid.');
                        }
                    }
                    const current = (s.site && typeof s.site === 'object') ? s.site : {};
                    for (const key of allowed) {
                        const value = body.site[key];
                        if (typeof value === 'string' && value.length <= 6000) {
                            current[key] = value;
                        }
                    }
                    s.site = { ...defaultSite(), ...current };
                }
                // Return the stored site so the dashboard refills from
                // what the server actually kept (an over-long field is
                // visibly reverted instead of silently dropped).
                return s.site || defaultSite();
            });
            if (site === null) {
                return sendError(res, 401, 'Unauthorized');
            }
            // Best-effort orphan cleanup: blobs replaced by this PATCH
            // are no longer referenced by the saved site, so delete
            // them instead of letting the store grow forever.
            const orphaned = oldNames.filter((n) => !collectMediaNames(site).includes(n));
            if (orphaned.length > 0) {
                await deleteMedia(orphaned);
            }
            return send(res, 200, { status: true, site });
        }

        return sendError(res, 405, 'Method not allowed');
    } catch (err) {
        return fail(res, err);
    }
};
