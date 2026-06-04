import { world, system } from "@minecraft/server";
import { syncHud } from "./ui_sync.js";
import { getAdjustedVitalityDuration, getNetheriteIndomitableThreshold, hasNetheriteSetBonus } from "./system_netherite.js";
import { safeSubscribe, debugWarn } from "./debug.js";
import {
    hasVoidPressureEffect,
    getEffectiveVoidPressure,
    getVitalityDrainMultiplier,
    getVitalityCap,
    getWaterCap,
    getWaterRecoveryAmount,
    getHeatAccelerationWetDurationTicks,
} from "./system_end.js";

export const VITALITY_DURATIONS = {
    0: 0,
    1: 20000,
    2: 12000,
    3: 11500,
    4: 11000,
    5: 8400,
    6: 7000,
    7: 6500,
    8: 6000,
    9: 5000,
    10: 1200,
};

export const HYDRATION_DROP_TICKS = 75 * 20;
const RESPAWN_HYDRATION_GRACE_TICKS = 5 * 20;
const HUNGER_RECOVERY_INTERVAL_TICKS = 60 * 20;

const DEFAULT_STATE = {
    vitality: 5,
    vitalityTimer: VITALITY_DURATIONS[5],
    water: 7,
    hydrationTimer: HYDRATION_DROP_TICKS,
    heat: 0,
    wetness: 0,
};

const VITALITY_MEDICINE_IDS = new Set([
    "pls:vitality_restorer",
    "pls:positive_tonic",
    "pls:stimulants",
    "pls:high_stimulants",
]);

const END_SPECIAL_USABLE_IDS = new Set([
    "pls:mania_saturation",
    "pls:mania_ignition",
    "pls:mania_gravity",
    "pls:mania_infinity",
    "pls:mania_corrosion",
    "pls:mania_remover",
]);

function vitalityDuration(player, level) {
    return getAdjustedVitalityDuration(player, VITALITY_DURATIONS[level] ?? 0);
}

function setDefaultState(player) {
    player.setDynamicProperty("vitality", DEFAULT_STATE.vitality);
    player.setDynamicProperty("vitality_timer", DEFAULT_STATE.vitalityTimer);
    player.setDynamicProperty("water_level", DEFAULT_STATE.water);
    player.setDynamicProperty("hydration_timer", DEFAULT_STATE.hydrationTimer);
    player.setDynamicProperty("heat", DEFAULT_STATE.heat);
    player.setDynamicProperty("wetness", DEFAULT_STATE.wetness);
    player.setDynamicProperty("dbg_wet_tier", -1);
    player.setDynamicProperty("dbg_heat_tier", -1);
    player.setDynamicProperty("wetness_fog_active", false);
    player.setDynamicProperty("hydration_damage_grace_until", system.currentTick + RESPAWN_HYDRATION_GRACE_TICKS);
    player.setDynamicProperty("state_alert_heat_tier", 0);
    player.setDynamicProperty("state_alert_wet_tier", 0);
}

function removeWetnessFog(player) {
    try {
        player.runCommand("fog @s remove shc_wetness_haze");
    } catch {}
}

export function initializePlayerState(player) {
    try {
        if (player.getDynamicProperty("vitality") === undefined) {
            player.setDynamicProperty("vitality", DEFAULT_STATE.vitality);
        }
        if (player.getDynamicProperty("vitality_timer") === undefined) {
            player.setDynamicProperty("vitality_timer", DEFAULT_STATE.vitalityTimer);
        }

        if (player.getDynamicProperty("water_level") === undefined) {
            player.setDynamicProperty("water_level", DEFAULT_STATE.water);
        }
        if (player.getDynamicProperty("hydration_timer") === undefined) {
            player.setDynamicProperty("hydration_timer", DEFAULT_STATE.hydrationTimer);
        }

        if (player.getDynamicProperty("heat") === undefined) {
            player.setDynamicProperty("heat", DEFAULT_STATE.heat);
        }
        if (player.getDynamicProperty("wetness") === undefined) {
            player.setDynamicProperty("wetness", DEFAULT_STATE.wetness);
        }
        if (player.getDynamicProperty("wetness_fog_active") === undefined) {
            player.setDynamicProperty("wetness_fog_active", false);
        }
        if (player.getDynamicProperty("hydration_damage_grace_until") === undefined) {
            player.setDynamicProperty("hydration_damage_grace_until", 0);
        }
        if (player.getDynamicProperty("coolant_heat_until") === undefined) {
            player.setDynamicProperty("coolant_heat_until", 0);
        }
        if (player.getDynamicProperty("coolant_heat_drain_remaining") === undefined) {
            player.setDynamicProperty("coolant_heat_drain_remaining", 0);
        }
        if (player.getDynamicProperty("heat_accel_wet_until") === undefined) {
            player.setDynamicProperty("heat_accel_wet_until", 0);
        }
        if (player.getDynamicProperty("heat_accel_wet_drain_remaining") === undefined) {
            player.setDynamicProperty("heat_accel_wet_drain_remaining", 0);
        }
    } catch (e) {
        console.warn(`[Init Player State Error] ${player.name}: ${e}`);
        debugWarn(`initializePlayerState failed for ${player.name}: ${e}`);
    }
}

