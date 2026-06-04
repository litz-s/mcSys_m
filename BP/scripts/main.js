import { world, system } from "@minecraft/server";
import "./drop_crafting.js";
import "./system_backpack.js";
import { initMassCraftingSystem } from "./mass_crafting.js";
import { initMassMiningSystem } from "./mass_mining.js";
import "./system_extra_drop.js";

import { syncHud } from "./ui_sync.js";
import { debugPlayerState } from "./debug.js";
import { tickHeat } from "./system_heat.js";
import { tickEndHardcore } from "./system_end.js";
import {
    tickVitality,
    initializePlayerState,
} from "./system_vitality.js";
import { tickAutoUse } from "./system_auto_use.js";
import { initNetheriteBonusSystem, applyNetheriteEffectImmunity } from "./system_netherite.js";
import { tickShiftTyelya } from "./system_shift_tyelya.js";

function bootstrapPlayer(player) {
    initializePlayerState(player);
    syncHud(player);
}

system.run(() => {
    initMassCraftingSystem();
    initMassMiningSystem();
    initNetheriteBonusSystem();
    for (const player of world.getAllPlayers()) {
        bootstrapPlayer(player);
    }
});

system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        try {
            initializePlayerState(player);
            tickHeat(player);
            tickVitality(player);
            tickAutoUse(player);
            tickEndHardcore(player);
            applyNetheriteEffectImmunity(player);
            syncHud(player);
            debugPlayerState(player, "MAIN");
            tickShiftTyelya(player);
        } catch (e) {
            console.warn(`[Main Tick Error] ${player.name}: ${e}`);
        }
    }
}, 1);
