import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { safeSubscribe, debugWarn } from "./debug.js";
import { getItemNameJa } from "./vanilla_item_names_ja.js";

const BACKPACK_ID = "pls:copper_backpack";
const BACKPACK_LORE_PREFIX = "§8BPID:";
const BACKPACK_LAST_ID_PROP = "backpack_last_id";
const BACKPACK_RESTORE_ID_PROP = "backpack_restore_id";

const LEVEL_LIMITS = {
    1: 8,
    2: 14,
    3: 22,
    4: 34,
    5: 60,
    6: 68,
    7: 80,
    8: 132,
    9: 142,
    10: 155,
};

const UPGRADE_COSTS = {
    2: { core: 1, branch: 1 },
    3: { core: 2, branch: 1 },
    4: { core: 3, branch: 2 },
    5: { core: 6, branch: 4 },
    6: { core: 7, branch: 5 },
    7: { core: 8, branch: 6 },
    8: { core: 15, branch: 12 },
    9: { core: 15, branch: 13 },
    10: { core: 15, branch: 15 },
};

function isPlayer(entity) {
    return entity?.typeId === "minecraft:player";
}

function makeId() {
    return `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

function dataKey(id) {
    return `backpack_data_${id}`;
}

function rememberBackpackId(player, id) {
    try {
        const current = String(player.getDynamicProperty(BACKPACK_LAST_ID_PROP) ?? "");
        if (current && current !== id) {

            player.setDynamicProperty(BACKPACK_RESTORE_ID_PROP, current);
        }
        player.setDynamicProperty(BACKPACK_LAST_ID_PROP, id);
    } catch {}
}

function parseBackpackId(item) {
    try {
        const lore = item?.getLore?.() ?? [];
        for (const line of lore) {
            if (typeof line === "string" && line.startsWith(BACKPACK_LORE_PREFIX)) {
                return line.slice(BACKPACK_LORE_PREFIX.length).trim();
            }
        }
    } catch {}
    return "";
}

function getSelectedSlot(player) {
    try {
        return player.selectedSlotIndex ?? 0;
    } catch {
        return 0;
    }
}

function getHeldItem(player) {
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        return inv?.getItem(getSelectedSlot(player));
    } catch {
        return undefined;
    }
}

function setHeldBackpackId(player, id) {
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        if (!inv) return false;
        const slot = getSelectedSlot(player);
        const item = inv.getItem(slot);
        if (!item || item.typeId !== BACKPACK_ID) return false;
        const clone = item.clone();
        const lore = (clone.getLore?.() ?? []).filter(line => !String(line).startsWith(BACKPACK_LORE_PREFIX));
        lore.push(`${BACKPACK_LORE_PREFIX}${id}`);
        clone.setLore(lore);
        inv.setItem(slot, clone);
        return true;
    } catch (e) {
        debugWarn(`set backpack id failed: ${e}`);
        return false;
    }
}

function ensureBackpackId(player, item) {
    let id = parseBackpackId(item);
    if (id) {
        rememberBackpackId(player, id);
        return id;
    }

    id = makeId();
    if (setHeldBackpackId(player, id)) {
        const data = loadBackpack(id);
        saveBackpack(id, data);
        rememberBackpackId(player, id);
        return id;
    }
    return "";
}

function emptyData() {
    return { level: 1, items: {} };
}

function loadBackpack(id) {
    try {
        const raw = world.getDynamicProperty(dataKey(id));
        if (typeof raw !== "string" || raw.length === 0) return emptyData();
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object") return emptyData();
        if (!data.items || typeof data.items !== "object") data.items = {};
        data.level = Math.max(1, Math.min(10, Number(data.level ?? 1)));
        return data;
    } catch {
        return emptyData();
    }
}

function saveBackpack(id, data) {
    try {
        world.setDynamicProperty(dataKey(id), JSON.stringify(data));
        return true;
    } catch (e) {
        debugWarn(`save backpack failed: ${e}`);
        return false;
    }
}

function cloneBackpackData(data) {
    const source = data && typeof data === "object" ? data : emptyData();
    const cloned = {
        level: Math.max(1, Math.min(10, Number(source.level ?? 1))),
        items: {},
    };

    if (source.items && typeof source.items === "object") {
        for (const [typeId, record] of Object.entries(source.items)) {
            if (!record || typeof record !== "object") continue;
            cloned.items[typeId] = {
                count: Math.max(0, Number(record.count ?? 0)),
                maxStack: Math.max(1, Number(record.maxStack ?? 64)),
            };
        }
    }

    return cloned;
}

function getCapacity(data) {
    return LEVEL_LIMITS[data.level] ?? LEVEL_LIMITS[1];
}

function getUsedSlots(data) {
    let used = 0;
    for (const record of Object.values(data.items ?? {})) {
        const count = Math.max(0, Number(record.count ?? 0));
        const maxStack = Math.max(1, Number(record.maxStack ?? 64));
        if (count > 0) used += Math.ceil(count / maxStack);
    }
    return used;
}

function formatSummary(data) {
    return `Lv${data.level} / ${getUsedSlots(data)}st 使用中 / 上限 ${getCapacity(data)}st`;
}

function getMaxAmount(stack) {
    try {
        return Math.max(1, Number(stack.maxAmount ?? stack.maxStackSize ?? 64));
    } catch {
        return 64;
    }
}

function isStorableStack(stack) {
    if (!stack) return false;
    if (stack.typeId === BACKPACK_ID) return false;
    if (stack.typeId.includes("shulker_box")) return false;
    if (stack.typeId === "minecraft:bundle") return false;

    if (getMaxAmount(stack) <= 1) return false;
    try {
        if ((stack.getLore?.() ?? []).length > 0) return false;
    } catch {}
    return true;
}

function collectInventoryTypes(player) {
    const map = new Map();
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        if (!inv) return [];
        for (let i = 0; i < inv.size; i++) {
            const stack = inv.getItem(i);
            if (!isStorableStack(stack)) continue;
            const maxStack = getMaxAmount(stack);
            const current = map.get(stack.typeId) ?? { typeId: stack.typeId, count: 0, maxStack };
            current.count += stack.amount;
            current.maxStack = Math.max(current.maxStack, maxStack);
            map.set(stack.typeId, current);
        }
    } catch {}
    return [...map.values()].sort((a, b) => a.typeId.localeCompare(b.typeId));
}

function countInventoryItem(player, typeId) {
    let total = 0;
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        if (!inv) return 0;
        for (let i = 0; i < inv.size; i++) {
            const stack = inv.getItem(i);
            if (!stack || stack.typeId !== typeId) continue;
            total += stack.amount;
        }
    } catch {}
    return total;
}

function removeInventoryItem(player, typeId, count) {
    let remaining = count;
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        if (!inv) return false;

        for (let i = 0; i < inv.size && remaining > 0; i++) {
            const stack = inv.getItem(i);
            if (!stack || stack.typeId !== typeId) continue;
            const take = Math.min(stack.amount, remaining);
            const nextAmount = stack.amount - take;
            if (nextAmount <= 0) {
                inv.setItem(i, undefined);
            } else {
                const clone = stack.clone();
                clone.amount = nextAmount;
                inv.setItem(i, clone);
            }
            remaining -= take;
        }
        return remaining <= 0;
    } catch {
        return false;
    }
}

function freeCapacityFor(player, typeId, maxStack) {
    let capacity = 0;
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        if (!inv) return 0;
        for (let i = 0; i < inv.size; i++) {
            const stack = inv.getItem(i);
            if (!stack) {
                capacity += maxStack;
            } else if (stack.typeId === typeId && stack.amount < getMaxAmount(stack)) {
                capacity += Math.max(0, getMaxAmount(stack) - stack.amount);
            }
        }
    } catch {}
    return capacity;
}

function giveItem(player, typeId, count, maxStack) {
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        if (!inv) return false;
        let remaining = count;
        while (remaining > 0) {
            const amount = Math.min(maxStack, remaining);
            const stack = new ItemStack(typeId, amount);
            const leftover = inv.addItem(stack);
            if (leftover && leftover.amount > 0) return false;
            remaining -= amount;
        }
        return true;
    } catch {
        return false;
    }
}

function getSlotsAfterAdd(data, typeId, count, maxStack) {
    const copy = JSON.parse(JSON.stringify(data));
    const rec = copy.items[typeId] ?? { count: 0, maxStack };
    rec.count += count;
    rec.maxStack = Math.max(1, Number(rec.maxStack ?? maxStack), maxStack);
    copy.items[typeId] = rec;
    return getUsedSlots(copy);
}

function parsePositiveInt(value) {
    const n = Math.floor(Number(String(value ?? "").trim()));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function addStoredItem(data, typeId, count, maxStack) {
    const rec = data.items[typeId] ?? { count: 0, maxStack };
    rec.count += count;
    rec.maxStack = Math.max(1, Number(rec.maxStack ?? maxStack), maxStack);
    data.items[typeId] = rec;
}

function removeStoredItem(data, typeId, count) {
    const rec = data.items[typeId];
    if (!rec) return false;
    rec.count -= count;
    if (rec.count <= 0) delete data.items[typeId];
    else data.items[typeId] = rec;
    return true;
}

function showActionbar(player, message) {
    try { player.onScreenDisplay.setActionBar(message); } catch {}
}

function reopen(fn) {
    system.runTimeout(fn, 1);
}

function showLater(fn) {
    system.runTimeout(fn, 1);
}

function showMain(player, id, message = "") {
    const data = loadBackpack(id);
    const form = new ActionFormData()
        .title(`銅のバックパック ${formatSummary(data)}`)
        .body(`${message ? `${message}\n\n` : ""}バックパックID: ${id}\n\n保管データはこのバックパックIDに紐づいて保存されます。`)
        .button("保管する")
        .button("取り出す")
        .button("拡張する")
        .button("復元");

    form.show(player).then((res) => {
        if (res.canceled) return;
        if (res.selection === 0) showLater(() => showDepositList(player, id));
        else if (res.selection === 1) showLater(() => showWithdrawList(player, id));
        else if (res.selection === 2) showLater(() => showExpand(player, id));
        else if (res.selection === 3) showLater(() => showRestore(player, id));
    }).catch((e) => debugWarn(`backpack main form failed: ${e}`));
}

function showDepositList(player, id, message = "") {
    const data = loadBackpack(id);
    const items = collectInventoryTypes(player);

    const form = new ActionFormData()
        .title(`保管する ${formatSummary(data)}`)
        .body(message || "保管するアイテムの種類を選んでください。\n※耐久/Lore付き/非スタック品/バックパック/シュルカーは除外しています。");

    if (items.length === 0) {
        form.button("戻る");
        form.show(player).then(() => showLater(() => showMain(player, id)));
        return;
    }

    for (const item of items) {
        form.button(`${getItemNameJa(item.typeId)}\n${item.typeId} / 所持: ${item.count}`);
    }
    form.button("戻る");

    form.show(player).then((res) => {
        if (res.canceled) return;
        if (res.selection === items.length) {
            showLater(() => showMain(player, id));
            return;
        }
        const selected = items[res.selection];
        if (selected) showLater(() => showDepositAmount(player, id, selected));
    }).catch((e) => { debugWarn(`deposit list failed: ${e}`); showActionbar(player, "§c保管リストの表示に失敗しました。"); });
}

function showDepositAmount(player, id, item, message = "") {
    const data = loadBackpack(id);
    const owned = countInventoryItem(player, item.typeId);
    const currentSlots = getUsedSlots(data);
    const form = new ModalFormData()
        .title(`保管する ${formatSummary(data)}`)
        .textField(
            `${message ? `${message}\n\n` : ""}${getItemNameJa(item.typeId)}\n${item.typeId}\n所持数: ${owned}\n現在: ${currentSlots}/${getCapacity(data)}st\n保管する個数を入力`,
            "例: 64",
            { defaultValue: String(Math.min(owned, item.maxStack)) }
        )
        .submitButton("保管");

    form.show(player).then((res) => {
        if (res.canceled) {
            showLater(() => showDepositList(player, id));
            return;
        }

        const count = parsePositiveInt(res.formValues?.[0]);
        const latestData = loadBackpack(id);
        const latestOwned = countInventoryItem(player, item.typeId);

        if (count <= 0) {
            showLater(() => showDepositAmount(player, id, item, "§c1以上の数値を入力してください。"));
            return;
        }
        if (count > latestOwned) {
            showLater(() => showDepositAmount(player, id, item, "§c十分な個数を所持していません。"));
            return;
        }
        if (getSlotsAfterAdd(latestData, item.typeId, count, item.maxStack) > getCapacity(latestData)) {
            showLater(() => showDepositAmount(player, id, item, "§cバックパックの保管上限を超えます。"));
            return;
        }
        if (!removeInventoryItem(player, item.typeId, count)) {
            showLater(() => showDepositAmount(player, id, item, "§cアイテムの消費に失敗しました。"));
            return;
        }

        addStoredItem(latestData, item.typeId, count, item.maxStack);
        if (!saveBackpack(id, latestData)) {

            try { giveItem(player, item.typeId, count, item.maxStack); } catch {}
            showLater(() => showDepositAmount(player, id, item, "§cバックパックデータの保存に失敗しました。"));
            return;
        }
        showLater(() => showDepositList(player, id, `§a${getItemNameJa(item.typeId)} を ${count} 個保管しました。`));
    }).catch((e) => { debugWarn(`deposit amount failed: ${e}`); showActionbar(player, "§c個数入力フォームの表示に失敗しました。"); });
}

function showWithdrawList(player, id, message = "") {
    const data = loadBackpack(id);
    const entries = Object.entries(data.items ?? {})
        .filter(([, rec]) => Number(rec.count ?? 0) > 0)
        .sort(([a], [b]) => a.localeCompare(b));

    const form = new ActionFormData()
        .title(`取り出す ${formatSummary(data)}`)
        .body(message || "取り出すアイテムの種類を選んでください。");

    if (entries.length === 0) {
        form.body(message || "バックパックは空です。");
        form.button("戻る");
        form.show(player).then(() => showLater(() => showMain(player, id)));
        return;
    }

    for (const [typeId, rec] of entries) {
        form.button(`${getItemNameJa(typeId)}\n${typeId} / 保管: ${rec.count}`);
    }
    form.button("戻る");

    form.show(player).then((res) => {
        if (res.canceled) return;
        if (res.selection === entries.length) {
            showLater(() => showMain(player, id));
            return;
        }
        const entry = entries[res.selection];
        if (entry) showLater(() => showWithdrawAmount(player, id, entry[0], entry[1]));
    }).catch((e) => { debugWarn(`withdraw list failed: ${e}`); showActionbar(player, "§c取り出しリストの表示に失敗しました。"); });
}

function showWithdrawAmount(player, id, typeId, rec, message = "") {
    const data = loadBackpack(id);
    const stored = Number(data.items?.[typeId]?.count ?? rec.count ?? 0);
    const maxStack = Math.max(1, Number(data.items?.[typeId]?.maxStack ?? rec.maxStack ?? 64));
    const form = new ModalFormData()
        .title(`取り出す ${formatSummary(data)}`)
        .textField(
            `${message ? `${message}\n\n` : ""}${getItemNameJa(typeId)}\n${typeId}\n保管数: ${stored}\n現在: ${getUsedSlots(data)}/${getCapacity(data)}st\n取り出す個数を入力`,
            "例: 64",
            { defaultValue: String(Math.min(stored, maxStack)) }
        )
        .submitButton("取り出す");

    form.show(player).then((res) => {
        if (res.canceled) {
            showLater(() => showWithdrawList(player, id));
            return;
        }

        const count = parsePositiveInt(res.formValues?.[0]);
        const latestData = loadBackpack(id);
        const latestRec = latestData.items?.[typeId];
        const latestStored = Number(latestRec?.count ?? 0);
        const latestMaxStack = Math.max(1, Number(latestRec?.maxStack ?? maxStack));

        if (count <= 0) {
            showLater(() => showWithdrawAmount(player, id, typeId, latestRec ?? rec, "§c1以上の数値を入力してください。"));
            return;
        }
        if (count > latestStored) {
            showLater(() => showWithdrawAmount(player, id, typeId, latestRec ?? rec, "§c十分な個数が保管されていません。"));
            return;
        }
        if (freeCapacityFor(player, typeId, latestMaxStack) < count) {
            showLater(() => showWithdrawAmount(player, id, typeId, latestRec ?? rec, "§cインベントリに十分な空きがありません。"));
            return;
        }

        if (!giveItem(player, typeId, count, latestMaxStack)) {
            showLater(() => showWithdrawAmount(player, id, typeId, latestRec ?? rec, "§cアイテムの取り出しに失敗しました。"));
            return;
        }

        removeStoredItem(latestData, typeId, count);
        if (!saveBackpack(id, latestData)) {
            showLater(() => showWithdrawAmount(player, id, typeId, latestRec ?? rec, "§cバックパックデータの保存に失敗しました。"));
            return;
        }
        showLater(() => showWithdrawList(player, id, `§a${getItemNameJa(typeId)} を ${count} 個取り出しました。`));
    }).catch((e) => { debugWarn(`withdraw amount failed: ${e}`); showActionbar(player, "§c個数入力フォームの表示に失敗しました。"); });
}

function showExpand(player, id, message = "") {
    const data = loadBackpack(id);
    const next = data.level + 1;
    const form = new ActionFormData().title(`拡張する ${formatSummary(data)}`);

    if (data.level >= 10) {
        form.body(`${message ? `${message}\n\n` : ""}これ以上拡張できません。最大レベルです。`);
        form.button("戻る");
        form.show(player).then(() => showLater(() => showMain(player, id)));
        return;
    }

    const cost = UPGRADE_COSTS[next];
    const ownedCore = countInventoryItem(player, "pls:copper_core");
    const ownedBoard = countInventoryItem(player, "pls:copper_board");

    form.body(
        `${message ? `${message}\n\n` : ""}` +
        `現在: Lv${data.level} / ${getCapacity(data)}st\n` +
        `次: Lv${next} / ${LEVEL_LIMITS[next]}st\n\n` +
        `必要素材:\n` +
        `銅のコア: ${cost.core} / 所持 ${ownedCore}\n` +
        `銅板: ${cost.branch} / 所持 ${ownedBoard}`
    );
    form.button("拡張");
    form.button("戻る");

    form.show(player).then((res) => {
        if (res.canceled) return;
        if (res.selection === 1) {
            showLater(() => showMain(player, id));
            return;
        }

        const latest = loadBackpack(id);
        if (latest.level >= 10) {
            showLater(() => showExpand(player, id, "§cすでに最大レベルです。"));
            return;
        }

        const latestNext = latest.level + 1;
        const latestCost = UPGRADE_COSTS[latestNext];
        if (countInventoryItem(player, "pls:copper_core") < latestCost.core || countInventoryItem(player, "pls:copper_board") < latestCost.branch) {
            showLater(() => showExpand(player, id, "§c拡張素材が足りません。"));
            return;
        }

        if (!removeInventoryItem(player, "pls:copper_core", latestCost.core) || !removeInventoryItem(player, "pls:copper_board", latestCost.branch)) {
            showLater(() => showExpand(player, id, "§c素材の消費に失敗しました。"));
            return;
        }

        latest.level = latestNext;
        saveBackpack(id, latest);
        showLater(() => showExpand(player, id, `§aLv${latestNext} に拡張しました。`));
    }).catch((e) => debugWarn(`expand form failed: ${e}`));
}

function showRestore(player, currentId, message = "") {
    const restoreId = String(player.getDynamicProperty(BACKPACK_RESTORE_ID_PROP) ?? "");
    const lastId = String(player.getDynamicProperty(BACKPACK_LAST_ID_PROP) ?? "");
    const targetId = restoreId && restoreId !== currentId ? restoreId : (lastId && lastId !== currentId ? lastId : "");
    const currentData = loadBackpack(currentId);
    const form = new ActionFormData().title(`復元 ${formatSummary(currentData)}`);

    if (!targetId) {
        form.body(`${message ? `${message}\n\n` : ""}復元できる過去のバックパックIDがありません。\n\n※復元候補は「以前のバックパックを一度開いた後、新しいバックパックを開いた時」に記録されます。`);
        form.button("戻る");
        form.show(player).then(() => showLater(() => showMain(player, currentId)));
        return;
    }

    const targetData = loadBackpack(targetId);

    if (getUsedSlots(currentData) > 0) {
        form.body(`${message ? `${message}\n\n` : ""}現在のバックパックに中身があります。\nデータ上書き防止のため、空のバックパックでのみ復元できます。`);
        form.button("戻る");
        form.show(player).then(() => showLater(() => showMain(player, currentId)));
        return;
    }

    if (getUsedSlots(targetData) <= 0 && Number(targetData.level ?? 1) <= 1) {
        form.body(`${message ? `${message}\n\n` : ""}過去IDの保管データが見つからないか、空の初期データです。\n\n過去ID: ${targetId}`);
        form.button("戻る");
        form.show(player).then(() => showLater(() => showMain(player, currentId)));
        return;
    }

    const ownedCore = countInventoryItem(player, "pls:copper_core");
    form.body(
        `${message ? `${message}\n\n` : ""}` +
        `過去ID: ${targetId}\n現在ID: ${currentId}\n\n` +
        `過去データ: ${formatSummary(targetData)}\n` +
        `現在データ: ${formatSummary(currentData)}\n\n` +
        `復元には銅のコア3個が必要です。\n` +
        `銅のコア: 3 / 所持 ${ownedCore}\n\n` +
        `復元すると、過去IDの中身・レベル・上限stを現在のバックパックへコピーします。`
    );
    form.button("復元");
    form.button("戻る");

    form.show(player).then((res) => {
        if (res.canceled) return;
        if (res.selection === 1) {
            showLater(() => showMain(player, currentId));
            return;
        }

        const latestCurrent = loadBackpack(currentId);
        const latestTarget = loadBackpack(targetId);

        if (getUsedSlots(latestCurrent) > 0) {
            showLater(() => showRestore(player, currentId, "§c現在のバックパックに中身があります。空にしてから復元してください。"));
            return;
        }

        if (getUsedSlots(latestTarget) <= 0 && Number(latestTarget.level ?? 1) <= 1) {
            showLater(() => showRestore(player, currentId, "§c過去バックパックのデータが見つかりません。"));
            return;
        }

        if (countInventoryItem(player, "pls:copper_core") < 3) {
            showLater(() => showRestore(player, currentId, "§c銅のコアが足りません。"));
            return;
        }

        if (!removeInventoryItem(player, "pls:copper_core", 3)) {
            showLater(() => showRestore(player, currentId, "§c素材の消費に失敗しました。"));
            return;
        }

        const restoredData = cloneBackpackData(latestTarget);

        if (!saveBackpack(currentId, restoredData)) {
            showLater(() => showRestore(player, currentId, "§c復元データの保存に失敗しました。"));
            return;
        }

        setHeldBackpackId(player, currentId);

        try {
            player.setDynamicProperty(BACKPACK_LAST_ID_PROP, currentId);
            player.setDynamicProperty(BACKPACK_RESTORE_ID_PROP, "");
        } catch {}

        showLater(() => showMain(player, currentId, `§a過去のバックパックデータを復元しました。\nLv${restoredData.level} / 上限 ${getCapacity(restoredData)}st を引き継ぎました。`));
    }).catch((e) => debugWarn(`restore form failed: ${e}`));
}

safeSubscribe(world.beforeEvents?.itemUse, "beforeEvents.itemUse.backpack", (event) => {
    const player = event.source;
    const item = event.itemStack;
    if (!isPlayer(player) || item?.typeId !== BACKPACK_ID) return;

    event.cancel = true;
    system.run(() => {
        try {
            const held = getHeldItem(player) ?? item;
            const id = ensureBackpackId(player, held);
            if (!id) {
                showActionbar(player, "§cバックパックIDを作成できませんでした。");
                return;
            }
            showLater(() => showMain(player, id));
        } catch (e) {
            debugWarn(`open backpack failed: ${e}`);
        }
    });
});
