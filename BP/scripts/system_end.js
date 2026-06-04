import { world, system, EquipmentSlot, ItemStack, EntityComponentTypes } from "@minecraft/server";
import { safeSubscribe, debugWarn } from "./debug.js";
import { getNetheriteVoidPressureBaseTicks, shouldDisableVoidWetnessMultiplier, hasNetheriteSetBonus } from "./system_netherite.js";

const END_DIMENSION_ID = "minecraft:the_end";
const VOID_PRESSURE_MIN = 1;
const VOID_PRESSURE_MAX = 20;
const VOID_PRESSURE_BASE_TICKS = 30 * 20;
const END_FOG_IDENTIFIER = "shc:end_void_haze";
const END_FOG_STACK_ID = "shc_end_void_haze";
const CRYSTAL_REGEN_TICKS = 150 * 20;

const MANIA_KEYS = {
    saturation: "mania_saturation",
    ignition: "mania_ignition",
    gravity: "mania_gravity",
    infinity: "mania_infinity",
    corrosion: "mania_corrosion",
};

const MANIA_ITEM_IDS = {
    "pls:mania_saturation": "saturation",
    "pls:mania_ignition": "ignition",
    "pls:mania_gravity": "gravity",
    "pls:mania_infinity": "infinity",
    "pls:mania_corrosion": "corrosion",
};

const ROMAN_TO_RANK = {
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7,
};

const VOIDGUARD_FULL_DELAY = {
    1: 1.1, 2: 1.2, 3: 1.3, 4: 1.5, 5: 1.8, 6: 2.5, 7: 4.0,
};

const VOIDGUARD_PIECE_CHANCE_REDUCTION = {
    1: 0.02, 2: 0.03, 3: 0.04, 4: 0.05, 5: 0.06, 6: 0.08, 7: 0.10,
};

const VOIDGUARD_BASE_TIME_BONUS_SECONDS = {
    1: 0.2, 2: 0.4, 3: 0.6, 4: 0.9, 5: 1.2, 6: 4.5, 7: 10.0,
};

const IGNITION_WATERPROOF_FULL_BONUS_SECONDS = {
    1: 0.2, 2: 0.4, 3: 0.6, 4: 0.9, 5: 1.2, 6: 4.5, 7: 10.0,
};

const PROTECTED_HEAD_BLOCK_KEYWORDS = [
    "purpur", "end_stone_bricks", "end_rod", "bedrock", "end_portal", "end_gateway",
    "dragon_egg", "obsidian", "chest", "shulker_box", "barrier", "command_block",
];

const BREAKABLE_HEAD_BLOCK_KEYWORDS = [
    "cobblestone", "dirt", "netherrack", "planks", "log", "wood", "wool", "glass",
    "stone", "deepslate", "andesite", "diorite", "granite", "sandstone", "brick",
];

const lastPlayerLocations = new WeakMap();
let cachedDragonAlive = false;
let lastDragonScanTick = -9999;
let dragonPhaseActive = false;
let dragonExtraHealGuard = false;
let dragonDamageGuard = false;

function isValidEntity(entity) {
    try { return Boolean(entity?.isValid); } catch { return false; }
}

export function isInEnd(player) {
    try { return player.dimension.id === END_DIMENSION_ID; } catch { return false; }
}

export function getManiaFlags(player) {
    const active = {};
    for (const [key, prop] of Object.entries(MANIA_KEYS)) {
        active[key] = Boolean(player.getDynamicProperty(prop) ?? false);
    }
    return active;
}

export function hasEffectiveMania(player, key) {
    const m = getManiaFlags(player);
    if (m.corrosion && key !== "ignition" && key !== "corrosion") return false;
    return Boolean(m[key]);
}

export function isVoidPressureOnePercentEffectSuppressed(player) {
    const m = getManiaFlags(player);
    return Boolean(m.saturation && m.infinity && !m.corrosion);
}

export function getVoidPressure(player) {
    return Number(player.getDynamicProperty("void_pressure") ?? 0);
}

