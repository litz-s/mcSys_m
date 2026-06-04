import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";

const DEBUG_MOB_DROP = false;

const EXTRA_DROP_PREFIX = "§6追加ドロップ";
const ROMAN_TO_TIER = { I: 1, II: 2, III: 3 };

const TOOL_BONUS = { 1: 1, 2: 2, 3: 5 };
const HOSTILE_BONUS = { 1: 1, 2: 2, 3: 4 };
const BOSS_BONUS = { 3: 1 };

const ORE_BLOCKS = new Set([
    "minecraft:coal_ore", "minecraft:deepslate_coal_ore",
    "minecraft:iron_ore", "minecraft:deepslate_iron_ore",
    "minecraft:copper_ore", "minecraft:deepslate_copper_ore",
    "minecraft:gold_ore", "minecraft:deepslate_gold_ore", "minecraft:nether_gold_ore",
    "minecraft:redstone_ore", "minecraft:deepslate_redstone_ore", "minecraft:lit_redstone_ore", "minecraft:lit_deepslate_redstone_ore",
    "minecraft:lapis_ore", "minecraft:deepslate_lapis_ore",
    "minecraft:diamond_ore", "minecraft:deepslate_diamond_ore",
    "minecraft:emerald_ore", "minecraft:deepslate_emerald_ore",
    "minecraft:quartz_ore",
    "minecraft:ancient_debris",
]);

const HOSTILE_TYPES = new Set([
    "minecraft:zombie", "minecraft:husk", "minecraft:drowned", "minecraft:skeleton", "minecraft:stray",
    "minecraft:creeper", "minecraft:spider", "minecraft:cave_spider", "minecraft:enderman",
    "minecraft:witch", "minecraft:slime", "minecraft:magma_cube", "minecraft:phantom",
    "minecraft:pillager", "minecraft:vindicator", "minecraft:evocation_illager", "minecraft:evoker",
    "minecraft:ravager", "minecraft:vex", "minecraft:warden", "minecraft:blaze",
    "minecraft:ghast", "minecraft:wither_skeleton", "minecraft:piglin_brute",
    "minecraft:hoglin", "minecraft:zoglin", "minecraft:guardian", "minecraft:elder_guardian",
    "minecraft:shulker", "minecraft:silverfish", "minecraft:endermite", "minecraft:breeze",
    "minecraft:bogged", "minecraft:creaking",
]);

const FRIENDLY_TYPES = new Set([
    "minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:chicken", "minecraft:rabbit",
    "minecraft:horse", "minecraft:donkey", "minecraft:mule", "minecraft:llama", "minecraft:trader_llama",
    "minecraft:goat", "minecraft:mooshroom", "minecraft:turtle", "minecraft:armadillo",
    "minecraft:wolf", "minecraft:cat", "minecraft:ocelot", "minecraft:fox", "minecraft:panda",
    "minecraft:parrot", "minecraft:bee", "minecraft:camel", "minecraft:frog", "minecraft:sniffer",
    "minecraft:bat", "minecraft:squid", "minecraft:glow_squid", "minecraft:cod", "minecraft:salmon",
    "minecraft:tropicalfish", "minecraft:tropical_fish", "minecraft:pufferfish", "minecraft:axolotl",
    "minecraft:villager", "minecraft:villager_v2", "minecraft:wandering_trader", "minecraft:iron_golem",
    "minecraft:snow_golem",
]);

const BOSS_TYPES = new Set([
    "minecraft:ender_dragon",
    "minecraft:wither",
    "minecraft:elder_guardian",
    "minecraft:warden",
]);

const MOB_LOOT_TABLE_OVERRIDES = {
    "minecraft:wither": "entities/wither_boss",
    "minecraft:villager_v2": "entities/villager",
    "minecraft:evoker": "entities/evocation_illager",
    "minecraft:evocation_illager": "entities/evocation_illager",
    "minecraft:tropicalfish": "entities/tropicalfish",
    "minecraft:tropical_fish": "entities/tropicalfish",
    "minecraft:mooshroom": "entities/mooshroom",
};

function debug(player, message) {
    if (!DEBUG_MOB_DROP) return;
    try { player.sendMessage(`[ExtraDrop] ${message}`); } catch {}
}

function getMainhand(player) {
    try {
        return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    } catch {
        return undefined;
    }
}

function getLoreDebug(item) {
    try {
        const lore = item?.getLore?.() ?? [];
        return lore.length ? lore.join("|") : "(no lore)";
    } catch {
        return "(lore read error)";
    }
}