export function resetPlayerStateAfterDeath(player) {
    try {
        setDefaultState(player);
        removeWetnessFog(player);
        syncHud(player);

        system.runTimeout(() => {
            try {
                setDefaultState(player);
                removeWetnessFog(player);
                syncHud(player);
            } catch {}
        }, 1);

        debugWarn(`[Respawn Reset] ${player.name}: heat/wetness/water/vitality reset to defaults.`);
    } catch (e) {
        console.warn(`[Reset Player State Error] ${player.name}: ${e}`);
    }
}

safeSubscribe(world.afterEvents?.playerSpawn, "afterEvents.playerSpawn", (event) => {
    const player = event.player;
    if (event.initialSpawn) {
        initializePlayerState(player);
        system.run(() => syncHud(player));
        return;
    }

    resetPlayerStateAfterDeath(player);
});

function isAllowedAtVitalityOne(typeId) {
    return VITALITY_MEDICINE_IDS.has(typeId) || END_SPECIAL_USABLE_IDS.has(typeId);
}

function getMedicineUseError(typeId, vitality) {
    if (!VITALITY_MEDICINE_IDS.has(typeId)) return "";

    if (typeId === "pls:vitality_restorer") {
        return vitality < 5 ? "" : "§c気力修復剤は気力5未満の時だけ使用できます。";
    }

    if (vitality < 5) {
        return "§c気力5未満では気力修復剤だけ使用できます。";
    }

    if (typeId === "pls:positive_tonic") {
        return vitality >= 5 && vitality <= 8 ? "" : "§c活力剤は気力5〜8の時だけ使用できます。";
    }

    if (typeId === "pls:stimulants") {
        return vitality >= 5 && vitality <= 9 ? "" : "§c覚醒剤は気力5〜9の時だけ使用できます。";
    }

    if (typeId === "pls:high_stimulants") {
        return vitality >= 5 ? "" : "§c超覚醒剤は気力5以上の時だけ使用できます。";
    }

    return "";
}

function cancelUse(event, message, showMessage = true) {
    event.cancel = true;
}

safeSubscribe(world.beforeEvents?.itemUse, "beforeEvents.itemUse", (event) => {
    const vitality = Number(event.source.getDynamicProperty("vitality") ?? 5);
    const typeId = event.itemStack?.typeId ?? "";

    const medicineError = getMedicineUseError(typeId, vitality);
    if (medicineError) {
        cancelUse(event, medicineError);
        return;
    }

    if (vitality <= 1 && !isAllowedAtVitalityOne(typeId)) {
        cancelUse(event, "§c絶望により専用の気力回復薬以外を使用できない！");
    }
});

safeSubscribe(world.beforeEvents?.itemUseOn, "beforeEvents.itemUseOn", (event) => {
    const vitality = Number(event.source.getDynamicProperty("vitality") ?? 5);
    const typeId = event.itemStack?.typeId ?? "";

    const medicineError = getMedicineUseError(typeId, vitality);
    if (medicineError) {
        event.cancel = true;
        return;
    }

    if (vitality <= 1 && !isAllowedAtVitalityOne(typeId)) {
        event.cancel = true;
    }
});

