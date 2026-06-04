import { world, system, EquipmentSlot } from "@minecraft/server";
import { debugWarn } from "./debug.js";
import { shouldCapHeatByNetherite } from "./system_netherite.js";
import {
    hasVoidPressureEffect,
    getVoidPressureWetnessMultiplier,
    getWetnessBaseBonusSeconds,
    isWetnessBlockedByMania,
} from "./system_end.js";

const HEAT_TIMES = {
    nether: 0.5 * 20,
    desert: 1.3 * 20,
    jungle: 1.8 * 20,
    savanna: 3 * 20,
    normal: 7 * 20,
};

const WET_TIMES = {
    water: 1.2 * 20,
    shadow: 6 * 20,
    rain: 10 * 20,
};

const WET_FOG_IDENTIFIER = "shc:wetness_haze";
const WET_FOG_STACK_ID = "shc_wetness_haze";

function biomeGroupFromId(id) {
    const biomeId = String(id ?? "").toLowerCase();
    if (biomeId.includes("desert") || biomeId.includes("badlands") || biomeId.includes("mesa")) return "desert";
    if (biomeId.includes("jungle") || biomeId.includes("swamp")) return "jungle";
    if (biomeId.includes("savanna")) return "savanna";
    return "normal";
}

function getBiomeGroup(player) {
    if (player.dimension.id === "minecraft:nether") return "nether";

    try {
        const biome = player.dimension.getBiome(player.location);
        return biomeGroupFromId(biome?.id);
    } catch (e) {
        debugWarn(`[Biome] ${player.name}: getBiome failed, using normal heat speed. ${e}`);
        return "normal";
    }
}

const FULL_SET_DELAY_MULTIPLIER = {

    1: 1.6,
    2: 1.8,
    3: 2.2,
    4: 2.5,
    5: 3.0,
    6: 4.0,
    7: 5.0,
};

const ROMAN_TO_RANK = {
    "I": 1,
    "II": 2,
    "III": 3,
    "IV": 4,
    "V": 5,
    "VI": 6,
    "VII": 7,
};

const JAPANESE_TIER_TO_RANK = {
    "革": 1,
    "チェーン": 2,
    "銅": 3,
    "金": 4,
    "鉄": 5,
    "ダイヤ": 6,
    "ネザライト": 7,
};

const EQUIPMENT_SLOTS = [
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
];

function getProcessingLorePrefix(processingType) {
    return processingType === "waterproof"
        ? "§b防水加工"
        : "§c耐熱加工";
}

function parseProcessingRank(line, processingType) {
    if (typeof line !== "string") return 0;

    const plainPrefix = getProcessingLorePrefix(processingType);
    const bracketPrefix = processingType === "waterproof"
        ? "§b[防水加工"
        : "§c[耐熱加工";

    if (line.startsWith(plainPrefix)) {
        const suffix = line.slice(plainPrefix.length).trim();
        return ROMAN_TO_RANK[suffix] ?? 1;
    }

    if (line === `${bracketPrefix}]`) return 1;

    if (line.startsWith(`${bracketPrefix}:`) && line.endsWith("]")) {
        const label = line.slice(bracketPrefix.length + 1, -1).trim();
        return JAPANESE_TIER_TO_RANK[label] ?? 1;
    }

    return 0;
}

