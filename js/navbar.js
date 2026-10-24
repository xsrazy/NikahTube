export const navbar = (() => {

    /**
     * Switch the visible dashboard view and mark every nav button
     * (sidebar and bottom nav) for that view as active.
     * @param {string} view
     * @param {HTMLElement} [btn]
     * @returns {void}
     */
    const showView = (view, btn) => {
        document.querySelectorAll('.view').forEach((el) => {
            el.classList.toggle('active', el.id === `view-${view}`);
        });
        document.querySelectorAll('[data-nav]').forEach((el) => {
            el.classList.toggle('active', el.dataset.nav === view);
        });
        if (btn) {
            btn.classList.add('active');
        }
    };

    return {
        showView,
    };
})();
