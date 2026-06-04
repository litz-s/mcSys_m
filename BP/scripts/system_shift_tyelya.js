import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";

const DIMENSION_IDS = ["overworld", "nether", "the_end"];
const DROP_CRAFT_INTERVAL = 10;
const DROP_CRAFT_DISTANCE = 1.15;
const PREVIEW_INTERVAL = 4;
const IMPORTANT_TICKS = 26;

const OVERLOAD_FRAGMENT_ID = "pls:overload_fragment";
const PORTALSHIFT_FRAGMENT_ID = "pls:portalshit_fragment";

const SHIFT_TIERS = {
    "pls:shift_tyelya": {
        tier: 0,
        next: "pls:shift_tyelya_t",
        label: "シフトティリア",
        maxDistance: 10,
        cooldown: 35 * 20,
        waterDelta: -2,
        vitalityTimerAdvance: 120 * 20,
        damage: 4,
        effects: [{ id: "slowness", seconds: 7, amplifier: 1 }],
    },
    "pls:shift_tyelya_t": {
        tier: 1,
        next: "pls:shift_tyelya_s",
        label: "シフトティリアT",
        maxDistance: 25,
        cooldown: 10 * 20,
        waterDelta: -1,
        vitalityTimerAdvance: 45 * 20,
        damage: 0,
        effects: [{ id: "slowness", seconds: 3, amplifier: 0 }],
    },
    "pls:shift_tyelya_s": {
        tier: 2,
        next: "pls:shift_tyelya_l",
        label: "シフトティリアS",
        maxDistance: 40,
        cooldown: 3 * 20,
        waterDelta: 0,
        vitalityTimerAdvance: 10 * 20,
        damage: 0,
        effects: [],
    },
    "pls:shift_tyelya_l": {
        tier: 3,
        next: undefined,
        label: "シフトティリアL",
        maxDistance: 90,
        cooldown: 0,
        waterDelta: 2,
        vitalityTimerAdvance: 0,
        damage: 0,
        airFallbackDistance: 24,
        effects: [
            { id: "fire_resistance", seconds: 5, amplifier: 0 },
            { id: "absorption", seconds: 5, amplifier: 4 },
            { id: "slow_falling", seconds: 0.7, amplifier: 0 },
        ],
    },
};

const FACE_OFFSETS = {
    Up: { x: 0, y: 1, z: 0 }, Down: { x: 0, y: -1, z: 0 }, North: { x: 0, y: 0, z: -1 },
    South: { x: 0, y: 0, z: 1 }, East: { x: 1, y: 0, z: 0 }, West: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, down: { x: 0, y: -1, z: 0 }, north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 }, east: { x: 1, y: 0, z: 0 }, west: { x: -1, y: 0, z: 0 },
};

const cooldownUntil = new Map();
const importantUntil = new Map();
const importantText = new Map();
let lastPreviewTick = -9999;

function safeEntity(entity) {
    try { return Boolean(entity?.isValid); } catch { return false; }
}

function safeGetItemStack(entity) {
    try {
        if (!safeEntity(entity)) return undefined;
        return entity.getComponent("minecraft:item")?.itemStack;
    } catch { return undefined; }
}

function safeGetLocation(entity) {
    try {
        if (!safeEntity(entity)) return undefined;
        const l = entity.location;
        return { x: l.x, y: l.y, z: l.z };
    } catch { return undefined; }
}

function safeRemove(entity) {
    try { if (safeEntity(entity)) entity.remove(); } catch {}
}

function consumeOneItemEntity(dimension, entity, loc) {
    const stack = safeGetItemStack(entity);
    if (!stack) return;
    const amount = Number(stack.amount ?? 1);
    safeRemove(entity);
    if (amount > 1) {
        try {
            const rest = stack.clone();
            rest.amount = amount - 1;
            dimension.spawnItem(rest, loc);
        } catch {}
    }
}

function getMainhand(player) {
    try {
        const eq = player.getComponent("minecraft:equippable");
        return eq?.getEquipment(EquipmentSlot.Mainhand);
    } catch { return undefined; }
}

function getShiftConfigFromItem(item) {
    return SHIFT_TIERS[item?.typeId ?? ""];
}

function getHeldShiftConfig(player) {
    return getShiftConfigFromItem(getMainhand(player));
}