function getExtraDropTier(item) {
    try {
        const lore = item?.getLore?.() ?? [];
        for (const line of lore) {
            if (typeof line !== "string") continue;
            if (line.startsWith(EXTRA_DROP_PREFIX) || line.includes("追加ドロップ")) {
                const matched = line.match(/(III|II|I)\s*$/);
                if (matched) return ROMAN_TO_TIER[matched[1]] ?? 1;
                return 1;
            }
        }
    } catch {}
    return 0;
}

function isSword(typeId) {
    return typeId.endsWith("_sword");
}

function isAxe(typeId) {
    return typeId.endsWith("_axe");
}

function isPickaxe(typeId) {
    return typeId.endsWith("_pickaxe");
}

function isShovel(typeId) {
    return typeId.endsWith("_shovel");
}

function isValidTool(typeId) {
    return isPickaxe(typeId);
}

function isOreLike(typeId) {
    return ORE_BLOCKS.has(typeId);
}

function isExtraDropTargetForTool(blockId, toolId) {

    if (isPickaxe(toolId)) return isOreLike(blockId);
    return false;
}

function classifyMob(typeId) {
    if (BOSS_TYPES.has(typeId)) return "boss";
    if (HOSTILE_TYPES.has(typeId)) return "hostile";
    if (FRIENDLY_TYPES.has(typeId)) return "friendly";
    return "unknown";
}

function getSwordBonus(tier, mobTypeId) {
    const cls = classifyMob(mobTypeId);
    if (cls === "boss") return BOSS_BONUS[tier] ?? 0;
    if (cls === "hostile") return HOSTILE_BONUS[tier] ?? 0;
    if (cls === "friendly" && tier >= 3) return HOSTILE_BONUS[3] ?? 0;
    return 0;
}

function getToolBonus(tier) {
    return TOOL_BONUS[tier] ?? 0;
}

function hasSilkTouch(item) {
    try {
        const ench = item?.getComponent?.("minecraft:enchantable");
        const silk = ench?.getEnchantment?.("silk_touch") ?? ench?.getEnchantment?.("minecraft:silk_touch");
        return Number(silk?.level ?? 0) > 0;
    } catch {
        return false;
    }
}

function escapeBlockId(blockId) {
    return String(blockId ?? "").replace(/[^a-zA-Z0-9_:.]/g, "");
}

function commandNumber(value) {
    return Math.floor(Number(value));
}

function spawnFixedItem(dimension, loc, typeId, amount) {
    if (amount <= 0) return;
    try {
        dimension.spawnItem(new ItemStack(typeId, amount), loc);
    } catch {}
}

