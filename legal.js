// Shared by /terms and /privacy: who runs dancerly and how to reach them.
// Change these two lines when the operator details change; every mention on both pages updates.
const LEGAL = {
  operator: 'The dancerly team (individual operator)', // the person (or, later, the company) that runs dancerly
  email: 'help@dancerly.app' // the dedicated contact address for legal and privacy requests
};

document.documentElement.lang = 'en';

document.querySelectorAll('[data-operator]').forEach((el) => {
  el.textContent = LEGAL.operator || el.textContent;
});
document.querySelectorAll('[data-email]').forEach((el) => {
  if (!LEGAL.email) return;
  el.textContent = LEGAL.email;
  if (el.tagName === 'A') el.href = `mailto:${LEGAL.email}`;
});
