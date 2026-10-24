import { util } from './util.js';
import { session } from './session.js';
import { storage } from './storage.js';
import { pagination } from './pagination.js';

const HEART_SVG = '<svg width="14" height="14" viewBox="0 0 512 512" aria-hidden="true"><path d="M47.6 300.4L228.3 469.1c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9L464.4 300.4c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141C347 36.5 300.6 51.4 268 84L256 96 244 84c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5z"/></svg>';
const PIN_SVG = '<svg width="11" height="11" viewBox="0 0 512 512" aria-hidden="true"><path d="M32 32C32 14.3 46.3 0 64 0H256c17.7 0 32 14.3 32 32s-14.3 32-32 32H197.5l55.2 86.5C300 164.9 344 198 344 240v30c0 8.8-7.2 16-16 16H224v136c0 17.7-14.3 32-32 32s-32-14.3-32-32V286H56c-8.8 0-16-7.2-16-16v-30c0-42 44-75.1 91.3-89.5L186.5 64H64C46.3 64 32 49.7 32 32z"/></svg>';

export const card = (() => {

    let user = null;
    let owns = null;
    let likes = null;
    let config = null;
    let tracker = null;
    let showHide = null;

    const maxCommentLength = 250;

    const renderLoading = () => {
        const comments = document.getElementById('comments');
        if (comments.getAttribute('data-loading') === 'true') {
            return;
        }

        comments.setAttribute('data-loading', 'true');
        comments.innerHTML = `
        <div class="cmt">
            <div class="skel">
                <div class="skel-bar" style="width: 40%"></div>
                <div class="skel-bar" style="width: 85%"></div>
                <div class="skel-bar" style="width: 100%"></div>
            </div>
        </div>`.repeat(pagination.getPer());
    };

    const convertMarkdownToHTML = (input) => {
        const lists = [
            ['*', `<strong>$1</strong>`],
            ['_', `<em>$1</em>`],
            ['~', `<del>$1</del>`],
            ['```', `<code>$1</code>`]
        ];

        lists.forEach((data) => {
            const k = data[0];
            const v = data[1];

            input = input.replace(new RegExp(`\\${k}(?=\\S)(.*?)(?<!\\s)\\${k}`, 'gs'), v);
        });

        return input;
    };

    const renderLike = (comment) => {
        return `
        <button onclick="like.like(this)" data-uuid="${comment.uuid}" class="cmt-btn cmt-like" offline-disabled>
            <span style="display: inline-flex; align-items: center; gap: 6px;">
                <span data-count-like="${comment.like.love}">${comment.like.love}</span>
                <span class="like-heart${likes.has(comment.uuid) ? ' liked' : ''}">${HEART_SVG}</span>
            </span>
        </button>`;
    };

    const renderAction = (comment, is_parent) => {
        let action = `<div data-button-action="${comment.uuid}" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">`;

        if (config.get('can_reply') == true || config.get('can_reply') === undefined) {
            action += `<button onclick="comment.reply(this)" data-uuid="${comment.uuid}" class="cmt-btn" offline-disabled>Reply</button>`;
        }

        if (owns.has(comment.uuid) && (config.get('can_edit') == true || config.get('can_edit') === undefined)) {
            action += `<button onclick="comment.edit(this)" data-uuid="${comment.uuid}" class="cmt-btn" offline-disabled>Edit</button>`;
        }

        if (session.isAdmin()) {
            if (is_parent) {
                const pinned = comment.pinned === true;
                action += `<button onclick="comment.pin(this)" data-uuid="${comment.uuid}" data-pinned="${pinned}" class="cmt-btn${pinned ? ' active' : ''}" offline-disabled>${pinned ? 'Lepas sematan' : 'Sematkan'}</button>`;
            }
            action += `<button onclick="comment.remove(this)" data-uuid="${comment.uuid}" class="cmt-btn" data-own="${comment.own}" offline-disabled>Delete</button>`;
        } else if (owns.has(comment.uuid) && (config.get('can_delete') == true || config.get('can_delete') === undefined)) {
            action += `<button onclick="comment.remove(this)" data-uuid="${comment.uuid}" class="cmt-btn" offline-disabled>Delete</button>`;
        }

        action += '</div>';

        return action;
    };

    const renderReadMore = (uuid, comments) => {
        const hasId = showHide.get('show').includes(uuid);
        return `<a class="cmt-readmore" onclick="comment.showOrHide(this)" data-uuid="${uuid}" data-uuids="${comments.join(',')}" data-show="${hasId ? 'true' : 'false'}" role="button">${hasId ? 'Hide replies' : `Show replies (${comments.length})`}</a>`;
    };

    const renderButton = (comment, is_parent) => {
        return `
        <div class="cmt-actions" id="button-${comment.uuid}">
            ${renderAction(comment, is_parent)}
            ${comment.comments.length > 0 ? renderReadMore(comment.uuid, comment.comments.map((c) => c.uuid)) : ''}
            ${renderLike(comment)}
        </div>`;
    };

    const renderTracker = (comment) => {
        if (comment.ip === undefined || comment.user_agent === undefined || comment.is_admin) {
            return '';
        }

        return `
        <div class="cmt-tracker">
            <p id="ip-${comment.uuid}">${util.escapeHtml(comment.ip)} ${tracker.has(comment.ip) ? `<strong>${util.escapeHtml(tracker.get(comment.ip))}</strong>` : `<span class="skel-bar" style="display: inline-block; width: 80px; height: 12px; vertical-align: middle;"></span>`}</p>
            <p>${util.escapeHtml(comment.user_agent)}</p>
        </div>`;
    };

    const renderHeader = (comment, is_parent) => {
        if (is_parent) {
            return `class="cmt" data-parent="true"`;
        }

        // Guard the show/hide lookup (audit fix): a missing entry used
        // to crash the whole comment render.
        const entry = showHide.get('hidden').find((item) => item.uuid === comment.uuid);
        return `class="cmt-reply${entry && !entry.show ? ' d-none' : ''}"`;
    };

    const renderTitle = (comment, is_parent) => {
        if (comment.is_admin) {
            return `<span class="cmt-name">${util.escapeHtml(user.get('name') ?? config.get('name'))}</span><span class="cmt-admin">Admin</span>`;
        }

        if (is_parent) {
            const badgeCls = comment.presence === 'ragu' ? 'badge-unsure' : comment.presence ? 'badge-present' : 'badge-absent';
            return `<span class="cmt-name">${util.escapeHtml(comment.name)}</span><span id="badge-${comment.uuid}" class="badge-dot ${badgeCls}"></span>`;
        }

        return `<span class="cmt-name">${util.escapeHtml(comment.name)}</span>`;
    };

    const renderBody = (comment, is_parent) => {
        // Audit fix: truncate the plain text BEFORE markdown conversion,
        // so the cut can never land inside an inserted <strong>/<em>/
        // <code> tag, and the length counts text rather than markup.
        const plain = util.escapeHtml(comment.comment);
        const moreThanMaxLength = plain.length > maxCommentLength;
        const original = convertMarkdownToHTML(plain);
        const short = moreThanMaxLength ? convertMarkdownToHTML(plain.slice(0, maxCommentLength)) + '...' : original;
        const pinBadge = (is_parent && comment.pinned) ? `<span class="cmt-pin">${PIN_SVG}Disematkan</span>` : '';

        return `
        <div class="cmt-head">
            <span>${renderTitle(comment, is_parent)}${pinBadge}</span>
            <small class="cmt-time">${comment.created_at}</small>
        </div>
        <div class="cmt-body" ${moreThanMaxLength ? `data-comment="${util.base64Encode(original)}" data-comment-short="${util.base64Encode(short)}"` : ''} id="content-${comment.uuid}">${short}</div>
        ${moreThanMaxLength ? `<p style="margin: 8px 0 0;"><a class="cmt-readmore" role="button" data-show="false" onclick="comment.showMore(this, '${comment.uuid}')">Selengkapnya</a></p>` : ''}`;
    };

    const renderContent = (comment, is_parent) => {
        return `
        <div ${renderHeader(comment, is_parent)} id="${comment.uuid}" style="overflow-wrap: break-word !important;">
            <div id="body-content-${comment.uuid}" data-tapTime="0" data-liked="false" ontouchend="like.tapTap(this)">
            ${renderBody(comment, is_parent)}
            </div>
            ${renderTracker(comment)}
            ${renderButton(comment, is_parent)}
            <div id="reply-content-${comment.uuid}">${comment.comments.map((c) => renderInnerContent(c)).join('')}</div>
        </div>`;
    };

    const renderInnerContent = (comment) => renderContent(comment, false);

    const renderReply = (id) => {
        const inner = document.createElement('div');
        inner.classList.add('cmt-form');
        inner.id = `inner-${id}`;
        inner.innerHTML = `
        <label for="form-inner-${id}" class="field-label">Reply</label>
        <textarea class="input" id="form-inner-${id}" placeholder="Type reply comment" rows="3" offline-disabled></textarea>
        <div class="btn-row">
            <button onclick="comment.cancel('${id}')" class="cmt-btn" offline-disabled>Cancel</button>
            <button onclick="comment.send(this)" data-uuid="${id}" class="cmt-btn" offline-disabled>Send</button>
        </div>`;

        return inner;
    };

    const renderEdit = (id, presence) => {
        const inner = document.createElement('div');
        inner.classList.add('cmt-form');
        inner.id = `inner-${id}`;
        inner.innerHTML = `
        <label for="form-inner-${id}" class="field-label">Edit</label>
        ${document.getElementById(id).getAttribute('data-parent') === 'true' && !session.isAdmin() ? `
        <select class="input" id="form-inner-presence-${id}" offline-disabled>
            <option value="1" ${presence === true ? 'selected' : ''}>Datang</option>
            <option value="2" ${presence === false ? 'selected' : ''}>Berhalangan</option>
            <option value="3" ${presence === 'ragu' ? 'selected' : ''}>Masih Ragu</option>
        </select>` : ''}
        <textarea class="input" id="form-inner-${id}" placeholder="Type update comment" rows="3" offline-disabled></textarea>
        <div class="btn-row">
            <button onclick="comment.cancel('${id}')" class="cmt-btn" offline-disabled>Cancel</button>
            <button onclick="comment.update(this)" data-uuid="${id}" class="cmt-btn" offline-disabled>Update</button>
        </div>`;

        return inner;
    };

    const init = () => {
        user = storage('user');
        owns = storage('owns');
        likes = storage('likes');
        config = storage('config');
        tracker = storage('tracker');
        showHide = storage('comment');
    };

    return {
        init,
        renderEdit,
        renderReply,
        renderLoading,
        renderReadMore,
        renderInnerContent,
        renderContent: (comment) => renderContent(comment, true),
        convertMarkdownToHTML,
        maxCommentLength,
    };
})();