function getArmorProtection(player) {
    let heatPieces = 0;
    let wetPieces = 0;
    let heatBonus = 0;
    let wetBonus = 0;

    try {
        const equippable = player.getComponent("minecraft:equippable");
        if (!equippable || typeof equippable.getEquipment !== "function") {
            return {
                heatPieces,
                wetPieces,
                heatDelayMultiplier: 1,
                wetDelayMultiplier: 1,
                wetBaseBonusSeconds: 0,
            };
        }

        for (const slot of EQUIPMENT_SLOTS) {
            const item = equippable.getEquipment(slot);
            if (!item) continue;

            const lore = typeof item.getLore === "function" ? item.getLore() : [];

            const heatRank = lore.reduce(
                (max, line) => Math.max(max, parseProcessingRank(line, "heatproof")),
                0
            );
            if (heatRank > 0) {
                heatPieces++;
                const fullSetMultiplier = FULL_SET_DELAY_MULTIPLIER[heatRank] ?? FULL_SET_DELAY_MULTIPLIER[1];
                heatBonus += (fullSetMultiplier - 1) / 4;
            }

            const wetRank = lore.reduce(
                (max, line) => Math.max(max, parseProcessingRank(line, "waterproof")),
                0
            );
            if (wetRank > 0) {
                wetPieces++;
                const fullSetMultiplier = FULL_SET_DELAY_MULTIPLIER[wetRank] ?? FULL_SET_DELAY_MULTIPLIER[1];
                wetBonus += (fullSetMultiplier - 1) / 4;
            }
        }
    } catch {
        return {
            heatPieces: 0,
            wetPieces: 0,
            heatDelayMultiplier: 1,
            wetDelayMultiplier: 1,
            wetBaseBonusSeconds: 0,
        };
    }

    return {
        heatPieces,
        wetPieces,
        heatDelayMultiplier: 1 + heatBonus,
        wetDelayMultiplier: 1 + wetBonus,

        wetBaseBonusSeconds: wetPieces > 0 ? 0.3 : 0,
    };
}

function isUnderSky(player) {
    try {
        const headLocation = {
            x: player.location.x,
            y: player.location.y + 1.8,
            z: player.location.z,
        };

        const blockAbove = player.dimension.getBlockAbove(headLocation, {
            maxDistance: 384,
            includePassableBlocks: false,
            includeLiquidBlocks: false,
        });

        return !blockAbove;
    } catch {

        return true;
    }
}

function isWaterBlock(player) {
    try {
        if (typeof player.isInWater === "boolean") return player.isInWater;
    } catch {}

    try {
        const block = player.dimension.getBlock(player.location);
        if (!block) return false;
        return Boolean(block.typeId.includes("water") || block.isWaterlogged);
    } catch {
        return false;
    }
}

function isRaining(player) {
    try {
        if (typeof player.dimension.getWeather === "function") {
            const weather = player.dimension.getWeather();
            const id = String(weather?.id ?? weather ?? "").toLowerCase();
            return id.includes("rain") || id.includes("thunder");
        }
    } catch {}
    return false;
}

function applyWetFog(player, enabled) {
    const active = Boolean(player.getDynamicProperty("wetness_fog_active") ?? false);
    if (enabled === active) return;

    try {
        if (enabled) {
            player.runCommand(`fog @s push ${WET_FOG_IDENTIFIER} ${WET_FOG_STACK_ID}`);
            player.setDynamicProperty("wetness_fog_active", true);
        } else {
            player.runCommand(`fog @s remove ${WET_FOG_STACK_ID}`);
            player.setDynamicProperty("wetness_fog_active", false);
        }
    } catch (e) {
        debugWarn(`[Fog] ${player.name}: fog command failed (${enabled ? "push" : "remove"}). ${e}`);
    }
}

function dryWetness(wetness, heat, isOutsideDay, isNether) {
    if (!(isOutsideDay || isNether)) return wetness;
    const dryRate = heat >= 1.0 && isOutsideDay ? 1.0 / 20 : 1.0 / 60;
    return wetness - dryRate;
}

const STATE_ALERT_DURATION_TICKS = 10 * 20;

function getHeatAlertTier(heat) {
    if (heat >= 100) return 3;
    if (heat >= 80) return 2;
    if (heat >= 65) return 1;
    return 0;
}

function getWetnessAlertTier(wetness) {
    if (wetness >= 80) return 3;
    if (wetness >= 65) return 2;
    if (wetness >= 45) return 1;
    return 0;
}

function getHeatAlertMessage(tier) {
    if (tier === 3) return "§4焼爛状態 §7(苦熱100%)";
    if (tier === 2) return "§c焦熱状態 §7(苦熱80%)";
    if (tier === 1) return "§6脱水症状 §7(苦熱65%)";
    return "";
}

