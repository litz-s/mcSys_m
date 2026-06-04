import { system } from "@minecraft/server";
import { getManiaMask } from "./system_end.js";

const CHUNK_WIDTH = 100;
const DEBUG_HUD_TEXTURE_PATHS = false;
const lastDebugTickByPlayer = new WeakMap();

function clampInt(value, min, max) {
    const n = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : min;
    return Math.max(min, Math.min(max, n));
}

function toUnicode(char) {
    return (char.slice(0, 1).charCodeAt(0).toString(16).padStart(4, "0"))
        .split("")
        .map(n => parseInt(n, 16));
}

function getUnicodeSize(text) {
    let totalSize = 0;
    for (const char of String(text).split("")) {
        const code = toUnicode(char);
        if (code[2] < 8 && code[0] === 0 && code[1] === 0) totalSize += 1;
        else if (code[1] < 8 && code[0] === 0) totalSize += 2;
        else totalSize += 3;
    }
    return totalSize;
}

function padChunk(text) {
    const value = String(text);
    const width = getUnicodeSize(value);
    if (width >= CHUNK_WIDTH) return value;
    return value + "\t".repeat(CHUNK_WIDTH - width);
}

function texturePath(folder, stage) {
    return `textures/ui/${folder}/value_${stage}`;
}

export function syncHud(player) {
    try {
        const heat = clampInt(player.getDynamicProperty("heat") ?? 0, 0, 100);
        const wetness = clampInt(player.getDynamicProperty("wetness") ?? 0, 0, 100);
        const water = clampInt(player.getDynamicProperty("water_level") ?? 7, 0, 10);
        const vitality = clampInt(player.getDynamicProperty("vitality") ?? 5, 0, 10);
        const voidPressure = clampInt(player.getDynamicProperty("void_pressure") ?? 0, 0, 20);
        const maniaMask = clampInt(getManiaMask(player), 0, 31);

        const heatStage = clampInt(Math.floor(heat / 5), 0, 20);
        const wetnessStage = clampInt(Math.floor(wetness / 5), 0, 20);

        const texturePaths = [
            texturePath("heat_bar", heatStage),
            texturePath("wetness_bar", wetnessStage),
            texturePath("water_gauge", water),
            texturePath("vitality_gauge", vitality),

            texturePath("heat_number", heat),
            texturePath("wetness_number", wetness),
            texturePath("void_pressure_bar", voidPressure),
            texturePath("mania_slots", maniaMask),
            texturePath("heat_number", voidPressure),
        ];

        const titlePayload = texturePaths.map(padChunk).join("");
        player.onScreenDisplay.setTitle(titlePayload);

        if (DEBUG_HUD_TEXTURE_PATHS) {
            const currentTick = system.currentTick;
            const previousTick = lastDebugTickByPlayer.get(player) ?? -999999;
            if (currentTick - previousTick >= 100) {
                lastDebugTickByPlayer.set(player, currentTick);
                console.warn(`[HUD PATH DBG] ${player.name}: ${texturePaths.join(" | ")}`);
            }
        }
    } catch (e) {
        console.warn(`[HUD Sync Error] ${player.name}: ${e}`);
    }
}

export function ensureHudObjectives() {}