safeSubscribe(world.beforeEvents?.playerPlaceBlock, "beforeEvents.playerPlaceBlock", (event) => {
    const player = event.player;
    const vitality = Number(player.getDynamicProperty("vitality") ?? 5);
    if (vitality <= 1) {
        event.cancel = true;
        system.run(() => {
            player.onScreenDisplay.setActionBar("§c絶望によりブロックを設置できない！");
        });
    }
});

function applyLowVitalityPhysics(player, vitality) {
    try {
        const velocity = player.getVelocity();

        if (vitality <= 3) {
            const airbornePull = vitality <= 2 ? -0.085 : -0.055;
            const jumpCut = vitality <= 2 ? -0.055 : -0.035;

            if (!player.isOnGround) {
                player.applyImpulse({ x: 0, y: airbornePull, z: 0 });
            } else if (player.isJumping && system.currentTick % 2 === 0) {
                player.applyImpulse({ x: 0, y: jumpCut, z: 0 });
            }
        }
    } catch (e) {
        debugWarn(`low vitality physics failed for ${player.name}: ${e}`);
    }
}

export function tickVitality(player) {
    let vitality = Number(player.getDynamicProperty("vitality") ?? DEFAULT_STATE.vitality);
    let vitTimer = Number(player.getDynamicProperty("vitality_timer") ?? DEFAULT_STATE.vitalityTimer);
    let water = Number(player.getDynamicProperty("water_level") ?? DEFAULT_STATE.water);
    let hydTimer = Number(player.getDynamicProperty("hydration_timer") ?? DEFAULT_STATE.hydrationTimer);
    const heat = Number(player.getDynamicProperty("heat") ?? DEFAULT_STATE.heat);
    const voidPressure = getEffectiveVoidPressure(player);
    const vitalityDrainMultiplier = getVitalityDrainMultiplier(player);
    const vitalityCap = getVitalityCap(player);
    const waterCap = getWaterCap(player);
    const hydrationGraceUntil = Number(player.getDynamicProperty("hydration_damage_grace_until") ?? 0);
    const hydrationDamageSuppressed = system.currentTick <= hydrationGraceUntil;

    if (hydrationDamageSuppressed) {
        if (water < DEFAULT_STATE.water) water = DEFAULT_STATE.water;
        if (hydTimer <= 0) hydTimer = DEFAULT_STATE.hydrationTimer;
    }

    if (water > waterCap) water = waterCap;
    if (vitality > vitalityCap) {
        vitality = vitalityCap;
        vitTimer = vitalityDuration(player, vitality);
    }

    let hydMultiplier = 1;
    if (heat >= 100) hydMultiplier = 25;
    else if (heat >= 80) hydMultiplier = 10;
    else if (heat >= 65) hydMultiplier = 4;
    else if (heat >= 30) hydMultiplier = 3;
    else if (heat >= 10) hydMultiplier = 1.5;

    if (vitality >= 7) hydMultiplier *= 0.5;

    const hydrationPauseUntil = Number(player.getDynamicProperty("netherite_hydration_pause_until") ?? 0);
    if (!hasNetheriteSetBonus(player, 1) || system.currentTick > hydrationPauseUntil) {
        hydTimer -= hydMultiplier;
    }
    if (hydTimer <= 0) {
        if (water > 0) {
            water -= 1;
            hydTimer = HYDRATION_DROP_TICKS;
        } else {
            hydTimer = 0;
        }
    }

    if (!hydrationDamageSuppressed && water === 0 && system.currentTick % 40 === 0) {
        try {
            player.applyDamage(4, { cause: "starve" });
        } catch (e) {
            debugWarn(`hydration damage failed for ${player.name}: ${e}`);
        }
    }

    vitTimer -= vitalityDrainMultiplier;
    if (vitTimer <= 0 && vitality > 0) {
        vitality -= 1;
        vitTimer = vitalityDuration(player, vitality);
    }

    if (hasNetheriteSetBonus(player, 1) && vitality < 5) {
        vitality = 5;
        if (vitTimer <= 0) vitTimer = vitalityDuration(player, vitality);
    }

    applyLowVitalityPhysics(player, vitality);

    if (vitality >= 6 && system.currentTick % HUNGER_RECOVERY_INTERVAL_TICKS === 0) {
        try {
            player.runCommand("effect @s saturation 1 2 true");
        } catch (e) {
            debugWarn(`hunger recovery failed for ${player.name}: ${e}`);
        }
    }

    if (vitality <= 2 && system.currentTick % 100 === 0) {
        try {
            const inv = player.getComponent("minecraft:inventory")?.container;
            if (inv) {
                const slot1 = Math.floor(Math.random() * 9);
                const slot2 = Math.floor(Math.random() * 9);
                const item1 = inv.getItem(slot1);
                const item2 = inv.getItem(slot2);
                inv.setItem(slot1, item2);
                inv.setItem(slot2, item1);
            }
        } catch (e) {
            debugWarn(`hotbar shuffle failed for ${player.name}: ${e}`);
        }
    }

    if (system.currentTick % 20 === 0) {
        try {
            if (vitality === 10) {
                const debuffs = [
                    "slowness",
                    "hunger",
                    "weakness",
                    "mining_fatigue",
                    "nausea",
                    "blindness",
                    "darkness",
                    "poison",
                    "wither",
                    "fatal_poison",
                ];
                debuffs.forEach((d) => {
                    try { player.removeEffect(d); } catch {}
                });
                removeWetnessFog(player);
                player.setDynamicProperty("wetness_fog_active", false);
                player.addEffect("strength", 40, { amplifier: 2, showParticles: false });
                player.addEffect("haste", 40, { amplifier: 2, showParticles: false });
                player.addEffect("resistance", 40, { amplifier: 1, showParticles: false });
            }

            if (vitality >= 9) {
                player.addEffect("regeneration", 40, { amplifier: 1, showParticles: false });
            }
            if (vitality >= 8) {
                player.addEffect("jump_boost", 40, { amplifier: 1, showParticles: false });
            }
            if (vitality >= 7) {
                player.addEffect("health_boost", 40, { amplifier: 2, showParticles: false });
                player.addEffect("speed", 40, { amplifier: 0, showParticles: false });
            }
            if (vitality === 6) {
                player.addEffect("strength", 40, { amplifier: 0, showParticles: false });
            }
            if (vitality === 0) {
                player.addEffect("wither", 40, { amplifier: 0, showParticles: false });
            }
        } catch (e) {
            debugWarn(`vitality effects failed for ${player.name}: ${e}`);
        }
    }

    player.setDynamicProperty("water_level", water);
    player.setDynamicProperty("hydration_timer", hydTimer);
    player.setDynamicProperty("vitality", vitality);
    player.setDynamicProperty("vitality_timer", vitTimer);
}