function setImportant(player, text, ticks = IMPORTANT_TICKS) {
    try {
        importantText.set(player.id, text);
        importantUntil.set(player.id, system.currentTick + ticks);
        player.onScreenDisplay.setActionBar(text);
    } catch {}
}

function showAction(player, text) {
    try { player.onScreenDisplay.setActionBar(text); } catch {}
}

function blockAt(dim, x, y, z) {
    try { return dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }); } catch { return undefined; }
}

function isAirLike(block) {
    if (!block) return false;
    try { if (block.isAir) return true; } catch {}
    const id = block.typeId;
    return id === "minecraft:air" || id === "minecraft:cave_air" || id === "minecraft:void_air";
}

function isLiquid(block) {
    if (!block) return false;
    const id = block.typeId;
    return id.includes("water") || id.includes("lava");
}

function isWater(block) {
    if (!block) return false;
    return block.typeId.includes("water");
}

function isLava(block) {
    if (!block) return false;
    return block.typeId.includes("lava");
}

function isDebugPlayer(player) {
    return false;
}

function blockId(block) {
    try { return block?.typeId ?? "undefined"; } catch { return "error"; }
}

function debugLog(player, msg) {

}

function isPassableForTeleport(block) {
    if (!block) return false;
    if (isAirLike(block)) return true;

    if (isWater(block)) return true;
    if (isLava(block)) return false;
    const id = block.typeId;

    const exactPassable = new Set([
        "minecraft:short_grass",
        "minecraft:tall_grass",
        "minecraft:grass",
        "minecraft:fern",
        "minecraft:large_fern",
        "minecraft:dead_bush",
        "minecraft:snow_layer",
        "minecraft:vine",
        "minecraft:glow_lichen",
        "minecraft:seagrass",
        "minecraft:tall_seagrass",
        "minecraft:kelp",
        "minecraft:kelp_plant",
        "minecraft:torch",
        "minecraft:soul_torch",
        "minecraft:redstone_torch",
    ]);
    if (exactPassable.has(id)) return true;

    if (id.includes("flower") || id.includes("sapling")) return true;
    if (id.includes("mushroom") || id.includes("sprouts")) return true;
    if (id.includes("coral_fan") || id.includes("sea_pickle")) return true;
    return false;
}

function isRayIgnoredBlock(block) {
    if (!block) return true;
    if (isPassableForTeleport(block)) return true;

    if (block.typeId.includes("water")) return true;
    return false;
}

function isUnsafeStandBlock(block) {
    if (!block) return true;
    const id = block.typeId;
    return id.includes("lava") || id.includes("fire") || id.includes("portal") || id.includes("cactus") || id.includes("magma") || id.includes("sweet_berry_bush");
}

function isSolidStandable(block) {
    if (!block) return false;
    if (isPassableForTeleport(block)) return false;
    if (isLiquid(block)) return false;
    if (isUnsafeStandBlock(block)) return false;
    return true;
}

function explainSafeTeleportFeet(dim, feet) {
    const feetBlock = blockAt(dim, feet.x, feet.y, feet.z);
    const headBlock = blockAt(dim, feet.x, feet.y + 1, feet.z);
    const groundBlock = blockAt(dim, feet.x, feet.y - 1, feet.z);
    const feetOk = isPassableForTeleport(feetBlock);
    const headOk = isPassableForTeleport(headBlock);
    const groundOk = isSolidStandable(groundBlock);
    return {
        ok: feetOk && headOk && groundOk,
        feetBlock,
        headBlock,
        groundBlock,
        reason: feetOk && headOk && groundOk
            ? "ok"
            : `feet=${blockId(feetBlock)}:${feetOk} head=${blockId(headBlock)}:${headOk} ground=${blockId(groundBlock)}:${groundOk}`,
    };
}

function isSafeTeleportFeet(dim, feet) {
    return explainSafeTeleportFeet(dim, feet).ok;
}

function candidateToLocation(c) {
    return { x: c.x + 0.5, y: c.y, z: c.z + 0.5 };
}