function distance3(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getItemStackFromEntity(entity) {
    try {
        return entity.getComponent("minecraft:item")?.itemStack;
    } catch {
        return undefined;
    }
}

function removeNearbyAncientDebrisDrops(dimension, loc, radius = 3) {
    try {
        const entities = dimension.getEntities({ location: loc, maxDistance: radius });
        for (const entity of entities) {
            if (!entity || entity.typeId !== "minecraft:item") continue;
            if (distance3(entity.location, loc) > radius) continue;

            const stack = getItemStackFromEntity(entity);
            if (stack?.typeId === "minecraft:ancient_debris") {
                try { entity.remove(); } catch {}
            }
        }
    } catch {}
}

function suppressAncientDebrisNormalDrop(player, loc) {
    for (const delay of [0, 1, 2, 4, 8]) {
        system.runTimeout(() => {
            try { removeNearbyAncientDebrisDrops(player.dimension, loc, 3); } catch {}
        }, delay);
    }
}

function runExtraBlockLootCommands(player, blockId, blockLoc, spawnLoc, bonus) {
    const x = commandNumber(blockLoc.x);
    const y = commandNumber(blockLoc.y);
    const z = commandNumber(blockLoc.z);
    const sx = spawnLoc.x;
    const sy = spawnLoc.y;
    const sz = spawnLoc.z;
    const safeBlockId = escapeBlockId(blockId);
    if (!safeBlockId || bonus <= 0) return false;

    try {
        player.runCommand(`setblock ${x} ${y} ${z} ${safeBlockId}`);
        for (let i = 0; i < bonus; i++) {
            player.runCommand(`loot spawn ${sx} ${sy} ${sz} mine ${x} ${y} ${z} mainhand`);
        }
        player.runCommand(`setblock ${x} ${y} ${z} air`);
        return true;
    } catch {
        try { player.runCommand(`setblock ${x} ${y} ${z} air`); } catch {}
        return false;
    }
}

function quoteCommandString(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function lootTableForMob(typeId) {
    if (MOB_LOOT_TABLE_OVERRIDES[typeId]) return MOB_LOOT_TABLE_OVERRIDES[typeId];

    const id = String(typeId ?? "").replace("minecraft:", "").replace(/[^a-zA-Z0-9_]/g, "");
    if (!id) return "";
    return `entities/${id}`;
}

function runExtraMobLootCommands(player, mobTypeId, loc, bonus) {
    if (bonus <= 0) return false;

    if (mobTypeId === "minecraft:wither") {
        try {
            spawnFixedItem(player.dimension, loc, "minecraft:nether_star", bonus);
            debug(player, `mobLootFixed: wither nether_star x${bonus}`);
            return true;
        } catch {
            return false;
        }
    }

    const lootTable = lootTableForMob(mobTypeId);
    if (!lootTable) return false;

    let success = 0;
    for (let i = 0; i < bonus; i++) {
        try {
            player.runCommand(`loot spawn ${loc.x} ${loc.y} ${loc.z} loot "${quoteCommandString(lootTable)}"`);
            success++;
        } catch {
            break;
        }
    }

    debug(player, `mobLootCmd: table="${lootTable}" success=${success}/${bonus}`);
    return success > 0;
}

export function registerPendingOreDrop(player, blockId, originalBlockLocation, dropSpawnLocation, tier = undefined, options = {}) {
    return registerPendingBlockDrop(player, blockId, originalBlockLocation, dropSpawnLocation, tier, options);
}

export function registerPendingBlockDrop(player, blockId, originalBlockLocation, dropSpawnLocation, tier = undefined, options = {}) {
    if (!player || !blockId) return false;

    const tool = getMainhand(player);
    if (!tool || !isValidTool(tool.typeId)) return false;
    if (!isExtraDropTargetForTool(blockId, tool.typeId)) return false;

    const actualTier = tier ?? getExtraDropTier(tool);
    if (actualTier <= 0) return false;

    const bonus = getToolBonus(actualTier);
    if (bonus <= 0) return false;

    const spawnLoc = dropSpawnLocation ?? {
        x: originalBlockLocation.x + 0.5,
        y: originalBlockLocation.y + 0.5,
        z: originalBlockLocation.z + 0.5,
    };

    if (blockId === "minecraft:ancient_debris") {
        spawnFixedItem(player.dimension, spawnLoc, "minecraft:netherite_scrap", bonus);
        suppressAncientDebrisNormalDrop(player, spawnLoc);
        return options.suppressNormalAncientDebrisDrop === true;
    }

    if (isOreLike(blockId) && hasSilkTouch(tool)) return false;
    return runExtraBlockLootCommands(player, blockId, originalBlockLocation, spawnLoc, bonus);
}

world.afterEvents.playerBreakBlock.subscribe((event) => {
    const player = event.player;
    const blockLoc = { x: event.block.x, y: event.block.y, z: event.block.z };
    const blockId = event.brokenBlockPermutation?.type?.id ?? "";
    const tool = getMainhand(player);
    if (!tool || !isValidTool(tool.typeId)) return;

    const tier = getExtraDropTier(tool);
    if (tier <= 0) return;

    if (!isExtraDropTargetForTool(blockId, tool.typeId)) return;

    registerPendingBlockDrop(
        player,
        blockId,
        blockLoc,
        { x: event.block.x + 0.5, y: event.block.y + 0.5, z: event.block.z + 0.5 },
        tier,
        { suppressNormalAncientDebrisDrop: false }
    );
});

world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    const source = event.damageSource?.damagingEntity;

    if (!source || source.typeId !== "minecraft:player") return;

    const weapon = getMainhand(source);
    if (!weapon) {
        debug(source, `die: no weapon mob=${dead?.typeId ?? "?"}`);
        return;
    }

    debug(source, `die: mob=${dead.typeId} weapon=${weapon.typeId} lore=${getLoreDebug(weapon)}`);

    if (!isSword(weapon.typeId)) {
        debug(source, `stop: not sword`);
        return;
    }

    const tier = getExtraDropTier(weapon);
    if (tier <= 0) {
        debug(source, `stop: no extra tier`);
        return;
    }

    const cls = classifyMob(dead.typeId);
    const bonus = getSwordBonus(tier, dead.typeId);
    debug(source, `judge: class=${cls} tier=${tier} bonus=${bonus}`);

    if (bonus <= 0) {
        debug(source, `stop: bonus 0`);
        return;
    }

    const loc = {
        x: dead.location.x,
        y: dead.location.y,
        z: dead.location.z,
    };

    runExtraMobLootCommands(source, dead.typeId, loc, bonus);
});
