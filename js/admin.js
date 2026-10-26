import { dto } from './dto.js';
import { util } from './util.js';
import { navbar } from './navbar.js';
import { storage } from './storage.js';
import { session } from './session.js';
import { comment } from './comment.js';
import { guests } from './guests.js';
import { site } from './site.js';
import { request, HTTP_GET, HTTP_PATCH, HTTP_PUT } from './request.js';

export const admin = (() => {

    let user = null;

    const showLogin = () => {
        document.getElementById('login-overlay')?.classList.add('open');
    };

    const hideLogin = () => {
        document.getElementById('login-overlay')?.classList.remove('open');
    };

    const formatNumber = (n) => Number(n ?? 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    const renderRsvpBars = (present, absent, unsure) => {
        const el = document.getElementById('rsvp-bars');
        if (!el) {
            return;
        }
        const total = present + absent + unsure;
        const pPct = total ? Math.round((present / total) * 100) : 0;
        const aPct = total ? Math.round((absent / total) * 100) : 0;
        const uPct = total ? Math.max(0, 100 - pPct - aPct) : 0;
        el.innerHTML = `
            <div class="rsvp-row">
                <div class="rsvp-label"><span>Hadir</span><span>${present} (${pPct}%)</span></div>
                <div class="rsvp-track"><div class="rsvp-fill hadir" style="width: ${pPct}%"></div></div>
            </div>
            <div class="rsvp-row">
                <div class="rsvp-label"><span>Berhalangan</span><span>${absent} (${aPct}%)</span></div>
                <div class="rsvp-track"><div class="rsvp-fill absent" style="width: ${aPct}%"></div></div>
            </div>
            <div class="rsvp-row">
                <div class="rsvp-label"><span>Masih Ragu</span><span>${unsure} (${uPct}%)</span></div>
                <div class="rsvp-track"><div class="rsvp-fill unsure" style="width: ${uPct}%"></div></div>
            </div>`;
    };

    const loadRecentComments = () => {
        const el = document.getElementById('recent-comments');
        if (!el) {
            return;
        }
        request(HTTP_GET, '/api/comment?per=3&next=0')
            .token(session.getToken())
            .send()
            .then((res) => {
                const items = res.data || [];
                if (items.length === 0) {
                    el.innerHTML = '<p class="muted">Belum ada komentar.</p>';
                    return;
                }
                el.innerHTML = items.map((c) => {
                    const text = String(c.comment || '').replace(/\s+/g, ' ').slice(0, 80);
                    const pin = c.pinned ? '<span class="cmt-pin">Disematkan</span>' : '';
                    return `<div class="recent-item"><div class="r-name">${util.escapeHtml(c.name)}${pin}</div><div class="r-text">${util.escapeHtml(text)}</div><div class="r-time">${util.escapeHtml(c.created_at || '')}</div></div>`;
                }).join('');
            })
            .catch(() => {
                el.innerHTML = '<p class="muted">Belum ada komentar.</p>';
            });
    };

    const loadRecentGuests = () => {
        const el = document.getElementById('recent-guests');
        if (!el) {
            return;
        }
        request(HTTP_GET, '/api/guest')
            .token(session.getToken())
            .send()
            .then((res) => {
                const items = (res.data || []).slice(0, 3);
                if (items.length === 0) {
                    el.innerHTML = '<p class="muted">Belum ada tamu tersimpan.</p>';
                    return;
                }
                el.innerHTML = items.map((g) => `<div class="recent-item"><div class="r-name">${util.escapeHtml(g.name)}</div><div class="r-time">${util.escapeHtml(g.created_at || '')}</div></div>`).join('');
            })
            .catch(() => {
                el.innerHTML = '<p class="muted">Belum ada tamu tersimpan.</p>';
            });
    };

    const getUserDetail = () => {
        return request(HTTP_GET, '/api/user').token(session.getToken()).send().then((res) => {

            for (let [key, value] of Object.entries(res.data)) {
                user.set(key, value);
            }

            document.getElementById('dashboard-email').textContent = res.data.email;
            document.getElementById('dashboard-accesskey').value = res.data.access_key;
            document.getElementById('button-copy-accesskey').setAttribute('data-copy', res.data.access_key);
            const headerName = document.getElementById('dashboard-name');
            if (headerName) {
                headerName.textContent = res.data.name || '';
            }

            document.getElementById('form-name').value = res.data.name;
            document.getElementById('filterBadWord').checked = Boolean(res.data.is_filter);
            document.getElementById('replyComment').checked = Boolean(res.data.can_reply);
            document.getElementById('editComment').checked = Boolean(res.data.can_edit);
            document.getElementById('deleteComment').checked = Boolean(res.data.can_delete);
            site.fill(res.data.site);
        }).catch((err) => {
            // Audit fix: an expired/revoked token used to leave the
            // dashboard half-loaded with placeholders and no login
            // prompt. Only auth failures force a re-login; transient
            // errors keep the session (request.js already alerted).
            const msg = err && err.message ? err.message : '';
            if (/unauthorized|invalid access key/i.test(msg)) {
                try { session.logout(); } catch {}
                try { if (user) { user.clear(); } } catch {}
                showLogin();
            }
        });

        request(HTTP_GET, '/api/stats').token(session.getToken()).send().then((res) => {
            document.getElementById('count-comment').innerHTML = formatNumber(res.data.comments);
            document.getElementById('count-like').innerHTML = formatNumber(res.data.likes);
            document.getElementById('count-present').innerHTML = formatNumber(res.data.present);
            document.getElementById('count-absent').innerHTML = formatNumber(res.data.absent);
            const unsureEl = document.getElementById('count-unsure');
            if (unsureEl) {
                unsureEl.innerHTML = formatNumber(res.data.unsure ?? 0);
            }
            document.getElementById('count-follow-groom').textContent = (res.data.follows_groom ?? 0).toString();
            document.getElementById('count-follow-bride').textContent = (res.data.follows_bride ?? 0).toString();
            renderRsvpBars(Number(res.data.present ?? 0), Number(res.data.absent ?? 0), Number(res.data.unsure ?? 0));
        }).catch(() => {
            // request.js already alerted the failure; without a catch
            // this promise left an unhandled rejection.
        });

        loadRecentComments();
        loadRecentGuests();
    };

    const changeFilterBadWord = async (checkbox) => {
        const label = util.addLoadingCheckbox(checkbox);

        try {
            await request(HTTP_PATCH, '/api/user').
                token(session.getToken()).
                body({
                    filter: Boolean(checkbox.checked)
                }).
                send();
        } catch {
            // request.js already alerted; revert the toggle so the
            // checkbox never shows a state the server did not keep.
            checkbox.checked = !checkbox.checked;
        } finally {
            label.restore();
        }
    };

    const replyComment = async (checkbox) => {
        const label = util.addLoadingCheckbox(checkbox);

        try {
            await request(HTTP_PATCH, '/api/user').
                token(session.getToken()).
                body({
                    can_reply: Boolean(checkbox.checked)
                }).
                send();
        } catch {
            checkbox.checked = !checkbox.checked;
        } finally {
            label.restore();
        }
    };

    const editComment = async (checkbox) => {
        const label = util.addLoadingCheckbox(checkbox);

        try {
            await request(HTTP_PATCH, '/api/user').
                token(session.getToken()).
                body({
                    can_edit: Boolean(checkbox.checked)
                }).
                send();
        } catch {
            checkbox.checked = !checkbox.checked;
        } finally {
            label.restore();
        }
    };

    const deleteComment = async (checkbox) => {
        const label = util.addLoadingCheckbox(checkbox);

        try {
            await request(HTTP_PATCH, '/api/user').
                token(session.getToken()).
                body({
                    can_delete: Boolean(checkbox.checked)
                }).
                send();
        } catch {
            checkbox.checked = !checkbox.checked;
        } finally {
            label.restore();
        }
    };

    const regenerate = async (button) => {
        if (!confirm('Are you sure?')) {
            return;
        }

        const btn = util.disableButton(button);

        try {
            await request(HTTP_PUT, '/api/key').
                token(session.getToken()).
                send(dto.statusResponse).
                then((res) => {
                    if (res.data.status) {
                        getUserDetail();
                    }
                });
        } finally {
            btn.restore();
        }
    };

    const changePassword = async (button) => {
        const old = document.getElementById('old_password');
        const newest = document.getElementById('new_password');

        if (old.value.length == 0 || newest.value.length == 0) {
            alert('Password cannot be empty');
            return;
        }

        if (newest.value.length < 8) {
            alert('Password baru minimal 8 karakter.');
            return;
        }

        old.disabled = true;
        newest.disabled = true;

        const btn = util.disableButton(button);

        const result = await request(HTTP_PATCH, '/api/user').
            token(session.getToken()).
            body({
                old_password: old.value,
                new_password: newest.value,
            }).
            send(dto.statusResponse).
            then((res) => res.data.status, () => false);

        btn.restore();

        old.disabled = false;
        newest.disabled = false;

        if (result) {
            old.value = null;
            newest.value = null;
            button.disabled = true;
            alert('Password berhasil diubah. Silakan login ulang dengan password baru.');
            try { user.clear(); } catch {}
            session.logout();
            showLogin();
        }
        // No second alert here: on failure request.js already showed the
        // server's real reason (e.g. wrong old password), and alerting
        // again would show two stacked dialogs.
    };

    const changeName = async (button) => {
        const name = document.getElementById('form-name');

        if (name.value.length == 0) {
            alert('Name cannot be empty');
            return;
        }

        name.disabled = true;

        const btn = util.disableButton(button);

        const result = await request(HTTP_PATCH, '/api/user').
            token(session.getToken()).
            body({
                name: name.value,
            }).
            send(dto.statusResponse).
            then((res) => res.data.status, () => false);

        name.disabled = false;

        btn.restore();

        if (result) {
            getUserDetail();
            button.disabled = true;
            alert('Success change name');
        }
        // No second alert on failure: request.js already showed the
        // server's real reason (the rejection handler above turned it
        // into result=false), and alerting again would stack dialogs.
    };

    const download = async (button) => {
        const btn = util.disableButton(button);

        // download() returns false on non-200 (no alert) and rethrows
        // (already alerted) on network errors: alert only for the
        // silent false case, and never leave an unhandled rejection.
        let ok = null;
        try {
            ok = await request(HTTP_GET, '/api/download').token(session.getToken()).download();
        } catch {
            ok = null;
        }
        if (ok === false) {
            alert('Gagal mengunduh. Coba lagi.');
        }

        btn.restore();
    };

    const enableButtonName = () => {
        const btn = document.getElementById('button-change-name');
        if (btn.disabled) {
            btn.disabled = false;
        }
    };

    const enableButtonPassword = () => {
        const btn = document.getElementById('button-change-password');
        const old = document.getElementById('old_password');

        if (btn.disabled && old.value.length !== 0) {
            btn.disabled = false;
        }
    };

    const login = async (button) => {
        const btn = util.disableButton(button);

        const formEmail = document.getElementById('loginEmail');
        const formPassword = document.getElementById('loginPassword');

        formEmail.disabled = true;
        formPassword.disabled = true;

        const loginError = document.getElementById('loginError');
        if (loginError) {
            loginError.classList.add('d-none');
        }

        const res = await session.login(dto.postSessionRequest(formEmail.value, formPassword.value));
        if (res.code === 200) {
            // Await the user detail before rendering the list: the old
            // fire-and-forget race rendered the admin name as literal
            // "undefined" and blocked admin posts until /api/user landed.
            await getUserDetail();
            guests.load();
            comment.comment();
            hideLogin();
            formEmail.value = null;
            formPassword.value = null;
        } else if (loginError) {
            loginError.textContent = res.code === 0
                ? 'Gagal terhubung, coba lagi.'
                : res.code === 401
                    ? 'Email atau password salah. Coba lagi.'
                    : res.code === 429
                        ? 'Terlalu banyak percobaan, coba lagi dalam 15 menit.'
                        : 'Terjadi kesalahan pada server, coba lagi.';
            loginError.classList.remove('d-none');
        }

        btn.restore();
        formEmail.disabled = false;
        formPassword.disabled = false;
    };

    const logout = () => {
        if (!confirm('Are you sure?')) {
            return;
        }

        // Revoke server-side first (best-effort): DELETE /api/session
        // bumps token_version, so a copied token stops working too. The
        // local discard below runs even if the call fails.
        try {
            const token = session.getToken();
            if (token) {
                fetch('/api/session', {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token },
                }).catch(() => {});
            }
        } catch {}

        user.clear();
        session.logout();
        showLogin();
    };

    const init = () => {
        session.init();
        user = storage('user');

        if (!session.isAdmin()) {
            storage('owns').clear();
            storage('likes').clear();
            storage('config').clear();
            storage('comment').clear();
            storage('session').clear();
            storage('information').clear();
        }

        comment.init();

        try {
            const jwt = session.decode();
            if (!jwt || (jwt.exp ?? 0) < (Date.now() / 1000)) {
                throw new Error('invalid token');
            }

            getUserDetail();
            guests.load();
            comment.comment();
        } catch {
            showLogin();
            session.logout();
            user.clear();
        }
    };

    return {
        init,
        login,
        logout,
        changeFilterBadWord,
        replyComment,
        editComment,
        deleteComment,
        regenerate,
        changePassword,
        download,
        changeName,
        enableButtonName,
        enableButtonPassword,
        navbar,
    };
})();
