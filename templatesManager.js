const fs = require('fs');
const path = require('path');
const baseTemplates = require('./templates');
const { safeWriteFile, dataPath } = require('./state');

const TEMPLATE_OVERRIDES_FILE = dataPath('template_overrides.json');
let overrides = { overrides: {}, custom: {} };

function normalizeStore(raw) {
    if (raw.overrides || raw.custom) {
        return {
            overrides: raw.overrides || {},
            custom: raw.custom || {}
        };
    }
    // legacy shape was a flat object of overrides
    return { overrides: raw || {}, custom: {} };
}

function loadTemplateOverrides() {
    if (!fs.existsSync(TEMPLATE_OVERRIDES_FILE)) {
        overrides = { overrides: {}, custom: {} };
        return;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(TEMPLATE_OVERRIDES_FILE, 'utf8'));
        overrides = normalizeStore(raw);
    } catch (error) {
        console.error('Failed to load template overrides:', error);
        overrides = { overrides: {}, custom: {} };
    }
}

function saveTemplateOverrides() {
    try {
        safeWriteFile(TEMPLATE_OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
    } catch (error) {
        console.error('Failed to save template overrides:', error);
    }
}

function getGuildTemplateOverrides(guildId) {
    return overrides.overrides[guildId] || {};
}

function getGuildCustomTemplates(guildId) {
    return overrides.custom[guildId] || {};
}

function updateGuildTemplateOverrides(guildId, templateId, overrideData, options = {}) {
    if (!overrides.overrides[guildId]) overrides.overrides[guildId] = {};
    if (options.reset) {
        delete overrides.overrides[guildId][templateId];
    } else {
        overrides.overrides[guildId][templateId] = { ...(overrides.overrides[guildId][templateId] || {}), ...(overrideData || {}) };
    }
    saveTemplateOverrides();
}

function addCustomTemplate(guildId, templateData) {
    if (!overrides.custom[guildId]) overrides.custom[guildId] = {};
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    overrides.custom[guildId][id] = {
        name: templateData.name || 'Custom Raid',
        emoji: templateData.emoji || '',
        description: templateData.description || '',
        color: templateData.color || '',
        roleGroups: templateData.roleGroups || [],
        id,
        isCustom: true
    };
    saveTemplateOverrides();
    return overrides.custom[guildId][id];
}

function updateCustomTemplate(guildId, templateId, updates) {
    if (!overrides.custom[guildId] || !overrides.custom[guildId][templateId]) return null;
    overrides.custom[guildId][templateId] = { ...overrides.custom[guildId][templateId], ...updates };
    saveTemplateOverrides();
    return overrides.custom[guildId][templateId];
}

function deleteCustomTemplate(guildId, templateId) {
    if (!overrides.custom[guildId]) return false;
    const removed = delete overrides.custom[guildId][templateId];
    if (removed) saveTemplateOverrides();
    return removed;
}

function deriveSlug(name) {
    const lower = name.toLowerCase();
    if (lower.includes('voracious') || lower.includes('dragonspyre')) return 'dragonspyre';
    if (lower.includes('ghastly') || lower.includes('lemuria')) return 'lemuria';
    if (lower.includes('cabal') || lower.includes('polaris')) return 'polaris';
    return lower.replace(/[^a-z0-9]+/g, '-');
}

function templatesForGuild(guildId, options = {}) {
    const includeDisabled = options.includeDisabled === true;
    const guildOverrides = getGuildTemplateOverrides(guildId);
    const guildCustom = getGuildCustomTemplates(guildId);

    const base = baseTemplates.raids
        .map((tpl, idx) => ({ id: `raid-${idx}`, slug: deriveSlug(tpl.name), isCustom: false, ...tpl }))
        .map((tpl) => {
            const override = guildOverrides[tpl.id];
            if (!override) return tpl;
            return {
                ...tpl,
                name: override.name || tpl.name,
                emoji: override.emoji || tpl.emoji,
                description: override.description || tpl.description,
                color: override.color || tpl.color,
                disabled: override.disabled === true
            };
        });

    const customList = Object.values(guildCustom).map((tpl) => ({
        ...tpl,
        slug: deriveSlug(tpl.name || tpl.id),
        isCustom: true
    }));

    return [...base, ...customList].filter((tpl) => includeDisabled ? true : !tpl.disabled);
}

module.exports = {
    loadTemplateOverrides,
    saveTemplateOverrides,
    getGuildTemplateOverrides,
    getGuildCustomTemplates,
    updateGuildTemplateOverrides,
    addCustomTemplate,
    updateCustomTemplate,
    deleteCustomTemplate,
    templatesForGuild,
    deriveSlug
};
