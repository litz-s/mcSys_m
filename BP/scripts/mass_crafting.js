import { world, system } from "@minecraft/server";

const CATALYST_ID = "pls:fragment_of_mass";
const CUSTOM_ENCHANT_LORE = "§r§7一括破壊 I";

const TOOL_NAMES_JP = {
    "minecraft:wooden_axe": "木の斧",
    "minecraft:wooden_pickaxe": "木のツルハシ",
    "minecraft:wooden_shovel": "木のシャベル",
    "minecraft:stone_axe": "石の斧",
    "minecraft:stone_pickaxe": "石のツルハシ",
    "minecraft:stone_shovel": "石のシャベル",
    "minecraft:iron_axe": "鉄の斧",
    "minecraft:iron_pickaxe": "鉄のツルハシ",
    "minecraft:iron_shovel": "鉄のシャベル",
    "minecraft:golden_axe": "金の斧",
    "minecraft:golden_pickaxe": "金のツルハシ",
    "minecraft:golden_shovel": "金のシャベル",
    "minecraft:diamond_axe": "ダイヤの斧",
    "minecraft:diamond_pickaxe": "ダイヤのツルハシ",
    "minecraft:diamond_shovel": "ダイヤのシャベル",
    "minecraft:netherite_axe": "ネザライトの斧",
    "minecraft:netherite_pickaxe": "ネザライトのツルハシ",
    "minecraft:netherite_shovel": "ネザライトのシャベル",
};

function isValidEntity(entity) {
    try {
        return !!entity && entity.isValid;
    } catch {
        return false;
    }
}

function getItemStackFromEntity(entity) {
    if (!isValidEntity(entity)) return undefined;

    try {
        const itemComp = entity.getComponent("minecraft:item");
        return itemComp?.itemStack;
    } catch {
        return undefined;
    }
}

function isMassTargetTool(typeId) {
    return (
        typeId.endsWith("_axe") ||
        typeId.endsWith("_pickaxe") ||
        typeId.endsWith("_shovel")
    );
}

export function initMassCraftingSystem() {
    system.runInterval(() => {
        for (const dimensionId of ["overworld", "nether", "the_end"]) {
            let dim;
            try {
                dim = world.getDimension(dimensionId);
            } catch {
                continue;
            }

            let itemEntities;
            try {
                itemEntities = dim.getEntities({ type: "minecraft:item" });
            } catch {
                continue;
            }

            for (const entity of itemEntities) {
                if (!isValidEntity(entity)) continue;

                const itemStack = getItemStackFromEntity(entity);
                if (!itemStack) continue;
                if (itemStack.typeId !== CATALYST_ID) continue;

                const catalystLocation = { ...entity.location };

                let nearbyItems;
                try {
                    nearbyItems = dim.getEntities({
                        type: "minecraft:item",
                        location: catalystLocation,
                        maxDistance: 1.5,
                    });
                } catch {
                    continue;
                }

                let crafted = false;

                for (const targetEntity of nearbyItems) {
                    if (crafted) break;
                    if (!isValidEntity(entity)) break;
                    if (!isValidEntity(targetEntity)) continue;
                    if (targetEntity.id === entity.id) continue;

                    const targetStack = getItemStackFromEntity(targetEntity);
                    if (!targetStack) continue;

                    const targetId = targetStack.typeId;
                    if (!isMassTargetTool(targetId)) continue;

                    let lore = [];
                    try {
                        lore = targetStack.getLore();
                    } catch {
                        lore = [];
                    }

                    if (lore.includes(CUSTOM_ENCHANT_LORE)) continue;

                    const resultStack = targetStack.clone();

                    let currentLore = [];
                    try {
                        currentLore = resultStack.getLore();
                    } catch {
                        currentLore = [];
                    }

                    currentLore.push(CUSTOM_ENCHANT_LORE);
                    resultStack.setLore(currentLore);

                    const spawnLocation = { ...catalystLocation };

                    try {
                        entity.remove();
                    } catch {}

                    try {
                        targetEntity.remove();
                    } catch {}

                    try {
                        dim.spawnItem(resultStack, spawnLocation);
                    } catch {}

                    try {
                        dim.spawnParticle("minecraft:trial_spawner_detection_ominous", spawnLocation);
                    } catch {}

                    try {
                        dim.playSound("trial_spawner.charge_activate", spawnLocation);
                    } catch {}

                    crafted = true;
                }
            }
        }
    }, 10);
}
