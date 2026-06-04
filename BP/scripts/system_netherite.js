import { world, system, EquipmentSlot } from "@minecraft/server";

const NETHERITE_ARMOR_IDS = new Set([
    "minecraft:netherite_helmet",
    "minecraft:netherite_chestplate",
    "minecraft:netherite_leggings",
    "minecraft:netherite_boots",
]);

const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
const MASS_LORE_TEXT = "一括破壊";

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

const LOG_KEYWORDS = [
    "_log", "_wood", "crimson_stem", "warped_stem", "crimson_hyphae", "warped_hyphae",
];

function isLogLike(typeId) {
    return LOG_KEYWORDS.some((keyword) => String(typeId ?? "").includes(keyword));
}

function isOreLike(typeId) {
    return ORE_BLOCKS.has(typeId);
}

function isGravel(typeId) {
    return typeId === "minecraft:gravel";
}

function isAxe(typeId) { return String(typeId ?? "").endsWith("_axe"); }
function isPickaxe(typeId) { return String(typeId ?? "").endsWith("_pickaxe"); }
function isShovel(typeId) { return String(typeId ?? "").endsWith("_shovel"); }

function hasMassMiningLore(item) {
    try {
        return (item?.getLore?.() ?? []).some((line) => String(line).includes(MASS_LORE_TEXT));
    } catch {
        return false;
    }
}

function wouldMassMiningActivate(blockId, toolId, item, player) {
    if (!item || !hasMassMiningLore(item)) return false;
    try { if (player?.isSneaking) return false; } catch {}
    if (isAxe(toolId) && isLogLike(blockId)) return true;
    if (isPickaxe(toolId) && isOreLike(blockId)) return true;
    if (isShovel(toolId) && isGravel(blockId)) return true;
    return false;
}

export function getNetheriteArmorPieces(player) {
    try {
        const equippable = player.getComponent("minecraft:equippable");
        if (!equippable) return 0;
        let count = 0;
        for (const slot of ARMOR_SLOTS) {
            const item = equippable.getEquipment(slot);
            if (item && NETHERITE_ARMOR_IDS.has(item.typeId)) count++;
        }
        return count;
    } catch {
        return 0;
    }
}

export function hasNetheriteSetBonus(player, requiredPieces = 1) {
    return getNetheriteArmorPieces(player) >= requiredPieces;
}

export function getNetheriteVitalityDurationMultiplier(player) {
    const pieces = getNetheriteArmorPieces(player);
    if (pieces >= 3) return 1.4;
    if (pieces >= 2) return 1.2;
    if (pieces >= 1) return 1.1;
    return 1.0;
}

export function getAdjustedVitalityDuration(player, baseTicks) {
    return Math.floor(Number(baseTicks ?? 0) * getNetheriteVitalityDurationMultiplier(player));
}

export function getNetheriteVoidPressureBaseTicks(player, defaultTicks = 30 * 20) {
    const pieces = getNetheriteArmorPieces(player);
    if (pieces >= 3) return 50 * 20;
    if (pieces >= 2) return 40 * 20;
    if (pieces >= 1) return 35 * 20;
    return defaultTicks;
}

export function shouldDisableVoidWetnessMultiplier(player) {
    return hasNetheriteSetBonus(player, 1);
}

export function shouldCapHeatByNetherite(player) {
    return hasNetheriteSetBonus(player, 1);
}

export function getNetheriteIndomitableThreshold(player) {
    return hasNetheriteSetBonus(player, 1) ? 7 : 9;
}

function getMainhand(player) {
    try {
        return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    } catch {
        return undefined;
    }
}

function setMainhand(player, item) {
    try {
        player.getComponent("minecraft:equippable")?.setEquipment(EquipmentSlot.Mainhand, item);
    } catch {}
}

function restoreOneDurability(item) {
    try {
        const durability = item?.getComponent?.("minecraft:durability");
        if (!durability) return false;
        const current = Number(durability.damage ?? 0);
        if (current <= 0) return false;
        durability.damage = Math.max(0, current - 1);
        return true;
    } catch {
        return false;
    }
}

export function applyNetheriteEffectImmunity(player) {
    const pieces = getNetheriteArmorPieces(player);
    if (pieces <= 0) return;

    const removeIds = [];
    if (pieces >= 1) removeIds.push("weakness");
    if (pieces >= 2) removeIds.push("mining_fatigue", "poison", "fatal_poison");
    if (pieces >= 3) {
        removeIds.push("slowness", "darkness");

        const corrosion = Boolean(player.getDynamicProperty("mania_corrosion") ?? false);
        const inEnd = (() => { try { return player.dimension.id === "minecraft:the_end"; } catch { return false; } })();
        if (!(corrosion && inEnd && player.location.y < 8)) removeIds.push("levitation");
    }

    for (const id of removeIds) {
        try { player.removeEffect(id); } catch {}
    }
}

export function initNetheriteBonusSystem() {
    world.afterEvents.playerBreakBlock.subscribe((event) => {
        const player = event.player;
        if (!player || getNetheriteArmorPieces(player) < 1) return;

        const item = getMainhand(player);
        if (!item) return;

        const blockId = event.brokenBlockPermutation?.type?.id ?? "";
        const massActivated = wouldMassMiningActivate(blockId, item.typeId, item, player);
        if (massActivated) return;

        if (restoreOneDurability(item)) setMainhand(player, item);
    });

    system.runInterval(() => {
        for (const player of world.getAllPlayers()) {
            try { applyNetheriteEffectImmunity(player); } catch {}
        }
    }, 10);
}