safeSubscribe(world.afterEvents?.playerBreakBlock, "afterEvents.playerBreakBlock", (event) => {
    const vitality = Number(event.player.getDynamicProperty("vitality") ?? DEFAULT_STATE.vitality);
    if (hasNetheriteSetBonus(event.player, 1)) return;
    if (vitality >= 7) return;

    const hydTimer = Number(event.player.getDynamicProperty("hydration_timer") ?? DEFAULT_STATE.hydrationTimer);
    event.player.setDynamicProperty("hydration_timer", Math.max(0, hydTimer - 15));
});

safeSubscribe(world.afterEvents?.entityHitEntity, "afterEvents.entityHitEntity", (event) => {
    if (event.damagingEntity.typeId !== "minecraft:player") return;

    const vitality = Number(event.damagingEntity.getDynamicProperty("vitality") ?? DEFAULT_STATE.vitality);
    if (hasNetheriteSetBonus(event.damagingEntity, 1)) return;
    if (vitality >= 7) return;

    const hydTimer = Number(event.damagingEntity.getDynamicProperty("hydration_timer") ?? DEFAULT_STATE.hydrationTimer);
    event.damagingEntity.setDynamicProperty("hydration_timer", Math.max(0, hydTimer - 20));
});

safeSubscribe(world.afterEvents?.entityHurt, "afterEvents.entityHurt", (event) => {
    const player = event.hurtEntity;
    const attacker = event.damageSource?.damagingEntity;

    if (player.typeId !== "minecraft:player") return;

    let vitality = Number(player.getDynamicProperty("vitality") ?? DEFAULT_STATE.vitality);
    const healthComp = player.getComponent("minecraft:health");

    if (vitality >= 9 && attacker) {
        system.runTimeout(() => {
            try {
                const v = player.getVelocity();
                player.applyImpulse({ x: -v.x * 0.55, y: 0, z: -v.z * 0.55 });
            } catch {}
        }, 1);
    }

    const cause = event.damageSource?.cause;
    const fallGuardUntil = Number(player.getDynamicProperty("fall_damage_extra_guard_until") ?? 0);
    if (cause === "fall" && system.currentTick > fallGuardUntil && healthComp) {
        if (vitality >= 8 && !hasVoidPressureEffect(player)) {

            try {
                const maxHealth = healthComp.effectiveMax ?? healthComp.defaultValue ?? 20;
                healthComp.setCurrentValue(Math.min(maxHealth, healthComp.currentValue + event.damage * 0.65));
            } catch (e) {
                debugWarn(`fall damage reduction failed for ${player.name}: ${e}`);
            }
        } else if (vitality === 4) {

            try {
                player.setDynamicProperty("fall_damage_extra_guard_until", system.currentTick + 2);
                system.run(() => {
                    try {
                        player.applyDamage(event.damage * 1.5, { cause: "fall" });
                    } catch {}
                });
            } catch (e) {
                debugWarn(`fall damage increase failed for ${player.name}: ${e}`);
            }
        }
    }

    if (vitality <= 3) {
        try {
            const inv = player.getComponent("minecraft:inventory")?.container;
            if (inv) {
                const randomSlot = Math.floor(Math.random() * inv.size);
                const itemToDrop = inv.getItem(randomSlot);
                if (itemToDrop) {
                    player.dimension.spawnItem(itemToDrop, player.location);
                    inv.setItem(randomSlot, undefined);
                    player.dimension.playSound("random.pop", player.location);
                }
            }
        } catch (e) {
            debugWarn(`random drop failed for ${player.name}: ${e}`);
        }
    }

    if (vitality >= getNetheriteIndomitableThreshold(player) && healthComp && healthComp.currentValue <= 6) {
        player.onScreenDisplay.setActionBar("§e【不屈の精神】極限の気力で死の淵から耐え抜いた！");
        try {
            player.addEffect("resistance", 100, { amplifier: 4, showParticles: true });
            player.addEffect("regeneration", 100, { amplifier: 3, showParticles: true });
            player.dimension.playSound("mob.totem.use", player.location);
        } catch {}

        vitality = 5;
        player.setDynamicProperty("vitality", vitality);
        player.setDynamicProperty("vitality_timer", vitalityDuration(player, 5));
        system.run(() => syncHud(player));
    }

    if (attacker) {
        let isMonster = false;
        try {
            if (typeof attacker.matches === "function") {
                isMonster = attacker.matches({ families: ["monster"] });
            }
        } catch {
            isMonster = false;
        }

        if (isMonster) {
            try {
                player.addEffect("weakness", 60, { amplifier: 0, showParticles: false });
                if (attacker.typeId.includes("zombie") || attacker.typeId.includes("spider")) {
                    player.addEffect("poison", 40, { amplifier: 1, showParticles: false });
                }

                const health = attacker.getComponent("minecraft:health");
                if (health) {
                    health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + 4));
                }
                attacker.addEffect("strength", 100, { amplifier: 1, showParticles: true });
            } catch (e) {
                debugWarn(`monster infection failed for ${player.name}: ${e}`);
            }
        }
    }

    system.run(() => syncHud(player));
});