function getWetnessAlertMessage(tier) {
    if (tier === 3) return "§1水危急 §7(滞水80%)";
    if (tier === 2) return "§b低体温症 §7(滞水65%)";
    if (tier === 1) return "§3風邪 §7(滞水45%)";
    return "";
}

function updateStateActionbarAlerts(player, heat, wetness) {
    try {
        const heatTier = getHeatAlertTier(heat);
        const wetTier = getWetnessAlertTier(wetness);

        const prevHeatTier = Number(player.getDynamicProperty("state_alert_heat_tier") ?? 0);
        const prevWetTier = Number(player.getDynamicProperty("state_alert_wet_tier") ?? 0);

        const currentTick = system.currentTick;
        let heatUntil = Number(player.getDynamicProperty("state_alert_heat_until") ?? 0);
        let wetUntil = Number(player.getDynamicProperty("state_alert_wet_until") ?? 0);

        if (heatTier !== prevHeatTier) {
            player.setDynamicProperty("state_alert_heat_tier", heatTier);
            if (heatTier > prevHeatTier && heatTier > 0) {
                heatUntil = currentTick + STATE_ALERT_DURATION_TICKS;
                player.setDynamicProperty("state_alert_heat_until", heatUntil);
            } else if (heatTier === 0) {
                heatUntil = 0;
                player.setDynamicProperty("state_alert_heat_until", 0);
            }
        }

        if (wetTier !== prevWetTier) {
            player.setDynamicProperty("state_alert_wet_tier", wetTier);
            if (wetTier > prevWetTier && wetTier > 0) {
                wetUntil = currentTick + STATE_ALERT_DURATION_TICKS;
                player.setDynamicProperty("state_alert_wet_until", wetUntil);
            } else if (wetTier === 0) {
                wetUntil = 0;
                player.setDynamicProperty("state_alert_wet_until", 0);
            }
        }

        const messages = [];
        if (heatTier > 0 && currentTick <= heatUntil) {
            const msg = getHeatAlertMessage(heatTier);
            if (msg) messages.push(msg);
        }
        if (wetTier > 0 && currentTick <= wetUntil) {
            const msg = getWetnessAlertMessage(wetTier);
            if (msg) messages.push(msg);
        }

        if (messages.length > 0) {
            player.onScreenDisplay.setActionBar(messages.join(" §8| "));
        }
    } catch (e) {
        debugWarn(`[State Alert] ${player.name}: failed. ${e}`);
    }
}

export function clearWetnessFog(player) {
    applyWetFog(player, false);
}