export function getEffectiveVoidPressure(player) {
    if (!isInEnd(player)) return 0;
    return getVoidPressure(player);
}

export function hasVoidPressureEffect(player) {
    return getEffectiveVoidPressure(player) >= 1 && !isVoidPressureOnePercentEffectSuppressed(player);
}

function parseVoidguardRank(line) {
    if (typeof line !== "string") return 0;
    const prefix = "§5浮郭加工";
    if (!line.startsWith(prefix)) return 0;
    const suffix = line.slice(prefix.length).trim();
    return ROMAN_TO_RANK[suffix] ?? 1;
}

function getArmorLoreRanks(player) {
    const ranks = [];
    try {
        const equippable = player.getComponent("minecraft:equippable");
        if (!equippable) return ranks;
        const slots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
        for (const slot of slots) {
            const item = equippable.getEquipment(slot);
            if (!item || typeof item.getLore !== "function") continue;
            const rank = (item.getLore() || []).reduce((max, line) => Math.max(max, parseVoidguardRank(line)), 0);
            if (rank > 0) ranks.push(rank);
        }
    } catch {}
    return ranks;
}

export function getVoidguardProtection(player) {
    const ranks = getArmorLoreRanks(player);
    let delayBonus = 0;
    let chanceReduction = 0;
    let baseBonusSeconds = 0;
    let pieces = 0;
    for (const rank of ranks) {
        pieces++;
        const fullDelay = VOIDGUARD_FULL_DELAY[rank] ?? 1.1;
        delayBonus += (fullDelay - 1) / 4;
        chanceReduction += VOIDGUARD_PIECE_CHANCE_REDUCTION[rank] ?? 0.02;
        baseBonusSeconds += (VOIDGUARD_BASE_TIME_BONUS_SECONDS[rank] ?? 0.2) / 4;
    }
    return {
        pieces,
        delayMultiplier: 1 + delayBonus,
        chanceReduction: Math.min(0.95, chanceReduction),
        baseBonusSeconds,
    };
}

export function getManiaMask(player) {
    const m = getManiaFlags(player);
    return (m.saturation ? 1 : 0)
        | (m.ignition ? 2 : 0)
        | (m.gravity ? 4 : 0)
        | (m.infinity ? 8 : 0)
        | (m.corrosion ? 16 : 0);
}

function stripColorCodes(text) {
    return String(text ?? "").replace(/§./g, "").trim();
}

function parseWaterproofRank(line) {
    if (typeof line !== "string") return 0;

    const plain = stripColorCodes(line);

    if (plain.startsWith("防水加工")) {
        const suffix = plain.slice("防水加工".length).trim();
        const matched = suffix.match(/^(VII|VI|V|IV|III|II|I)$/);
        if (matched) return ROMAN_TO_RANK[matched[1]] ?? 1;
        return 1;
    }

    if (plain === "[防水加工]") return 1;

    const legacy = plain.match(/^\[防水加工:(.+)\]$/);
    if (legacy) {
        const label = legacy[1].trim();
        const jp = {
            "革": 1,
            "チェーン": 2,
            "銅": 3,
            "金": 4,
            "鉄": 5,
            "ダイヤ": 6,
            "ネザライト": 7,
        };
        return jp[label] ?? 1;
    }

    return 0;
}

function getWaterproofRanks(player) {
    const ranks = [];
    try {
        const equippable = player.getComponent("minecraft:equippable");
        if (!equippable) return ranks;
        const slots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
        for (const slot of slots) {
            const item = equippable.getEquipment(slot);
            if (!item || typeof item.getLore !== "function") continue;
            const rank = (item.getLore() || []).reduce((max, line) => Math.max(max, parseWaterproofRank(line)), 0);
            if (rank > 0) ranks.push(rank);
        }
    } catch {}
    return ranks;
}

