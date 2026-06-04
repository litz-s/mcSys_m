import { world, system, ItemStack } from "@minecraft/server";

const DIMENSION_IDS = ["overworld", "nether", "the_end"];
const CRAFT_SCAN_INTERVAL_TICKS = 20;
const CRAFT_DISTANCE = 1.0;

const PROCESSING_TIERS = {
    leather:   { rank: 1, roman: "I" },
    chain:     { rank: 2, roman: "II" },
    copper:    { rank: 3, roman: "III" },
    gold:      { rank: 4, roman: "IV" },
    iron:      { rank: 5, roman: "V" },
    diamond:   { rank: 6, roman: "VI" },
    netherite: { rank: 7, roman: "VII" },
};

const JAPANESE_TIER_TO_RANK = {
    "革": 1, "チェーン": 2, "銅": 3, "金": 4, "鉄": 5, "ダイヤ": 6, "ネザライト": 7,
};

const ROMAN_TO_RANK = {
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7,
};

function stripColorCodes(value) {
    return String(value ?? "").replace(/§./g, "").trim();
}

function romanFromRank(rank, maxRank = 7) {
    const clamped = Math.max(1, Math.min(maxRank, Number(rank) || 1));
    return Object.entries(ROMAN_TO_RANK).find(([, v]) => v === clamped)?.[0] ?? "I";
}

const EXTRA_DROP_TIERS = {
    "pls:extra_drop_fragment_1": { rank: 1, roman: "I" },
    "pls:extra_drop_fragment_2": { rank: 2, roman: "II" },
    "pls:extra_drop_fragment_3": { rank: 3, roman: "III" },
};

const FRAGMENT_REMOVER_ID = "pls:fragment_remover";
const RANK_TO_TIER_KEY = {
    1: "leather", 2: "chain", 3: "copper", 4: "gold", 5: "iron", 6: "diamond", 7: "netherite",
};

function isArmorType(typeId) {
    return typeId.includes("helmet") || typeId.includes("chestplate") || typeId.includes("leggings") || typeId.includes("boots");
}

function isExtraDropTarget(typeId) {
    return typeId.endsWith("_sword") || typeId.endsWith("_pickaxe") || typeId.endsWith("_axe") || typeId.endsWith("_shovel");
}

function isFragmentType(typeId) {
    if (typeId === FRAGMENT_REMOVER_ID) return false;
    return typeId.startsWith("pls:") && typeId.includes("fragment");
}

function processingTypeFromFragment(typeId) {
    if (typeId.includes("waterproof")) return "waterproof";
    if (typeId.includes("heatproof")) return "heatproof";
    if (typeId.includes("voidguard")) return "voidguard";
    if (typeId === "pls:auto_use_fragment") return "auto_use";
    if (typeId.startsWith("pls:extra_drop_fragment_")) return "extra_drop";
    if (typeId === FRAGMENT_REMOVER_ID) return "fragment_remover";
    return undefined;
}

function getTierKeyFromFragmentTypeId(typeId) {
    for (const tier of Object.keys(PROCESSING_TIERS)) {
        if (typeId.endsWith(`_${tier}`)) return tier;
    }
    return "leather";
}

function getTierFromFragmentTypeId(typeId) {
    return PROCESSING_TIERS[getTierKeyFromFragmentTypeId(typeId)] ?? PROCESSING_TIERS.leather;
}

function getExtraDropTierFromFragment(typeId) {
    return EXTRA_DROP_TIERS[typeId] ?? EXTRA_DROP_TIERS["pls:extra_drop_fragment_1"];
}

function getProcessingLorePrefix(processingType) {
    if (processingType === "waterproof") return "§b防水加工";
    if (processingType === "heatproof") return "§c耐熱加工";
    if (processingType === "voidguard") return "§5浮郭加工";
    if (processingType === "auto_use") return "§a自動使用";
    if (processingType === "extra_drop") return "§6追加ドロップ";
    return "";
}

function parseExistingProcessingRank(line, processingType) {
    if (typeof line !== "string") return 0;

    const plain = stripColorCodes(line);

    if (processingType === "auto_use") {
        return plain === "自動使用" ? 1 : 0;
    }

    const labels = {
        waterproof: "防水加工",
        heatproof: "耐熱加工",
        voidguard: "浮郭加工",
        extra_drop: "追加ドロップ",
        mass: "一括破壊",
    };
    const label = labels[processingType];
    if (!label) return 0;

    if (plain === label) return 1;
    if (plain.startsWith(label)) {
        const suffix = plain.slice(label.length).trim();
        if (!suffix) return 1;
        return ROMAN_TO_RANK[suffix] ?? 1;
    }

    if (processingType === "waterproof" || processingType === "heatproof") {
        const legacy = plain.match(/^\[(防水加工|耐熱加工)(?::(.+))?\]$/);
        if (legacy && legacy[1] === label) {
            const tierLabel = legacy[2]?.trim();
            if (!tierLabel) return 1;
            return JAPANESE_TIER_TO_RANK[tierLabel] ?? 1;
        }
    }

    return 0;
}

