// src/utils/template.js
// Tiny {placeholder} substitution helper used to render theme-driven
// notification strings (themes/*.json `notifications.*` fields) without
// pulling in a templating dependency.

function renderTemplate(template, vars = {}) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

module.exports = { renderTemplate };
