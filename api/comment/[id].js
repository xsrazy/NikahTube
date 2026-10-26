const crypto = require('crypto');
const {
    loadDB, withDB, noSave, getAuth, send, sendError, fail, httpError, readBody, clientIp,
    rateLimit, filterBadWords, parsePresence, toPublic, buildTree,
    findComment, findByOwn, removeSubtree,
} = require('../_lib');

const MAX_COMMENT = 3000;

module.exports = async (req, res) => {
    try {
        const id = String(req.query.id || '');

        // Show one comment (used by the edit form). One shared
        // serializer (toPublic), so pinned/like/own are included just
        // like in list responses.
        if (req.method === 'GET') {
            const db = await loadDB();
            const auth = getAuth(req, db);
            if (!auth) {
                return sendError(res, 401, 'Invalid access key');
            }
            const comment = findComment(db, id);
            if (!comment) {
                return sendError(res, 404, 'Komentar tidak ditemukan.');
            }
            const { byParent } = buildTree(db.comments);
            return send(res, 200, toPublic(comment, byParent, Boolean(auth.admin)));
        }

        // Like a comment. The id is the comment's public uuid. One like per
        // IP per comment (audit fix): a repeat like returns the existing
        // like instead of inflating the count. Guests are rate-limited
        // (admins exempt); the limit is checked once before withDB so a
        // lost-update retry never burns extra quota.
        if (req.method === 'POST') {
            const preDb = await loadDB();
            const preAuth = getAuth(req, preDb);
            if (!preAuth) {
                return sendError(res, 401, 'Invalid access key');
            }
            const ip = clientIp(req);
            if (!preAuth.admin && !rateLimit(`like:${ip}`, 30, 60 * 1000)) {
                return sendError(res, 429, 'Terlalu cepat. Coba lagi sebentar.');
            }
            const likeUuid = await withDB(async (db) => {
                const auth = getAuth(req, db);
                if (!auth) {
                    return noSave(null);
                }
                const comment = findComment(db, id);
                if (!comment) {
                    return noSave(undefined);
                }
                comment.likes = comment.likes || [];
                const existing = comment.likes.find((l) => l.ip === ip);
                if (existing) {
                    return noSave(existing.uuid);
                }
                const like = {
                    uuid: crypto.randomUUID(),
                    ip,
                    created_at: new Date().toISOString(),
                };
                comment.likes.push(like);
                return like.uuid;
            });
            if (likeUuid === null) {
                return sendError(res, 401, 'Invalid access key');
            }
            if (likeUuid === undefined) {
                return sendError(res, 404, 'Komentar tidak ditemukan.');
            }
            return send(res, 201, { uuid: likeUuid });
        }

        // Unlike. The id is the like uuid returned when liking. Only the
        // liker's own IP (or an admin) may remove a like.
        if (req.method === 'PATCH') {
            const preDb = await loadDB();
            const preAuth = getAuth(req, preDb);
            if (!preAuth) {
                return sendError(res, 401, 'Invalid access key');
            }
            const ip = clientIp(req);
            if (!preAuth.admin && !rateLimit(`like:${ip}`, 30, 60 * 1000)) {
                return sendError(res, 429, 'Terlalu cepat. Coba lagi sebentar.');
            }
            const removed = await withDB(async (db) => {
                const auth = getAuth(req, db);
                if (!auth) {
                    return noSave(null);
                }
                const isAdmin = Boolean(auth.admin);
                for (const comment of db.comments) {
                    const idx = (comment.likes || []).findIndex((l) => l.uuid === id);
                    if (idx >= 0) {
                        if (!isAdmin && comment.likes[idx].ip !== ip) {
                            throw httpError(403, 'Bukan like Anda.');
                        }
                        comment.likes.splice(idx, 1);
                        return true;
                    }
                }
                return noSave(false);
            });
            if (removed === null) {
                return sendError(res, 401, 'Invalid access key');
            }
            if (removed === false) {
                return sendError(res, 404, 'Like tidak ditemukan.');
            }
            return send(res, 200, { status: true });
        }

        if (req.method === 'PUT' || req.method === 'DELETE') {
            // Audit fix: a malformed PUT body must be a 400, not a silent
            // no-op success. DELETE carries no body, so its parse errors
            // stay swallowed (the body is ignored for deletes).
            const body = req.method === 'PUT' ? await readBody(req) : await readBody(req).catch(() => ({}));
            const status = await withDB(async (db) => {
                const auth = getAuth(req, db);
                if (!auth) {
                    return noSave(null);
                }
                const isAdmin = Boolean(auth.admin);
                // Edit / delete resolve by the secret "own" token; admins
                // may use the public uuid.
                const target = findByOwn(db, id) || (isAdmin ? findComment(db, id) : null);
                if (!target) {
                    throw httpError(404, 'Komentar tidak ditemukan.');
                }
                if (req.method === 'PUT') {
                    // Strict type: a non-string comment used to be
                    // coerced into "[object Object]" and stored.
                    if (body.comment !== undefined && body.comment !== null
                        && typeof body.comment !== 'string') {
                        throw httpError(400, 'Komentar tidak valid.');
                    }
                    // Pinned comments (dashboard feature): only admins
                    // may pin, only top-level comments can be pinned, and
                    // there is exactly one pinned comment at a time.
                    // Strict pinned validation: only real booleans, plus
                    // exactly 1/'true' for pin and 0/'false' for unpin.
                    // Anything else is a 400 BEFORE mutating (a loose
                    // value used to silently unpin with a 200).
                    if (body.pinned !== undefined && body.pinned !== null) {
                        if (!isAdmin) {
                            throw httpError(403, 'Hanya admin yang dapat menyematkan komentar.');
                        }
                        if (target.parent) {
                            throw httpError(400, 'Hanya komentar utama yang dapat disematkan.');
                        }
                        let want;
                        if (body.pinned === true || body.pinned === 1 || body.pinned === 'true') {
                            want = true;
                        } else if (body.pinned === false || body.pinned === 0 || body.pinned === 'false') {
                            want = false;
                        } else {
                            throw httpError(400, 'Nilai sematan tidak valid.');
                        }
                        if (want) {
                            for (const c of db.comments) {
                                c.pinned = false;
                            }
                            target.pinned = true;
                        } else {
                            target.pinned = false;
                        }
                    }
                    if (!db.settings.can_edit && !isAdmin) {
                        throw httpError(403, 'Edit komentar sedang dimatikan.');
                    }
                    let text = String(body.comment ?? target.comment).trim();
                    if (text.length === 0 || text.length > MAX_COMMENT) {
                        throw httpError(400, 'Komentar tidak valid.');
                    }
                    if (db.settings.is_filter) {
                        text = filterBadWords(text);
                    }
                    target.comment = text;
                    if (body.presence !== null && body.presence !== undefined) {
                        const presence = parsePresence(body.presence);
                        if (presence === null) {
                            throw httpError(400, 'Konfirmasi kehadiran tidak valid.');
                        }
                        target.presence = presence;
                    }
                    return true;
                }
                if (!db.settings.can_delete && !isAdmin) {
                    throw httpError(403, 'Hapus komentar sedang dimatikan.');
                }
                // Guests must not destroy other people's replies: a
                // non-admin delete of a comment that has replies is
                // rejected (admin deletes still remove the subtree).
                if (!isAdmin && db.comments.some((c) => c.parent === target.uuid)) {
                    throw httpError(400, 'Komentar ini memiliki balasan, jadi tidak dapat dihapus.');
                }
                removeSubtree(db, target.uuid);
                return true;
            });
            if (status === null) {
                return sendError(res, 401, 'Invalid access key');
            }
            return send(res, 200, { status });
        }

        return sendError(res, 405, 'Method not allowed');
    } catch (err) {
        return fail(res, err);
    }
};