function findProcessingLoreIndex(lore, processingType) {
    if (!Array.isArray(lore)) return -1;
    return lore.findIndex((line) => parseExistingProcessingRank(line, processingType) > 0);
}

function formatProcessingLore(processingType, rank) {
    if (processingType === "auto_use") return getProcessingLorePrefix(processingType);
    const roman = processingType === "extra_drop"
        ? Object.values(EXTRA_DROP_TIERS).find((v) => v.rank === rank)?.roman ?? "I"
        : Object.values(PROCESSING_TIERS).find((v) => v.rank === rank)?.roman ?? "I";
    return `${getProcessingLorePrefix(processingType)} ${roman}`;
}

function safeGetItemStack(entity) {
    try {
        if (!entity?.isValid) return undefined;
        const itemComp = entity.getComponent("minecraft:item");
        return itemComp?.itemStack;
    } catch {
        return undefined;
    }
}

function safeGetLocation(entity) {
    try {
        if (!entity?.isValid) return undefined;
        const loc = entity.location;
        return { x: loc.x, y: loc.y, z: loc.z };
    } catch {
        return undefined;
    }
}

function safeRemove(entity) {
    try { if (entity?.isValid) entity.remove(); } catch {}
}

function canApplyProcessingToItem(itemTypeId, processingType) {
    if (processingType === "auto_use") return isArmorType(itemTypeId);
    if (processingType === "extra_drop") return isExtraDropTarget(itemTypeId);
    return isArmorType(itemTypeId);
}

function getTargetRank(fragmentTypeId, processingType) {
    if (processingType === "auto_use") return { rank: 1, roman: "I" };
    if (processingType === "extra_drop") return getExtraDropTierFromFragment(fragmentTypeId);
    return getTierFromFragmentTypeId(fragmentTypeId);
}

function craftEquipmentWithFragment(dimension, equipmentEntity, fragmentEntity) {
    const equipmentLocation = safeGetLocation(equipmentEntity);
    if (!equipmentLocation) return false;

    const equipmentStack = safeGetItemStack(equipmentEntity);
    const fragmentStack = safeGetItemStack(fragmentEntity);
    if (!equipmentStack || !fragmentStack) return false;

    const fragmentTypeId = fragmentStack.typeId;
    const processingType = processingTypeFromFragment(fragmentTypeId);
    if (!processingType) return false;
    if (!canApplyProcessingToItem(equipmentStack.typeId, processingType)) return false;

    const targetTier = getTargetRank(fragmentTypeId, processingType);

    let resultItem;
    try {
        resultItem = equipmentStack.clone();
        const lore = resultItem.getLore() || [];
        const existingIndex = findProcessingLoreIndex(lore, processingType);
        const existingRank = existingIndex >= 0 ? parseExistingProcessingRank(lore[existingIndex], processingType) : 0;

        if (existingRank >= targetTier.rank) return false;

        const newLoreLine = formatProcessingLore(processingType, targetTier.rank);
        if (existingIndex >= 0) lore[existingIndex] = newLoreLine;
        else lore.push(newLoreLine);

        resultItem.setLore(lore);
    } catch {
        return false;
    }

    try {
        dimension.spawnParticle("minecraft:trial_spawner_detection_ominous", {
            x: equipmentLocation.x - 0.5, y: equipmentLocation.y, z: equipmentLocation.z - 0.5,
        });
        dimension.playSound("trial_spawner.charge_activate", equipmentLocation);
    } catch {}

    safeRemove(equipmentEntity);
    safeRemove(fragmentEntity);

    try {
        dimension.spawnItem(resultItem, equipmentLocation);
        return true;
    } catch {
        return false;
    }
}