function makeCandidatesFromHit(hit) {
    const b = hit.block;
    const loc = b.location;
    const face = String(hit.face ?? "Up");
    const n = FACE_OFFSETS[face] ?? { x: 0, y: 1, z: 0 };
    const candidates = [];
    candidates.push({ x: loc.x + n.x, y: loc.y + n.y, z: loc.z + n.z });
    candidates.push({ x: loc.x, y: loc.y + 1, z: loc.z });
    const around = [
        { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
        { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: -1, z: -1 },
    ];
    for (const a of around) candidates.push({ x: loc.x + a.x, y: loc.y + 1, z: loc.z + a.z });
    return candidates;
}

function findSafeTeleportLocationInfo(player, hit) {
    if (!hit?.block) return { tp: undefined, reason: "no_hit" };
    const dim = player.dimension;
    let lastReason = "no_candidate";
    for (const c of makeCandidatesFromHit(hit)) {
        const ex = explainSafeTeleportFeet(dim, c);
        if (ex.ok) return { tp: candidateToLocation(c), reason: "ok", candidate: c, ex };
        lastReason = `${c.x},${c.y},${c.z} ${ex.reason}`;
    }
    return { tp: undefined, reason: lastReason };
}

function findSafeTeleportLocation(player, hit) {
    return findSafeTeleportLocationInfo(player, hit).tp;
}

function explainCollisionTeleportFeet(dim, feet) {
    const feetBlock = blockAt(dim, feet.x, feet.y, feet.z);
    const headBlock = blockAt(dim, feet.x, feet.y + 1, feet.z);
    const feetOk = isPassableForTeleport(feetBlock);
    const headOk = isPassableForTeleport(headBlock);
    return {
        ok: feetOk && headOk,
        feetBlock,
        headBlock,
        reason: feetOk && headOk
            ? "ok"
            : `collision feet=${blockId(feetBlock)}:${feetOk} head=${blockId(headBlock)}:${headOk}`,
    };
}

function makeCollisionCandidatesFromHit(hit) {
    const b = hit.block;
    const loc = b.location;
    const face = String(hit.face ?? "Up");
    const n = FACE_OFFSETS[face] ?? { x: 0, y: 1, z: 0 };
    const candidates = [];

    if (face === "Down" || face === "down") {

        candidates.push({ x: loc.x, y: loc.y - 2, z: loc.z });
        candidates.push({ x: loc.x + 1, y: loc.y - 2, z: loc.z });
        candidates.push({ x: loc.x - 1, y: loc.y - 2, z: loc.z });
        candidates.push({ x: loc.x, y: loc.y - 2, z: loc.z + 1 });
        candidates.push({ x: loc.x, y: loc.y - 2, z: loc.z - 1 });
        candidates.push({ x: loc.x, y: loc.y - 3, z: loc.z });
        return candidates;
    }

    if (face === "Up" || face === "up") {

        candidates.push({ x: loc.x, y: loc.y + 1, z: loc.z });
        candidates.push({ x: loc.x, y: loc.y + 2, z: loc.z });
        return candidates;
    }

    const base = { x: loc.x + n.x, y: loc.y, z: loc.z + n.z };
    candidates.push(base);
    candidates.push({ x: base.x, y: base.y - 1, z: base.z });
    candidates.push({ x: base.x, y: base.y + 1, z: base.z });
    candidates.push({ x: base.x, y: base.y - 2, z: base.z });
    return candidates;
}

function findCollisionTeleportLocationInfo(player, hit) {
    if (!hit?.block) return { tp: undefined, reason: "no_hit" };
    const dim = player.dimension;
    let lastReason = "no_collision_candidate";

    for (const c of makeCollisionCandidatesFromHit(hit)) {
        const ex = explainCollisionTeleportFeet(dim, c);
        if (ex.ok) {
            return {
                tp: candidateToLocation(c),
                reason: "collision_ok",
                candidate: c,
                ex,
            };
        }
        lastReason = `${c.x},${c.y},${c.z} ${ex.reason}`;
    }

    return { tp: undefined, reason: lastReason };
}

function getViewDirection(player) {
    try { return player.getViewDirection(); } catch { return undefined; }
}

function getEyeLocation(player) {
    try { return player.getHeadLocation(); } catch {}
    try {
        const l = player.location;
        return { x: l.x, y: l.y + 1.62, z: l.z };
    } catch { return undefined; }
}

function faceFromPreviousCell(prev, cur) {
    if (!prev) return "Up";
    const dx = prev.x - cur.x;
    const dy = prev.y - cur.y;
    const dz = prev.z - cur.z;
    if (dy > 0) return "Up";
    if (dy < 0) return "Down";
    if (dx > 0) return "East";
    if (dx < 0) return "West";
    if (dz > 0) return "South";
    if (dz < 0) return "North";
    return "Up";
}

function customRaycastBlock(player, maxDistance) {
    const dim = player.dimension;
    const origin = getEyeLocation(player);
    const dir = getViewDirection(player);
    if (!origin || !dir) return undefined;

    let lastCellKey = "";
    let prevCell;
    const step = maxDistance > 80 ? 0.75 : 0.5;

    for (let d = 0.5; d <= maxDistance; d += step) {
        const cell = {
            x: Math.floor(origin.x + dir.x * d),
            y: Math.floor(origin.y + dir.y * d),
            z: Math.floor(origin.z + dir.z * d),
        };
        const key = `${cell.x},${cell.y},${cell.z}`;
        if (key === lastCellKey) continue;
        lastCellKey = key;

        const block = blockAt(dim, cell.x, cell.y, cell.z);
        if (!block) {
            prevCell = cell;
            continue;
        }
        if (isRayIgnoredBlock(block)) {
            prevCell = cell;
            continue;
        }

        return { block, face: faceFromPreviousCell(prevCell, block.location) };
    }
    return undefined;
}

function getViewHit(player, maxDistance) {

    try {
        const hit = player.getBlockFromViewDirection({
            maxDistance,
            includeLiquidBlocks: false,
            includePassableBlocks: false,
        });
        if (hit?.block) return hit;
    } catch {}

    return customRaycastBlock(player, maxDistance);
}

function explainSafeAirTeleportFeet(dim, feet) {
    const feetBlock = blockAt(dim, feet.x, feet.y, feet.z);
    const headBlock = blockAt(dim, feet.x, feet.y + 1, feet.z);
    const feetOk = isPassableForTeleport(feetBlock);
    const headOk = isPassableForTeleport(headBlock);
    return {
        ok: feetOk && headOk,
        reason: feetOk && headOk ? "ok" : `air feet=${blockId(feetBlock)}:${feetOk} head=${blockId(headBlock)}:${headOk}`,
    };
}

function isSafeAirTeleportFeet(dim, feet) {
    return explainSafeAirTeleportFeet(dim, feet).ok;
}

function findAirFallbackLocationInfo(player, distanceBlocks) {
    const dir = getViewDirection(player);
    if (!dir) return { tp: undefined, reason: "no_direction" };
    const origin = player.location;
    const dim = player.dimension;
    let lastReason = "no_candidate";
    for (let d = distanceBlocks; d >= 2; d--) {
        const feet = {
            x: Math.floor(origin.x + dir.x * d),
            y: Math.floor(origin.y + dir.y * d),
            z: Math.floor(origin.z + dir.z * d),
        };
        const ex = explainSafeAirTeleportFeet(dim, feet);
        if (ex.ok) return { tp: { x: feet.x + 0.5, y: feet.y, z: feet.z + 0.5 }, reason: "ok", distance: d, feet };
        lastReason = `${d}m ${feet.x},${feet.y},${feet.z} ${ex.reason}`;
    }
    return { tp: undefined, reason: lastReason };
}

function findAirFallbackLocation(player, distanceBlocks) {
    return findAirFallbackLocationInfo(player, distanceBlocks).tp;
}

function distance(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function spawnDarkPreviewParticles(dim, loc, ok) {

    try {
        dim.spawnParticle(ok ? "minecraft:basic_flame_particle" : "minecraft:basic_smoke_particle", {
            x: loc.x,
            y: loc.y + 0.35,
            z: loc.z,
        });
    } catch {}
}

function spawnTeleportTrail(dim, from, to) {
    try {
        const start = { x: from.x, y: from.y + 0.95, z: from.z };
        const end = { x: to.x, y: to.y + 0.95, z: to.z };
        const dist = distance(start, end);

        const steps = Math.max(4, Math.min(18, Math.floor(dist / 5)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const p = {
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
                z: start.z + (end.z - start.z) * t,
            };
            try { dim.spawnParticle("minecraft:endrod", p); } catch {}
        }
    } catch {}
}

function playSoundForPlayerNow(player, sound, label = "self", volume = 1.0, pitch = 1.0) {

    try {
        player.runCommand(`playsound ${sound} @s ~ ~ ~ ${volume} ${pitch} 1.0`);
        return true;
    } catch {
        return false;
    }
}

function playTeleportSounds(dim, from, to, player) {
    const primary = "mob.endermen.portal";

    system.runTimeout(() => {
        try {
            if (!player?.isValid) return;
            playSoundForPlayerNow(player, primary, "single4", 1.0, 1.0);
        } catch {}
    }, 4);
}

function resolveTarget(player, cfg) {
    const hit = getViewHit(player, cfg.maxDistance);
    if (hit?.block) {
        const info = findSafeTeleportLocationInfo(player, hit);
        const b = hit.block;
        if (info.tp) {
            return {
                hit,
                tp: info.tp,
                previewLoc: info.tp,
                mode: "block",
                reason: info.reason,
                debug: `hit=${blockId(b)} face=${String(hit.face ?? "?")} tp=ok ${info.reason}`,
            };
        }

        const collision = findCollisionTeleportLocationInfo(player, hit);
        if (collision.tp) {
            return {
                hit,
                tp: collision.tp,
                previewLoc: collision.tp,
                mode: "collision",
                reason: collision.reason,
                debug: `hit=${blockId(b)} face=${String(hit.face ?? "?")} tp=collision ${collision.reason}`,
            };
        }

        const previewLoc = { x: b.location.x + 0.5, y: b.location.y + 1.05, z: b.location.z + 0.5 };
        return {
            hit,
            tp: undefined,
            previewLoc,
            mode: "block",
            reason: `${info.reason}; ${collision.reason}`,
            debug: `hit=${blockId(b)} face=${String(hit.face ?? "?")} tp=ng ${info.reason}; ${collision.reason}`,
        };
    }
    if (cfg.tier === 3 && cfg.airFallbackDistance) {
        const info = findAirFallbackLocationInfo(player, cfg.airFallbackDistance);
        if (info.tp) return { hit: undefined, tp: info.tp, previewLoc: info.tp, mode: "air", reason: info.reason, debug: `air_fallback=${info.distance}m` };
        return { hit: undefined, tp: undefined, previewLoc: undefined, mode: "none", reason: info.reason, debug: `no_hit air_ng ${info.reason}` };
    }
    return { hit: undefined, tp: undefined, previewLoc: undefined, mode: "none", reason: "no_hit", debug: "no_hit" };
}

function canPayCost(player, cfg) {
    if ((cfg.waterDelta ?? 0) < 0) {
        const water = Number(player.getDynamicProperty("water_level") ?? 7);
        if (water < Math.abs(cfg.waterDelta)) {
            setImportant(player, `§c水分が足りません §7(${water}/${Math.abs(cfg.waterDelta)})`, IMPORTANT_TICKS);
            try { player.playSound("note.bass"); } catch {}
            return false;
        }
    }
    return true;
}

function applyUseCostAndRewards(player, cfg) {
    const now = system.currentTick;
    try {
        let water = Number(player.getDynamicProperty("water_level") ?? 7);
        water = Math.max(0, Math.min(10, water + (cfg.waterDelta ?? 0)));
        player.setDynamicProperty("water_level", water);
    } catch {}

    try {
        const adv = Number(cfg.vitalityTimerAdvance ?? 0);
        if (adv > 0) {
            const timer = Number(player.getDynamicProperty("vitality_timer") ?? 0);
            player.setDynamicProperty("vitality_timer", Math.max(0, timer - adv));
        }
    } catch {}

    if (cfg.tier === 3) {
        try {
            const vitality = Number(player.getDynamicProperty("vitality") ?? 5);
            player.setDynamicProperty("vitality", Math.min(9, vitality + 1));
        } catch {}
        try { player.setDynamicProperty("coolant_heat_until", now + 30 * 20); } catch {}
        try { player.setDynamicProperty("coolant_heat_drain_remaining", 0); } catch {}
        try { player.setDynamicProperty("heat_accel_wet_until", now + 30 * 20); } catch {}
        try { player.setDynamicProperty("heat_accel_wet_drain_remaining", 0); } catch {}
        try { player.setDynamicProperty("shift_void_block_until", now + 15 * 20); } catch {}
        for (const key of ["heat", "wetness", "void_pressure"]) {
            try {
                const v = Number(player.getDynamicProperty(key) ?? 0);
                player.setDynamicProperty(key, Math.max(0, v - 1));
            } catch {}
        }
    }

    if ((cfg.damage ?? 0) > 0) {
        try { player.applyDamage(cfg.damage, { cause: "magic" }); } catch {}
    }

    for (const e of cfg.effects ?? []) {
        try { player.addEffect(e.id, Math.max(1, Math.round(e.seconds * 20)), { amplifier: e.amplifier, showParticles: true }); } catch {}
    }
}

function previewShiftTyelya(player, cfg) {
    const target = resolveTarget(player, cfg);
    if (!target.previewLoc) {
        showAction(player, `§5${cfg.label} §8| §7転移先: §8なし`);
        debugLog(player, target.debug ?? "no preview");
        return;
    }
    spawnDarkPreviewParticles(player.dimension, target.previewLoc, !!target.tp);
    const dist = distance(player.location, target.previewLoc).toFixed(1);
    if (target.tp) {
        const mode = target.mode === "air" ? "空間" : (target.mode === "collision" ? "衝突" : "転移先");
        showAction(player, `§5${cfg.label} §8| §d${mode}: §f${dist}m §7右クリックで転移`);
    } else {
        showAction(player, `§5${cfg.label} §8| §c転移不可: §f${dist}m §7空間不足`);
        debugLog(player, target.debug ?? "preview ng");
    }
}

function executeShiftTyelya(player, cfg) {
    const now = system.currentTick;
    const until = cooldownUntil.get(player.id) ?? 0;
    if (now < until) {
        const sec = Math.ceil((until - now) / 20);
        setImportant(player, `§c転移再使用まで ${sec}秒`, IMPORTANT_TICKS);
        try { player.playSound("note.bass"); } catch {}
        return;
    }

    if (!canPayCost(player, cfg)) return;

    const target = resolveTarget(player, cfg);
    if (!target.hit?.block && target.mode !== "air") {
        setImportant(player, `§c転移先の距離が足りません §7(${cfg.maxDistance}m以内のブロックを見てください)`, IMPORTANT_TICKS);
        try { player.playSound("note.bass"); } catch {}
        return;
    }
    if (!target.tp) {
        setImportant(player, "§c転移先に立てる空間がありません", IMPORTANT_TICKS);
        debugLog(player, target.debug ?? "execute no tp");
        try { player.playSound("note.bass"); } catch {}
        return;
    }

    const from = { ...player.location };
    const rot = player.getRotation();
    try {
        const dim = player.dimension;
        dim.spawnParticle("minecraft:endrod", { x: from.x, y: from.y + 0.5, z: from.z });
        spawnTeleportTrail(dim, from, target.tp);
        player.teleport(target.tp, {
            dimension: dim,
            rotation: rot,
            keepVelocity: false,

            checkForBlocks: false,
        });
        system.run(() => {
            try {
                spawnDarkPreviewParticles(dim, target.tp, true);
                playTeleportSounds(dim, from, target.tp, player);
            } catch {}
        });
        applyUseCostAndRewards(player, cfg);
        if (target.mode === "collision") {
            try { player.addEffect("slow_falling", 30, { amplifier: 0, showParticles: true }); } catch {}
        }
        if (cfg.cooldown > 0) cooldownUntil.set(player.id, now + cfg.cooldown);
        const dist = distance(from, target.tp).toFixed(1);
        setImportant(player, `§d転移しました §7(${dist}m)`, IMPORTANT_TICKS);
        debugLog(player, `success mode=${target.mode} dist=${dist} ${target.debug ?? ""}`);
    } catch (e) {
        setImportant(player, `§c転移失敗: ${e}`, IMPORTANT_TICKS);
        try { player.playSound("note.bass"); } catch {}
    }
}

world.afterEvents.itemUse.subscribe((event) => {
    try {
        const player = event.source;
        if (!player || player.typeId !== "minecraft:player") return;
        const cfg = SHIFT_TIERS[event.itemStack?.typeId ?? ""];
        if (!cfg) return;
        executeShiftTyelya(player, cfg);
    } catch (e) {
        console.warn(`[ShiftTyelya] itemUse failed: ${e}`);
    }
});

function upgradeShiftTyelya(dimension, rodEntity, fragmentEntity) {
    const loc = safeGetLocation(rodEntity);
    const rod = safeGetItemStack(rodEntity);
    const fragment = safeGetItemStack(fragmentEntity);
    if (!loc || !rod || !fragment) return false;
    const cfg = SHIFT_TIERS[rod.typeId];
    if (!cfg?.next || fragment.typeId !== PORTALSHIFT_FRAGMENT_ID) return false;

    let result;
    try { result = new ItemStack(cfg.next, 1); } catch { return false; }
    try {
        safeRemove(rodEntity);
        consumeOneItemEntity(dimension, fragmentEntity, loc);
        dimension.spawnItem(result, loc);
        dimension.spawnParticle("minecraft:trial_omen_emitter", { x: loc.x, y: loc.y + 0.2, z: loc.z });
        dimension.spawnParticle("minecraft:shriek_particle", { x: loc.x, y: loc.y + 0.35, z: loc.z });
        dimension.playSound("mob.endermen.portal", loc);
        return true;
    } catch { return false; }
}

function craftPortalshiftFragment(dimension, overloadEntity, elytraEntity) {
    const loc = safeGetLocation(overloadEntity);
    const overload = safeGetItemStack(overloadEntity);
    const elytra = safeGetItemStack(elytraEntity);
    if (!loc || !overload || !elytra) return false;
    if (overload.typeId !== OVERLOAD_FRAGMENT_ID || elytra.typeId !== "minecraft:elytra") return false;
    let result;
    try { result = new ItemStack(PORTALSHIFT_FRAGMENT_ID, 1); } catch { return false; }
    try {
        consumeOneItemEntity(dimension, overloadEntity, loc);
        safeRemove(elytraEntity);
        dimension.spawnItem(result, loc);
        dimension.spawnParticle("minecraft:trial_omen_emitter", { x: loc.x, y: loc.y + 0.25, z: loc.z });
        dimension.playSound("mob.endermen.portal", loc);
        return true;
    } catch { return false; }
}

function scanDropCrafts() {
    for (const dimensionId of DIMENSION_IDS) {
        let dimension;
        try { dimension = world.getDimension(dimensionId); } catch { continue; }
        let itemEntities = [];
        try { itemEntities = dimension.getEntities({ type: "minecraft:item" }); } catch { continue; }

        for (const entity of itemEntities) {
            try {
                if (!safeEntity(entity)) continue;
                const stack = safeGetItemStack(entity);
                if (!stack || stack.typeId !== OVERLOAD_FRAGMENT_ID) continue;
                const loc = safeGetLocation(entity);
                if (!loc) continue;
                const nearby = dimension.getEntities({ type: "minecraft:item", location: loc, maxDistance: DROP_CRAFT_DISTANCE });
                for (const other of nearby) {
                    if (!safeEntity(other)) continue;
                    try { if (other.id === entity.id) continue; } catch { continue; }
                    const otherStack = safeGetItemStack(other);
                    if (otherStack?.typeId === "minecraft:elytra") {
                        if (craftPortalshiftFragment(dimension, entity, other)) break;
                    }
                }
            } catch {}
        }

        try { itemEntities = dimension.getEntities({ type: "minecraft:item" }); } catch { continue; }

        for (const entity of itemEntities) {
            try {
                if (!safeEntity(entity)) continue;
                const stack = safeGetItemStack(entity);
                if (!stack || !SHIFT_TIERS[stack.typeId]) continue;
                const loc = safeGetLocation(entity);
                if (!loc) continue;
                const nearby = dimension.getEntities({ type: "minecraft:item", location: loc, maxDistance: DROP_CRAFT_DISTANCE });
                for (const other of nearby) {
                    if (!safeEntity(other)) continue;
                    try { if (other.id === entity.id) continue; } catch { continue; }
                    const otherStack = safeGetItemStack(other);
                    if (otherStack?.typeId === PORTALSHIFT_FRAGMENT_ID) {
                        if (upgradeShiftTyelya(dimension, entity, other)) break;
                    }
                }
            } catch {}
        }
    }
}

system.runInterval(scanDropCrafts, DROP_CRAFT_INTERVAL);

export function tickShiftTyelya(player) {
    try {
        const activeUntil = importantUntil.get(player.id) ?? 0;
        if (system.currentTick <= activeUntil) {
            const text = importantText.get(player.id);
            if (text) showAction(player, text);
            return;
        }
        const cfg = getHeldShiftConfig(player);
        if (!cfg) return;
        if (system.currentTick - lastPreviewTick < PREVIEW_INTERVAL) return;
        previewShiftTyelya(player, cfg);
    } catch {}
}

system.run(() => console.warn("[ShiftTyelya] loaded."));