safeSubscribe(world.afterEvents?.entityDie, "afterEvents.entityDie", (event) => {
    const player = event.deadEntity;
    if (!player || player.typeId !== "minecraft:player") return;

    const vitality = Number(player.getDynamicProperty("vitality") ?? DEFAULT_STATE.vitality);
    if (vitality <= 3 && vitality >= 2) {
        try {
            const loc = player.location;
            player.dimension.spawnEntity("minecraft:lightning_bolt", loc);
        } catch (e) {
            try {
                player.runCommand("summon lightning_bolt ~ ~ ~");
            } catch {}
            debugWarn(`death lightning failed for ${player.name}: ${e}`);
        }
    }
});

function isWaterBottle(item) {
    if (!item || item.typeId !== "minecraft:potion") return false;

    try {
        const potion = item.getComponent("minecraft:potion");
        const effectId = potion?.potionEffectType?.id ?? "";
        return effectId === "minecraft:water" || effectId === "water";
    } catch (e) {
        debugWarn(`water bottle detection failed: ${e}`);
        return false;
    }
}

safeSubscribe(world.afterEvents?.itemCompleteUse, "afterEvents.itemCompleteUse", (event) => {
    const { source: player, itemStack: item } = event;
    if (player.typeId !== "minecraft:player") return;

    let water = Number(player.getDynamicProperty("water_level") ?? DEFAULT_STATE.water);
    let vit = Number(player.getDynamicProperty("vitality") ?? DEFAULT_STATE.vitality);
    let changed = false;

    if (item.typeId === "pls:water_bottle") {
        const baseRecovery = vit >= 7 ? 8 : 5;
        const waterRecovery = getWaterRecoveryAmount(player, baseRecovery);
        water = Math.min(getWaterCap(player), water + waterRecovery);
        player.setDynamicProperty("water_level", water);
        if (hasNetheriteSetBonus(player, 1)) {
            player.setDynamicProperty("netherite_hydration_pause_until", system.currentTick + 120 * 20);
        }
        changed = true;
    }

    if (item.typeId.startsWith("pls:")) {
        if (item.typeId === "pls:vitality_restorer" && vit < 5) {
            vit = Math.min(5, vit + 2);
            player.setDynamicProperty("vitality", vit);
            player.setDynamicProperty("vitality_timer", vitalityDuration(player, vit));
            changed = true;
        } else if (item.typeId === "pls:positive_tonic" && vit >= 5 && vit <= 8) {
            vit = Math.min(9, vit + 1);
            player.setDynamicProperty("vitality", vit);
            player.setDynamicProperty("vitality_timer", vitalityDuration(player, vit));
            changed = true;
        } else if (item.typeId === "pls:stimulants" && vit >= 5 && vit <= 9) {
            vit = Math.min(10, vit + 2);
            player.setDynamicProperty("vitality", vit);
            player.setDynamicProperty("vitality_timer", vitalityDuration(player, vit));
            changed = true;
        } else if (item.typeId === "pls:high_stimulants" && vit >= 5) {
            vit = Math.min(10, vit + 5);
            player.setDynamicProperty("vitality", vit);
            player.setDynamicProperty("vitality_timer", vit === 10 ? vitalityDuration(player, 10) * 5 : vitalityDuration(player, vit));
            changed = true;
        } else if (item.typeId === "pls:coolant") {
            const heat = Number(player.getDynamicProperty("heat") ?? DEFAULT_STATE.heat);
            player.setDynamicProperty("heat", Math.max(0, heat - 15));
            player.setDynamicProperty("coolant_heat_until", system.currentTick + 90 * 20);
            player.setDynamicProperty("coolant_heat_drain_remaining", 15);
            changed = true;
        } else if (item.typeId === "pls:heat_acceleration") {
            const wetness = Number(player.getDynamicProperty("wetness") ?? DEFAULT_STATE.wetness);
            player.setDynamicProperty("wetness", Math.max(0, wetness - 25));
            const heatAccelWetDuration = getHeatAccelerationWetDurationTicks(player);
            player.setDynamicProperty("heat_accel_wet_until", system.currentTick + heatAccelWetDuration);
            player.setDynamicProperty("heat_accel_wet_drain_remaining", 15);
            player.setDynamicProperty("dbg_heat_accel_wet_active_until", system.currentTick + heatAccelWetDuration);
            changed = true;
        }
    }

    if (changed) {
        const cap = getVitalityCap(player);
        if (vit > cap) {
            vit = cap;
            player.setDynamicProperty("vitality", vit);
            player.setDynamicProperty("vitality_timer", vitalityDuration(player, vit));
        }
        const capWater = getWaterCap(player);
        const currentWater = Number(player.getDynamicProperty("water_level") ?? water);
        if (currentWater > capWater) player.setDynamicProperty("water_level", capWater);
        system.run(() => syncHud(player));
    }
});