export function tickHeat(player) {
    let heat = Number(player.getDynamicProperty("heat") ?? 0);
    let wetness = Number(player.getDynamicProperty("wetness") ?? 0);
    const vitality = Number(player.getDynamicProperty("vitality") ?? 5);
    const water = Number(player.getDynamicProperty("water_level") ?? 7);
    const voidPressureActive = hasVoidPressureEffect(player);
    const voidWetMultiplier = getVoidPressureWetnessMultiplier(player);
    const maniaWetBaseBonusSeconds = getWetnessBaseBonusSeconds(player);
    const maniaBlocksWetness = isWetnessBlockedByMania(player);

    try { player.setDynamicProperty("dbg_wet_mania_base_bonus_seconds", maniaWetBaseBonusSeconds); } catch {}

    const armorProtection = getArmorProtection(player);
    const hpArmorCount = armorProtection.heatPieces;
    const wpArmorCount = armorProtection.wetPieces;
    const heatDelayMultiplier = armorProtection.heatDelayMultiplier;
    const wetDelayMultiplier = armorProtection.wetDelayMultiplier;
    const wetBaseBonusSeconds = armorProtection.wetBaseBonusSeconds ?? 0;

    player.setDynamicProperty("dbg_heat_protection_multiplier", heatDelayMultiplier);
    player.setDynamicProperty("dbg_wet_protection_multiplier", wetDelayMultiplier);

    const isNether = player.dimension.id === "minecraft:nether";
    const time = world.getTimeOfDay();
    const isDay = time >= 0 && time < 13000;
    const underSky = isUnderSky(player);
    const isWater = isWaterBlock(player);
    const raining = isRaining(player);

    const isOutsideDay = isDay && underSky && !isNether;
    const isShadow = !underSky && !isNether;
    const isRainOutside = raining && underSky && !isNether;

    const now = system.currentTick;
    const coolantUntil = Number(player.getDynamicProperty("coolant_heat_until") ?? 0);
    let coolantDrainRemaining = Number(player.getDynamicProperty("coolant_heat_drain_remaining") ?? 0);
    const coolantActive = now <= coolantUntil;

    const heatAccelWetUntil = Number(player.getDynamicProperty("heat_accel_wet_until") ?? 0);
    let heatAccelWetDrainRemaining = Number(player.getDynamicProperty("heat_accel_wet_drain_remaining") ?? 0);
    const heatAccelerationActive = now <= heatAccelWetUntil;

    if (maniaBlocksWetness) {

    } else if (heatAccelerationActive) {

        if (heatAccelWetDrainRemaining > 0 && now % 20 === 0) {
            wetness -= 1;
            heatAccelWetDrainRemaining -= 1;
            player.setDynamicProperty("heat_accel_wet_drain_remaining", Math.max(0, heatAccelWetDrainRemaining));
        }
    } else if (voidPressureActive) {

        let baseTime = 4;
        if (Number.isFinite(wetBaseBonusSeconds) && wetBaseBonusSeconds > 0) {
            baseTime += wetBaseBonusSeconds * 20;
        }
        if (Number.isFinite(maniaWetBaseBonusSeconds) && maniaWetBaseBonusSeconds > 0) {
            baseTime += maniaWetBaseBonusSeconds * 20;
        }

        const baseRate = 1.0 / baseTime;

        const actualRate = (baseRate / wetDelayMultiplier) * voidWetMultiplier;

        wetness += actualRate;
    } else if (vitality >= 9) {
        wetness -= 5.0 / 20;
    } else if (isWater || isShadow || isRainOutside) {
        let baseTime = isWater ? WET_TIMES.water : isRainOutside ? WET_TIMES.rain : WET_TIMES.shadow;

        if (Number.isFinite(wetBaseBonusSeconds) && wetBaseBonusSeconds > 0) {
            baseTime += wetBaseBonusSeconds * 20;
        }
        if (Number.isFinite(maniaWetBaseBonusSeconds) && maniaWetBaseBonusSeconds > 0) {
            baseTime += maniaWetBaseBonusSeconds * 20;
        }

        const baseRate = 1.0 / baseTime;
        let actualRate = baseRate / wetDelayMultiplier;
        if (player.location.y <= -30) actualRate *= 3.0;
        else if (player.location.y <= 0) actualRate *= 2.0;
        wetness += actualRate;
    } else {
        wetness = dryWetness(wetness, heat, isOutsideDay, isNether);
    }
    wetness = Math.max(0, Math.min(100, wetness));

    if (voidPressureActive) {

        heat = 0;
    } else if (isWater) {

        heat -= 1.0 / (2 * 20);
    } else {
        if (coolantActive) {

            if (coolantDrainRemaining > 0 && now % 20 === 0) {
                heat -= 1;
                coolantDrainRemaining -= 1;
                player.setDynamicProperty("coolant_heat_drain_remaining", Math.max(0, coolantDrainRemaining));
            }
        } else if (isRainOutside) {

        } else if (isOutsideDay || isNether) {
            const biomeGroup = getBiomeGroup(player);
            let baseTicks = HEAT_TIMES[biomeGroup];

            if (isNether && hpArmorCount > 0) baseTicks += 20;

            const baseRate = 1.0 / baseTicks;
            let actualRate = baseRate / heatDelayMultiplier;

            if (wetness >= 1.0) actualRate /= 1.5;
            if (water >= 1.0) actualRate /= 1.2;
            if (vitality >= 8) actualRate /= 2.0;

            heat += actualRate;
        } else {
            heat -= hpArmorCount > 0 ? 1.0 / 10 : 1.0 / 100;
        }
    }

    if (shouldCapHeatByNetherite(player)) heat = Math.min(heat, 31);

    if (vitality === 10) heat = Math.min(heat, 10);
    heat = Math.max(0, Math.min(100, heat));

    player.setDynamicProperty("heat", heat);
    player.setDynamicProperty("wetness", wetness);

    updateStateActionbarAlerts(player, heat, wetness);

    if (system.currentTick % 20 === 0) {
        const wetTier = wetness >= 80 ? 4 : wetness >= 65 ? 3 : wetness >= 45 ? 2 : wetness >= 10 ? 1 : 0;
        const heatTier = heat >= 100 ? 4 : heat >= 80 ? 3 : heat >= 65 ? 2 : heat >= 10 ? 1 : 0;
        const prevWetTier = Number(player.getDynamicProperty("dbg_wet_tier") ?? -1);
        const prevHeatTier = Number(player.getDynamicProperty("dbg_heat_tier") ?? -1);
        if (prevWetTier !== wetTier) {
            player.setDynamicProperty("dbg_wet_tier", wetTier);
            debugWarn(`[Wetness] ${player.name}: tier ${prevWetTier} -> ${wetTier} (value=${wetness.toFixed(2)})`);
        }
        if (prevHeatTier !== heatTier) {
            player.setDynamicProperty("dbg_heat_tier", heatTier);
            debugWarn(`[Heat] ${player.name}: tier ${prevHeatTier} -> ${heatTier} (value=${heat.toFixed(2)})`);
        }
    }

    if (system.currentTick % 20 === 0) {
        const debuffsSuppressed = vitality === 10;

        applyWetFog(player, !debuffsSuppressed && wetness >= 65);

        if (!debuffsSuppressed) {
            if (heat >= 100) {
                player.addEffect("hunger", 60, { amplifier: 3, showParticles: false });
                player.addEffect("slowness", 40, { amplifier: 2, showParticles: false });
                player.setOnFire(2, true);
            } else if (heat >= 80) {
                player.addEffect("hunger", 60, { amplifier: 2, showParticles: false });
                player.addEffect("slowness", 40, { amplifier: 1, showParticles: false });
            } else if (heat >= 65) {
                player.addEffect("hunger", 60, { amplifier: 2, showParticles: false });
                player.addEffect("slowness", 40, { amplifier: 1, showParticles: false });
            } else if (heat >= 30) {
                player.addEffect("hunger", 60, { amplifier: 1, showParticles: false });
                player.addEffect("slowness", 40, { amplifier: 0, showParticles: false });
            } else if (heat >= 10) {
                player.addEffect("hunger", 60, { amplifier: 1, showParticles: false });
            }

            if (wetness >= 80) {
                player.addEffect("slowness", 40, { amplifier: 3, showParticles: false });
                player.addEffect("weakness", 40, { amplifier: 4, showParticles: false });
                player.addEffect("mining_fatigue", 40, { amplifier: 4, showParticles: false });
                player.addEffect("nausea", 40, { amplifier: 0, showParticles: false });
                player.addEffect("darkness", 40, { amplifier: 0, showParticles: false });
            } else if (wetness >= 65) {
                player.addEffect("slowness", 40, { amplifier: 2, showParticles: false });
                player.addEffect("weakness", 40, { amplifier: 1, showParticles: false });
                player.addEffect("mining_fatigue", 40, { amplifier: 3, showParticles: false });
            } else if (wetness >= 45) {
                player.addEffect("slowness", 40, { amplifier: 2, showParticles: false });
                player.addEffect("weakness", 40, { amplifier: 0, showParticles: false });
                player.addEffect("mining_fatigue", 40, { amplifier: 0, showParticles: false });
            } else if (wetness >= 25) {
                player.addEffect("slowness", 40, { amplifier: 1, showParticles: false });
                player.addEffect("mining_fatigue", 40, { amplifier: 0, showParticles: false });
            } else if (wetness >= 10) {
                player.addEffect("slowness", 40, { amplifier: 0, showParticles: false });
            }
        }
    }
}
