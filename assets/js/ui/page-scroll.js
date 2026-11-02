/**
 * On phones, views that read like a page (the Layered View, the rankings)
 * scroll the page instead of their panel, since iOS only scrolls the page
 * back to the top on a tap on the status bar. main.js sets `.page-scroll`
 * for views that export `scrollsPage`; styles.css applies it on phones.
 */

/** What scrolls the view: the view itself, or the page. */
export function scrollerFor(root) {
  return getComputedStyle(root).overflowY === 'visible' ? document.scrollingElement : root;
}
