import { guest } from './guest.js';

// Legacy no-op module, kept on disk but NOT imported by any live page
// (dashboard.html loads only js/dashboard.js; index.html loads only
// js/app.js, a standalone script with no imports). The loading screen
// was removed by request of the site owner; init() used to hand over to
// guest.name(), but guest.js is likewise unreferenced by live code.
export const progress = (() => {

    let done = false;

    const init = () => {
        if (done) {
            return;
        }
        done = true;
        guest.name();
    };

    const add = () => { };
    const complete = () => { };
    const invalid = () => { };

    return {
        init,
        add,
        invalid,
        complete,
    };
})();
