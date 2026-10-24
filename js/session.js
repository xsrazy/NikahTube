import { storage } from './storage.js';
import { request, HTTP_GET } from './request.js';

export const session = (() => {

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let ses = null;

    /**
     * @returns {string|null}
     */
    const getToken = () => ses.get('token');

    /**
     * Direct fetch (not request.js) so the caller can see the real HTTP
     * status: request.js alerts and throws on error bodies, which is why
     * the old login collapsed every failure into one message.
     * @param {object} body
     * @returns {Promise<{code: number}>}
     */
    const login = async (body) => {
        let url = document.body.getAttribute('data-url');
        if (url.slice(-1) === '/') {
            url = url.slice(0, -1);
        }

        try {
            const res = await fetch(url + '/api/session', {
                method: 'POST',
                headers: new Headers({
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                }),
                body: JSON.stringify(body),
            });
            const json = await res.json().catch(() => ({}));
            if (res.status === 200 && json.data?.token) {
                setToken(json.data.token);
            }
            return { code: res.status };
        } catch {
            return { code: 0 };
        }
    };

    /**
     * @returns {void}
     */
    const logout = () => ses.unset('token');

    /**
     * @param {string} token
     * @returns {void}
     */
    const setToken = (token) => ses.set('token', token);

    /**
     * @returns {boolean}
     */
    const isAdmin = () => String(getToken() ?? '.').split('.').length === 3;

    /**
     * @returns {Promise<ReturnType<typeof dto.baseResponse<object>>}
     */
    const guest = () => {
        const config = storage('config');

        return request(HTTP_GET, '/api/config')
            .token(document.body.getAttribute('data-key'))
            .send()
            .then((res) => {
                if (res.code !== 200) {
                    return res;
                }

                for (let [key, value] of Object.entries(res.data)) {
                    config.set(key, value);
                }

                setToken(document.body.getAttribute('data-key'));
                return res;
            });
    };

    /**
     * @returns {object|null}
     */
    const decode = () => {
        if (!isAdmin()) {
            return null;
        }

        try {
            // JWT segments are base64url; convert before atob (audit fix:
            // raw atob threw on '-'/'_' and valid tokens were discarded).
            const segment = getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = segment + '='.repeat((4 - (segment.length % 4)) % 4);
            return JSON.parse(window.atob(padded));
        } catch {
            return null;
        }
    };

    /**
     * @returns {void}
     */
    const init = () => {
        ses = storage('session');
    };

    return {
        init,
        guest,
        login,
        logout,
        decode,
        isAdmin,
        setToken,
        getToken,
    };
})();
