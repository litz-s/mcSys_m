import { system, EquipmentSlot, ItemStack } from "@minecraft/server";
import { syncHud } from "./ui_sync.js";
import { getWaterCap, getWaterRecoveryAmount, getVitalityCap } from "./system_end.js";

const AUTO_USE_LORE = "§a自動使用";

const VITALITY_DURATIONS = {
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

const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];

function getContainer(player) {
    try {
        return player.getComponent("minecraft:inventory")?.container;
    } catch {
        return undefined;
    }
}

function itemHasLore(item, loreLine) {
    try {
        return (item?.getLore?.() ?? []).includes(loreLine);
    } catch {
        return false;
    }
}

function countAutoUsePieces(player) {
    try {
        const eq = player.getComponent("minecraft:equippable");
        if (!eq) return 0;
        let count = 0;
        for (const slot of ARMOR_SLOTS) {
            const item = eq.getEquipment(slot);
            if (itemHasLore(item, AUTO_USE_LORE)) count++;
        }
        return count;
    } catch {
        return 0;
    }
}

function countItem(player, typeId) {
    const inv = getContainer(player);
    if (!inv) return 0;
    let total = 0;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item?.typeId === typeId) total += item.amount;
    }
    return total;
}

function removeOneItem(player, typeId) {
    const inv = getContainer(player);
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (!item || item.typeId !== typeId) continue;

        if (item.amount <= 1) {
            inv.setItem(i, undefined);
        } else {
            const next = item.clone();
            next.amount = item.amount - 1;
            inv.setItem(i, next);
        }
        return true;
    }
    return false;
}

function giveItem(player, typeId, count = 1) {
    const inv = getContainer(player);
    if (!inv) return false;
    try {
        const stack = new ItemStack(typeId, count);
        const leftover = inv.addItem(stack);
        if (leftover && leftover.amount > 0) {
            player.dimension.spawnItem(leftover, player.location);
        }
        return true;
    } catch {
        return false;
    }
}

function setVitality(player, vitality, timerOverride = undefined) {
    const cap = getVitalityCap(player);
    const vit = Math.min(cap, Math.max(0, vitality));
    player.setDynamicProperty("vitality", vit);
    player.setDynamicProperty("vitality_timer", timerOverride ?? VITALITY_DURATIONS[vit] ?? 0);
}

function autoUseWaterBottle(player) {
    let water = Number(player.getDynamicProperty("water_level") ?? 7);
    const vitality = Number(player.getDynamicProperty("vitality") ?? 5);
    const cap = getWaterCap(player);
    if (water >= cap) return false;
    if (!removeOneItem(player, "pls:water_bottle")) return false;

    const baseRecovery = vitality >= 7 ? 8 : 5;
    const recovery = getWaterRecoveryAmount(player, baseRecovery);
    water = Math.min(cap, water + recovery);
    player.setDynamicProperty("water_level", water);
    player.setDynamicProperty("auto_use_last_water", water);
    player.setDynamicProperty("auto_use_cooldown_water", system.currentTick + 10);
    return true;
}

function autoUseMedicine(player, typeId) {
    if (!removeOneItem(player, typeId)) return false;

    let vitality = Number(player.getDynamicProperty("vitality") ?? 5);

    if (typeId === "pls:vitality_restorer") {
        vitality = Math.min(5, vitality + 2);
        setVitality(player, vitality);
    } else if (typeId === "pls:positive_tonic") {
        vitality = Math.min(9, vitality + 1);
        setVitality(player, vitality);
    } else if (typeId === "pls:stimulants") {
        vitality = Math.min(10, vitality + 2);
        setVitality(player, vitality);
    } else if (typeId === "pls:high_stimulants") {
        vitality = Math.min(10, vitality + 5);
        setVitality(player, vitality, vitality === 10 ? 6000 : undefined);
    }

    giveItem(player, "minecraft:glass_bottle", 1);
    player.setDynamicProperty("auto_use_cooldown_medicine", system.currentTick + 10);
    return true;
}

function shouldUseWater(player, water) {
    const lastWater = Number(player.getDynamicProperty("auto_use_last_water") ?? water);
    const lostSince = lastWater - water;
    return water <= 5 || lostSince >= 5;
}

function updateLastTrackers(player, water) {
    const last = Number(player.getDynamicProperty("auto_use_last_water") ?? water);
    if (water > last) player.setDynamicProperty("auto_use_last_water", water);
}

export function tickAutoUse(player) {
    const pieces = countAutoUsePieces(player);
    let water = Number(player.getDynamicProperty("water_level") ?? 7);
    let vitality = Number(player.getDynamicProperty("vitality") ?? 5);

    if (pieces <= 0) {
        player.setDynamicProperty("auto_use_last_water", water);
        return;
    }

    const waterCooldown = Number(player.getDynamicProperty("auto_use_cooldown_water") ?? 0);
    if (system.currentTick >= waterCooldown && shouldUseWater(player, water)) {
        autoUseWaterBottle(player);
        water = Number(player.getDynamicProperty("water_level") ?? water);
    }

    const medicineCooldown = Number(player.getDynamicProperty("auto_use_cooldown_medicine") ?? 0);
    if (system.currentTick >= medicineCooldown) {
        vitality = Number(player.getDynamicProperty("vitality") ?? vitality);

        if (vitality <= 4 && countItem(player, "pls:vitality_restorer") > 0) {
            autoUseMedicine(player, "pls:vitality_restorer");
        } else if (pieces >= 4 && vitality <= 9 && countItem(player, "pls:high_stimulants") > 0) {
            autoUseMedicine(player, "pls:high_stimulants");
        } else if (pieces >= 3 && vitality <= 9 && countItem(player, "pls:stimulants") > 0) {
            autoUseMedicine(player, "pls:stimulants");
        } else if (pieces >= 2 && vitality <= 8 && countItem(player, "pls:positive_tonic") > 0) {
            autoUseMedicine(player, "pls:positive_tonic");
        }
    }

    updateLastTrackers(player, Number(player.getDynamicProperty("water_level") ?? water));
    system.run(() => syncHud(player));
}
