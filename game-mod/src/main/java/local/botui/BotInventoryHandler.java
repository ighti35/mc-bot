package local.botui;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.EnchantmentEffectComponentTypes;
import net.minecraft.enchantment.EnchantmentHelper;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.screen.slot.Slot;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import java.util.HashMap;
import java.util.Map;
public class BotInventoryHandler extends ScreenHandler {
    final ServerPlayerEntity viewer, target;
    private final SimpleInventory statusInventory = new SimpleInventory(13);
    private final Map<String, Integer> durations = new HashMap<>();
    private int ticks; private boolean closed;
    static final EquipmentSlot[] EQUIPMENT = { EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET, EquipmentSlot.OFFHAND };
    static final int[] EQUIPMENT_INDEX = { 39, 38, 37, 36, 40 };
    BotInventoryHandler(int syncId, ServerPlayerEntity viewer, ServerPlayerEntity target) {
        super(ScreenHandlerType.GENERIC_9X6, syncId); this.viewer = viewer; this.target = target;
        for (int i = 0; i < 27; i++) addSlot(new Slot(target.getInventory(), i + 9, 8 + i % 9 * 18, 106 + i / 9 * 18));
        for (int i = 0; i < 9; i++) addSlot(new Slot(target.getInventory(), i, 8 + i * 18, 166));
        for (int i = 0; i < 5; i++) {
            final EquipmentSlot equipment = EQUIPMENT[i];
            addSlot(new Slot(target.getInventory(), EQUIPMENT_INDEX[i], 8 + i * 34, 64) {
                @Override public boolean canInsert(ItemStack stack) { return equipment == EquipmentSlot.OFFHAND || target.canEquip(stack, equipment); }
                @Override public boolean isEnabled() { return target.canUseSlot(equipment); }
                @Override public void setStack(ItemStack stack, ItemStack previousStack) {
                    target.onEquipStack(equipment, previousStack, stack);
                    super.setStack(stack, previousStack);
                }
                @Override public int getMaxItemCount() { return equipment == EquipmentSlot.OFFHAND ? 64 : 1; }
                @Override public boolean canTakeItems(PlayerEntity player) { return equipment == EquipmentSlot.OFFHAND || player.isCreative() || !EnchantmentHelper.hasAnyEnchantmentsWith(getStack(), EnchantmentEffectComponentTypes.PREVENT_ARMOR_CHANGE); }
            });
        }
        for (int i = 0; i < 13; i++) addSlot(new Slot(statusInventory, i, -1000, -1000) {
            @Override public boolean canInsert(ItemStack stack) { return false; }
            @Override public boolean canTakeItems(PlayerEntity player) { return false; }
        });
        for (int i = 0; i < 27; i++) addSlot(new Slot(viewer.getInventory(), i + 9, 190 + i % 9 * 18, 106 + i / 9 * 18));
        for (int i = 0; i < 9; i++) addSlot(new Slot(viewer.getInventory(), i, 190 + i * 18, 166));
        target.sendMessage(Text.literal("[BOT_UI] OPEN " + viewer.getName().getString()), false); updateStatus();
    }
    private void updateStatus() {
        JsonObject status = new JsonObject();
        status.addProperty("health", target.getHealth()); status.addProperty("maxHealth", target.getMaxHealth()); status.addProperty("absorption", target.getAbsorptionAmount());
        status.addProperty("food", target.getHungerManager().getFoodLevel()); status.addProperty("saturation", target.getHungerManager().getSaturationLevel()); status.addProperty("armor", target.getArmor());
        JsonArray effects = new JsonArray(); Map<String, Integer> active = new HashMap<>();
        for (StatusEffectInstance effect : target.getStatusEffects()) {
            String key = effect.getEffectType().value().getTranslationKey(); int maximum = Math.max(effect.getDuration(), durations.getOrDefault(key, 0)); active.put(key, maximum);
            JsonObject data = new JsonObject(); data.addProperty("key", key); data.addProperty("level", effect.getAmplifier() + 1); data.addProperty("duration", effect.getDuration()); data.addProperty("maximum", maximum);
            data.addProperty("infinite", effect.isInfinite()); data.addProperty("beneficial", effect.getEffectType().value().isBeneficial()); effects.add(data);
        }
        durations.clear(); durations.putAll(active); status.add("effects", effects);
        ItemStack carrier = new ItemStack(Items.PAPER); carrier.set(DataComponentTypes.CUSTOM_NAME, Text.literal(status.toString())); statusInventory.setStack(12, carrier);
    }
    @Override public void sendContentUpdates() {
        if (!closed && ++ticks % 5 == 0) updateStatus();
        if (!closed && ticks % 20 == 0) target.sendMessage(Text.literal("[BOT_UI] OPEN " + viewer.getName().getString()), false);
        super.sendContentUpdates(); if (!closed) target.playerScreenHandler.sendContentUpdates();
    }
    @Override public boolean canUse(PlayerEntity player) {
        return !closed && player == viewer && target.isAlive() && !target.isRemoved() && target.getEntityWorld() == viewer.getEntityWorld()
            && viewer.getPermissions().hasPermission(new net.minecraft.command.permission.Permission.Level(net.minecraft.command.permission.PermissionLevel.GAMEMASTERS));
    }
    @Override public ItemStack quickMove(PlayerEntity player, int index) {
        if (!canUse(player) || index < 0 || index >= slots.size() || index >= 41 && index < 54) return ItemStack.EMPTY;
        Slot slot = slots.get(index); if (!slot.hasStack() || !slot.canTakeItems(player)) return ItemStack.EMPTY;
        ItemStack stack = slot.getStack(), original = stack.copy();
        if (index < 41) { if (!insertItem(stack, 54, 90, true)) return ItemStack.EMPTY; }
        else {
            boolean equipped = false;
            for (int i = 36; i < 40; i++) if (!slots.get(i).hasStack() && slots.get(i).canInsert(stack)) { equipped = insertItem(stack, i, i + 1, false); break; }
            if (!stack.isEmpty() && !insertItem(stack, 0, 36, false) && !equipped) return ItemStack.EMPTY;
        }
        if (stack.isEmpty()) slot.setStack(ItemStack.EMPTY); else slot.markDirty();
        if (stack.getCount() == original.getCount()) return ItemStack.EMPTY;
        slot.onTakeItem(player, stack); target.playerScreenHandler.sendContentUpdates(); return original;
    }
    @Override public void onClosed(PlayerEntity player) {
        super.onClosed(player); closed = true; BotInventoryMod.EDITORS.remove(target.getUuid(), this);
        target.sendMessage(Text.literal("[BOT_UI] CLOSE " + viewer.getName().getString()), false); target.playerScreenHandler.sendContentUpdates();
    }
}
