const baseTemplates = require('./templates');
const { db, prepare } = require('./db/database');
const { generateTimestampedId } = require('./utils/idGenerator');

// Prepared statements
let statements = null;

function getStatements() {
    if (statements) return statements;

    statements = {
        getOverrides: prepare('SELECT * FROM template_overrides WHERE guild_id = ?'),
        getOverride: prepare('SELECT * FROM template_overrides WHERE guild_id = ? AND template_id = ?'),
        upsertOverride: prepare(`
            INSERT INTO template_overrides (guild_id, template_id, name, emoji, description, color, disabled)
            VALUES (@guild_id, @template_id, @name, @emoji, @description, @color, @disabled)
            ON CONFLICT(guild_id, template_id) DO UPDATE SET
                name = excluded.name,
                emoji = excluded.emoji,
                description = excluded.description,
                color = excluded.color,
                disabled = excluded.disabled
        `),
        deleteOverride: prepare('DELETE FROM template_overrides WHERE guild_id = ? AND template_id = ?'),

        getCustomTemplates: prepare('SELECT * FROM custom_templates WHERE guild_id = ?'),
        getCustomTemplate: prepare('SELECT * FROM custom_templates WHERE id = ?'),
        insertCustomTemplate: prepare(`
            INSERT INTO custom_templates (id, guild_id, name, emoji, description, color, role_groups)
            VALUES (@id, @guild_id, @name, @emoji, @description, @color, @role_groups)
        `),
        updateCustomTemplate: prepare(`
            UPDATE custom_templates SET
                name = @name,
                emoji = @emoji,
                description = @description,
                color = @color,
                role_groups = @role_groups
            WHERE id = @id
        `),
        deleteCustomTemplate: prepare('DELETE FROM custom_templates WHERE id = ?')
    };

    return statements;
}

function loadTemplateOverrides() {
    // No-op: data is loaded on demand from SQLite
    console.log('Template overrides ready (SQLite)');
}

function saveTemplateOverrides() {
    // No-op: changes are persisted immediately
}

function getGuildTemplateOverrides(guildId) {
    const stmts = getStatements();
    const rows = stmts.getOverrides.all(guildId);
    const result = {};
    rows.forEach(row => {
        result[row.template_id] = {
            name: row.name,
            emoji: row.emoji,
            description: row.description,
            color: row.color,
            disabled: row.disabled === 1
        };
    });
    return result;
}

function getGuildCustomTemplates(guildId) {
    const stmts = getStatements();
    const rows = stmts.getCustomTemplates.all(guildId);
    const result = {};
    rows.forEach(row => {
        result[row.id] = {
            id: row.id,
            name: row.name,
            emoji: row.emoji,
            description: row.description,
            color: row.color,
            roleGroups: row.role_groups ? JSON.parse(row.role_groups) : [],
            isCustom: true
        };
    });
    return result;
}

function updateGuildTemplateOverrides(guildId, templateId, overrideData, options = {}) {
    const stmts = getStatements();

    if (options.reset) {
        stmts.deleteOverride.run(guildId, templateId);
        return;
    }

    // Get existing override to merge
    const existing = stmts.getOverride.get(guildId, templateId) || {};

    stmts.upsertOverride.run({
        guild_id: guildId,
        template_id: templateId,
        name: overrideData?.name || existing.name || null,
        emoji: overrideData?.emoji || existing.emoji || null,
        description: overrideData?.description || existing.description || null,
        color: overrideData?.color || existing.color || null,
        disabled: (overrideData?.disabled ?? existing.disabled) ? 1 : 0
    });
}

function addCustomTemplate(guildId, templateData) {
    const stmts = getStatements();
    const id = generateTimestampedId('custom', 4);

    const template = {
        id,
        guild_id: guildId,
        name: templateData.name || 'Custom Raid',
        emoji: templateData.emoji || '',
        description: templateData.description || '',
        color: templateData.color || '',
        role_groups: JSON.stringify(templateData.roleGroups || [])
    };

    stmts.insertCustomTemplate.run(template);

    return {
        id,
        name: template.name,
        emoji: template.emoji,
        description: template.description,
        color: template.color,
        roleGroups: templateData.roleGroups || [],
        isCustom: true
    };
}

function updateCustomTemplate(guildId, templateId, updates) {
    const stmts = getStatements();
    const existing = stmts.getCustomTemplate.get(templateId);

    if (!existing || existing.guild_id !== guildId) {
        return null;
    }

    const updated = {
        id: templateId,
        name: updates.name ?? existing.name,
        emoji: updates.emoji ?? existing.emoji,
        description: updates.description ?? existing.description,
        color: updates.color ?? existing.color,
        role_groups: updates.roleGroups
            ? JSON.stringify(updates.roleGroups)
            : existing.role_groups
    };

    stmts.updateCustomTemplate.run(updated);

    return {
        id: templateId,
        name: updated.name,
        emoji: updated.emoji,
        description: updated.description,
        color: updated.color,
        roleGroups: JSON.parse(updated.role_groups || '[]'),
        isCustom: true
    };
}

function deleteCustomTemplate(guildId, templateId) {
    const stmts = getStatements();
    const existing = stmts.getCustomTemplate.get(templateId);

    if (!existing || existing.guild_id !== guildId) {
        return false;
    }

    stmts.deleteCustomTemplate.run(templateId);
    return true;
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