export function getWetnessBaseBonusSeconds(player) {

    if (!isInEnd(player)) return 0;
    if (!hasEffectiveMania(player, "ignition")) return 0;
    const m = getManiaFlags(player);
    if (m.infinity && !m.corrosion) return Number.POSITIVE_INFINITY;

    const ranks = getWaterproofRanks(player);
    let bonus = 0;
    for (const rank of ranks) {
        let fullBonus = IGNITION_WATERPROOF_FULL_BONUS_SECONDS[rank] ?? 0.2;
        if (m.saturation && !m.corrosion) fullBonus += 1.0;
        bonus += fullBonus / 4;
    }
    return bonus;
}

export function isWetnessBlockedByMania(player) {
    if (!isInEnd(player)) return false;
    const m = getManiaFlags(player);
    return Boolean(m.ignition && m.infinity && !m.corrosion);
}

export function getVoidPressureWetnessMultiplier(player) {
    if (shouldDisableVoidWetnessMultiplier(player)) return 1;
    const vp = getEffectiveVoidPressure(player);
    return vp >= 12 ? 2 : 1;
}

export function getVitalityDrainMultiplier(player) {
    const vp = getEffectiveVoidPressure(player);
    if (vp < 1 || isVoidPressureOnePercentEffectSuppressed(player)) return 1;
    if (hasEffectiveMania(player, "infinity")) return 0;
    return vp >= 12 ? 2.5 : 1.5;
}

export function getVitalityCap(player) {
    const vp = getEffectiveVoidPressure(player);
    let cap = 10;
    if (vp >= 18) cap = 5;
    else if (vp >= 7) cap = 8;
    return hasNetheriteSetBonus(player, 1) ? Math.max(5, cap) : cap;
}

export function getWaterCap(player) {
    const vp = getEffectiveVoidPressure(player);
    return vp >= 3 ? 3 : 10;
}

export function getWaterRecoveryAmount(player, normalAmount) {
    const vp = getEffectiveVoidPressure(player);
    return vp >= 3 ? 1 : normalAmount;
}

export function getHeatAccelerationWetDurationTicks(player) {

    return hasVoidPressureEffect(player) ? 20 * 20 : 120 * 20;
}

function setVoidPressure(player, value) {
    const clamped = Math.max(VOID_PRESSURE_MIN, Math.min(VOID_PRESSURE_MAX, value));
    player.setDynamicProperty("void_pressure", clamped);
    return clamped;
}

function ensureEndState(player) {
    if (player.getDynamicProperty("void_pressure") === undefined) {
        player.setDynamicProperty("void_pressure", isInEnd(player) ? 1 : 0);
    }
    for (const prop of Object.values(MANIA_KEYS)) {
        if (player.getDynamicProperty(prop) === undefined) player.setDynamicProperty(prop, false);
    }
    if (player.getDynamicProperty("end_fog_active") === undefined) player.setDynamicProperty("end_fog_active", false);
    if (player.getDynamicProperty("end_void_explosion_next") === undefined) player.setDynamicProperty("end_void_explosion_next", 0);
    if (player.getDynamicProperty("void_pressure_water_timer") === undefined) player.setDynamicProperty("void_pressure_water_timer", 10 * 20);
}

function updateVoidPressure(player) {
    if (!isInEnd(player)) return;

    try {
        const blockUntil = Number(player.getDynamicProperty("shift_void_block_until") ?? 0);
        if (system.currentTick <= blockUntil) return;
    } catch {}

    const m = getManiaFlags(player);
    let pressure = Number(player.getDynamicProperty("void_pressure") ?? 1);
    if (pressure < 1) pressure = 1;

    if (m.saturation && !m.corrosion) {
        if (pressure > 2) pressure = 2;
        player.setDynamicProperty("void_pressure", pressure);
        return;
    }

    let rate = 1 / getNetheriteVoidPressureBaseTicks(player, VOID_PRESSURE_BASE_TICKS);
    const prot = getVoidguardProtection(player);
    rate /= prot.delayMultiplier;

    if (m.gravity && m.corrosion) rate *= 3;
    else if (m.gravity && !m.saturation) rate *= 1.25;

    setVoidPressure(player, pressure + rate);
}