function fragmentItemForProcessing(processingType, rank) {
    if (processingType === "auto_use") return "pls:auto_use_fragment";
    if (processingType === "mass") return "pls:fragment_of_mass";
    if (processingType === "extra_drop") {
        const tier = Math.max(1, Math.min(3, Number(rank) || 1));
        return `pls:extra_drop_fragment_${tier}`;
    }
    const tierKey = RANK_TO_TIER_KEY[Math.max(1, Math.min(7, Number(rank) || 1))] ?? "leather";
    if (processingType === "waterproof") return `pls:waterproof_fragment_${tierKey}`;
    if (processingType === "heatproof") return `pls:heatproof_fragment_${tierKey}`;
    if (processingType === "voidguard") return `pls:voidguard_fragment_${tierKey}`;
    return undefined;
}

function collectProcessingLore(lore) {
    const entries = [];
    const processingTypes = ["waterproof", "heatproof", "voidguard", "auto_use", "extra_drop", "mass"];
    for (let i = 0; i < lore.length; i++) {
        for (const type of processingTypes) {
            const rank = parseExistingProcessingRank(lore[i], type);
            if (rank > 0) {
                const fragmentId = fragmentItemForProcessing(type, rank);
                if (fragmentId) entries.push({ index: i, type, rank, fragmentId });
                break;
            }
        }
    }
    return entries;
}

function spawnRemovalParticles(dimension, loc) {

    const offsets = [
        { x: 0, y: 0.05, z: 0 },
        { x: 0.18, y: 0.12, z: 0 },
        { x: -0.18, y: 0.12, z: 0 },
        { x: 0, y: 0.12, z: 0.18 },
        { x: 0, y: 0.12, z: -0.18 },
    ];
    for (const o of offsets) {
        try { dimension.spawnParticle("minecraft:basic_flame_particle", { x: loc.x + o.x, y: loc.y + o.y, z: loc.z + o.z }); } catch {}
    }
    try { dimension.spawnParticle("minecraft:lava_particle", { x: loc.x, y: loc.y + 0.15, z: loc.z }); } catch {}
}

function consumeOneItemEntity(dimension, entity, loc) {
    const stack = safeGetItemStack(entity);
    if (!stack) return;
    const amount = Number(stack.amount ?? 1);
    safeRemove(entity);
    if (amount > 1) {
        const rest = stack.clone();
        rest.amount = amount - 1;
        try { dimension.spawnItem(rest, loc); } catch {}
    }
}

function removalDropLocation(baseLoc, index, total) {

    const count = Math.max(1, total || 1);
    const angle = (Math.PI * 2 * index) / count;
    const radius = 1.85;
    return {
        x: baseLoc.x + Math.cos(angle) * radius,
        y: baseLoc.y + 0.25,
        z: baseLoc.z + Math.sin(angle) * radius,
    };
}

function removeFragmentsFromEquipment(dimension, equipmentEntity, removerEntity) {
    const loc = safeGetLocation(equipmentEntity);
    if (!loc) return false;

    const equipmentStack = safeGetItemStack(equipmentEntity);
    const removerStack = safeGetItemStack(removerEntity);
    if (!equipmentStack || !removerStack || removerStack.typeId !== FRAGMENT_REMOVER_ID) return false;

    let resultItem;
    let returns;
    let returnStacks;
    try {
        resultItem = equipmentStack.clone();
        const lore = resultItem.getLore?.() || [];
        returns = collectProcessingLore(lore);
        if (returns.length <= 0) return false;

        const removeIndexes = new Set(returns.map((e) => e.index));
        const newLore = lore.filter((_, index) => !removeIndexes.has(index));
        resultItem.setLore(newLore);

        returnStacks = returns.map((entry) => new ItemStack(entry.fragmentId, 1));
    } catch (e) {
        console.warn(`[FragmentRemover] prepare failed: ${e}`);
        return false;
    }

    try {

        safeRemove(equipmentEntity);
        consumeOneItemEntity(dimension, removerEntity, loc);

        dimension.spawnItem(resultItem, loc);
        for (let i = 0; i < returnStacks.length; i++) {
            dimension.spawnItem(returnStacks[i], removalDropLocation(loc, i, returnStacks.length));
        }
    } catch (e) {
        console.warn(`[FragmentRemover] spawn failed: ${e}`);
        return false;
    }

    try {
        spawnRemovalParticles(dimension, loc);
        dimension.playSound("fire.ignite", loc);
        dimension.playSound("random.fizz", loc);
    } catch {}

    return true;
}

