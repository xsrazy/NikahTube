const crypto = require('crypto');
const {
    loadDB, withDB, getAuth, send, sendError, fail, httpError, readBody,
    clientIp, rateLimit, filterBadWords, parsePresence, toPublic, buildTree,
    findComment, commentDepth,
} = require('../_lib');

const MAX_NAME = 100;
const MAX_COMMENT = 3000;
const MAX_DEPTH = 10;

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            const db = await loadDB();
            const auth = getAuth(req, db);
            if (!auth) {
                return sendError(res, 401, 'Invalid access key');
            }
            const isAdmin = Boolean(auth.admin);
            const per = Math.max(1, Math.min(100, parseInt(req.query.per, 10) || 10));
            const next = Math.max(0, parseInt(req.query.next, 10) || 0);
            // Roots arrive pinned-first, then newest-first (buildTree), so
            // the pinned root (if any) is on the first page (next=0) and
            // is not repeated on later pages.
            const { roots, byParent } = buildTree(db.comments);
            const page = roots.slice(next, next + per).map((c) => toPublic(c, byParent, isAdmin));
            return send(res, 200, page);
        }

        if (req.method === 'POST') {
            // Auth first (before body validation), and the rate limit is
            // checked once here — not inside the mutator, where a
            // lost-update retry would burn extra quota and could turn a
            // would-be success into a 429.
            const preDb = await loadDB();
            const preAuth = getAuth(req, preDb);
            if (!preAuth) {
                return sendError(res, 401, 'Invalid access key');
            }
            const body = await readBody(req);
            // Strict types: String() coercion used to turn {comment: {}}
            // into the literal "[object Object]" in the public guestbook.
            const name = typeof body.name === 'string' ? body.name.trim() : null;
            let text = typeof body.comment === 'string' ? body.comment.trim() : null;
            if (name === null || name.length === 0) {
                return sendError(res, 400, 'Silakan masukkan nama Anda.');
            }
            if (name.length > MAX_NAME) {
                return sendError(res, 400, 'Nama terlalu panjang.');
            }
            if (text === null || text.length === 0) {
                return sendError(res, 400, 'Komentar tidak boleh kosong.');
            }
            if (text.length > MAX_COMMENT) {
                return sendError(res, 400, 'Komentar terlalu panjang.');
            }
            const presence = parsePresence(body.presence);
            if (presence === null) {
                return sendError(res, 400, 'Konfirmasi kehadiran tidak valid.');
            }
            // Throttle guest comment floods (audit fix); admins exempt.
            const ip = clientIp(req);
            if (!preAuth.admin && !rateLimit(`comment:${ip}`, 20, 60 * 1000)) {
                return sendError(res, 429, 'Terlalu banyak komentar. Coba lagi nanti.');
            }
            const parentId = body.id ? String(body.id) : null;

            const payload = await withDB(async (db) => {
                const auth = getAuth(req, db);
                if (!auth) {
                    throw httpError(401, 'Invalid access key');
                }
                const isAdmin = Boolean(auth.admin);
                if (parentId) {
                    if (!db.settings.can_reply && !isAdmin) {
                        throw httpError(403, 'Balasan komentar sedang dimatikan.');
                    }
                    const parent = findComment(db, parentId);
                    if (!parent) {
                        throw httpError(404, 'Komentar induk tidak ditemukan.');
                    }
                    if (commentDepth(db, parent) + 1 > MAX_DEPTH) {
                        throw httpError(400, 'Balasan komentar terlalu dalam.');
                    }
                }
                let finalName = name;
                let finalText = text;
                if (db.settings.is_filter) {
                    // Same word-boundary filter as the comment text.
                    finalName = filterBadWords(finalName);
                    finalText = filterBadWords(finalText);
                }
                const comment = {
                    uuid: crypto.randomUUID(),
                    own: crypto.randomUUID(),
                    parent: parentId,
                    name: finalName,
                    presence,
                    comment: finalText,
                    is_admin: isAdmin,
                    ip,
                    user_agent: String(req.headers['user-agent'] || ''),
                    created_at: new Date().toISOString(),
                    likes: [],
                };
                db.comments.push(comment);
                // One shared serializer (toPublic) for every comment
                // response, so pinned/like/created_raw are always present.
                // `own` is added back because the poster needs it to
                // edit/delete their own comment.
                return { ...toPublic(comment, new Map(), isAdmin), own: comment.own };
            });
            return send(res, 201, payload);
        }

        return sendError(res, 405, 'Method not allowed');
    } catch (err) {
        return fail(res, err);
    }
};