function applyVoidPressureCaps(player) {
    if (!isInEnd(player)) return;

    const vp = getEffectiveVoidPressure(player);
    const vitCap = getVitalityCap(player);
    let vitality = Number(player.getDynamicProperty("vitality") ?? 5);
    if (vitality > vitCap) {
        player.setDynamicProperty("vitality", vitCap);
        player.setDynamicProperty("vitality_timer", 0);
    }

    const waterCap = getWaterCap(player);
    let water = Number(player.getDynamicProperty("water_level") ?? 7);
    if (water > waterCap) player.setDynamicProperty("water_level", waterCap);

    if (vp >= 18) {
        let timer = Number(player.getDynamicProperty("void_pressure_water_timer") ?? 10 * 20);
        timer -= 1;
        if (timer <= 0) {
            const current = Number(player.getDynamicProperty("water_level") ?? 0);
            player.setDynamicProperty("water_level", Math.max(0, current - 1));
            timer = 10 * 20;
        }
        player.setDynamicProperty("void_pressure_water_timer", timer);
    } else {
        player.setDynamicProperty("void_pressure_water_timer", 10 * 20);
    }
}

function removeForbiddenEffects(player) {
    if (getEffectiveVoidPressure(player) < 7) return;
    const ids = ["jump_boost", "speed", "resistance", "invisibility", "absorption"];
    for (const id of ids) {
        try { player.removeEffect(id); } catch {}
    }
}

function enforceTotemBan(player) {
    if (getEffectiveVoidPressure(player) < 7) return;
    try {
        const equippable = player.getComponent("minecraft:equippable");
        if (!equippable) return;
        const off = equippable.getEquipment(EquipmentSlot.Offhand);
        if (off?.typeId === "minecraft:totem_of_undying") {
            equippable.setEquipment(EquipmentSlot.Offhand, undefined);
            player.dimension.spawnItem(off, player.location);
        }
    } catch {}
}

function applySaturationMania(player) {
    if (!isInEnd(player)) return;
    const m = getManiaFlags(player);
    if (!m.saturation) return;

    try {
        if (m.corrosion) {
            player.addEffect("strength", 40, { amplifier: 4, showParticles: false });
            player.addEffect("regeneration", 40, { amplifier: 4, showParticles: false });
        } else {
            player.runCommand("effect @s saturation 2 255 true");
            try { player.removeEffect("hunger"); } catch {}
        }
    } catch {}
}

function applyCorrosionMania(player) {
    if (!isInEnd(player) || !hasEffectiveMania(player, "corrosion")) return;

    if (system.currentTick % 20 === 0) {
        let healed = false;
        try {
            const targets = player.dimension.getEntities({
                location: player.location,
                maxDistance: 10,
            }).filter(e => {
                if (!isValidEntity(e)) return false;
                if (e.id === player.id) return false;
                if (e.typeId === "minecraft:player" || e.typeId === "minecraft:ender_dragon") return false;
                return true;
            });

            for (const target of targets) {
                try {
                    target.applyDamage(4, { cause: "magic", damagingEntity: player });
                    target.addEffect("poison", 40, { amplifier: 0, showParticles: false });
                    healed = true;
                } catch {}
            }
        } catch {}

        if (healed) {
            try {
                const health = player.getComponent(EntityComponentTypes.Health);
                const max = health.effectiveMax ?? health.defaultValue ?? 20;
                health.setCurrentValue(Math.min(max, health.currentValue + 4));
            } catch {}
        }
    }

    if (system.currentTick % 10 === 0 && player.location.y < 5) {
        let hasBlockBelow = false;
        try {
            const below = player.dimension.getBlockBelow(player.location, {
                maxDistance: 96,
                includePassableBlocks: false,
                includeLiquidBlocks: false,
            });
            hasBlockBelow = Boolean(below);
        } catch {}
        if (!hasBlockBelow) {
            try { player.addEffect("levitation", 40, { amplifier: 0, showParticles: false }); } catch {}
        }
    }
}

