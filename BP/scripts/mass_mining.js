import { world, system, EquipmentSlot } from "@minecraft/server";
import { registerPendingBlockDrop } from "./system_extra_drop.js";

const MAX_BREAK_LIMIT = 128;
const CUSTOM_ENCHANT_LORE = "§r§7一括破壊 I";

const LOG_KEYWORDS = [
    "_log", "_wood", "crimson_stem", "warped_stem", "crimson_hyphae", "warped_hyphae",
];

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

function isLogLike(typeId) {
    return LOG_KEYWORDS.some((keyword) => typeId.includes(keyword));
}

function isOreLike(typeId) {
    return ORE_BLOCKS.has(typeId);
}

function isGravel(typeId) {
    return typeId === "minecraft:gravel";
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

function hasMassLore(item) {
    try {
        return (item.getLore() || []).includes(CUSTOM_ENCHANT_LORE);
    } catch {
        return false;
    }
}

function getTargetKind(blockId, toolId) {
    if (isAxe(toolId) && isLogLike(blockId)) return "log";
    if (isPickaxe(toolId) && isOreLike(blockId)) return "ore";
    if (isShovel(toolId) && isGravel(blockId)) return "gravel";
    return "none";
}

function matchesTargetKind(typeId, kind, originTypeId) {
    if (kind === "log") {

        return typeId === originTypeId;
    }
    if (kind === "ore") {

        return typeId === originTypeId;
    }
    if (kind === "gravel") {
        return isGravel(typeId);
    }
    return false;
}

function commandNumber(value) {
    return Math.floor(Number(value));
}

function quoteCommandString(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function spawnVanillaMineLoot(dimension, player, blockLoc, spawnLoc) {
    const x = commandNumber(blockLoc.x);
    const y = commandNumber(blockLoc.y);
    const z = commandNumber(blockLoc.z);
    const sx = spawnLoc.x;
    const sy = spawnLoc.y;
    const sz = spawnLoc.z;
    try {
        dimension.runCommand(`execute as "${quoteCommandString(player.name)}" run loot spawn ${sx} ${sy} ${sz} mine ${x} ${y} ${z} mainhand`);
        return true;
    } catch {
        return false;
    }
}

function setAir(dimension, loc) {
    const x = commandNumber(loc.x);
    const y = commandNumber(loc.y);
    const z = commandNumber(loc.z);
    try {
        dimension.runCommand(`setblock ${x} ${y} ${z} air`);
        return true;
    } catch {
        try {
            const block = dimension.getBlock({ x, y, z });
            block?.setType?.("minecraft:air");
            return true;
        } catch {}
    }
    return false;
}

export function initMassMiningSystem() {
    world.afterEvents.playerBreakBlock.subscribe((event) => {
        const { block, player, brokenBlockPermutation } = event;

        const equipment = player.getComponent("minecraft:equippable");
        if (!equipment) return;

        const mainHandItem = equipment.getEquipment(EquipmentSlot.Mainhand);
        if (!mainHandItem || !hasMassLore(mainHandItem)) return;
        if (player.isSneaking) return;

        const toolId = mainHandItem.typeId;
        const originBlockId = brokenBlockPermutation?.type?.id ?? "";
        const targetKind = getTargetKind(originBlockId, toolId);
        if (targetKind === "none") return;

        const dimension = block.dimension;
        const dropOrigin = { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 };

        const queue = [{ x: block.x, y: block.y, z: block.z }];
        const visited = new Set([`${block.x},${block.y},${block.z}`]);
        let breakCount = 0;

        system.runJob(function* () {
            while (queue.length > 0 && breakCount < MAX_BREAK_LIMIT) {
                const current = queue.shift();

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            if (dx === 0 && dy === 0 && dz === 0) continue;

                            const tx = current.x + dx;
                            const ty = current.y + dy;
                            const tz = current.z + dz;
                            const posKey = `${tx},${ty},${tz}`;
                            if (visited.has(posKey)) continue;
                            visited.add(posKey);

                            const targetLoc = { x: tx, y: ty, z: tz };
                            const targetBlock = dimension.getBlock(targetLoc);
                            if (!targetBlock) continue;

                            const targetTypeId = targetBlock.typeId;
                            if (!matchesTargetKind(targetTypeId, targetKind, originBlockId)) continue;

                            const shouldSuppressNormalLoot =
                                targetTypeId === "minecraft:ancient_debris" &&
                                registerPendingBlockDrop(
                                    player,
                                    targetTypeId,
                                    targetLoc,
                                    dropOrigin,
                                    undefined,
                                    { suppressNormalAncientDebrisDrop: true }
                                );

                            if (targetTypeId !== "minecraft:ancient_debris") {
                                registerPendingBlockDrop(
                                    player,
                                    targetTypeId,
                                    targetLoc,
                                    dropOrigin,
                                    undefined,
                                    { suppressNormalAncientDebrisDrop: false }
                                );
                            }

                            if (!shouldSuppressNormalLoot) {
                                spawnVanillaMineLoot(dimension, player, targetLoc, dropOrigin);
                            }

                            setAir(dimension, targetLoc);
                            breakCount++;
                            queue.push(targetLoc);
                            yield;
                        }
                    }
                }
            }
        }());
    });
}
