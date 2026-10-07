package local.botui;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.screen.GenericContainerScreenHandler;
import net.minecraft.screen.slot.Slot;
import net.minecraft.text.Text;
import net.minecraft.client.gui.widget.ButtonWidget;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
public class BotInventoryScreen extends HandledScreen<GenericContainerScreenHandler> {
    private static final String[] LABELS = {"头盔", "胸甲", "护腿", "靴子", "副手"};
    private String lastStatus = "";
    private JsonObject status = new JsonObject();
    public BotInventoryScreen(GenericContainerScreenHandler handler, PlayerInventory inventory, Text title) {
        super(handler, inventory, title); backgroundWidth = 360; backgroundHeight = 230;
        final PlayerInventory playerInventory = inventory;
        // Keep packet slot IDs and inventories, and move only client hitboxes.
        for (int i = 0; i < handler.slots.size(); i++) {
            Slot old = handler.slots.get(i); int sx = -1000, sy = -1000;
            if (i < 27) { sx = 8 + i % 9 * 18; sy = 106 + i / 9 * 18; }
            else if (i < 36) { sx = 8 + (i - 27) * 18; sy = 166; }
            else if (i < 41) { sx = 8 + (i - 36) * 34; sy = 64; }
            else if (i >= 54 && i < 81) { sx = 190 + (i - 54) % 9 * 18; sy = 106 + (i - 54) / 9 * 18; }
            else if (i >= 81) { sx = 190 + (i - 81) * 18; sy = 166; }
            final int id = i;
            Slot replacement = new Slot(old.inventory, old.getIndex(), sx, sy) {
                @Override public boolean canInsert(ItemStack stack) {
                    if (id >= 41 && id < 54) return false;
                    if (id >= 36 && id < 40) return playerInventory.player.canEquip(stack, BotInventoryHandler.EQUIPMENT[id - 36]);
                    return true;
                }
                @Override public boolean canTakeItems(net.minecraft.entity.player.PlayerEntity player) { return !(id >= 41 && id < 54); }
                @Override public int getMaxItemCount() { return id >= 36 && id < 40 ? 1 : 64; }
            };
            replacement.id = old.id; handler.slots.set(i, replacement);
        }
    }
    @Override protected void init(){super.init();addDrawableChild(ButtonWidget.builder(Text.literal("建筑图纸"),button->{client.player.closeHandledScreen();client.setScreen(new BotBuildScreen());}).dimensions(x+250,y+5,100,16).build());}
    private void readStatus() {
        String value = handler.getSlot(53).getStack().getName().getString();
        if (!value.equals(lastStatus)) { lastStatus = value; try { status = JsonParser.parseString(value).getAsJsonObject(); } catch (RuntimeException ignored) {} }
    }
    private float number(String key, float fallback) { try { return status.get(key).getAsFloat(); } catch (RuntimeException ignored) { return fallback; } }
    private void bar(DrawContext context, int bx, String label, float value, float maximum, int color) {
        context.drawText(textRenderer, label + " " + format(value) + "/" + format(maximum), x + bx, y + 25, 0xffe9eff0, false);
        context.fill(x + bx, y + 39, x + bx + 104, y + 43, 0xff34444e);
        context.fill(x + bx, y + 39, x + bx + (int)(104 * Math.clamp(value / Math.max(1, maximum), 0, 1)), y + 43, color);
    }
    private static String format(float value) { return value == (int)value ? String.valueOf((int)value) : String.format(Locale.ROOT, "%.1f", value); }
    private static String duration(JsonObject effect) {
        if (effect.get("infinite").getAsBoolean()) return "∞";
        int seconds = Math.max(0, effect.get("duration").getAsInt() / 20); return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
    }
    @Override protected void drawBackground(DrawContext context, float delta, int mouseX, int mouseY) {
        readStatus(); context.fill(x - 1, y - 1, x + backgroundWidth + 1, y + backgroundHeight + 1, 0xff60787f);
        context.fill(x, y, x + backgroundWidth, y + backgroundHeight, 0xff18252d); context.fill(x + 180, y + 52, x + 181, y + 185, 0xff43545c);
        context.drawText(textRenderer, title, x + 8, y + 8, 0xff9ae6c5, false);
        bar(context, 8, "生命", number("health",0), number("maxHealth",20), 0xffec7774);
        bar(context, 128, "饥饿", number("food",0), 20, 0xffe7b667);
        bar(context, 248, "护甲", number("armor",0), 20, 0xff8bbede);
        context.drawText(textRenderer, "机器人装备", x + 8, y + 51, 0xffb7ccd0, false);
        context.drawText(textRenderer, "拖放穿戴 / Shift 自动装备", x + 190, y + 65, 0xff92abae, false);
        context.drawText(textRenderer, "机器人背包", x + 8, y + 95, 0xffb7ccd0, false); context.drawText(textRenderer, "我的背包", x + 190, y + 95, 0xffb7ccd0, false);
        context.drawText(textRenderer, "快捷栏", x + 8, y + 156, 0xff829aa2, false); context.drawText(textRenderer, "快捷栏", x + 190, y + 156, 0xff829aa2, false);
        for (Slot slot : handler.slots) if (slot.x >= 0) {
            context.fill(x + slot.x - 1, y + slot.y - 1, x + slot.x + 17, y + slot.y + 17, 0xff405762);
            context.fill(x + slot.x, y + slot.y, x + slot.x + 16, y + slot.y + 16, 0xff0e1c24);
        }
        for (int i = 0; i < 5; i++) {
            context.drawText(textRenderer, LABELS[i], x + 5 + i * 34, y + 84, 0xffa0b7bd, false);
            if (!handler.getSlot(36 + i).hasStack()) context.drawText(textRenderer, "·", x + 14 + i * 34, y + 68, 0xff526974, false);
        }
        context.drawText(textRenderer, "状态效果 / Buff", x + 8, y + 189, 0xffb7ccd0, false);
        JsonArray effects = status.has("effects") ? status.getAsJsonArray("effects") : new JsonArray();
        if (effects.isEmpty()) context.drawText(textRenderer, "无状态效果", x + 113, y + 189, 0xff7e979f, false);
        for (int i = 0; i < Math.min(effects.size(),8); i++) {
            JsonObject effect = effects.get(i).getAsJsonObject(); int bx = x + 8 + i * 43, by = y + 202;
            String name = Text.translatable(effect.get("key").getAsString()).getString(); int color = effect.get("beneficial").getAsBoolean() ? 0xff9ae6c5 : 0xffef9b8e;
            name = textRenderer.trimToWidth(name, 26) + " " + effect.get("level").getAsInt();
            if (i == 7 && effects.size() > 8) name = "+" + (effects.size() - 7) + " 种";
            context.drawText(textRenderer, textRenderer.trimToWidth(name, 40), bx, by, color, false); context.drawText(textRenderer, duration(effect), bx, by + 10, 0xff91a8af, false);
            float ratio = effect.get("infinite").getAsBoolean() ? 1 : (float)effect.get("duration").getAsInt() / Math.max(1,effect.get("maximum").getAsInt());
            context.fill(bx, by + 21, bx + 39, by + 23, 0xff34444e); context.fill(bx, by + 21, bx + (int)(39 * Math.clamp(ratio,0,1)), by + 23, color);
        }
    }
    @Override protected void drawForeground(DrawContext context, int mouseX, int mouseY) {}
    @Override public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        super.render(context, mouseX, mouseY, delta); drawMouseoverTooltip(context, mouseX, mouseY);
        if (mouseY >= y + 200 && mouseY <= y + 226 && mouseX >= x + 8) {
            int index = (mouseX - x - 8) / 43; JsonArray effects = status.has("effects") ? status.getAsJsonArray("effects") : new JsonArray();
            if (index >= 0 && index < Math.min(effects.size(),8)) {
                List<Text> tooltip = new ArrayList<>(); int end = index == 7 ? effects.size() : index + 1;
                for (int i = index; i < end; i++) { JsonObject effect = effects.get(i).getAsJsonObject(); tooltip.add(Text.literal(Text.translatable(effect.get("key").getAsString()).getString() + " " + effect.get("level").getAsInt() + " · " + duration(effect))); }
                context.drawTooltip(textRenderer, tooltip, mouseX, mouseY);
            }
        }
        if (mouseY >= y + 24 && mouseY <= y + 44 && mouseX >= x && mouseX <= x + 360)
            context.drawTooltip(textRenderer, Text.literal("吸收生命 " + format(number("absorption",0)) + " · 饱和度 " + format(number("saturation",0)) + " · 每 0.25 秒同步"), mouseX, mouseY);
    }
}
