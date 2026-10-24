import { dto } from './dto.js';
import { card } from './card.js';
import { like } from './like.js';
import { util } from './util.js';
import { session } from './session.js';
import { storage } from './storage.js';
import { pagination } from './pagination.js';
import { request, HTTP_GET, HTTP_POST, HTTP_DELETE, HTTP_PUT } from './request.js';

export const comment = (() => {

    let owns = null;
    let user = null;
    let tracker = null;
    let showHide = null;

    // Root comment ids in the order the API returned them (pinned
    // first, then newest first). setSort reorders the DOM from this
    // list without refetching.
    let currentOrder = [];

    // Raw ISO timestamps per root id (from the API's created_raw), so
    // the "Terbaru"/"Terlama" sorts can be strictly chronological
    // instead of reusing the pinned-first API order.
    let currentCreated = {};

    const changeButton = (id, disabled) => document.querySelector(`[data-button-action="${id}"]`).childNodes.forEach((e) => e.disabled = disabled);

    const remove = async (button) => {
        if (!confirm('Are you sure?')) {
            return;
        }

        const id = button.getAttribute('data-uuid');

        if (session.isAdmin()) {
            owns.set(id, button.getAttribute('data-own'));
        }

        changeButton(id, true);
        const btn = util.disableButton(button);
        const like = document.querySelector(`[onclick="like.like(this)"][data-uuid="${id}"]`);
        like.disabled = true;

        const status = await request(HTTP_DELETE, '/api/comment/' + owns.get(id))
            .token(session.getToken())
            .send(dto.statusResponse)
            .then((res) => res.data.status, () => false);

        if (!status) {
            btn.restore();
            like.disabled = false;
            return;
        }

        document.querySelectorAll('a[onclick="comment.showOrHide(this)"]').forEach((n) => {
            const oldUuids = n.getAttribute('data-uuids').split(',');

            if (oldUuids.find((i) => i === id)) {
                const uuids = oldUuids.filter((i) => i !== id).join(',');
                uuids.length === 0 ? n.remove() : n.setAttribute('data-uuids', uuids);
            }
        });

        owns.unset(id);
        currentOrder = currentOrder.filter((u) => u !== id);
        document.getElementById(id).remove();
    };

    const pin = async (button) => {
        const id = button.getAttribute('data-uuid');
        const currentlyPinned = button.getAttribute('data-pinned') === 'true';

        const btn = util.disableButton(button);
        try {
            const res = await request(HTTP_PUT, '/api/comment/' + id)
                .token(session.getToken())
                .body({ pinned: !currentlyPinned })
                .send(dto.statusResponse);
            if (res.data.status) {
                comment();
            } else {
                alert('Gagal mengubah sematan. Coba lagi.');
            }
        } catch {
            // request.js already alerted the real reason (e.g. a 400/403).
        } finally {
            btn.restore();
        }
    };

    const setSort = (btn, mode) => {
        document.querySelectorAll('[data-sort]').forEach((c) => {
            c.classList.toggle('active', c === btn);
        });

        const list = document.getElementById('comments');
        if (!list) {
            return;
        }
        // "Semua" keeps the pinned-first API order; "Terbaru" is
        // strictly chronological (pins NOT prioritized); "Terlama" is
        // the reverse. Missing timestamps fall back to API order.
        let order;
        if (mode === 'new') {
            order = [...currentOrder].sort((a, b) => String(currentCreated[b] || '').localeCompare(String(currentCreated[a] || '')));
        } else if (mode === 'old') {
            order = [...currentOrder].sort((a, b) => String(currentCreated[a] || '').localeCompare(String(currentCreated[b] || '')));
        } else {
            order = currentOrder;
        }
        for (const uuid of order) {
            const el = document.getElementById(uuid);
            if (el) {
                list.appendChild(el);
            }
        }
    };

    const update = async (button) => {
        const id = button.getAttribute('data-uuid');

        // Tri-state presence: '1' = Datang, '2' = Berhalangan,
        // '3' = Masih Ragu. Null when the edit form has no select
        // (admin edits), meaning "leave presence unchanged".
        let presenceVal = null;
        const presence = document.getElementById(`form-inner-presence-${id}`);
        if (presence) {
            presence.disabled = true;
            presenceVal = presence.value;
        }

        const form = document.getElementById(`form-${id ? `inner-${id}` : 'comment'}`);

        let badgeVal = null;
        const badge = document.getElementById(`badge-${id}`);
        if (badge) {
            badgeVal = badge.classList.contains('badge-present') ? '1'
                : badge.classList.contains('badge-unsure') ? '3' : '2';
        }

        if (id && util.base64Encode(form.value) === form.getAttribute('data-original') && (!presence || badgeVal === presenceVal)) {
            changeButton(id, false);
            document.getElementById(`inner-${id}`).remove();
            return;
        }

        form.disabled = true;

        const cancel = document.querySelector(`[onclick="comment.cancel('${id}')"]`);
        if (cancel) {
            cancel.disabled = true;
        }

        const btn = util.disableButton(button);

        const status = await request(HTTP_PUT, '/api/comment/' + owns.get(id))
            .token(session.getToken())
            .body(dto.updateCommentRequest(presenceVal !== null ? Number(presenceVal) : null, form.value))
            .send(dto.statusResponse)
            .then((res) => res.data.status, () => false);

        form.disabled = false;
        if (cancel) {
            cancel.disabled = false;
        }

        if (presence) {
            presence.disabled = false;
        }

        btn.restore();

        if (!status) {
            return;
        }

        changeButton(id, false);
        document.getElementById(`inner-${id}`).remove();

        const show = document.querySelector(`[onclick="comment.showMore(this, '${id}')"]`);
        // Audit fix: truncate the plain text BEFORE markdown conversion,
        // so the cut can never land inside an inserted HTML tag (and the
        // length counts text, not markup). Store both variants so
        // showMore never has to slice HTML either.
        const plain = util.escapeHtml(form.value);
        const original = card.convertMarkdownToHTML(plain);
        const short = plain.length > card.maxCommentLength ? card.convertMarkdownToHTML(plain.slice(0, card.maxCommentLength)) + '...' : original;
        const content = document.getElementById(`content-${id}`);

        content.innerHTML = show && show.getAttribute('data-show') == 'false' ? short : original;
        if (plain.length > card.maxCommentLength) {
            content.setAttribute('data-comment', util.base64Encode(original));
            content.setAttribute('data-comment-short', util.base64Encode(short));
        } else {
            content.removeAttribute('data-comment');
            content.removeAttribute('data-comment-short');
        }

        if (presence) {
            const formPresence = document.getElementById('form-presence');
            if (formPresence) {
                formPresence.value = presenceVal;
            }
            storage('information').set('presence', presenceVal);
        }

        if (!presence || !badge) {
            return;
        }

        badge.classList.remove('badge-present', 'badge-absent', 'badge-unsure');
        badge.classList.add(presenceVal === '1' ? 'badge-present' : presenceVal === '3' ? 'badge-unsure' : 'badge-absent');
    };

    const send = async (button) => {
        const id = button.getAttribute('data-uuid');

        // The Ringkasan "Tulis komentar" card has no name field at all
        // (only #form-comment), and #form-name lives in the Pengaturan
        // view. For admins the display name comes explicitly from the
        // loaded user data; for anyone else fall back to the field if
        // it exists. Never crash on a missing #form-name.
        const nameEl = document.getElementById('form-name');
        let nameValue = session.isAdmin() ? (user.get('name') || '') : (nameEl ? nameEl.value : '');

        if (nameValue.length == 0) {
            alert('Silakan masukkan nama Anda.');
            return;
        }

        const presence = document.getElementById('form-presence');
        if (!id && presence && presence.value == '0') {
            alert('Silakan pilih status kehadiran Anda.');
            return;
        }

        if (!id && nameEl && !session.isAdmin()) {
            nameEl.disabled = true;
        }

        if (presence && presence.value != '0') {
            presence.disabled = true;
        }

        const form = document.getElementById(`form-${id ? `inner-${id}` : 'comment'}`);
        form.disabled = true;

        const cancel = document.querySelector(`[onclick="comment.cancel('${id}')"]`);
        if (cancel) {
            cancel.disabled = true;
        }

        const btn = util.disableButton(button);
        const isPresence = presence ? presence.value === '1' : true;

        if (!session.isAdmin()) {
            const info = storage('information');
            info.set('name', nameValue);

            if (!id) {
                info.set('presence', isPresence);
            }
        }

        const response = await request(HTTP_POST, '/api/comment')
            .token(session.getToken())
            .body(dto.postCommentRequest(id, nameValue, isPresence, form.value))
            .send(dto.postCommentResponse)
            .then((res) => res, () => null);

        if (nameEl) {
            nameEl.disabled = false;
        }

        form.disabled = false;
        if (cancel) {
            cancel.disabled = false;
        }

        if (presence) {
            presence.disabled = false;
        }

        btn.restore();

        if (!response || response.code !== 201) {
            return;
        }

        owns.set(response.data.uuid, response.data.own);
        form.value = null;

        if (!id) {
            const newPage = await pagination.reset();
            if (newPage) {
                scroll();
                return;
            }

            response.data.is_admin = session.isAdmin();
            const length = document.getElementById('comments').children.length;
            pagination.setResultData(length);

            if (length == pagination.getPer()) {
                document.getElementById('comments').lastElementChild.remove();
                currentOrder.pop();
            }

            document.getElementById('comments').innerHTML = card.renderContent(response.data) + document.getElementById('comments').innerHTML;
            currentOrder.unshift(response.data.uuid);
            scroll();
        }

        if (id) {
            showHide.set('hidden', showHide.get('hidden').concat([dto.commentShowMore(response.data.uuid, true)]));
            showHide.set('show', showHide.get('show').concat([id]));

            changeButton(id, false);
            document.getElementById(`inner-${id}`).remove();

            response.data.is_admin = session.isAdmin();
            document.getElementById(`reply-content-${id}`).insertAdjacentHTML('beforeend', card.renderInnerContent(response.data));

            const containerDiv = document.getElementById(`button-${id}`);
            const anchorTag = containerDiv.querySelector('a');
            const uuids = [response.data.uuid];

            if (anchorTag) {
                if (anchorTag.getAttribute('data-show') === 'false') {
                    showOrHide(anchorTag);
                }

                anchorTag.remove();
            }

            containerDiv.querySelector(`button[onclick="like.like(this)"][data-uuid="${id}"]`).insertAdjacentHTML('beforebegin', card.renderReadMore(id, anchorTag ? anchorTag.getAttribute('data-uuids').split(',').concat(uuids) : uuids));
        }
    };

    const cancel = (id) => {
        const form = document.getElementById(`form-inner-${id}`);

        const presence = document.getElementById(`form-inner-presence-${id}`);
        const presenceVal = presence ? presence.value : null;

        const badge = document.getElementById(`badge-${id}`);
        let badgeVal = null;
        if (badge) {
            badgeVal = badge.classList.contains('badge-present') ? '1'
                : badge.classList.contains('badge-unsure') ? '3' : '2';
        }

        if (form.value.length === 0 || (util.base64Encode(form.value) === form.getAttribute('data-original') && (!presence || badgeVal === presenceVal)) || confirm('Are you sure?')) {
            changeButton(id, false);
            document.getElementById(`inner-${id}`).remove();
        }
    };

    const reply = (button) => {
        const id = button.getAttribute('data-uuid');

        if (document.getElementById(`inner-${id}`)) {
            return;
        }

        changeButton(id, true);
        document.getElementById(`button-${id}`).insertAdjacentElement('afterend', card.renderReply(id));
    };

    const edit = async (button) => {
        const id = button.getAttribute('data-uuid');

        if (document.getElementById(`inner-${id}`)) {
            return;
        }

        changeButton(id, true);
        const btn = util.disableButton(button);

        await request(HTTP_GET, '/api/comment/' + id)
            .token(session.getToken())
            .send(dto.commentResponse)
            .then((res) => {
                if (res.code !== 200) {
                    return;
                }

                document.getElementById(`button-${id}`).insertAdjacentElement('afterend', card.renderEdit(id, res.data.presence));
                const formInner = document.getElementById(`form-inner-${id}`);
                formInner.value = res.data.comment;
                formInner.setAttribute('data-original', util.base64Encode(res.data.comment));
            });

        btn.restore();
        button.disabled = true;
    };

    const comment = () => {
        card.renderLoading();
        const comments = document.getElementById('comments');
        const onNullComment = `<div class="card" style="text-align: center;"><p style="font-weight: 600; margin: 0;">Yuk bagikan undangan ini biar banyak komentarnya</p></div>`;

        return request(HTTP_GET, `/api/comment?per=${pagination.getPer()}&next=${pagination.getNext()}`)
            .token(session.getToken())
            .send()
            .then((res) => {
                pagination.setResultData(res.data.length);
                comments.setAttribute('data-loading', 'false');

                if (res.data.length === 0) {
                    if (pagination.getNext() > 0) {
                        // Empty page past the first one (an exactly-full
                        // last page invited one Next too many): step back
                        // instead of replacing the list with the empty
                        // state (audit fix).
                        return pagination.stepBack().then(() => res);
                    }

                    comments.innerHTML = onNullComment;
                    currentOrder = [];
                    return res;
                }

                const traverse = (items, hide) => {
                    items.forEach((item) => {
                        if (!hide.find((i) => i.uuid === item.uuid)) {
                            hide.push(dto.commentShowMore(item.uuid));
                        }

                        if (item.comments && item.comments.length > 0) {
                            traverse(item.comments, hide);
                        }
                    });

                    return hide;
                };

                showHide.set('hidden', traverse(res.data, showHide.get('hidden')));
                comments.innerHTML = res.data.map((c) => card.renderContent(c)).join('');
                currentOrder = res.data.map((c) => c.uuid);
                currentCreated = {};
                res.data.forEach((c) => { if (c.created_raw) currentCreated[c.uuid] = c.created_raw; });
                res.data.forEach(fetchTracker);

                return res;
            })
            .catch(() => {
                // Audit fix: a failed load used to leave loading
                // skeletons on screen forever (request.js already
                // alerted the failure). Show an error + retry instead.
                comments.setAttribute('data-loading', 'false');
                comments.innerHTML = `<div class="card" style="text-align: center;"><p style="font-weight: 600; margin: 0;">Gagal memuat komentar. Periksa koneksi, lalu coba lagi.</p><button class="btn btn-sm" style="margin-top: 12px;" onclick="comment.comment()">Muat Ulang</button></div>`;
            });
    };

    const showOrHide = (button) => {
        const ids = button.getAttribute('data-uuids').split(',');
        const show = button.getAttribute('data-show') === 'true';
        const uuid = button.getAttribute('data-uuid');

        if (show) {
            button.setAttribute('data-show', 'false');
            button.innerText = 'Show replies';
            button.innerText += ' (' + ids.length + ')';

            showHide.set('show', showHide.get('show').filter((i) => i !== uuid));
        } else {
            button.setAttribute('data-show', 'true');
            button.innerText = 'Hide replies';

            showHide.set('show', showHide.get('show').concat([uuid]));
        }

        for (const id of ids) {
            showHide.set('hidden', showHide.get('hidden').map((i) => {
                if (i.uuid === id) {
                    i.show = !show;
                }

                return i;
            }));

            const cls = document.getElementById(id).classList;
            show ? cls.add('d-none') : cls.remove('d-none');
        }
    };

    const showMore = (anchor, uuid) => {
        const comment = document.getElementById(`content-${uuid}`);
        const original = util.base64Decode(comment.getAttribute('data-comment'));
        const shortAttr = comment.getAttribute('data-comment-short');
        const isCollapsed = anchor.getAttribute('data-show') === 'false';

        // Audit fix: toggle between the stored full/short variants instead
        // of slicing HTML (a cut could land inside a tag). The slice
        // fallback only covers DOM rendered before this fix.
        comment.innerHTML = isCollapsed ? original : (shortAttr ? util.base64Decode(shortAttr) : original.slice(0, card.maxCommentLength) + '...');
        anchor.innerText = isCollapsed ? 'Sebagian' : 'Selengkapnya';
        anchor.setAttribute('data-show', isCollapsed ? 'true' : 'false');
    };

    const fetchTracker = (comment) => {
        if (!session.isAdmin()) {
            return;
        }

        if (comment.comments) {
            comment.comments.forEach(fetchTracker);
        }

        if (comment.ip === undefined || comment.user_agent === undefined || comment.is_admin || tracker.has(comment.ip)) {
            return;
        }

        fetch(`https://freeipapi.com/api/json/${comment.ip}`)
            .then((res) => res.json())
            .then((res) => {
                let result = res.cityName + ' - ' + res.regionName;

                if (res.cityName == '-' && res.regionName == '-') {
                    result = 'localhost';
                }

                tracker.set(comment.ip, result);
                // Audit fix: null-check the target (a removed comment
                // row used to throw an unhandled rejection here).
                const el = document.getElementById(`ip-${comment.uuid}`);
                if (el) {
                    el.innerHTML = `${util.escapeHtml(comment.ip)} <strong>${util.escapeHtml(result)}</strong>`;
                }
            })
            .catch((err) => {
                const el = document.getElementById(`ip-${comment.uuid}`);
                if (el) {
                    el.innerHTML = `${util.escapeHtml(comment.ip)} <strong>${util.escapeHtml(err.message)}</strong>`;
                }
            });
    };

    const scroll = () => document.getElementById('comments').scrollIntoView({ behavior: 'smooth' });

    const init = () => {
        like.init();
        card.init();

        owns = storage('owns');
        user = storage('user');
        tracker = storage('tracker');
        showHide = storage('comment');

        if (!showHide.has('hidden')) {
            showHide.set('hidden', []);
        }

        if (!showHide.has('show')) {
            showHide.set('show', []);
        }
    };

    return {
        init,
        scroll,
        cancel,
        send,
        edit,
        reply,
        remove,
        update,
        comment,
        showMore,
        showOrHide,
        pin,
        setSort,
    };
})();