function applyAirVoidPunish(player) {
    if (!hasVoidPressureEffect(player)) return;

    const m = getManiaFlags(player);

    if (m.corrosion) return;

    if (system.currentTick % 10 !== 0) return;
    try { if (player.isOnGround) return; } catch {}

    const prot = getVoidguardProtection(player);

    let chance = 0.8;
    chance -= prot.chanceReduction;
    if (m.gravity) chance -= 0.5;
    if (m.gravity && m.infinity && !m.corrosion) chance = 0;

    if (Math.random() < Math.max(0, chance)) {
        try { player.addEffect("levitation", 40, { amplifier: 1, showParticles: false }); } catch {}

        if (!m.gravity) {
            try { player.applyDamage(4, { cause: "magic" }); } catch {}
        }
    }
}

function findSafeTeleportLocation(dimension, origin, radius = 7) {
    for (let i = 0; i < 24; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 2 + Math.random() * radius;
        const x = Math.floor(origin.x + Math.cos(angle) * dist) + 0.5;
        const z = Math.floor(origin.z + Math.sin(angle) * dist) + 0.5;
        const startY = Math.floor(origin.y + 4);
        try {
            for (let y = startY; y >= Math.max(-60, origin.y - 12); y--) {
                const ground = dimension.getBlock({ x, y: y - 1, z });
                const feet = dimension.getBlock({ x, y, z });
                const head = dimension.getBlock({ x, y: y + 1, z });
                if (!ground || !feet || !head) continue;
                if (ground.typeId === "minecraft:air" || ground.typeId.includes("portal") || ground.typeId.includes("fire")) continue;
                if (feet.typeId !== "minecraft:air" || head.typeId !== "minecraft:air") continue;

                const below = dimension.getBlockBelow({ x, y, z }, {
                    maxDistance: 96,
                    includePassableBlocks: false,
                    includeLiquidBlocks: false,
                });
                if (!below) continue;
                return { x, y, z };
            }
        } catch {}
    }
    return undefined;
}

export function tryVoidPressureHitTeleport(player, hitLocation) {
    if (!hasVoidPressureEffect(player)) return;
    const m = getManiaFlags(player);
    const prot = getVoidguardProtection(player);

    let chance = 0.8 - prot.chanceReduction;
    if (m.gravity) chance -= 0.5;
    if (m.gravity && m.infinity && !m.corrosion) chance = 0;

    if (Math.random() >= Math.max(0, chance)) return;

    const dest = findSafeTeleportLocation(player.dimension, hitLocation ?? player.location, 7);
    if (!dest) return;
    try {
        player.teleport(dest, { dimension: player.dimension });
        player.dimension.playSound("mob.endermen.portal", dest);
    } catch {}
}

function scanDragonAlive() {
    if (system.currentTick - lastDragonScanTick < 40) return cachedDragonAlive;
    lastDragonScanTick = system.currentTick;
    try {
        const end = world.getDimension("the_end");
        const dragons = end.getEntities({ type: "minecraft:ender_dragon" });
        cachedDragonAlive = dragons.length > 0;
        if (!cachedDragonAlive) dragonPhaseActive = false;
        return cachedDragonAlive;
    } catch {
        cachedDragonAlive = false;
        return false;
    }
}

export function isEndDragonAlive() {
    return scanDragonAlive();
}

function updateEndFog(player, enabled) {
    const active = Boolean(player.getDynamicProperty("end_fog_active") ?? false);
    if (enabled === active) return;
    try {
        if (enabled) {
            player.runCommand(`fog @s push ${END_FOG_IDENTIFIER} ${END_FOG_STACK_ID}`);
            player.setDynamicProperty("end_fog_active", true);
        } else {
            player.runCommand(`fog @s remove ${END_FOG_STACK_ID}`);
            player.setDynamicProperty("end_fog_active", false);
        }
    } catch {}
}

function getNearbyEndermen(player, distance = 10) {
    try {
        return player.dimension.getEntities({
            type: "minecraft:enderman",
            location: player.location,
            maxDistance: distance,
        });
    } catch {
        return [];
    }
}