function craftVoidguardFragment(dimension, fragmentEntity, eyeEntity, coreEntity) {
    const loc = safeGetLocation(fragmentEntity);
    const fragmentStack = safeGetItemStack(fragmentEntity);
    const eyeStack = safeGetItemStack(eyeEntity);
    const coreStack = safeGetItemStack(coreEntity);
    if (!loc || !fragmentStack || !eyeStack || !coreStack) return false;
    if (!fragmentStack.typeId.includes("waterproof_fragment")) return false;
    if (eyeStack.typeId !== "minecraft:ender_eye") return false;
    if (coreStack.typeId !== "pls:copper_core") return false;

    const tierKey = getTierKeyFromFragmentTypeId(fragmentStack.typeId);
    let result;
    try {
        result = new ItemStack(`pls:voidguard_fragment_${tierKey}`, 1);
    } catch {
        return false;
    }

    try {
        dimension.spawnParticle("minecraft:dragon_breath_trail", loc);
        dimension.playSound("mob.endermen.portal", loc);
    } catch {}

    safeRemove(fragmentEntity);
    safeRemove(eyeEntity);
    safeRemove(coreEntity);

    try {
        dimension.spawnItem(result, loc);
        return true;
    } catch {
        return false;
    }
}

system.runInterval(() => {
    for (const dimensionId of DIMENSION_IDS) {
        let dimension;
        try { dimension = world.getDimension(dimensionId); } catch { continue; }

        let itemEntities = [];
        try { itemEntities = dimension.getEntities({ type: "minecraft:item" }); } catch { continue; }

        for (const entity of itemEntities) {
            try {
                if (!entity?.isValid) continue;
                const stack = safeGetItemStack(entity);
                if (!stack || !stack.typeId.includes("waterproof_fragment")) continue;
                const loc = safeGetLocation(entity);
                if (!loc) continue;

                const nearby = dimension.getEntities({ location: loc, maxDistance: CRAFT_DISTANCE, type: "minecraft:item" });
                let eyeEntity;
                let coreEntity;
                for (const other of nearby) {
                    if (!other?.isValid) continue;
                    try { if (other.id === entity.id) continue; } catch { continue; }
                    const otherStack = safeGetItemStack(other);
                    if (!otherStack) continue;
                    if (otherStack.typeId === "minecraft:ender_eye") eyeEntity = other;
                    else if (otherStack.typeId === "pls:copper_core") coreEntity = other;
                }
                if (eyeEntity && coreEntity) {
                    craftVoidguardFragment(dimension, entity, eyeEntity, coreEntity);
                }
            } catch {}
        }

        try { itemEntities = dimension.getEntities({ type: "minecraft:item" }); } catch { continue; }

        for (const removerEntity of itemEntities) {
            try {
                if (!removerEntity?.isValid) continue;
                const removerStack = safeGetItemStack(removerEntity);
                if (!removerStack || removerStack.typeId !== FRAGMENT_REMOVER_ID) continue;
                const removerLoc = safeGetLocation(removerEntity);
                if (!removerLoc) continue;

                const nearbyEntities = dimension.getEntities({
                    location: removerLoc,
                    maxDistance: CRAFT_DISTANCE,
                    type: "minecraft:item",
                });

                for (const equipmentEntity of nearbyEntities) {
                    if (!equipmentEntity?.isValid) continue;
                    try { if (equipmentEntity.id === removerEntity.id) continue; } catch { continue; }
                    const equipmentStack = safeGetItemStack(equipmentEntity);
                    if (!equipmentStack) continue;
                    if (collectProcessingLore(equipmentStack.getLore?.() || []).length <= 0) continue;
                    if (removeFragmentsFromEquipment(dimension, equipmentEntity, removerEntity)) break;
                }
            } catch {}
        }

        try { itemEntities = dimension.getEntities({ type: "minecraft:item" }); } catch { continue; }

        for (const equipmentEntity of itemEntities) {
            try {
                if (!equipmentEntity?.isValid) continue;

                const equipmentStack = safeGetItemStack(equipmentEntity);
                if (!equipmentStack) continue;

                const equipmentLocation = safeGetLocation(equipmentEntity);
                if (!equipmentLocation) continue;

                const nearbyEntities = dimension.getEntities({
                    location: equipmentLocation,
                    maxDistance: CRAFT_DISTANCE,
                    type: "minecraft:item",
                });

                for (const nearby of nearbyEntities) {
                    if (!nearby?.isValid) continue;
                    try { if (nearby.id === equipmentEntity.id) continue; } catch { continue; }

                    const fragmentStack = safeGetItemStack(nearby);
                    if (!fragmentStack || !isFragmentType(fragmentStack.typeId)) continue;

                    const crafted = craftEquipmentWithFragment(dimension, equipmentEntity, nearby);
                    if (crafted) break;
                }
            } catch {}
        }
    }
}, CRAFT_SCAN_INTERVAL_TICKS);
