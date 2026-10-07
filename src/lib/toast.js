export const toast = (msg) => window.dispatchEvent(new CustomEvent('app-toast', { detail: msg }))