function breakBlocksAbovePlayer(player) {

    try {
        const x = Math.floor(player.location.x);
        const baseY = Math.floor(player.location.y);
        const z = Math.floor(player.location.z);

        for (let dy = 1; dy <= 4; dy++) {
            const loc = { x, y: baseY + dy, z };
            const block = player.dimension.getBlock(loc);
            if (!block || block.typeId === "minecraft:air") continue;

            if (shouldBreakHeadBlock(block.typeId)) {

                try {
                    block.setType("minecraft:air");
                } catch {
                    try { player.dimension.runCommand(`setblock ${loc.x} ${loc.y} ${loc.z} air`); } catch {}
                }
                return true;
            }

            return false;
        }
    } catch {}
    return false;
}

function applyDragonEndGlobalEffects(player, dragonAlive) {
    if (!isInEnd(player)) {
        updateEndFog(player, false);
        clearVoidPressureOutsideEnd(player);
        return;
    }

    updateEndFog(player, dragonAlive);
    if (!dragonAlive) return;

    if (system.currentTick % 20 === 0 && getNearbyEndermen(player, 8).length > 0) {
        try { player.addEffect("darkness", 100, { amplifier: 0, showParticles: false }); } catch {}
    }

    if (system.currentTick % 40 === 0) {
        for (const e of getNearbyEndermen(player, 64)) {
            try {
                e.addEffect("speed", 80, { amplifier: 2, showParticles: false });
                e.addEffect("strength", 80, { amplifier: 2, showParticles: false });
                e.addEffect("resistance", 80, { amplifier: 1, showParticles: false });
            } catch {}
        }
    }

    if (system.currentTick % 10 === 0) {
        breakBlocksAbovePlayer(player);
    }

    if (system.currentTick % 20 === 0) {
        const last = lastPlayerLocations.get(player);
        const now = { x: player.location.x, y: player.location.y, z: player.location.z, stopped: 0 };
        if (last) {
            const dx = player.location.x - last.x;
            const dz = player.location.z - last.z;
            const moved = Math.sqrt(dx * dx + dz * dz) > 0.08;
            now.stopped = moved ? 0 : (last.stopped ?? 0) + 20;
        }
        lastPlayerLocations.set(player, now);

        const sec = now.stopped / 20;
        try {
            if (sec >= 7) {
                player.addEffect("hunger", 40, { amplifier: 254, showParticles: false });
                player.addEffect("darkness", 100, { amplifier: 0, showParticles: false });
            } else if (sec >= 3) {
                player.addEffect("hunger", 40, { amplifier: 2, showParticles: false });
            } else if (sec >= 1) {
                player.addEffect("hunger", 40, { amplifier: 0, showParticles: false });
            }
        } catch {}
    }

    let next = Number(player.getDynamicProperty("end_void_explosion_next") ?? 0);
    if (next <= 0) {
        player.setDynamicProperty("end_void_explosion_next", system.currentTick + 30 * 20);
    } else if (system.currentTick >= next) {
        try {
            player.dimension.createExplosion(player.location, 1.2, {
                breaksBlocks: false,
                causesFire: false,
                source: player,
            });
            player.applyImpulse({ x: 0, y: 1.15, z: 0 });
        } catch {}
        player.setDynamicProperty("end_void_explosion_next", system.currentTick + 30 * 20);
    }
}

function shouldBreakHeadBlock(typeId) {
    if (!typeId || typeId === "minecraft:air") return false;
    const id = typeId.toLowerCase();
    if (PROTECTED_HEAD_BLOCK_KEYWORDS.some(k => id.includes(k))) return false;
    return BREAKABLE_HEAD_BLOCK_KEYWORDS.some(k => id.includes(k));
}

