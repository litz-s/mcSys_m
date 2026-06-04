import { system } from "@minecraft/server";

export const DEBUG_MODE = false;

function formatValue(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value.toFixed(2) : String(value);
    }
    return String(value);
}

export function debugPlayerState(player, label = "") {
    if (!DEBUG_MODE) return;

    try {
        const tick = system.currentTick;
        const heat = player.getDynamicProperty("heat") ?? "undef";
        const wetness = player.getDynamicProperty("wetness") ?? "undef";
        const water = player.getDynamicProperty("water_level") ?? "undef";
        const vitality = player.getDynamicProperty("vitality") ?? "undef";
        const vitTimer = player.getDynamicProperty("vitality_timer") ?? "undef";
        const hydTimer = player.getDynamicProperty("hydration_timer") ?? "undef";
        const heatProtection = player.getDynamicProperty("dbg_heat_protection_multiplier") ?? 1;
        const wetProtection = player.getDynamicProperty("dbg_wet_protection_multiplier") ?? 1;

        if (tick % 20 === 0) {
            player.onScreenDisplay.setActionBar(
                `§7[DBG${label ? `:${label}` : ""}] §fT:${tick} §cH:${formatValue(heat)} §bWt:${formatValue(wetness)} §9Wa:${formatValue(water)} §aVi:${formatValue(vitality)} §eVT:${formatValue(vitTimer)} §dHT:${formatValue(hydTimer)} §6Heat×:${formatValue(heatProtection)} §3Wet×:${formatValue(wetProtection)}`
            );
        }
    } catch (e) {
        console.warn(`[Debug HUD Error] ${player.name}: ${e}`);
    }
}

export function debugWarn(message) {
    if (DEBUG_MODE) {
        console.warn(`[DBG] ${message}`);
    }
}

export function safeSubscribe(signal, name, callback) {
    if (!signal || typeof signal.subscribe !== "function") {
        console.warn(`[DBG] Missing event signal: ${name}`);
        return false;
    }
    signal.subscribe(callback);
    return true;
}
