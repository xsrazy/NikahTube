import { comment } from './comment.js';

export const pagination = (() => {

    let perPage = 10;
    let pageNow = 0;
    let resultData = 0;

    let page = null;
    let liPrev = null;
    let liNext = null;

    const setPer = (num) => {
        perPage = Number(num);
    };

    const getPer = () => perPage;

    const getNext = () => pageNow;

    const disabledPrevious = () => !liPrev.classList.contains('disabled') ? liPrev.classList.add('disabled') : null;

    const enablePrevious = () => liPrev.classList.contains('disabled') ? liPrev.classList.remove('disabled') : null;

    const disabledNext = () => !liNext.classList.contains('disabled') ? liNext.classList.add('disabled') : null;

    const enableNext = () => liNext.classList.contains('disabled') ? liNext.classList.remove('disabled') : null;

    const enablePagination = () => {
        const pagination = document.getElementById('pagination');
        if (pagination.classList.contains('d-none')) {
            pagination.classList.remove('d-none');
        }
    };

    const buttonAction = (button) => {
        button.disabled = true;
        const tmp = button.innerHTML;
        button.innerHTML = `<div class="spinner-border spinner-border-sm my-0 mx-1 p-0" style="height: 0.8rem; width: 0.8rem;"></div>`;

        const process = async () => {
            let ok = false;
            try {
                ok = await comment.comment();
            } finally {
                // Always restore the button (audit fix): a failed fetch
                // used to leave it disabled with a spinner forever.
                button.disabled = false;
                button.innerHTML = tmp;
            }

            comment.scroll();
            return !!ok;
        };

        const next = async () => {
            const prevNow = pageNow;
            pageNow += perPage;

            button.innerHTML = 'Next' + button.innerHTML;
            const ok = await process();
            // A failed load used to leave the counter advanced onto an
            // error card, so the next Next skipped the failed page.
            // Revert instead: Next retries the same page.
            if (ok) {
                page.innerText = parseInt(page.innerText) + 1;
            } else {
                pageNow = prevNow;
            }
        };

        const prev = async () => {
            const prevNow = pageNow;
            pageNow -= perPage;

            button.innerHTML = button.innerHTML + 'Prev';
            const ok = await process();
            if (ok) {
                page.innerText = parseInt(page.innerText) - 1;
            } else {
                pageNow = prevNow;
            }
        };

        return {
            next,
            prev,
        };
    };

    const reset = async () => {
        if (pageNow === 0) {
            return false;
        }

        pageNow = 0;
        resultData = 0;
        page.innerText = 1;

        disabledNext();
        disabledPrevious();
        await comment.comment();

        return true;
    };

    const setResultData = (len) => {
        resultData = len;

        if (pageNow > 0) {
            enablePrevious();
        }

        if (resultData < perPage) {
            disabledNext();
            return;
        }

        enableNext();
        enablePagination();
    };

    // Step back one page after landing on an empty page past page one
    // (audit fix): an exactly-full last page is indistinguishable from
    // "more pages exist" until the next page comes back empty.
    const stepBack = async () => {
        if (pageNow <= 0) {
            return;
        }

        pageNow -= perPage;
        disabledNext();

        const pageEl = document.getElementById('page');
        if (pageEl) {
            pageEl.innerText = Math.max(1, parseInt(pageEl.innerText) - 1);
        }

        await comment.comment();
    };

    const previous = async (button) => {
        disabledPrevious();

        // Audit fix: pageNow is 0 on page 1, so `< 0` never guarded and
        // a stray Previous could fetch next=-10 -> an empty list.
        if (pageNow <= 0) {
            return;
        }

        disabledNext();
        await buttonAction(button).prev();
    };

    const next = async (button) => {
        disabledNext();

        if (resultData < perPage) {
            return;
        }

        disabledPrevious();
        await buttonAction(button).next();
    };

    const init = () => {
        page = document.getElementById('page');
        liPrev = document.getElementById('previous');
        liNext = document.getElementById('next');
    };

    return {
        init,
        setPer,
        getPer,
        getNext,
        reset,
        setResultData,
        stepBack,
        previous,
        next,
    };
})();