function rememberCrystalLocation(loc) {
    try {
        const dim = world.getDimension("the_end");
        const key = "end_crystal_locations";
        const raw = world.getDynamicProperty(key);
        const list = raw ? JSON.parse(String(raw)) : [];
        const rounded = { x: Math.floor(loc.x) + 0.5, y: loc.y, z: Math.floor(loc.z) + 0.5 };
        if (!list.some(p => Math.abs(p.x - rounded.x) < 1 && Math.abs(p.y - rounded.y) < 2 && Math.abs(p.z - rounded.z) < 1)) {
            list.push(rounded);
            world.setDynamicProperty(key, JSON.stringify(list.slice(-64)));
        }
    } catch {}
}

function scanExistingCrystals() {
    if (system.currentTick % 100 !== 0) return;
    try {
        const dim = world.getDimension("the_end");
        const crystals = dim.getEntities({ type: "minecraft:ender_crystal" });
        for (const c of crystals) rememberCrystalLocation(c.location);
    } catch {}
}

function hasCrystalNear(dim, loc, distance = 2) {
    try {
        return dim.getEntities({
            type: "minecraft:ender_crystal",
            location: loc,
            maxDistance: distance,
        }).length > 0;
    } catch {
        return true;
    }
}

function respawnCrystalAt(loc) {
    try {
        const dim = world.getDimension("the_end");
        if (hasCrystalNear(dim, loc, 2)) return;
        dim.spawnEntity("minecraft:ender_crystal", loc);
        dim.playSound("beacon.activate", loc);
    } catch (e) {
        debugWarn(`crystal respawn failed: ${e}`);
    }
}

function respawnKnownCrystals() {
    try {
        const raw = world.getDynamicProperty("end_crystal_locations");
        const list = raw ? JSON.parse(String(raw)) : [];
        for (const loc of list) respawnCrystalAt(loc);
    } catch {}
}

function processDragonPhase() {
    if (system.currentTick % 20 !== 0) return;
    try {
        const dim = world.getDimension("the_end");
        const dragon = dim.getEntities({ type: "minecraft:ender_dragon" })[0];
        if (!dragon) {
            dragonPhaseActive = false;
            return;
        }

        const health = dragon.getComponent(EntityComponentTypes.Health);
        if (!health) return;
        const max = health.effectiveMax ?? health.defaultValue ?? 200;
        const ratio = health.currentValue / max;

        if (ratio >= 0.999) {
            dragonPhaseActive = false;
        }

        if (!dragonPhaseActive && ratio <= 0.5) {
            dragonPhaseActive = true;
            respawnKnownCrystals();
            try { dim.playSound("mob.enderdragon.growl", dragon.location); } catch {}
        }
    } catch {}
}

function clearVoidPressureOutsideEnd(player) {

    try {
        const current = Number(player.getDynamicProperty("void_pressure") ?? 0);
        if (current !== 0) player.setDynamicProperty("void_pressure", 0);
    } catch {}

    try { player.setDynamicProperty("void_pressure_water_timer", 10 * 20); } catch {}

    for (const id of ["levitation", "darkness", "hunger", "saturation"]) {
        try { player.removeEffect(id); } catch {}
    }
}

export function tickEndHardcore(player) {
    ensureEndState(player);
    scanExistingCrystals();

    const dragonAlive = isEndDragonAlive();

    if (!isInEnd(player)) {

        updateEndFog(player, false);
        clearVoidPressureOutsideEnd(player);
        return;
    }

    updateVoidPressure(player);
    applyVoidPressureCaps(player);
    removeForbiddenEffects(player);
    enforceTotemBan(player);
    applySaturationMania(player);
    applyCorrosionMania(player);
    applyAirVoidPunish(player);
    applyDragonEndGlobalEffects(player, dragonAlive);
    processDragonPhase();
}

safeSubscribe(world.afterEvents?.itemCompleteUse, "afterEvents.itemCompleteUse.endMania", (event) => {
    const player = event.source;
    const item = event.itemStack;
    if (!player || player.typeId !== "minecraft:player" || !item) return;

    const maniaKey = MANIA_ITEM_IDS[item.typeId];
    if (maniaKey) {
        player.setDynamicProperty(MANIA_KEYS[maniaKey], true);
        if (maniaKey === "saturation") {
            const vp = Number(player.getDynamicProperty("void_pressure") ?? 1);
            if (vp >= 3) player.setDynamicProperty("void_pressure", 2);
        }
        return;
    }

    if (item.typeId === "pls:mania_remover") {
        system.run(() => {
            try {
                for (const [key, prop] of Object.entries(MANIA_KEYS)) {
                    if (Boolean(player.getDynamicProperty(prop) ?? false)) {
                        player.setDynamicProperty(prop, false);
                        player.dimension.spawnItem(new ItemStack(`pls:mania_${key}`, 1), player.location);
                    }
                }
            } catch (e) {
                debugWarn(`mania remover failed for ${player.name}: ${e}`);
            }
        });
    }
});

safeSubscribe(world.afterEvents?.entityHurt, "afterEvents.entityHurt.endVoid", (event) => {
    const entity = event.hurtEntity;
    if (!entity || entity.typeId !== "minecraft:player") {

        if (entity?.typeId === "minecraft:enderman" && cachedDragonAlive && entity.dimension?.id === END_DIMENSION_ID) {
            system.run(() => {
                try {
                    const h = entity.getComponent(EntityComponentTypes.Health);
                    const max = h.effectiveMax ?? h.defaultValue ?? 40;
                    h.setCurrentValue(Math.min(max, h.currentValue + event.damage * 0.8));
                } catch {}
            });
        }
        return;
    }

    const player = entity;

    if (isInEnd(player) && hasEffectiveMania(player, "corrosion")) {
        system.run(() => {
            try {
                const h = player.getComponent(EntityComponentTypes.Health);
                const max = h.effectiveMax ?? h.defaultValue ?? 20;
                h.setCurrentValue(Math.min(max, h.currentValue + event.damage));
                player.addEffect("resistance", 20, { amplifier: 4, showParticles: false });
            } catch {}
        });
    }

    tryVoidPressureHitTeleport(player, player.location);
});

safeSubscribe(world.afterEvents?.entityDie, "afterEvents.entityDie.endCrystal", (event) => {
    const entity = event.deadEntity;
    if (!entity || entity.typeId !== "minecraft:ender_crystal") return;
    let loc;
    try {
        if (entity.dimension.id !== END_DIMENSION_ID) return;
        loc = { x: entity.location.x, y: entity.location.y, z: entity.location.z };
    } catch { return; }

    rememberCrystalLocation(loc);

    if (dragonPhaseActive) {
        system.runTimeout(() => respawnCrystalAt(loc), CRYSTAL_REGEN_TICKS);
    }
});

safeSubscribe(world.afterEvents?.entityHeal, "afterEvents.entityHeal.dragonCrystalBoost", (event) => {
    const dragon = event.healedEntity;
    if (!dragon || dragon.typeId !== "minecraft:ender_dragon") return;
    if (!dragonPhaseActive || dragonExtraHealGuard) return;

    const extra = Number(event.healing ?? 0) * 0.75;
    if (extra <= 0) return;

    system.run(() => {
        try {
            dragonExtraHealGuard = true;
            const health = dragon.getComponent(EntityComponentTypes.Health);
            const max = health.effectiveMax ?? health.defaultValue ?? 200;
            health.setCurrentValue(Math.min(max, health.currentValue + extra));
        } catch {} finally {
            system.run(() => { dragonExtraHealGuard = false; });
        }
    });
});

safeSubscribe(world.afterEvents?.entityHurt, "afterEvents.entityHurt.dragonEffectiveHp", (event) => {
    const dragon = event.hurtEntity;
    if (!dragon || dragon.typeId !== "minecraft:ender_dragon") return;
    if (dragonDamageGuard) return;

    system.run(() => {
        try {
            dragonDamageGuard = true;
            const h = dragon.getComponent(EntityComponentTypes.Health);
            const max = h.effectiveMax ?? h.defaultValue ?? 200;
            h.setCurrentValue(Math.min(max, h.currentValue + event.damage / 3));
        } catch {} finally {
            system.run(() => { dragonDamageGuard = false; });
        }
    });
});
